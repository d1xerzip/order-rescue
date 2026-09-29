import type { Prisma } from "@prisma/client";
import prisma from "./db.server";

export function validateShopDomain(domain: string): string {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
    throw new Error("Invalid shop domain");
  }
  return domain;
}

async function lockShop(tx: Prisma.TransactionClient, domain: string) {
  validateShopDomain(domain);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${domain}, 0))`;
}

// Call only after Shopify's successful token exchange, never from a supplied shop ID.
export async function activateShop(shopDomain: string, shopifyId?: string) {
  if (
    shopifyId !== undefined &&
    !/^gid:\/\/shopify\/Shop\/[1-9]\d*$/.test(shopifyId)
  )
    throw new Error("Invalid Shopify shop identifier");
  return prisma.$transaction(async (tx) => {
    await lockShop(tx, shopDomain);
    const existing = await tx.shop.findUnique({
      where: { domain: shopDomain },
    });
    if (shopifyId && existing?.shopifyId && existing.shopifyId !== shopifyId)
      throw new Error("Shop identity conflict");
    if (shopifyId) {
      const bound = await tx.shop.findUnique({ where: { shopifyId } });
      if (bound && bound.domain !== shopDomain)
        throw new Error("Shop identity conflict");
    }
    const shop = existing?.active
      ? shopifyId && !existing.shopifyId
        ? await tx.shop.update({
            where: { id: existing.id },
            data: { shopifyId },
          })
        : existing
      : existing
        ? await tx.shop.update({
            where: { id: existing.id },
            data: {
              active: true,
              jobsEnabled: true,
              generation: { increment: 1 },
              installedAt: new Date(),
              uninstalledAt: null,
              ...(shopifyId ? { shopifyId } : {}),
            },
          })
        : await tx.shop.create({
            data: { domain: shopDomain, shopifyId, installedAt: new Date() },
          });
    await tx.workspaceRecord.upsert({
      where: { shopId: shop.id },
      update: {},
      create: { shopId: shop.id },
    });
    return shop;
  });
}

export async function requireActiveShop(shopDomain: string) {
  validateShopDomain(shopDomain);
  return prisma.shop.findFirst({ where: { domain: shopDomain, active: true } });
}

export async function deactivateShop(
  shopDomain: string,
  deliveryId: string,
  triggeredAt?: Date,
) {
  return prisma.$transaction(async (tx) => {
    await lockShop(tx, shopDomain);
    const duplicate = await tx.lifecycleDelivery.findUnique({
      where: { shopDomain_deliveryId: { shopDomain, deliveryId } },
    });
    if (duplicate) return { duplicate: true, stale: false };
    const shop = await tx.shop.findUnique({ where: { domain: shopDomain } });
    const validTimestamp =
      triggeredAt && Number.isFinite(triggeredAt.getTime())
        ? triggeredAt
        : undefined;
    const stale = Boolean(
      shop && validTimestamp && validTimestamp < shop.installedAt,
    );
    // Delivery headers are not covered by the body HMAC. Never preserve access
    // solely because a timestamp claims to predate this installation.
    await tx.lifecycleDelivery.create({
      data: { shopDomain, deliveryId, triggeredAt: validTimestamp },
    });
    await tx.shop.updateMany({
      where: { domain: shopDomain },
      data: { active: false, jobsEnabled: false, uninstalledAt: new Date() },
    });
    await tx.session.deleteMany({ where: { shop: shopDomain } });
    return { duplicate: false, stale };
  });
}

export async function canRunOrdinaryJob(
  shopDomain: string,
  generation: number,
) {
  validateShopDomain(shopDomain);
  return Boolean(
    await prisma.shop.findFirst({
      where: {
        domain: shopDomain,
        active: true,
        jobsEnabled: true,
        generation,
      },
    }),
  );
}

export async function getOwnWorkspaceRecord(shopId: string) {
  return prisma.workspaceRecord.findFirst({
    where: { shopId, shop: { active: true } },
  });
}

export async function getWorkspaceRecord(shopId: string, id: string) {
  return prisma.workspaceRecord.findFirst({
    where: { id, shopId, shop: { active: true } },
  });
}

export async function updateWorkspaceRecord(
  shopId: string,
  id: string,
  displayName: string,
) {
  if (
    typeof displayName !== "string" ||
    !displayName.trim() ||
    displayName.length > 80
  )
    throw new Error("Invalid display name");
  return prisma.$transaction(async (tx) => {
    const shop = await tx.shop.findUnique({ where: { id: shopId } });
    if (!shop) return null;
    await lockShop(tx, shop.domain);
    const updated = await tx.workspaceRecord.updateMany({
      where: { id, shopId, shop: { active: true } },
      data: { displayName: displayName.trim() },
    });
    return updated.count
      ? tx.workspaceRecord.findFirst({ where: { id, shopId } })
      : null;
  });
}

export type PrivacyTopic =
  | "CUSTOMERS_DATA_REQUEST"
  | "CUSTOMERS_REDACT"
  | "SHOP_REDACT"
  | "customers/data_request"
  | "customers/redact"
  | "shop/redact";

function privacyPayload(
  payload: Record<string, unknown>,
): Prisma.InputJsonObject {
  const result: Record<string, Prisma.InputJsonValue> = {};
  for (const key of ["orders_requested", "orders_to_redact"] as const) {
    const value = payload[key];
    if (value !== undefined) {
      if (
        !Array.isArray(value) ||
        value.some(
          (id) =>
            !(typeof id === "string" && /^\d+$/.test(id)) &&
            !(typeof id === "number" && Number.isSafeInteger(id) && id > 0),
        )
      )
        throw new Error("Invalid privacy order identifiers");
      result[key] = value.map(String);
    }
  }
  const request = payload.data_request as Record<string, unknown> | undefined;
  if (request?.id !== undefined) {
    if (
      !(typeof request.id === "string" && /^\d+$/.test(request.id)) &&
      !(
        typeof request.id === "number" &&
        Number.isSafeInteger(request.id) &&
        request.id > 0
      )
    )
      throw new Error("Invalid privacy request identifier");
    result.requestId = String(request.id);
  }
  return result;
}

// Durable intake only. No session/token is required; no false claim of completed export.
export async function receivePrivacy(
  shopDomain: string,
  topic: PrivacyTopic,
  deliveryId: string,
  minimalPayload: Record<string, unknown>,
) {
  const normalized = topic.includes("/")
    ? topic.toLowerCase()
    : topic.toLowerCase().replace("_", "/");
  if (
    !["customers/data_request", "customers/redact", "shop/redact"].includes(
      normalized,
    )
  )
    throw new Error("Invalid privacy topic");
  const payload = privacyPayload(minimalPayload);
  return prisma.$transaction(async (tx) => {
    await lockShop(tx, shopDomain);
    return tx.privacyReceipt.upsert({
      where: {
        shopDomain_topic_deliveryId: {
          shopDomain,
          topic: normalized,
          deliveryId,
        },
      },
      update: {},
      create: { shopDomain, topic: normalized, deliveryId, payload },
    });
  });
}
