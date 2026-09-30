import { authLockDb } from "./db.server";

// Shared by managed authentication and privacy erasure. Order is always auth
// lock (salt1), then lifecycle transaction lock (salt0); no Shopify token needed.
export async function withAuthLock<T>(domain: string, operation: () => Promise<T>): Promise<T> {
  return authLockDb.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${domain}, 1))`;
    return operation();
  }, { maxWait: 15000, timeout: 60000 });
}
