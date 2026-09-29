import { createHmac, timingSafeEqual } from "node:crypto";
import { acceptOrderJob } from "./order-jobs.server";

// No JSON parsing, database access or logging until the original bytes authenticate.
export async function receiveOrderCreated(request: Request, expectedTopic = "orders/create") {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (process.env.ORDER_INGESTION_ENABLED !== "1")
    return new Response(null, { status: 503 });
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) return new Response(null, { status: 503 });
  const reader = request.body?.getReader();
  if (!reader) return new Response(null, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1_048_576) {
        await reader.cancel();
        return new Response(null, { status: 413 });
      }
      chunks.push(value);
    }
  } catch {
    return new Response(null, { status: 400 });
  }
  const bytes = Buffer.concat(chunks);
  const signature = request.headers.get("x-shopify-hmac-sha256") || "";
  const expected = createHmac("sha256", secret).update(bytes).digest();
  if (
    !/^[A-Za-z0-9+/]{43}=$/.test(signature) ||
    !timingSafeEqual(expected, Buffer.from(signature, "base64"))
  )
    return new Response(null, { status: 401 });
  const domain = request.headers.get("x-shopify-shop-domain") || "";
  const deliveryId = request.headers.get("x-shopify-webhook-id") || "";
  if (
    !["orders/create", "orders/updated", "orders/cancelled"].includes(expectedTopic) ||
    request.headers.get("x-shopify-topic") !== expectedTopic ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) ||
    !/^[A-Za-z0-9-]{1,200}$/.test(deliveryId)
  )
    return new Response(null, { status: 400 });
  let orderId: string;
  try {
    const body = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    orderId = body.admin_graphql_api_id;
    if (
      typeof orderId !== "string" ||
      !/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(orderId)
    )
      return new Response(null, { status: 400 });
  } catch {
    return new Response(null, { status: 400 });
  }
  // Headers are routing hints, not signed tenant identity. Worker proves ownership
  // using this installed shop's credential before persisting any order snapshot.
  try {
    const receipt = await acceptOrderJob(domain, deliveryId, orderId);
    return new Response(null, { status: receipt.accepted ? 200 : 503 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
