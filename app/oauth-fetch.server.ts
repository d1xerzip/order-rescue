import { authOperation } from "./auth-lock.server";

export const OAUTH_TIMEOUT_MS = 10_000;
// Public Shopify runtime hook. Native fetch retains this signal while the SDK
// consumes response.json(), so the deadline covers headers AND response body.
export const oauthFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.protocol !== "https:" || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(url.hostname) || url.pathname !== "/admin/oauth/access_token")
    return globalThis.fetch(input, init);
  const signals = [AbortSignal.timeout(OAUTH_TIMEOUT_MS)];
  const operation = authOperation(url.hostname);
  if (operation) signals.push(operation.controller.signal);
  if (input instanceof Request) signals.push(input.signal);
  if (init?.signal) signals.push(init.signal);
  return globalThis.fetch(input, { ...init, signal: AbortSignal.any(signals) });
};
