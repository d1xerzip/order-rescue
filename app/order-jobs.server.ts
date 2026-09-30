import { randomUUID } from "node:crypto";
import type { OrderJob, Prisma, Shop } from "@prisma/client";
import prisma from "./db.server";
import { openOrder, sealOrder } from "./order-crypto.server";
import { validateShopDomain } from "./storage.server";
import { privacyBlocked } from "./privacy-guard.server";
import { SnapshotError } from "./order-snapshot.server";
import { loadRuleSettings, persistRuleEvaluations } from "./exceptions.server";
import { evaluateStoredOrderRules } from "./order-evaluation.server";
import { validateHighOrderValueSettings } from "./rules/high-order-value";
import { validateHighLineQuantitySettings } from "./rules/high-line-quantity";
import type { HighLineQuantitySettings, HighOrderValueSettings, RuleResult } from "./rules/contracts";

const DAY = 86_400_000;
const MAX_ATTEMPTS = 5;
const LEASE_MS = 60_000;
const orderIdPattern = /^gid:\/\/shopify\/Order\/[1-9]\d*$/;

async function lifecycleLock(tx: Prisma.TransactionClient, domain: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${domain}, 0))`;
}

// Caller must verify the original request bytes first. Store only the routing ID;
// ownership and the order snapshot are obtained with this shop's server token.
export async function acceptOrderJob(
  domain: string,
  deliveryId: string,
  orderId: string,
) {
  validateShopDomain(domain);
  if (!deliveryId || deliveryId.length > 200 || !orderIdPattern.test(orderId))
    throw new Error("INVALID_DELIVERY");
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '1250ms'`;
      await tx.$executeRaw`SET LOCAL lock_timeout = '1000ms'`;
      await lifecycleLock(tx, domain);
      const shop = await tx.shop.findUnique({ where: { domain } });
      if (!shop?.active || !shop.jobsEnabled)
        return { accepted: false, duplicate: false };
      if (await privacyBlocked(tx, domain, orderId, shop.installedAt))
        return { accepted: false, duplicate: false };
      const key = { shopId: shop.id, generation: shop.generation, deliveryId };
      const existing = await tx.orderJob.findUnique({
        where: { shopId_generation_deliveryId: key },
      });
      if (existing) {
        if (existing.orderId !== orderId) throw new Error("DELIVERY_CONFLICT");
        return { accepted: true, duplicate: true, jobId: existing.id };
      }
      const receivedAt = new Date();
      const job = await tx.orderJob.create({
        data: {
          ...key,
          orderId,
          receivedAt,
          availableAt: receivedAt,
          expiresAt: new Date(receivedAt.getTime() + 7 * DAY),
        },
      });
      return { accepted: true, duplicate: false, jobId: job.id };
    },
    { maxWait: 500, timeout: 1500 },
  );
}

export async function claimOrderJob(
  now = new Date(),
): Promise<OrderJob | null> {
  const leaseToken = randomUUID();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  // One statement: competing workers cannot claim the same row. Expired leases
  // are reclaimable; lease tokens fence all subsequent writes.
  const jobs = await prisma.$queryRaw<OrderJob[]>`
    WITH candidate AS (
      SELECT j."id" FROM "OrderJob" j JOIN "Shop" s ON s."id" = j."shopId"
      WHERE j."attempts" < ${MAX_ATTEMPTS} AND j."expiresAt" > (${now}::timestamptz AT TIME ZONE 'UTC')
        AND s."active" AND s."jobsEnabled" AND s."generation" = j."generation"
        AND ((j."status" IN ('pending','retry') AND j."availableAt" <= (${now}::timestamptz AT TIME ZONE 'UTC'))
          OR (j."status" = 'processing' AND j."leaseUntil" <= (${now}::timestamptz AT TIME ZONE 'UTC')))
      ORDER BY j."availableAt", j."id" FOR UPDATE OF j SKIP LOCKED LIMIT 1
    )
    UPDATE "OrderJob" j SET "status" = 'processing', "attempts" = j."attempts" + 1,
      "leaseToken" = ${leaseToken}, "leaseUntil" = (${leaseUntil}::timestamptz AT TIME ZONE 'UTC'), "errorCode" = NULL
    FROM candidate WHERE j."id" = candidate."id" RETURNING j.*`;
  return jobs[0] ?? null;
}

