import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "./db.server";
import { openOrder, sealOrder } from "./order-crypto.server";
import { appendDeletionJournal, deletionEntry, privacyBlocked, privacyHash, readDeletionJournal, type DeletionEntry } from "./privacy-guard.server";
import type { Principal } from "./exceptions.server";
import { withAuthLock } from "./auth-lock.server";

const DAY = 86_400_000;
async function lock(tx: Prisma.TransactionClient, domain: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${domain}, 0))`;
}
async function saveMarker(tx: Prisma.TransactionClient, entry: DeletionEntry) {
  const where = { shopKey_orderKey: { shopKey: entry.shopKey, orderKey: entry.orderKey } };
  const old = await tx.privacyDeletion.findUnique({ where });
  if (!old || old.deletedAt < new Date(entry.deletedAt)) await tx.privacyDeletion.upsert({ where, create: { ...entry, deletedAt: new Date(entry.deletedAt) }, update: { deletedAt: new Date(entry.deletedAt) } });
}
async function eraseOrders(tx: Prisma.TransactionClient, shopId: string, orderIds: string[]) {
  await tx.orderSnapshot.deleteMany({ where: { shopId, orderId: { in: orderIds } } }); // FK cascades evaluations/exceptions/history.
  await tx.orderJob.deleteMany({ where: { shopId, orderId: { in: orderIds } } });
  await tx.orderReadLock.deleteMany({ where: { shopId, orderId: { in: orderIds } } });
  await tx.orderSyncState.deleteMany({ where: { shopId } }); // No dangling page checkpoint.
}
async function eraseShop(tx: Prisma.TransactionClient, domain: string, cutoff: Date) {
  const shop = await tx.shop.findUnique({ where: { domain } });
  if (shop && shop.installedAt > cutoff) return;
  await tx.session.deleteMany({ where: { shop: domain } });
  await tx.shop.deleteMany({ where: { domain, installedAt: { lte: cutoff } } });
  await tx.lifecycleDelivery.deleteMany({ where: { shopDomain: domain } });
  await tx.privacyReceipt.updateMany({ where: { shopDomain: domain, topic: "customers/data_request" }, data: { encryptedExport: null, exportExpiresAt: null } });
}
// Restore is offline by operator procedure. The independent journal remains newer
// than the restored DB. Ordinary guards consult it even BEFORE this sweep runs.
export async function applyPrivacyJournal(now = new Date()) {
  const entries = readDeletionJournal();
  const shops = await prisma.shop.findMany();
  for (const hint of shops) await withAuthLock(hint.domain, () => prisma.$transaction(async tx => {
    await lock(tx, hint.domain);
    const shop = await tx.shop.findUnique({ where: { domain: hint.domain } });
    if (!shop) return;
    const relevant = entries.filter(entry => entry.shopKey === privacyHash(`shop:${shop.domain}`));
    for (const entry of relevant) await saveMarker(tx, entry);
    const shopMarker = relevant.filter(entry => entry.orderKey === "").sort((a,b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt))[0];
    if (shopMarker && shop.installedAt <= new Date(shopMarker.deletedAt)) { await eraseShop(tx, shop.domain, new Date(shopMarker.deletedAt)); return; }
    const ids = new Set([...await tx.orderSnapshot.findMany({ where: { shopId: shop.id }, select: { orderId: true } }), ...await tx.orderJob.findMany({ where: { shopId: shop.id }, select: { orderId: true } })].filter(row => relevant.some(entry => entry.orderKey === privacyHash(`order:${shop.domain}:${row.orderId}`))).map(row => row.orderId));
    if (ids.size) await eraseOrders(tx, shop.id, [...ids]);
    // Restored exports may contain erased order evidence, regardless of snapshot presence.
    if (relevant.some(entry => entry.orderKey !== "")) await tx.privacyReceipt.updateMany({ where: { shopDomain: shop.domain }, data: { encryptedExport: null, exportExpiresAt: null } });
    await tx.orderSnapshot.deleteMany({ where: { shopId: shop.id, expiresAt: { lte: now } } });
  }));
  // Journal may refer to shops entirely absent in the restored backup.
  for (const entry of entries) await prisma.$transaction(tx => saveMarker(tx, entry));
  // Session storage is not FK-linked to Shop. An isolated restored credential
  // must also be erased, including when its Shop row is absent from the backup.
  const sessionDomains = await prisma.session.findMany({ distinct: ["shop"], select: { shop: true } });
  for (const { shop: domain } of sessionDomains) {
    const marker = entries.filter(entry => entry.shopKey === privacyHash(`shop:${domain}`) && entry.orderKey === "").sort((a,b) => Date.parse(b.deletedAt)-Date.parse(a.deletedAt))[0];
    if (marker) await withAuthLock(domain, () => prisma.$transaction(async tx => {
      await lock(tx, domain);
      await eraseShop(tx, domain, new Date(marker.deletedAt));
    }));
  }
  return { entries: entries.length };
}
export async function processOnePrivacyJob(now = new Date(), options: { afterJournal?: () => void } = {}) {
  const token = randomUUID();
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH candidate AS (SELECT "id" FROM "PrivacyReceipt" WHERE
      (("status" IN ('pending','retry') AND "availableAt" <= (${now}::timestamptz AT TIME ZONE 'UTC')) OR ("status"='processing' AND "leaseUntil" <= (${now}::timestamptz AT TIME ZONE 'UTC')))
      AND "attempts" < 5 ORDER BY "receivedAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE "PrivacyReceipt" p SET "status"='processing', "attempts"="attempts"+1,
      "leaseToken"=${token}, "leaseUntil"=(${new Date(now.getTime()+60_000)}::timestamptz AT TIME ZONE 'UTC')
      FROM candidate c WHERE p."id"=c."id" RETURNING p."id"`;
  if (!claimed.length) return { processed: false };
  const id = claimed[0].id;
  try {
    const owner = await prisma.privacyReceipt.findUniqueOrThrow({ where: { id }, select: { shopDomain: true } });
    await withAuthLock(owner.shopDomain, () => prisma.$transaction(async tx => {
      const hint = await tx.privacyReceipt.findUniqueOrThrow({ where: { id } });
      await lock(tx, hint.shopDomain);
      const row = await tx.privacyReceipt.findUniqueOrThrow({ where: { id } });
      if (row.leaseToken !== token || row.status !== "processing" || !row.leaseUntil || row.leaseUntil <= new Date()) throw Error("LEASE_LOST");
      const payload = row.payload as Record<string, unknown>;
      const shop = await tx.shop.findUnique({ where: { domain: row.shopDomain } });
      const orders = (payload[row.topic === "customers/data_request" ? "orders_requested" : "orders_to_redact"] || []) as string[];
      const gids = orders.map(value => `gid://shopify/Order/${value}`);
      if (row.topic === "customers/data_request") {
        // The authenticated Shopify order list defines customer membership. We do
        // not collect Customer.id/profile or query extra protected fields.
        const records = [];
        let expiry = now.getTime() + 7 * DAY;
        if (shop) {
          if (await privacyBlocked(tx, row.shopDomain, undefined, shop.installedAt)) throw Error("PRIVACY_EXPORT_UNAVAILABLE");
          const snapshots = await tx.orderSnapshot.findMany({ where: { shopId: shop.id, orderId: { in: gids }, expiresAt: { gt: now } }, orderBy: { orderId: "asc" } });
          if (snapshots.length > 500) throw Error("EXPORT_LIMIT");
          for (const snapshot of snapshots) {
            // A retained but inaccessible record is unavailable, not an empty
            // customer result. Let redaction/sweep complete, then retry export.
            if (await privacyBlocked(tx, row.shopDomain, snapshot.orderId, shop.installedAt)) throw Error("PRIVACY_EXPORT_UNAVAILABLE");
            expiry = Math.min(expiry, snapshot.expiresAt.getTime());
            const context = `${shop.id}:${snapshot.generation}:${snapshot.orderId}`;
            const evaluations = await tx.ruleEvaluation.findMany({ where: { shopId: shop.id, generation: snapshot.generation, orderId: snapshot.orderId }, orderBy: { ruleKey: "asc" } });
            const exceptions = await tx.exceptionRecord.findMany({ where: { shopId: shop.id, generation: snapshot.generation, orderId: snapshot.orderId }, include: { history: { orderBy: { revision: "asc" } } } });
            records.push({ order: JSON.parse(openOrder(snapshot.encryptedSnapshot, context)), evaluations: evaluations.map(value => JSON.parse(openOrder(value.encryptedResult, `evaluation:${context}:${value.ruleKey}`))), exceptions: exceptions.map(value => ({ state: value.state, ruleKey: value.ruleKey, history: value.history.map(history => {
              const detail = JSON.parse(openOrder(history.encryptedDetail, `history:${context}:${value.ruleKey}:${value.id}:${history.id}`));
              delete detail.actor; // Staff identity is not customer export evidence.
              return { at: history.at, kind: history.kind, detail };
            }) })) });
          }
        }
        const result = JSON.stringify({ requestId: payload.requestId ?? null, records });
        if (Buffer.byteLength(result) > 5_000_000) throw Error("EXPORT_LIMIT");
        await tx.privacyReceipt.update({ where: { id }, data: { encryptedExport: sealOrder(result, `privacy-export:${id}:${row.shopDomain}`), exportExpiresAt: new Date(expiry) } });
      } else {
        // Compute after lock acquisition: an install/refresh that finished while
        // we waited must not escape the documented conservative tenant purge.
        const deletionAt = new Date(Math.max(now.getTime(), Date.now(), shop?.installedAt.getTime() ?? 0));
        const targets = row.topic === "shop/redact" ? [""] : gids;
        for (const orderId of targets) {
          const entry = deletionEntry(row.shopDomain, orderId, deletionAt);
          appendDeletionJournal(entry); // fsync BEFORE deletion/commit; restore-safe.
          options.afterJournal?.();
          await saveMarker(tx, entry);
        }
        if (row.topic === "shop/redact") await eraseShop(tx, row.shopDomain, deletionAt);
        else if (shop) await eraseOrders(tx, shop.id, gids);
        // Invalidate prepared exports in this shop; conservative, no extra data.
        await tx.privacyReceipt.updateMany({ where: { shopDomain: row.shopDomain }, data: { encryptedExport: null, exportExpiresAt: null } });
        // Completed redaction no longer needs plaintext erased order identifiers.
        await tx.privacyReceipt.update({ where: { id }, data: { payload: payload.customerKey ? { customerKey: payload.customerKey as string } : {} } });
      }
      await tx.privacyReceipt.update({ where: { id }, data: { status: "completed", completedAt: now, leaseToken: null, leaseUntil: null, errorCode: null } });
    }, { timeout: 30_000 }));
    return { processed: true, status: "completed", id };
  } catch {
    const row = await prisma.privacyReceipt.findUnique({ where: { id } });
    await prisma.privacyReceipt.updateMany({ where: { id, leaseToken: token }, data: { status: (row?.attempts ?? 5) >= 5 ? "failed" : "retry", errorCode: "PRIVACY_PROCESSING_UNAVAILABLE", leaseToken: null, leaseUntil: null, availableAt: new Date(now.getTime() + Math.min(60_000 * 2 ** (row?.attempts ?? 1), 900_000)) } });
    return { processed: true, status: "retry_or_failed", id };
  }
}
// Server-only handoff: principal must come from verified Shopify authentication.
// No public export endpoint, no external delivery or secrets in this return value.
export async function getPrivacyExport(principal: Principal, receiptId: string, now = new Date()) {
  return prisma.$transaction(async tx => {
    let shop = await tx.shop.findFirst({ where: { id: principal.shopId, generation: principal.generation, active: true } });
    if (!shop || !principal.actor) return null;
    await lock(tx, shop.domain);
    shop = await tx.shop.findFirst({ where: { id: principal.shopId, generation: principal.generation, active: true } });
    if (!shop) return null;
    if (await privacyBlocked(tx, shop.domain, undefined, shop.installedAt)) return null;
    const receipt = await tx.privacyReceipt.findFirst({ where: { id: receiptId, shopDomain: shop.domain, topic: "customers/data_request", status: "completed", exportExpiresAt: { gt: now } } });
    if (!receipt?.encryptedExport) return null;
    const result = JSON.parse(openOrder(receipt.encryptedExport, `privacy-export:${receipt.id}:${shop.domain}`));
    // Guard the actual prepared evidence. Requested IDs that were already
    // erased can legitimately be absent from a newly prepared empty export.
    for (const record of result.records) if (await privacyBlocked(tx, shop.domain, record.order.id, shop.installedAt)) return null;
    return result;
  });
}
export async function purgePrivacy(now = new Date()) {
  await prisma.privacyReceipt.updateMany({ where: { exportExpiresAt: { lte: now } }, data: { encryptedExport: null, exportExpiresAt: null } });
  await prisma.privacyReceipt.updateMany({ where: { status: "processing", attempts: { gte: 5 }, leaseUntil: { lte: now } }, data: { status: "failed", leaseToken: null, leaseUntil: null, errorCode: "PRIVACY_ATTEMPTS_EXHAUSTED" } });
  return prisma.privacyReceipt.deleteMany({ where: { status: "completed", completedAt: { lte: new Date(now.getTime() - 30 * DAY) }, OR: [{ topic: { not: "customers/data_request" } }, { deliveredAt: { not: null } }] } });
}

