import { webhookApi } from "./shopify.server";
import { withAuthLock } from "./auth.server";
import {
  deactivateShop,
  receivePrivacy,
  type PrivacyTopic,
} from "./storage.server";
import prisma from "./db.server";

function canonicalShopId(value: unknown): string | null {
  if (typeof value === "string" && /^gid:\/\/shopify\/Shop\/\d+$/.test(value))
    return value;
  if (
    (typeof value === "string" && /^\d+$/.test(value)) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value > 0)
  )
    return `gid://shopify/Shop/${value}`;
  return null;
}

export async function lifecycleWebhook(
  request: Request,
  expectedTopic: string,
) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const rawBody = await request.text();
  const validation = await webhookApi.webhooks.validate({
    rawBody,
    rawRequest: request,
  });
  if (!validation.valid) return new Response(null, { status: 401 });
  if (
    (validation.topic.includes("/")
      ? validation.topic.toLowerCase()
      : validation.topic.toLowerCase().replace("_", "/")) !== expectedTopic
  )
    return new Response(null, { status: 400 });
  const { domain } = validation;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain))
    return new Response(null, { status: 400 });
  const deliveryId = request.headers.get("x-shopify-webhook-id");
  if (!deliveryId || deliveryId.length > 200)
    return new Response(null, { status: 400 });
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return new Response(null, { status: 400 });
  // The verified signature covers the body; match its domain when supplied.
  if (
    expectedTopic === "app/uninstalled" &&
    payload.myshopify_domain != null &&
    payload.myshopify_domain !== domain
  )
    return new Response(null, { status: 400 });
  if (
    expectedTopic.startsWith("customers/") ||
    expectedTopic === "shop/redact"
  ) {
    if (payload.shop_domain !== domain)
      return new Response(null, { status: 400 });
  }
  if (expectedTopic === "app/uninstalled") {
    await withAuthLock(domain, async () => {
      const shop = await prisma.shop.findUnique({ where: { domain } });
      if (
        payload.myshopify_domain == null &&
        (!shop?.shopifyId || shop.shopifyId !== canonicalShopId(payload.id))
      )
        throw new Response(null, { status: 400 });
      await deactivateShop(domain, deliveryId);
    });
  } else if (expectedTopic === "app/scopes_update") {
    const current = payload.current;
    if (!Array.isArray(current) || current.some((v) => typeof v !== "string"))
      return new Response(null, { status: 400 });
    await withAuthLock(domain, async () => {
      const shop = await prisma.shop.findUnique({ where: { domain } });
      if (
        !shop?.shopifyId ||
        shop.shopifyId !== canonicalShopId(payload.shop_id)
      )
        throw new Response(null, { status: 400 });
      if (!shop.active) return;
      await prisma.$transaction([
        prisma.session.updateMany({
          where: { shop: domain },
          data: { scope: current.join(",") },
        }),
        prisma.shop.update({
          where: { id: shop.id },
          data: { jobsEnabled: current.includes("read_orders") },
        }),
      ]);
    });
  } else {
    const ids =
      expectedTopic === "customers/data_request"
        ? payload.orders_requested
        : payload.orders_to_redact;
    if (
      expectedTopic !== "shop/redact" &&
      (!Array.isArray(ids) ||
        ids.some(
          (v) =>
            !Number.isSafeInteger(v) &&
            !(typeof v === "string" && /^\d+$/.test(v)),
        ))
    )
      return new Response(null, { status: 400 });
    // Retain only allowlisted identifiers. P02 stores no orders or customer profiles.
    await receivePrivacy(domain, expectedTopic as PrivacyTopic, deliveryId, {
      ...(expectedTopic === "customers/data_request"
        ? { orders_requested: ids, data_request: payload.data_request }
        : {}),
      ...(expectedTopic === "customers/redact"
        ? { orders_to_redact: ids }
        : {}),
    });
  }
  return new Response(null, { status: 200 });
}
