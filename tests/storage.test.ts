import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { Session } from "@shopify/shopify-api";
import prisma from "../app/db.server";
import { EncryptedSessionStorage } from "../app/session-storage.server";
import {
  activateShop,
  canRunOrdinaryJob,
  deactivateShop,
  getOwnWorkspaceRecord,
  getWorkspaceRecord,
  receivePrivacy,
  requireActiveShop,
  updateWorkspaceRecord,
} from "../app/storage.server";

const prefix = `fixture-${randomUUID()}`;
const shops = [`${prefix}-a.myshopify.com`, `${prefix}-b.myshopify.com`];
let sessions: EncryptedSessionStorage;
let fixtureReady = false;

before(async () => {
  assert.equal(
    process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB,
    "1",
    "Use the disposable database test runner",
  );
  const database = new URL(process.env.DATABASE_URL || "");
  assert.ok(
    ["127.0.0.1", "localhost", "[::1]"].includes(database.hostname),
    "Tests require a loopback database",
  );
  fixtureReady = true;
  process.env.SESSION_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  sessions = new EncryptedSessionStorage(prisma);
  assert.equal(await sessions.isReady(), true);
});

after(async () => {
  if (!fixtureReady) return;
  await prisma.session.deleteMany({ where: { shop: { in: shops } } });
  await prisma.privacyReceipt.deleteMany({
    where: { shopDomain: { in: shops } },
  });
  await prisma.lifecycleDelivery.deleteMany({
    where: { shopDomain: { in: shops } },
  });
  await prisma.shop.deleteMany({ where: { domain: { in: shops } } });
  await prisma.$disconnect();
});

function session(domain: string) {
  return new Session({
    id: `offline_${domain}`,
    shop: domain,
    isOnline: false,
    state: "",
    accessToken: `synthetic-access-${randomUUID()}`,
    refreshToken: `synthetic-refresh-${randomUUID()}`,
    expires: new Date(Date.now() + 3_600_000),
    refreshTokenExpires: new Date(Date.now() + 86_400_000),
    scope: "read_orders",
  });
}

test("same-shop concurrent activation is idempotent and creates one preferences record", async () => {
  const results = await Promise.all([
    activateShop(shops[0]),
    activateShop(shops[0]),
    activateShop(shops[0]),
  ]);
  assert.equal(new Set(results.map((shop) => shop.id)).size, 1);
  assert.deepEqual(
    results.map((shop) => shop.generation),
    [1, 1, 1],
  );
  assert.equal(
    await prisma.workspaceRecord.count({ where: { shopId: results[0].id } }),
    1,
  );
});

test("foreign tenant cannot read or modify preferences using another record ID", async () => {
  const a = await activateShop(shops[0]);
  const b = await activateShop(shops[1]);
  const ownB = await getOwnWorkspaceRecord(b.id);
  assert.ok(ownB);
  assert.equal(await getWorkspaceRecord(a.id, ownB.id), null);
  assert.equal(
    await updateWorkspaceRecord(a.id, ownB.id, "Foreign update"),
    null,
  );
  assert.equal(
    (await getWorkspaceRecord(b.id, ownB.id))?.displayName,
    "Order Rescue",
  );
  assert.equal(
    (await updateWorkspaceRecord(b.id, ownB.id, "My workspace"))?.displayName,
    "My workspace",
  );
});

test("verified Shopify identity cannot be rebound across tenant domains", async () => {
  const numericId = String(BigInt(`0x${randomBytes(7).toString("hex")}`));
  const gid = `gid://shopify/Shop/${numericId}`;
  const bound = await activateShop(shops[0], gid);
  assert.equal(bound.shopifyId, gid);
  assert.equal((await activateShop(shops[0])).shopifyId, gid);
  await assert.rejects(activateShop(shops[1], gid), /identity conflict/);
  await assert.rejects(activateShop(shops[0], `${gid}1`), /identity conflict/);
  await assert.rejects(
    activateShop(shops[0], "not-a-shop-id"),
    /Invalid Shopify shop/,
  );
});

