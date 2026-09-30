import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { after, afterEach, before, test } from "node:test";
import prisma, { authLockDb } from "../app/db.server";
import { activateShop, deactivateShop, receivePrivacy } from "../app/storage.server";
import { acceptOrderJob, processOneOrderJob, purgeExpiredOrders, type IngestedSnapshot } from "../app/order-jobs.server";
import { actOnException, getException, listEvaluations, listExceptions, listRuleSettings, saveRuleSettings } from "../app/exceptions.server";

const domains: string[] = [];
const orderId = "gid://shopify/Order/97001";
const actor = "synthetic-merchant-7001";
const stamp = new Date(Date.now() - 10_000).toISOString();
type Principal = { shopId: string; generation: number; actor: string };
before(() => {
  assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB, "1");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname, "127.0.0.1");
});
afterEach(async () => { await prisma.orderJob.deleteMany({ where: { shop: { domain: { in: domains } } } }); });
after(async () => {
  await prisma.lifecycleDelivery.deleteMany({ where: { shopDomain: { in: domains } } });
  await prisma.privacyReceipt.deleteMany({ where: { shopDomain: { in: domains } } });
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
  await Promise.all([prisma.$disconnect(), authLockDb.$disconnect()]);
});
async function fixture(configured = true) {
  const domain = `lifecycle-${randomUUID()}.myshopify.com`; domains.push(domain);
  const activated = await activateShop(domain);
  const shop = await prisma.shop.update({ where: { id: activated.id }, data: { installedAt: new Date(Date.now() - 60_000) } });
  const principal = { shopId: shop.id, generation: shop.generation, actor };
  if (configured) {
    await saveRuleSettings(principal, "high_order_value", { enabled: true, threshold: "100.00", currencyCode: "CAD" }, 0);
    await saveRuleSettings(principal, "high_line_quantity", { enabled: true, threshold: 5 }, 0);
  }
  return { ...shop, principal };
}
function snapshot(amount = "100.01", quantities = [6]): IngestedSnapshot {
  return { id: orderId, createdAt: stamp, updatedAt: stamp,
    cancelledAt: { available: true, value: null },
    total: { available: true, value: { amount, currencyCode: "CAD" } },
    lines: { available: true, value: quantities.map((currentQuantity, i) => ({ id: `gid://shopify/LineItem/${97001 + i}`, currentQuantity })) } };
}
async function ingest(shop: { domain: string }, value = snapshot()) {
  await acceptOrderJob(shop.domain, randomUUID(), orderId);
  const result = await processOneOrderJob(async () => value);
  assert.equal(result.status, "completed");
  return result;
}
async function valueException(principal: Principal) {
  const rows = await listExceptions(principal);
  const value = rows.find(row => row.ruleKey === "high_order_value");
  assert.ok(value);
  return value;
}
const status = (expected: number) => (error: unknown) => {
  assert.equal((error as { status: number }).status, expected); return true;
};

// Each subprocess owns an independent Prisma connection. The IPC barrier starts
// both competing calls together even though the parent test pool has one connection.
const actionProcessCode = `
import prisma, {authLockDb} from './app/db.server.ts';
import {actOnException} from './app/exceptions.server.ts';
process.once('message', async ({principal,id,input}) => {
  let report;
  try { const result=await actOnException(principal,id,input); report={type:'result',status:200,state:result.state}; }
  catch(error) { report={type:'result',status:Number.isInteger(error?.status)?error.status:500}; }
  finally { await Promise.all([prisma.$disconnect(),authLockDb.$disconnect()]); }
  process.send(report, () => process.disconnect());
});
process.send({type:'ready'});
`;
function competingAction(principal: Principal, id: string, input: Parameters<typeof actOnException>[2]) {
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", actionProcessCode], {
    cwd: process.cwd(), env: process.env, windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const result = new Promise<{ status: number; state?: string }>((resolve, reject) => {
    let report: { status: number; state?: string } | undefined;
    const timeout = setTimeout(() => { child.kill(); }, 30_000);
    child.on("message", (message: { type?: string; status?: number; state?: string }) => {
      if (message.type === "ready") readyResolve();
      if (message.type === "result" && typeof message.status === "number") report = { status: message.status, state: message.state };
    });
    child.once("error", () => { clearTimeout(timeout); const error = Error("SYNTHETIC_ACTION_CHILD_FAILED"); readyReject(error); reject(error); });
    child.once("exit", code => {
      clearTimeout(timeout);
      if (code === 0 && report) resolve(report);
      else { const error = Error("SYNTHETIC_ACTION_CHILD_FAILED"); readyReject(error); reject(error); }
    });
  });
  return { ready, result, go: () => child.send({ principal, id, input }) };
}

