import { createHmac, timingSafeEqual } from "node:crypto";
import { receivePrivacy, type PrivacyTopic } from "./storage.server";

// Lossless integer tokens, without touching digits inside JSON strings. Shopify
// IDs can exceed JavaScript's safe integer range; no rounded routing identifiers.
export function parsePrivacyBody(raw: string): Record<string, unknown> {
  let result = "", quoted = false, escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      result += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') { quoted = true; result += c; }
    else if (/[0-9-]/.test(c)) {
      const token = raw.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0];
      if (!token) throw Error();
      result += /^[1-9]\d*$/.test(token) ? JSON.stringify(token) : token;
      i += token.length - 1;
    } else result += c;
  }
  const body = JSON.parse(result);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
  return body;
}
export async function receivePrivacyWebhook(request: Request, topic: string) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return new Response(null, { status: 503 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 1_048_576) { await reader.cancel(); return new Response(null, { status: 413 }); }
      chunks.push(value);
    }
  } catch { return new Response(null, { status: 400 }); }
  const bytes = Buffer.concat(chunks);
  const signature = request.headers.get("x-shopify-hmac-sha256") || "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(signature) || !timingSafeEqual(createHmac("sha256", secret).update(bytes).digest(), Buffer.from(signature, "base64"))) return new Response(null, { status: 401 });
  const domain = request.headers.get("x-shopify-shop-domain") || "";
  const delivery = request.headers.get("x-shopify-webhook-id") || "";
  if (!["customers/data_request", "customers/redact", "shop/redact"].includes(topic) || request.headers.get("x-shopify-topic") !== topic || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) || !/^[A-Za-z0-9-]{1,200}$/.test(delivery)) return new Response(null, { status: 400 });
  let body: Record<string, unknown>;
  try {
    body = parsePrivacyBody(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (body.shop_domain !== domain) throw Error();
    // Routing headers are not signed. Do not allow a signed customer payload to
    // be relabelled as whole-shop deletion by changing X-Shopify-Topic.
    if (topic === "shop/redact" && Object.keys(body).some(key => !["shop_id", "shop_domain"].includes(key))) throw Error();
    if (topic === "customers/redact" && (body.orders_requested !== undefined || body.data_request !== undefined)) throw Error();
    if (topic === "customers/data_request" && body.orders_to_redact !== undefined) throw Error();
    if (body.shop_id !== undefined && !(typeof body.shop_id === "string" && /^[1-9]\d*$/.test(body.shop_id))) throw Error();
    const ids = body[topic === "customers/data_request" ? "orders_requested" : "orders_to_redact"];
    if (topic !== "shop/redact" && (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !/^[1-9]\d*$/.test(id)))) throw Error();
  } catch { return new Response(null, { status: 400 }); }
  try {
    await receivePrivacy(domain, topic as PrivacyTopic, delivery, body);
    return new Response(null, { status: 200 });
  } catch (error) { return new Response(null, { status: error instanceof Error && error.message === "PRIVACY_SHOP_IDENTITY_CONFLICT" ? 400 : 503 }); }
}
