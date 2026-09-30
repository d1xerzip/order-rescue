import { authLockDb } from "./db.server";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";

type AuthOperation = { domain: string; tx: Prisma.TransactionClient; active: boolean; controller: AbortController };
const operations = new AsyncLocalStorage<AuthOperation>();
export function authOperation(domain?: string) {
  const current = operations.getStore();
  if (current && (!current.active || (domain !== undefined && current.domain !== domain)))
    throw new Error("STALE_AUTH_OPERATION");
  return current;
}

// Shared by managed authentication and privacy erasure. Order is always auth
// lock (salt1), then lifecycle transaction lock (salt0); no Shopify token needed.
export async function withAuthLock<T>(domain: string, operation: () => Promise<T>): Promise<T> {
  return authLockDb.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${domain}, 1))`;
    const current: AuthOperation = { domain, tx, active: true, controller: new AbortController() };
    return operations.run(current, async () => {
      try { return await operation(); }
      finally { current.active = false; current.controller.abort(); }
    });
  }, { maxWait: 15000, timeout: 60000 });
}