test("persisted settings have no defaults; validation, versioning and settings CAS are enforced", async () => {
  const shop = await fixture(false);
  assert.deepEqual(await listRuleSettings(shop.principal), []);
  await ingest(shop);
  assert.deepEqual((await listEvaluations(shop.principal)).map(row => row.result.reasonCode), ["NOT_CONFIGURED", "NOT_CONFIGURED"]);
  assert.deepEqual(await listExceptions(shop.principal), []);
  for (const input of [{ enabled: true }, { enabled: true, threshold: "-1", currencyCode: "CAD" }, { enabled: true, threshold: "100", currencyCode: "XXX" }]) {
    await assert.rejects(saveRuleSettings(shop.principal, "high_order_value", input, 0), status(400));
  }
  assert.deepEqual(await listRuleSettings(shop.principal), []);
  const first = await saveRuleSettings(shop.principal, "high_order_value", { enabled: true, threshold: "100.00", currencyCode: "CAD" }, 0);
  assert.equal(first.revision, 1);
  const changes = await Promise.allSettled([
    saveRuleSettings(shop.principal, "high_order_value", { enabled: true, threshold: "150.00", currencyCode: "CAD" }, 1),
    saveRuleSettings(shop.principal, "high_order_value", { enabled: true, threshold: "200.00", currencyCode: "CAD" }, 1),
  ]);
  assert.equal(changes.filter(result => result.status === "fulfilled").length, 1);
  const failed = changes.find(result => result.status === "rejected");
  assert.equal(failed?.status === "rejected" && failed.reason.status, 409);
  const current = (await listRuleSettings(shop.principal))[0];
  assert.equal(current.revision, 2);
  assert.notEqual(current.settings.settingsVersion, first.settings.settingsVersion);
});

test("one worker persists both results, one stable exception per rule and no duplicate observation", async () => {
  const shop = await fixture();
  const first = await ingest(shop);
  const before = await listExceptions(shop.principal);
  assert.equal(before.length, 2);
  assert.ok(before.every(row => row.state === "open" && row.revision === 1 && row.priority === "review"));
  assert.equal(first.evaluations?.high_order_value.sourceSnapshotVersion, first.evaluations?.high_line_quantity.sourceSnapshotVersion);
  await ingest(shop);
  const after = await listExceptions(shop.principal);
  for (const row of before) {
    const repeated = after.find(next => next.id === row.id)!;
    assert.equal(repeated.revision, row.revision);
    assert.equal(repeated.history.length, row.history.length);
    assert.equal(repeated.currentEvaluation.settingsVersion, row.currentEvaluation.settingsVersion);
  }
  const other = await fixture();
  await saveRuleSettings(other.principal, "high_order_value", { enabled: true, threshold: "200.00", currencyCode: "CAD" }, 1);
  await ingest(other);
  assert.equal((await listEvaluations(other.principal)).find(row => row.result.ruleKey === "high_order_value")?.result.outcome, "not_matched");
  assert.equal((await listExceptions(other.principal)).length, 1);
});