test("credentials persist encrypted across a fresh client and separate Node process", async () => {
  const original = session(shops[0]);
  await sessions.storeSession(original);
  const stored = await prisma.session.findUniqueOrThrow({
    where: { id: original.id },
  });
  assert.notEqual(stored.accessToken, original.accessToken);
  assert.notEqual(stored.refreshToken, original.refreshToken);
  assert.ok(stored.accessToken.startsWith("v1:"));
  assert.equal(
    original.accessToken?.startsWith("synthetic-access-"),
    true,
    "Input session remains unmodified",
  );
  const child = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import {EncryptedSessionStorage} from "./app/session-storage.server.ts";
    import db from "./app/db.server.ts";
    const restored=await new EncryptedSessionStorage().loadSession(${JSON.stringify(original.id)});
    if(restored?.accessToken!==${JSON.stringify(original.accessToken)} || restored?.refreshToken!==${JSON.stringify(original.refreshToken)}) throw new Error("PROCESS_PERSISTENCE_FAILED");
    await db.$disconnect();
  `,
    ],
    { env: process.env, windowsHide: true, stdio: "pipe", timeout: 15000 },
  );
  assert.equal(
    child.status,
    0,
    "Separate Node process must recover encrypted credentials",
  );
  const restartedClient = new PrismaClient();
  try {
    const restartedStorage = new EncryptedSessionStorage(restartedClient);
    const restored = await restartedStorage.loadSession(original.id);
    assert.equal(restored?.accessToken, original.accessToken);
    assert.equal(restored?.refreshToken, original.refreshToken);
    assert.equal(restored?.expires?.getTime(), original.expires?.getTime());
    assert.equal(
      restored?.refreshTokenExpires?.getTime(),
      original.refreshTokenExpires?.getTime(),
    );
  } finally {
    await restartedClient.$disconnect();
  }
});

test("ciphertext copied between tenants is rejected by authenticated encryption", async () => {
  const a = session(shops[0]);
  const b = session(shops[1]);
  await sessions.storeSession(a);
  await sessions.storeSession(b);
  const storedA = await prisma.session.findUniqueOrThrow({
    where: { id: a.id },
  });
  await prisma.session.update({
    where: { id: b.id },
    data: { accessToken: storedA.accessToken },
  });
  await assert.rejects(sessions.loadSession(b.id), /decryption failed/);
  await sessions.storeSession(b);
});

test("rotated access and refresh credentials and expiries replace old persisted values", async () => {
  const original = session(shops[0]);
  await sessions.storeSession(original);
  const rotated = new Session(original.toObject());
  rotated.accessToken = `synthetic-access-${randomUUID()}`;
  rotated.refreshToken = `synthetic-refresh-${randomUUID()}`;
  rotated.expires = new Date(Date.now() + 7_200_000);
  rotated.refreshTokenExpires = new Date(Date.now() + 172_800_000);
  await sessions.storeSession(rotated);
  const loaded = await sessions.loadSession(original.id);
  assert.equal(loaded?.accessToken, rotated.accessToken);
  assert.equal(loaded?.refreshToken, rotated.refreshToken);
  assert.equal(loaded?.expires?.getTime(), rotated.expires.getTime());
  assert.equal(
    loaded?.refreshTokenExpires?.getTime(),
    rotated.refreshTokenExpires.getTime(),
  );
  const stored = await prisma.session.findUniqueOrThrow({
    where: { id: original.id },
  });
  assert.equal(stored.accessToken.includes(rotated.accessToken), false);
});

test("uninstall disables access/jobs and clears sessions; replay cannot disable reinstall", async () => {
  const initial = await activateShop(shops[0]);
  await sessions.storeSession(session(shops[0]));
  const delivery = randomUUID();
  const concurrent = await Promise.all([
    deactivateShop(shops[0], delivery),
    deactivateShop(shops[0], delivery),
  ]);
  assert.equal(concurrent.filter((result) => result.duplicate).length, 1);
  assert.equal(await requireActiveShop(shops[0]), null);
  assert.equal(await canRunOrdinaryJob(shops[0], initial.generation), false);
  assert.equal(await getOwnWorkspaceRecord(initial.id), null);
  assert.equal((await sessions.findSessionsByShop(shops[0])).length, 0);
  const reinstalled = await activateShop(shops[0]);
  assert.equal(reinstalled.generation, initial.generation + 1);
  assert.equal(await canRunOrdinaryJob(shops[0], initial.generation), false);
  assert.equal(await canRunOrdinaryJob(shops[0], reinstalled.generation), true);
  assert.equal((await deactivateShop(shops[0], delivery)).duplicate, true);
  assert.ok(await requireActiveShop(shops[0]));
});

test("an unseen old-timestamp uninstall fails closed instead of trusting an unsigned header", async () => {
  await activateShop(shops[0]);
  const result = await deactivateShop(shops[0], randomUUID(), new Date(0));
  assert.equal(result.stale, true);
  assert.equal(await requireActiveShop(shops[0]), null);
});

test("privacy intake stays available after uninstall, deduplicates, and strips customer identity", async () => {
  const delivery = randomUUID();
  const payload = {
    orders_requested: [123],
    customer: { email: "synthetic@example.invalid", id: 456 },
    data_request: { id: 789 },
  };
  const first = await receivePrivacy(
    shops[0],
    "CUSTOMERS_DATA_REQUEST",
    delivery,
    payload,
  );
  const duplicate = await receivePrivacy(
    shops[0],
    "customers/data_request",
    delivery,
    payload,
  );
  assert.equal(first.id, duplicate.id);
  assert.equal(first.status, "pending");
  assert.deepEqual(first.payload, {
    orders_requested: ["123"],
    requestId: "789",
  });
  assert.equal(await requireActiveShop(shops[0]), null);
  assert.equal(
    (await receivePrivacy(shops[0], "SHOP_REDACT", randomUUID(), {})).status,
    "pending",
  );
  await assert.rejects(
    receivePrivacy(shops[0], "customers/redact", randomUUID(), {
      orders_to_redact: [Number.MAX_SAFE_INTEGER + 1],
    }),
    /Invalid privacy order/,
  );
});
