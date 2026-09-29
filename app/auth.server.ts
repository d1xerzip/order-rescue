import { authLockDb } from "./db.server";
import {
  authenticate,
  unauthenticated,
  sessionStorage,
} from "./shopify.server";
import { requireActiveShop } from "./storage.server";
import { localPreviewEnabled } from "./config.server";

const shopDomain = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
// This hint only selects a mutex; it never grants tenant access.
function lockHint(request: Request) {
  const url = new URL(request.url);
  const token =
    request.headers.get("authorization")?.replace(/^Bearer /i, "") ||
    url.searchParams.get("id_token");
  try {
    if (token) {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1], "base64url").toString(),
      );
      const domain = new URL(payload.dest).hostname;
      if (shopDomain.test(domain)) return domain;
    }
  } catch {
    /* Official authentication rejects malformed tokens. */
  }
  const hint = url.searchParams.get("shop") || "invalid-auth";
  return shopDomain.test(hint) ? hint : "invalid-auth";
}
export async function withAuthLock<T>(
  domain: string,
  operation: () => Promise<T>,
): Promise<T> {
  // Distinct from storage's lifecycle transaction lock (salt 0).
  return authLockDb.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${domain}, 1))`;
      return operation();
    },
    { maxWait: 15000, timeout: 60000 },
  );
}
export async function authenticateShopRequest(request: Request) {
  if (localPreviewEnabled())
    throw new Response("Shopify connection not configured", { status: 503 });
  return withAuthLock(lockHint(request), async () => {
    const context = await authenticate.admin(request);
    const shop = await requireActiveShop(context.session.shop);
    if (!shop) {
      await sessionStorage.deleteSession(context.session.id);
      throw new Response("Installation inactive", { status: 403 });
    }
    return { shop, context };
  });
}
// For future workers only. No route accepts a caller-supplied domain for this function.
export async function authenticatedBackground(
  domain: string,
  generation: number,
) {
  return withAuthLock(domain, async () => {
    const shop = await requireActiveShop(domain);
    if (!shop || !shop.jobsEnabled || shop.generation !== generation)
      throw new Error("INACTIVE_INSTALLATION");
    return unauthenticated.admin(domain); // SDK refreshes expiring offline tokens and persists rotation.
  });
}