test("concurrent duplicate delivery and crash replay create one effect and no duplicate history", async () => {
  const shop = await fixture(); const delivery = randomUUID();
  const accepted = await Promise.all([acceptOrderJob(shop.domain, delivery, orderId), acceptOrderJob(shop.domain, delivery, orderId)]);
  assert.equal(accepted.filter(row => row.duplicate).length, 1);
  const concurrent = await Promise.all([processOneOrderJob(async () => snapshot()), processOneOrderJob(async () => snapshot())]);
  assert.equal(concurrent.filter(row => row.status === "completed").length, 1);
  const before = await listExceptions(shop.principal);
  await acceptOrderJob(shop.domain, randomUUID(), orderId);
  await assert.rejects(processOneOrderJob(async () => snapshot(), { afterWrite: () => { throw Error("SIMULATED_CRASH"); } }), /SIMULATED_CRASH/);
  const job = await prisma.orderJob.findFirstOrThrow({ where: { shopId: shop.id, status: "processing" } });
  const replay = await processOneOrderJob(async () => snapshot(), { now: new Date(job.leaseUntil!.getTime() + 1) });
  assert.equal(replay.status, "completed");
  const after = await listExceptions(shop.principal);
  assert.deepEqual(after.map(row => [row.id, row.revision, row.history.length]), before.map(row => [row.id, row.revision, row.history.length]));
  assert.equal(await prisma.orderSnapshot.count({ where: { shopId: shop.id } }), 1);
});

test("acknowledge then resolve records reproducible before/after states, actor and viewed versions", async () => {
  const shop = await fixture(); await ingest(shop);
  const before = await valueException(shop.principal);
  const acknowledged = await actOnException(shop.principal, before.id, { action: "acknowledge", reason: "REVIEW_STARTED", expectedRevision: before.revision });
  assert.equal(acknowledged.state, "acknowledged");
  const after = await actOnException(shop.principal, before.id, { action: "resolve", reason: "REVIEW_COMPLETED", expectedRevision: acknowledged.revision });
  assert.equal(after.state, "resolved");
  assert.equal(after.revision, before.revision + 2);
  const decisions = after.history.filter(row => row.kind === "decision");
  assert.equal(decisions.length, 2);
  assert.deepEqual(decisions.map(row => [row.fromState, row.toState, row.action, row.reason]), [
    ["open", "acknowledged", "acknowledge", "REVIEW_STARTED"], ["acknowledged", "resolved", "resolve", "REVIEW_COMPLETED"],
  ]);
  for (const decision of decisions) {
    assert.equal(decision.actor, actor); assert.ok(Number.isFinite(new Date(decision.at).getTime()));
    assert.equal(decision.result.ruleVersion, before.currentEvaluation.ruleVersion);
    assert.equal(decision.result.settingsVersion, before.currentEvaluation.settingsVersion);
    assert.equal(decision.result.sourceSnapshotVersion, before.currentEvaluation.sourceSnapshotVersion);
    assert.deepEqual(decision.result.evidence, before.currentEvaluation.evidence);
  }
  await assert.rejects(actOnException(shop.principal, before.id, { action: "ignore", reason: "NOT_RELEVANT", expectedRevision: after.revision }), status(409));
  await ingest(shop, snapshot("300.00"));
  assert.equal((await getException(shop.principal, before.id)).state, "resolved");
});

