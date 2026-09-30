import { randomUUID } from "node:crypto";
import type { Prisma, Shop } from "@prisma/client";
import prisma from "./db.server";
import { openOrder } from "./order-crypto.server";
import { OrderApiError } from "./order-api.server";
import { SnapshotError } from "./order-snapshot.server";
import { privacyBlocked } from "./privacy-guard.server";

const DAY = 86_400_000;
const INTERVAL = 300_000;
const LEASE = 60_000;
export type SyncPage = {
  orders: Array<{ id: string; createdAt: string; updatedAt: string }>;
  hasNextPage: boolean;
  endCursor: string | null;
};
export type SyncPageFetcher = (input: {
  shop: Shop; windowStart: Date; windowEnd: Date; cursor: string | null;
}) => Promise<SyncPage>;

// Lock ordering matches ingestion: lifecycle advisory lock, then Shop row.
async function guard(tx: Prisma.TransactionClient, shopId: string) {
  const hint = await tx.shop.findUnique({ where: { id: shopId } });
  if (!hint) throw new Error("INACTIVE_INSTALLATION");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hint.domain}, 0))`;
  await tx.$queryRaw`SELECT "id" FROM "Shop" WHERE "id" = ${shopId} FOR UPDATE`;
  const shop = await tx.shop.findUniqueOrThrow({ where: { id: shopId } });
  if (!shop.active || !shop.jobsEnabled) throw new Error("INACTIVE_INSTALLATION");
  if (await privacyBlocked(tx,shop.domain,undefined,shop.installedAt)) throw new Error("PRIVACY_PENDING");
  return shop;
}
function pendingIds(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== "string"))
    throw new Error("INVALID_CHECKPOINT");
  return value as string[];
}
function usable(encrypted: string, context: string) {
  try {
    const value = JSON.parse(openOrder(encrypted, context));
    return value.cancelledAt?.available === true && value.total?.available === true && value.lines?.available === true;
  } catch { return false; }
}

// One durable step. Network I/O is outside transactions. A page checkpoint is
// committed only after every discovered order has a usable persisted snapshot.
export async function advanceOrderSync(shopId: string, fetchPage: SyncPageFetcher, now = new Date()) {
  const claim = await prisma.$transaction(async tx => {
    const shop = await guard(tx, shopId);
    let state = await tx.orderSyncState.findUnique({ where: { shopId } });
    if (state && state.generation !== shop.generation) {
      await tx.orderSyncState.delete({ where: { shopId } });
      state = null;
    }
    if (!state) state = await tx.orderSyncState.create({ data: { shopId, generation: shop.generation, nextRunAt: now } });
    if (state.phase === "failed" || state.nextRunAt > now || (state.leaseUntil && state.leaseUntil > now)) return null;
    if (state.phase === "waiting") {
      const ids = pendingIds(state.pendingJobIds);
      const receivedJobs = await tx.orderJob.findMany({ where: { id: { in: ids }, shopId, generation: shop.generation } });
      const jobs = [];
      // Redaction can be received while a page is waiting. Those orders are
      // deliberately absent; their removal must not make synchronization wait
      // forever or classify erased fields as unavailable.
      for (const job of receivedJobs) if (!await privacyBlocked(tx,shop.domain,job.orderId,shop.installedAt)) jobs.push(job);
      const missing = receivedJobs.length !== ids.length;
      const failed = jobs.some(job => job.status === "failed");
      if (missing || failed) {
        await tx.orderSyncState.update({ where: { shopId }, data: { phase: "failed", lastError: missing ? "SYNC_JOBS_EXPIRED" : "SYNC_ORDER_FAILED" } });
        return null;
      }
      if (jobs.some(job => job.status !== "completed")) return null;
      const snapshots = await tx.orderSnapshot.findMany({ where: { shopId, generation: shop.generation, orderId: { in: jobs.map(job => job.orderId) }, expiresAt: { gt: now } } });
      if (jobs.some(job => !snapshots.some(snapshot => snapshot.orderId === job.orderId && (!job.minimumUpdatedAt || snapshot.orderUpdatedAt >= job.minimumUpdatedAt) && usable(snapshot.encryptedSnapshot, `${shopId}:${shop.generation}:${job.orderId}`)))) {
        await tx.orderSyncState.update({ where: { shopId }, data: { phase: "failed", lastError: "SYNC_FIELDS_UNAVAILABLE" } });
        return null;
      }
      state = await tx.orderSyncState.update({ where: { shopId }, data: {
        phase: state.pendingHasNextPage ? "scanning" : "idle", cursor: state.pendingCursor,
        pageNo: state.pageNo + 1, pendingJobIds: [], pendingCursor: null, pendingHasNextPage: false,
        attempts: 0, lastError: null,
        ...(state.pendingHasNextPage ? {} : { lastSuccessAt: now, nextRunAt: new Date(now.getTime() + INTERVAL) }),
      } });
      if (state.phase === "idle") return null;
    }
    if (state.phase === "idle") {
      state = await tx.orderSyncState.update({ where: { shopId }, data: {
        phase: "scanning", runId: randomUUID(), windowStart: new Date(Math.max(shop.installedAt.getTime(), now.getTime() - 30 * DAY)),
        windowEnd: now, cursor: null, pageNo: 0, attempts: 0, lastError: null,
      } });
    }
    if (state.attempts >= 3 || state.pageNo >= 500) {
      await tx.orderSyncState.update({ where: { shopId }, data: { phase: "failed", lastError: state.pageNo >= 500 ? "SYNC_WINDOW_LIMIT" : "SYNC_ATTEMPTS_EXHAUSTED", leaseToken: null, leaseUntil: null } });
      return null;
    }
    const token = randomUUID();
    state = await tx.orderSyncState.update({ where: { shopId }, data: { phase: "scanning", leaseToken: token, leaseUntil: new Date(now.getTime() + LEASE), attempts: { increment: 1 } } });
    return { shop, state, token };
  });
  if (!claim) return { advanced: false };
  const { shop, state, token } = claim;
  // Injected clock is used only for deterministic tests. A live lease must expire
  // against wall clock even if the upstream request stalls.
  const started = Date.now();
  const clock = () => new Date(now.getTime() + Date.now() - started);
  try {
    if (!state.windowStart || !state.windowEnd || !state.runId) throw new Error("INVALID_CHECKPOINT");
    await prisma.$transaction(async tx => {
      const currentShop = await guard(tx,shopId);
      const current = await tx.orderSyncState.findUnique({where:{shopId}});
      if (currentShop.generation !== state.generation || current?.leaseToken !== token || !current.leaseUntil || current.leaseUntil <= clock())
        throw new Error("SYNC_LEASE_LOST");
    });
    const page = await fetchPage({ shop, windowStart: state.windowStart, windowEnd: state.windowEnd, cursor: state.cursor });
    if (!Array.isArray(page.orders) || page.orders.length > 50 || typeof page.hasNextPage !== "boolean" ||
      (page.hasNextPage && (!page.endCursor || page.endCursor === state.cursor))) throw new Error("INVALID_SYNC_PAGE");
    const ids = new Set<string>();
    for (const order of page.orders) {
      const created = Date.parse(order.createdAt), updated = Date.parse(order.updatedAt);
      if (!/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(order.id) || ids.has(order.id) || !Number.isFinite(created) || !Number.isFinite(updated) || updated < created || created < state.windowStart.getTime() || created > state.windowEnd.getTime()) throw new Error("INVALID_SYNC_PAGE");
      ids.add(order.id);
    }
    await prisma.$transaction(async tx => {
      const currentShop = await guard(tx, shopId);
      const current = await tx.orderSyncState.findUniqueOrThrow({ where: { shopId } });
      if (currentShop.generation !== state.generation || current.leaseToken !== token || !current.leaseUntil || current.leaseUntil <= clock()) throw new Error("SYNC_LEASE_LOST");
      const jobIds: string[] = [];
      for (const order of page.orders) {
        if (await privacyBlocked(tx,currentShop.domain,order.id,currentShop.installedAt)) continue;
        const deliveryId = `sync:${state.runId}:${state.pageNo}:${order.id}`;
        const previous = await tx.orderJob.findUnique({ where: { shopId_generation_deliveryId: { shopId, generation: state.generation, deliveryId } } });
        // A replayed page can discover a newer revision under the same cursor.
        // Preserve the stronger minimum; completed old work must be reread.
        const stronger = previous && (!previous.minimumUpdatedAt || previous.minimumUpdatedAt < new Date(order.updatedAt));
        const job = await tx.orderJob.upsert({
          where: { shopId_generation_deliveryId: { shopId, generation: state.generation, deliveryId } }, update: stronger ? { minimumUpdatedAt: new Date(order.updatedAt), ...(previous.status === "completed" ? { status: "pending", attempts: 0, availableAt: clock() } : {}) } : {},
          create: { shopId, generation: state.generation, deliveryId, orderId: order.id, minimumUpdatedAt: new Date(order.updatedAt), receivedAt: clock(), availableAt: clock(), expiresAt: new Date(Math.min(clock().getTime() + 7 * DAY, Date.parse(order.createdAt) + 30 * DAY)) },
        });
        jobIds.push(job.id);
      }
      await tx.orderSyncState.update({ where: { shopId }, data: { phase: "waiting", pendingJobIds: jobIds, pendingCursor: page.endCursor, pendingHasNextPage: page.hasNextPage, leaseToken: null, leaseUntil: null, lastError: null } });
    });
    return { advanced: true };
  } catch (error) {
    const apiError = error instanceof OrderApiError || error instanceof SnapshotError;
    const hintedDelay = apiError && Number.isFinite(error.retryAfterMs) ? Math.max(0, error.retryAfterMs!) : 0;
    const delay = Math.min(3_600_000, Math.max(hintedDelay, Math.min(60_000 * 2 ** (state.attempts - 1), 900_000)));
    await prisma.orderSyncState.updateMany({ where: { shopId, generation: state.generation, leaseToken: token }, data: {
      phase: state.attempts >= 3 || hintedDelay > 3_600_000 ? "failed" : "retry", lastError: hintedDelay > 3_600_000 ? "THROTTLE_DELAY_EXCESSIVE" : apiError && error.code === "API_THROTTLED" ? "API_THROTTLED" : "SYNC_PAGE_UNAVAILABLE", leaseToken: null, leaseUntil: null,
      nextRunAt: new Date(clock().getTime() + delay),
    } });
    return { advanced: false };
  }
}

// Explicit operator retry restarts the bounded pass; abandoned jobs keep their
// normal retry/expiry semantics. No historical monitoring boundary is widened.
export async function resetOrderSync(shopId: string, now = new Date()) {
  await prisma.$transaction(async tx => {
    const shop = await guard(tx, shopId);
    const state = await tx.orderSyncState.findUnique({ where: { shopId } });
    if (!state || state.generation !== shop.generation || state.phase !== "failed") return;
    await tx.orderSyncState.update({ where: { shopId }, data: { phase: "idle", nextRunAt: now, attempts: 0, lastError: null, leaseToken: null, leaseUntil: null, pendingJobIds: [], pendingCursor: null, pendingHasNextPage: false } });
  });
}

export async function getOrderSyncStatus(shopId: string) {
  return prisma.$transaction(async tx => {
    const hint = await tx.shop.findUnique({where:{id:shopId}});
    if (!hint) throw new Error("INACTIVE_INSTALLATION");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hint.domain}, 0))`;
    const shop = await tx.shop.findUnique({ where: { id: shopId } });
    if (!shop?.active) throw new Error("INACTIVE_INSTALLATION");
    if (await privacyBlocked(tx,shop.domain,undefined,shop.installedAt)) throw new Error("PRIVACY_PENDING");
    const [state, backlog, failed] = await Promise.all([
      tx.orderSyncState.findFirst({ where: { shopId, generation: shop.generation } }),
      tx.orderJob.count({ where: { shopId, generation: shop.generation, status: { in: ["pending", "processing", "retry"] } } }),
      tx.orderJob.count({ where: { shopId, generation: shop.generation, status: "failed" } }),
    ]);
    return { phase: state?.phase ?? "not_started", lastSuccessAt: state?.lastSuccessAt ?? null, nextRunAt: state?.nextRunAt ?? null, lastError: state?.lastError ?? null, backlog, failed };
  });
}
