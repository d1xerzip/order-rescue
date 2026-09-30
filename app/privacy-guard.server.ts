import { createHmac, timingSafeEqual } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Prisma } from "@prisma/client";

export type DeletionEntry = { shopKey: string; orderKey: string; deletedAt: string };
function key() {
  const encoded = process.env.PRIVACY_LEDGER_KEY || "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error("PRIVACY_JOURNAL_UNAVAILABLE");
  return Buffer.from(encoded, "base64");
}
export function privacyHash(value: string) { return createHmac("sha256", key()).update(value).digest("hex"); }
export function deletionEntry(domain: string, orderId: string, now: Date): DeletionEntry {
  return { shopKey: privacyHash(`shop:${domain}`), orderKey: orderId ? privacyHash(`order:${domain}:${orderId}`) : "", deletedAt: now.toISOString() };
}
function journalPath() {
  const path = process.env.PRIVACY_JOURNAL_PATH || "";
  if (!isAbsolute(path)) throw new Error("PRIVACY_JOURNAL_UNAVAILABLE");
  return path;
}
// Fail closed on missing, truncated or unauthenticated journal. Provision an empty
// file explicitly, outside database backups; never auto-create after a restore.
export function readDeletionJournal(): DeletionEntry[] {
  const path = journalPath();
  if (!existsSync(path)) throw new Error("PRIVACY_JOURNAL_UNAVAILABLE");
  const data = readFileSync(path, "utf8");
  if (data && !data.endsWith("\n")) throw new Error("PRIVACY_JOURNAL_UNAVAILABLE");
  return data.split("\n").filter(Boolean).map(line => {
    try {
      const { entry, signature } = JSON.parse(line);
      if (!entry || Object.keys(entry).sort().join() !== "deletedAt,orderKey,shopKey" || !/^[a-f0-9]{64}$/.test(entry.shopKey) || !(entry.orderKey === "" || /^[a-f0-9]{64}$/.test(entry.orderKey)) || !Number.isFinite(Date.parse(entry.deletedAt)) || !/^[a-f0-9]{64}$/.test(signature)) throw Error();
      const expected = privacyHash(JSON.stringify(entry));
      if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"))) throw Error();
      return entry as DeletionEntry;
    } catch { throw new Error("PRIVACY_JOURNAL_UNAVAILABLE"); }
  });
}
// Must be called under the shop transaction lock BEFORE deleting data. A failed
// database commit may over-block; it can never silently resurrect erased data.
export function appendDeletionJournal(entry: DeletionEntry) {
  readDeletionJournal();
  const fd = openSync(journalPath(), "a");
  try { writeSync(fd, JSON.stringify({ entry, signature: privacyHash(JSON.stringify(entry)) }) + "\n"); fsyncSync(fd); }
  finally { closeSync(fd); }
}
export async function privacyBlocked(tx: Prisma.TransactionClient, domain: string, orderId?: string, installedAt?: Date) {
  const entries = readDeletionJournal();
  const shopKey = privacyHash(`shop:${domain}`);
  const orderKey = orderId ? privacyHash(`order:${domain}:${orderId}`) : undefined;
  const relevant = (entry: { shopKey: string; orderKey: string; deletedAt: Date | string }) => entry.shopKey === shopKey && (
    entry.orderKey === "" ? !installedAt || installedAt <= new Date(entry.deletedAt) : orderKey === entry.orderKey);
  if (entries.some(relevant)) return true;
  const markers = await tx.privacyDeletion.findMany({ where: { shopKey, orderKey: { in: ["", ...(orderKey ? [orderKey] : [])] } } });
  if (markers.some(relevant)) return true;
  return Boolean(await tx.privacyReceipt.findFirst({ where: {
    shopDomain: domain, status: { not: "completed" }, OR: [ { topic: "shop/redact" },
      ...(orderId ? [{ topic: "customers/redact", payload: { path: ["orders_to_redact"], array_contains: [orderId.split("/").at(-1)!] } }] : []) ],
  }, select: { id: true } }));
}