test("ignored material changes preserve decision evidence separately from latest observation", async () => {
  const shop = await fixture(); await ingest(shop);
  const before = await valueException(shop.principal);
  const ignored = await actOnException(shop.principal, before.id, { action: "ignore", reason: "NOT_RELEVANT", expectedRevision: before.revision });
  assert.deepEqual([before.state, before.revision, before.history.length], ["open", 1, 1]);
  assert.deepEqual([ignored.state, ignored.revision, ignored.history.length], ["ignored", 2, 2]);
  const decision = ignored.history.find(row => row.kind === "decision"); assert.ok(decision);
  await ingest(shop, snapshot("250.00"));
  const changed = await getException(shop.principal, before.id);
  assert.equal(changed.state, "ignored"); assert.equal(changed.revision, ignored.revision + 1);
  assert.deepEqual([changed.revision, changed.history.length, changed.currentEvaluation.outcome], [3, 3, "matched"]);
  assert.notDeepEqual(changed.currentEvaluation.evidence, decision.result.evidence);
  assert.deepEqual(changed.history.find(row => row.id === decision.id), decision);
  await ingest(shop, snapshot("20.00", [0]));
  const disappeared = await getException(shop.principal, before.id);
  assert.deepEqual([disappeared.state, disappeared.revision, disappeared.history.length, disappeared.currentEvaluation.outcome], ["ignored", 4, 4, "not_matched"]);
  await ingest(shop, snapshot("500.00"));
  const returned = await getException(shop.principal, before.id);
  assert.deepEqual([returned.state, returned.revision, returned.history.length, returned.currentEvaluation.outcome], ["ignored", 5, 5, "matched"]);
  assert.equal(returned.history.filter(row => row.kind === "decision").length, 1);
  assert.equal((await listExceptions(shop.principal)).filter(row => row.ruleKey === "high_order_value").length, 1);
});

test("disappearing, cancelled, disabled and unknown signals never automatically resolve review", async () => {
  const shop = await fixture(); await ingest(shop);
  const first = await valueException(shop.principal);
  await actOnException(shop.principal, first.id, { action: "acknowledge", reason: "REVIEW_STARTED", expectedRevision: first.revision });
  const observations: Array<[IngestedSnapshot, string, string]> = [
    [snapshot("20.00", [0]), "not_matched", "AT_OR_BELOW_THRESHOLD"],
    [{ ...snapshot(), cancelledAt: { available: true, value: stamp } }, "not_applicable", "ORDER_CANCELLED"],
    [{ ...snapshot(), total: { available: false, reason: "TOTAL_UNAVAILABLE" } }, "unknown", "AMOUNT_UNAVAILABLE"],
  ];
  for (const [input, outcome, reason] of observations) {
    await ingest(shop, input); const row = await getException(shop.principal, first.id);
    assert.equal(row.state, "acknowledged"); assert.equal(row.currentEvaluation.outcome, outcome);
    assert.equal(row.currentEvaluation.reasonCode, reason);
  }
  await saveRuleSettings(shop.principal, "high_order_value", { enabled: false, threshold: "100.00", currencyCode: "CAD" }, 1);
  assert.ok((await getException(shop.principal, first.id)).freshness.includes("SETTINGS_CHANGED"));
  await ingest(shop);
  const disabled = await getException(shop.principal, first.id);
  assert.equal(disabled.state, "acknowledged"); assert.equal(disabled.currentEvaluation.reasonCode, "RULE_DISABLED");
  assert.equal(disabled.freshness.includes("SETTINGS_CHANGED"), false);
});

test("unknown without a prior match remains visible without fabricating an exception", async () => {
  const shop = await fixture();
  await ingest(shop, { ...snapshot(), total: { available: false, reason: "TOTAL_UNAVAILABLE" }, lines: { available: false, reason: "LINES_UNAVAILABLE" } });
  assert.deepEqual(await listExceptions(shop.principal), []);
  const evaluations = await listEvaluations(shop.principal);
  assert.equal(evaluations.length, 2); assert.ok(evaluations.every(row => row.result.outcome === "unknown"));
  assert.deepEqual(evaluations.map(row => row.result.reasonCode).sort(), ["AMOUNT_UNAVAILABLE", "LINES_UNAVAILABLE"]);
});

test("pending and failed processing keep last evidence visibly stale, never safe", async () => {
  const shop = await fixture(); await ingest(shop); const first = await valueException(shop.principal);
  const accepted = await acceptOrderJob(shop.domain, randomUUID(), orderId);
  assert.ok((await getException(shop.principal, first.id)).freshness.includes("PROCESSING_PENDING"));
  await prisma.orderJob.update({ where: { id: accepted.jobId! }, data: { status: "failed", errorCode: "ORDER_FETCH_FAILED" } });
  const failed = await getException(shop.principal, first.id);
  assert.ok(failed.freshness.includes("PROCESSING_FAILED"));
  assert.deepEqual(failed.currentEvaluation, first.currentEvaluation);
  assert.equal(failed.state, "open");
});