// Call only after a separately authorized, observed secure merchant handoff.
// Merely preparing or reading an export must never mark it delivered.
export async function markPrivacyExportDelivered(principal: Principal, receiptId: string, confirmedHandoff: boolean, now = new Date()) {
  if (confirmedHandoff !== true) throw new Error("HANDOFF_CONFIRMATION_REQUIRED");
  return prisma.$transaction(async tx => {
    const hint = await tx.shop.findUnique({ where: { id: principal.shopId } });
    if (!hint) return false;
    await lock(tx, hint.domain);
    const shop = await tx.shop.findFirst({ where: { id: principal.shopId, generation: principal.generation, active: true } });
    if (!shop || !principal.actor || await privacyBlocked(tx, shop.domain, undefined, shop.installedAt)) return false;
    const row = await tx.privacyReceipt.findFirst({ where: { id: receiptId, shopDomain: shop.domain, topic: "customers/data_request", status: "completed", encryptedExport: { not: null }, exportExpiresAt: { gt: now } } });
    if (!row) return false;
    const result = JSON.parse(openOrder(row.encryptedExport!, `privacy-export:${row.id}:${shop.domain}`));
    for (const record of result.records) if (await privacyBlocked(tx,shop.domain,record.order.id,shop.installedAt)) return false;
    if (!row.deliveredAt) await tx.privacyReceipt.update({ where: { id: row.id }, data: { deliveredAt: now, encryptedDelivery: sealOrder(JSON.stringify({ actor: principal.actor, at: now.toISOString(), reason: "VERIFIED_MERCHANT_HANDOFF" }), `privacy-delivery:${row.id}:${shop.domain}`) } });
    return true;
  });
}
export async function privacyStatus(now = new Date()) {
  const pending = await prisma.privacyReceipt.findMany({ where: { status: { not: "completed" } }, select: { receivedAt: true, status: true } });
  const handoffs = await prisma.privacyReceipt.findMany({ where: { topic: "customers/data_request", status: "completed", deliveredAt: null }, select: { receivedAt: true } });
  return { backlog: pending.length, failed: pending.filter(row => row.status === "failed").length, awaitingHandoff: handoffs.length, overdue: [...pending,...handoffs].filter(row => row.receivedAt.getTime() + 30 * DAY <= now.getTime()).length };
}