export type IngestedSnapshot = {
  id: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
};
export type SnapshotLoader = (
  job: OrderJob,
  shop: Shop,
) => Promise<IngestedSnapshot>;

export async function processOneOrderJob(
  loadSnapshot: SnapshotLoader,
  options: { now?: Date; afterWrite?: () => Promise<void> | void;
    valueSettings?: HighOrderValueSettings | null; quantitySettings?: HighLineQuantitySettings | null } = {},
): Promise<{ processed: boolean; status?: string; jobId?: string; evaluation?: RuleResult; evaluations?: ReturnType<typeof evaluateStoredOrderRules> }> {
  // Explicit settings injection is only a disposable-test compatibility seam.
  // Ordinary workers resolve current persisted settings under the Shop lock.
  const injected = options.valueSettings !== undefined || options.quantitySettings !== undefined;
  if (injected && (process.env.RUN_MODE !== "test" || process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB !== "1"))
    throw new Error("TEST_SETTINGS_OVERRIDE_FORBIDDEN");
  const valueSettings = structuredClone(options.valueSettings ?? null);
  const quantitySettings = structuredClone(options.quantitySettings ?? null);
  let evaluations: ReturnType<typeof evaluateStoredOrderRules> | undefined;
  const now = options.now ?? new Date();
  const job = await claimOrderJob(now);
  if (!job) return { processed: false };
  const clock = () => options.now ?? new Date();
  const readKey = { shopId: job.shopId, generation: job.generation, orderId: job.orderId };
  const releaseRead = () => prisma.orderReadLock.deleteMany({where: {...readKey, token: job.leaseToken!}});
  try {
    const shop = await prisma.$transaction(async tx => {
      const hint = await tx.shop.findUniqueOrThrow({where:{id:job.shopId}});
      await lifecycleLock(tx,hint.domain);
      const current = await tx.shop.findUniqueOrThrow({where:{id:job.shopId}});
      if (!current.active || !current.jobsEnabled || current.generation !== job.generation)
        throw new Error("INACTIVE_INSTALLATION");
      if (await privacyBlocked(tx,current.domain,job.orderId,current.installedAt))
        throw new Error("PRIVACY_PENDING");
      return current;
    });
    const acquired = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${job.shopId}:${job.generation}:${job.orderId}`}, 2))`;
      const existing = await tx.orderReadLock.findUnique({where:{shopId_generation_orderId:readKey}});
      if (existing && existing.expiresAt > clock()) return false;
      await tx.orderReadLock.upsert({where:{shopId_generation_orderId:readKey},create:{...readKey,token:job.leaseToken!,expiresAt:job.leaseUntil!},update:{token:job.leaseToken!,expiresAt:job.leaseUntil!}});
      return true;
    });
    if (!acquired) throw new Error("ORDER_BUSY");
    if (valueSettings) validateHighOrderValueSettings(shop.id, valueSettings);
    if (quantitySettings) validateHighLineQuantitySettings(shop.id, quantitySettings);
    const snapshot = await loadSnapshot(job, shop);
    const createdAt = new Date(snapshot.createdAt);
    const updatedAt = new Date(snapshot.updatedAt);
    if (job.minimumUpdatedAt && updatedAt < job.minimumUpdatedAt)
      throw new Error("SNAPSHOT_BEHIND_DISCOVERY");
    if (
      snapshot.id !== job.orderId ||
      !Number.isFinite(createdAt.getTime()) ||
      !Number.isFinite(updatedAt.getTime()) ||
      updatedAt < createdAt
    )
      throw new Error("INVALID_SNAPSHOT");
    const expiresAt = new Date(createdAt.getTime() + 30 * DAY);
    const encryptedSnapshot = sealOrder(
      JSON.stringify(snapshot),
      `${job.shopId}:${job.generation}:${job.orderId}`,
    );
    await prisma.$transaction(async (tx) => {
      await lifecycleLock(tx, shop.domain);
      // Global order: lifecycle advisory lock -> shop row -> job row. Scope
      // updates serialize on Shop; claimers skip this locked OrderJob row.
      await tx.$queryRaw`SELECT "id" FROM "Shop" WHERE "id" = ${shop.id} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "OrderJob" WHERE "id" = ${job.id} FOR UPDATE`;
      const current = await tx.shop.findUniqueOrThrow({
        where: { id: shop.id },
      });
      const claimed = await tx.orderJob.findFirst({
        where: {
          id: job.id,
          status: "processing",
          leaseToken: job.leaseToken,
          leaseUntil: { gt: clock() },
          expiresAt: { gt: clock() },
        },
      });
      if (!claimed) throw new Error("LEASE_LOST");
      if (claimed.minimumUpdatedAt && updatedAt < claimed.minimumUpdatedAt)
        throw new Error("SNAPSHOT_BEHIND_DISCOVERY");
      await tx.$queryRaw`SELECT "token" FROM "OrderReadLock" WHERE "shopId"=${job.shopId} AND "generation"=${job.generation} AND "orderId"=${job.orderId} FOR UPDATE`;
      const readLock = await tx.orderReadLock.findUnique({where:{shopId_generation_orderId:readKey}});
      if (!readLock || readLock.token !== job.leaseToken || readLock.expiresAt <= clock()) throw new Error("LEASE_LOST");
      if (
        !current.active ||
        !current.jobsEnabled ||
        current.generation !== job.generation
      )
        throw new Error("INACTIVE_INSTALLATION");
      if (await privacyBlocked(tx,current.domain,job.orderId,current.installedAt))
        throw new Error("PRIVACY_PENDING");
      if (
        createdAt < current.installedAt ||
        createdAt > clock() ||
        expiresAt <= clock()
      )
        throw new Error("OUTSIDE_MONITORING_WINDOW");
      const key = {
        shopId: job.shopId,
        generation: job.generation,
        orderId: job.orderId,
      };
      const existing = await tx.orderSnapshot.findUnique({
        where: { shopId_generation_orderId: key },
      });
      if (!existing)
        await tx.orderSnapshot.create({
          data: {
            ...key,
            encryptedSnapshot,
            orderCreatedAt: createdAt,
            orderUpdatedAt: updatedAt,
            expiresAt,
          },
        });
      // All sources reread under the same durable per-order fence. A matching
      // timestamp is not a revision ID: a later stable authoritative read may
      // repair different fields at equal time. Identical replays remain no-ops.
      else if (existing.orderUpdatedAt <= updatedAt && openOrder(existing.encryptedSnapshot, `${job.shopId}:${job.generation}:${job.orderId}`) !== JSON.stringify(snapshot))
        await tx.orderSnapshot.update({
          where: { id: existing.id },
          data: { encryptedSnapshot, orderUpdatedAt: updatedAt, expiresAt },
        });
      const selected = existing && existing.orderUpdatedAt > updatedAt
        ? JSON.parse(openOrder(existing.encryptedSnapshot, `${job.shopId}:${job.generation}:${job.orderId}`))
        : snapshot;
      const configured = injected ? { valueSettings, quantitySettings } : await loadRuleSettings(tx, current);
      const evaluatedAt = clock();
      evaluations = evaluateStoredOrderRules(selected, {
        shopId: current.id, generation: current.generation,
        active: current.active && current.jobsEnabled,
        monitoringStartedAt: current.installedAt.toISOString(),
        evaluatedAt: evaluatedAt.toISOString(),
      }, configured.valueSettings, configured.quantitySettings);
      if (!injected) {
        const stored = await tx.orderSnapshot.findUniqueOrThrow({ where: { shopId_generation_orderId: key } });
        await persistRuleEvaluations(tx, current, stored, evaluations, evaluatedAt);
      }
      await tx.orderJob.update({
        where: { id: job.id },
        data: {
          expiresAt: new Date(
            Math.min(job.expiresAt.getTime(), expiresAt.getTime()),
          ),
        },
      });
    });
  } catch (error) {
    const safeCodes = new Set([
      "INVALID_SNAPSHOT",
      "LEASE_LOST",
      "INACTIVE_INSTALLATION",
      "OUTSIDE_MONITORING_WINDOW",
      "PRIVACY_PENDING",
      "ORDER_BUSY",
      "SNAPSHOT_BEHIND_DISCOVERY",
      "INVALID_CONFIGURATION",
      "RULE_TENANT_MISMATCH",
    ]);
    const code =
      error instanceof SnapshotError && error.code === "API_THROTTLED"
        ? "API_THROTTLED"
        : error instanceof Error && safeCodes.has(error.message)
        ? error.message
        : "ORDER_FETCH_FAILED";
    const terminal =
      code === "INACTIVE_INSTALLATION" ||
      code === "OUTSIDE_MONITORING_WINDOW" ||
      code === "PRIVACY_PENDING" ||
      code === "INVALID_CONFIGURATION" ||
      code === "RULE_TENANT_MISMATCH" ||
      job.attempts >= MAX_ATTEMPTS;
    const result = await prisma.orderJob.updateMany({
      where: {
        id: job.id,
        status: "processing",
        leaseToken: job.leaseToken,
        leaseUntil: { gt: clock() },
      },
      data: {
        status: terminal ? "failed" : "retry",
        errorCode: code,
        leaseToken: null,
        leaseUntil: null,
        availableAt: new Date(
          clock().getTime() +
            Math.max(Math.min(60_000 * 2 ** (job.attempts - 1), 900_000),
              error instanceof SnapshotError && Number.isFinite(error.retryAfterMs)
                ? Math.max(0, error.retryAfterMs!) : 0),
        ),
      },
    });
    await releaseRead();
    return {
      processed: true,
      status: result.count ? (terminal ? "failed" : "retry") : "lease_lost",
      jobId: job.id,
    };
  }
  // Intentional separate transaction: snapshot, evaluations and exception history
  // are durable together. Crash replay is idempotent and the lease is reclaimable.
  await options.afterWrite?.();
  const result = await prisma.$transaction(async tx => {
    const hint = await tx.shop.findUnique({where:{id:job.shopId}});
    if (!hint) return {count:0,blocked:false};
    await lifecycleLock(tx,hint.domain);
    const current = await tx.shop.findUnique({where:{id:job.shopId}});
    if (!current?.active || !current.jobsEnabled || current.generation !== job.generation)
      return {count:0,blocked:false};
    const blocked = await privacyBlocked(tx,current.domain,job.orderId,current.installedAt);
    const updated = await tx.orderJob.updateMany({
      where: {id:job.id,status:"processing",leaseToken:job.leaseToken,leaseUntil:{gt:clock()}},
      data: {status:blocked ? "failed" : "completed",leaseToken:null,leaseUntil:null,errorCode:blocked ? "PRIVACY_PENDING" : null},
    });
    // A privacy request received after the snapshot transaction must suppress
    // its in-memory evidence as well as prevent completion/replay writes.
    return {count:blocked ? 0 : updated.count,blocked};
  });
  await releaseRead();
  return {
    processed: true,
    status: result.blocked ? "failed" : result.count ? "completed" : "lease_lost",
    jobId: job.id,
    // Never expose evidence on failure, lost lease or afterWrite crash. This is
    // internal response only; persisted results remain behind authenticated reads.
    // Worker logs continue to select operation/status.
    ...(result.count ? { evaluation: evaluations?.high_order_value, evaluations } : {}),
  };
}

export async function purgeExpiredOrders(now = new Date()) {
  return prisma.$transaction(async (tx) => {
    await tx.orderReadLock.deleteMany({ where: { expiresAt: { lte: now } } });
    await tx.$executeRaw`
      UPDATE "OrderJob" j SET "status" = 'failed', "errorCode" = 'INACTIVE_INSTALLATION',
        "leaseToken" = NULL, "leaseUntil" = NULL
      FROM "Shop" s WHERE j."shopId" = s."id"
        AND j."status" IN ('pending', 'retry', 'processing')
        AND (NOT s."active" OR NOT s."jobsEnabled" OR s."generation" <> j."generation")`;
    await tx.orderJob.updateMany({
      where: {
        status: "processing",
        attempts: { gte: MAX_ATTEMPTS },
        leaseUntil: { lte: now },
      },
      data: {
        status: "failed",
        errorCode: "ATTEMPTS_EXHAUSTED",
        leaseToken: null,
        leaseUntil: null,
      },
    });
    const snapshots = await tx.orderSnapshot.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    const jobs = await tx.orderJob.deleteMany({
      where: { expiresAt: { lte: now } },
    });
    return { snapshots: snapshots.count, jobs: jobs.count };
  });
}