test("stale source cannot overwrite current evidence; equal timestamp changes invalidate stale merchant actions", async () => {
  const shop = await fixture();
  const newest = { ...snapshot(), updatedAt: new Date(Date.parse(stamp) + 1000).toISOString() };
  await ingest(shop, newest); const first = await valueException(shop.principal);
  await ingest(shop, snapshot("9.00"));
  const stale = await getException(shop.principal, first.id);
  assert.equal(stale.revision, first.revision); assert.equal(stale.history.length, first.history.length);
  assert.equal(stale.currentEvaluation.sourceSnapshotVersion, first.currentEvaluation.sourceSnapshotVersion);
  assert.deepEqual(stale.currentEvaluation.evidence, first.currentEvaluation.evidence);
  await ingest(shop, { ...newest, total: snapshot("200.00").total });
  const changed = await getException(shop.principal, first.id);
  assert.equal(changed.revision, first.revision + 1);
  assert.notEqual(changed.currentEvaluation.sourceSnapshotVersion, first.currentEvaluation.sourceSnapshotVersion);
  await assert.rejects(actOnException(shop.principal, first.id, { action: "ignore", reason: "NOT_RELEVANT", expectedRevision: first.revision }), status(409));
});

test("settings changed during snapshot fetch are loaded at the fenced transaction boundary", async () => {
  const shop = await fixture(); await acceptOrderJob(shop.domain, randomUUID(), orderId);
  let settingsVersion = "";
  const completed = await processOneOrderJob(async () => {
    const saved = await saveRuleSettings(shop.principal, "high_order_value", { enabled: true, threshold: "200.00", currencyCode: "CAD" }, 1);
    settingsVersion = saved.settings.settingsVersion;
    return snapshot();
  });
  assert.equal(completed.status, "completed");
  const evaluation = (await listEvaluations(shop.principal)).find(row => row.result.ruleKey === "high_order_value")!;
  assert.equal(evaluation.result.settingsVersion, settingsVersion);
  assert.equal(evaluation.result.outcome, "not_matched");
  assert.equal(evaluation.freshness.includes("SETTINGS_CHANGED"), false);
  assert.equal((await listExceptions(shop.principal)).some(row => row.ruleKey === "high_order_value"), false);
});

test("two competing merchant decisions yield exactly one transition and one conflict", async () => {
  const shop = await fixture(); await ingest(shop); const first = await valueException(shop.principal);
  const a = competingAction(shop.principal, first.id, { action: "resolve", reason: "REVIEW_COMPLETED", expectedRevision: first.revision });
  const b = competingAction({ ...shop.principal, actor: "synthetic-merchant-7002" }, first.id, { action: "ignore", reason: "NOT_RELEVANT", expectedRevision: first.revision });
  const completed = Promise.all([a.result, b.result]);
  await Promise.all([a.ready, b.ready]);
  a.go(); b.go();
  const decisions = await completed;
  assert.deepEqual(decisions.map(row => row.status).sort(), [200, 409]);
  const after = await getException(shop.principal, first.id);
  assert.equal(after.revision, first.revision + 1);
  assert.equal(after.history.filter(row => row.kind === "decision").length, 1);
});

test("transition table permits resolve/ignore from open or acknowledged and rejects repeated acknowledge", async () => {
  for (const acknowledged of [false, true]) {
    for (const action of ["resolve", "ignore"] as const) {
      const shop = await fixture(); await ingest(shop); let current = await valueException(shop.principal);
      if (acknowledged) {
        current = await actOnException(shop.principal, current.id, { action: "acknowledge", reason: "REVIEW_STARTED", expectedRevision: current.revision });
        await assert.rejects(actOnException(shop.principal, current.id, { action: "acknowledge", reason: "REVIEW_STARTED", expectedRevision: current.revision }), status(409));
      }
      const beforeState = current.state;
      const after = await actOnException(shop.principal, current.id, { action, reason: action === "resolve" ? "REVIEW_COMPLETED" : "NOT_RELEVANT", expectedRevision: current.revision });
      assert.equal(after.state, action === "resolve" ? "resolved" : "ignored");
      assert.equal(after.revision, current.revision + 1);
      const last = after.history.filter(row => row.kind === "decision").at(-1)!;
      assert.equal(last.fromState, beforeState); assert.equal(last.toState, after.state);
      await assert.rejects(actOnException(shop.principal, after.id, { action: "acknowledge", reason: "REVIEW_STARTED", expectedRevision: after.revision }), status(409));
    }
  }
});

test("foreign exception IDs and forged settings identity cannot read or mutate another shop", async () => {
  const a = await fixture(), b = await fixture(); await ingest(a); await ingest(b);
  const first = await valueException(a.principal); const before = await getException(a.principal, first.id);
  await assert.rejects(getException(b.principal, first.id), status(404));
  await assert.rejects(actOnException(b.principal, first.id, { action: "ignore", reason: "NOT_RELEVANT", expectedRevision: first.revision }), status(404));
  await assert.rejects(saveRuleSettings(b.principal, "high_order_value", { shopId: a.id, enabled: true, threshold: "1", currencyCode: "CAD" }, 1), status(400));
  assert.deepEqual(await getException(a.principal, first.id), before);
});

test("expired snapshots hide all derived data and purge cascades history", async () => {
  const shop = await fixture(); await ingest(shop); const first = await valueException(shop.principal);
  await actOnException(shop.principal, first.id, { action: "ignore", reason: "NOT_RELEVANT", expectedRevision: first.revision });
  await prisma.orderSnapshot.updateMany({ where: { shopId: shop.id }, data: { expiresAt: new Date(0) } });
  assert.deepEqual(await listExceptions(shop.principal), []); assert.deepEqual(await listEvaluations(shop.principal), []);
  await assert.rejects(getException(shop.principal, first.id), status(404));
  await assert.rejects(actOnException(shop.principal, first.id, { action: "resolve", reason: "REVIEW_COMPLETED", expectedRevision: first.revision }), status(404));
  await purgeExpiredOrders();
  assert.equal(await prisma.exceptionRecord.count({ where: { shopId: shop.id } }), 0);
  assert.equal(await prisma.ruleEvaluation.count({ where: { shopId: shop.id } }), 0);
  assert.equal(await prisma.exceptionHistory.count({ where: { exceptionId: first.id } }), 0);
});

test("privacy pending and inactive installations deny evidence/actions and do not retain settings", async () => {
  const shop = await fixture(); await ingest(shop); const first = await valueException(shop.principal);
  await receivePrivacy(shop.domain, "customers/redact", randomUUID(), { orders_to_redact: ["97001"] });
  assert.deepEqual(await listExceptions(shop.principal), []); assert.deepEqual(await listEvaluations(shop.principal), []);
  await assert.rejects(getException(shop.principal, first.id), status(404));
  await assert.rejects(actOnException(shop.principal, first.id, { action: "ignore", reason: "NOT_RELEVANT", expectedRevision: first.revision }), status(404));
  assert.equal((await acceptOrderJob(shop.domain, randomUUID(), orderId)).accepted, false);
  assert.equal((await processOneOrderJob(async () => { throw new Error("PRIVACY_MUST_NOT_FETCH"); })).processed, false);
  await deactivateShop(shop.domain, randomUUID());
  await assert.rejects(listRuleSettings(shop.principal), status(404));
  const installed = await activateShop(shop.domain);
  const next = { ...shop.principal, generation: installed.generation };
  assert.deepEqual(await listRuleSettings(next), []);
  await assert.rejects(getException(next, first.id), status(404));
  await assert.rejects(saveRuleSettings(shop.principal, "high_line_quantity", { enabled: true, threshold: 5 }, 0), status(404));
});
