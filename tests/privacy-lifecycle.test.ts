import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { after, afterEach, before, test } from "node:test";
import { Session } from "@shopify/shopify-api";
import prisma, { authLockDb } from "../app/db.server";
import { activateShop, canRunOrdinaryJob, deactivateShop } from "../app/storage.server";
import { authOperation, withAuthLock } from "../app/auth-lock.server";
import { acceptOrderJob, processOneOrderJob, purgeExpiredOrders } from "../app/order-jobs.server";
import { actOnException, getException, listExceptions, saveRuleSettings } from "../app/exceptions.server";
import { applyPrivacyJournal, getPrivacyExport, markPrivacyExportDelivered, privacyStatus, processOnePrivacyJob, purgePrivacy } from "../app/privacy.server";
import { openOrder } from "../app/order-crypto.server";
import { EncryptedSessionStorage } from "../app/session-storage.server";
import { privacyBlocked, privacyHash, readDeletionJournal } from "../app/privacy-guard.server";
import { parsePrivacyBody, receivePrivacyWebhook } from "../app/privacy-webhook.server";
import { advanceOrderSync } from "../app/order-sync.server";

const DAY = 86_400_000;
const domains: string[] = [];
const originalJournal = process.env.PRIVACY_JOURNAL_PATH!;
const journal = `${originalJournal}.lifecycle`;
const actor = "synthetic-staff-901";
let shopSequence = 81000;
before(() => {
  assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB, "1");
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.match(url.pathname, /^\/rescue_test_/);
  writeFileSync(journal, "", { flag: "wx" });
  process.env.PRIVACY_JOURNAL_PATH = journal;
});
afterEach(async () => {
  await prisma.privacyReceipt.deleteMany({ where: { shopDomain: { in: domains } } });
  await prisma.shop.deleteMany({ where: { domain: { in: domains } } });
  await prisma.session.deleteMany({ where: { shop: { in: domains } } });
  await prisma.lifecycleDelivery.deleteMany({ where: { shopDomain: { in: domains } } });
});
after(async () => {
  process.env.PRIVACY_JOURNAL_PATH = originalJournal;
  unlinkSync(journal);
  await Promise.all([prisma.$disconnect(), authLockDb.$disconnect()]);
});
async function fixture(configured = true) {
  const domain = `privacy-${randomUUID()}.myshopify.com`; domains.push(domain);
  const created = await activateShop(domain, `gid://shopify/Shop/${++shopSequence}`);
  const shop = await prisma.shop.update({ where: { id: created.id }, data: { installedAt: new Date(Date.now() - 60_000) } });
  const principal = { shopId: shop.id, generation: shop.generation, actor };
  if (configured) {
    await saveRuleSettings(principal, "high_order_value", { enabled: true, threshold: "100.00", currencyCode: "CAD" }, 0);
    await saveRuleSettings(principal, "high_line_quantity", { enabled: true, threshold: 5 }, 0);
  }
  return { ...shop, principal };
}
function order(id: string) {
  const stamp = new Date(Date.now() - 1000).toISOString();
  return { id, legacyResourceId: id.split("/").at(-1)!, createdAt: stamp, updatedAt: stamp,
    cancelledAt: { available: true, value: null },
    total: { available: true, value: { amount: "100.01", currencyCode: "CAD" } },
    lines: { available: true, value: [{ id: "gid://shopify/LineItem/81001", currentQuantity: 6 }] } };
}
async function ingest(shop: { domain: string }, id = "gid://shopify/Order/82001") {
  const snapshot = order(id);
  await acceptOrderJob(shop.domain, randomUUID(), id);
  assert.equal((await processOneOrderJob(async () => snapshot)).status, "completed");
  return snapshot;
}
function signed(domain: string, topic: string, raw: string, delivery = randomUUID(), signature?: string) {
  return new Request("https://app.example.test/webhooks/privacy", { method: "POST", body: Buffer.from(raw), headers: {
    "x-shopify-shop-domain": domain, "x-shopify-topic": topic, "x-shopify-webhook-id": delivery,
    "x-shopify-hmac-sha256": signature ?? createHmac("sha256", process.env.SHOPIFY_API_SECRET!).update(Buffer.from(raw)).digest("base64"),
  } });
}
async function receipt(shop: {domain:string;shopifyId?:string|null}, topic: string, ids: string[] = [], delivery = randomUUID()) {
  const body = JSON.stringify({ shop_domain: shop.domain, shop_id: shop.shopifyId?.split("/").at(-1) ?? "81001",
    ...(topic === "shop/redact" ? {} : { customer: { id: "83001", email: "discard@example.invalid" }, [topic === "customers/data_request" ? "orders_requested" : "orders_to_redact"]: ids }),
    ...(topic === "customers/data_request" ? { data_request: { id: "84001" } } : {}) });
  assert.equal((await receivePrivacyWebhook(signed(shop.domain, topic, body, delivery), topic)).status, 200);
  return prisma.privacyReceipt.findFirstOrThrow({ where: {shopDomain:shop.domain,topic,deliveryId:delivery} });
}
async function blocked(domain: string, id?: string, installedAt?: Date) {
  return prisma.$transaction(tx => privacyBlocked(tx, domain, id, installedAt));
}
async function awaitPrivacyClaim(id: string) {
  for (let attempt=0;attempt<100;attempt++) {
    if ((await prisma.privacyReceipt.findUniqueOrThrow({where:{id}})).status==="processing") return;
    await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.fail("Privacy worker did not claim the queued receipt");
}

test("privacy HMAC covers original bytes; altered/invalid bodies cause zero writes", async () => {
  const shop = await fixture(false);
  const raw = `{ "shop_domain": "${shop.domain}", "shop_id": ${shop.shopifyId!.split("/").at(-1)}, "orders_requested": [82001], "customer": {"id":83001,"email":"é@example.invalid"}, "data_request":{"id":84001} }`;
  const signature = createHmac("sha256", process.env.SHOPIFY_API_SECRET!).update(Buffer.from(raw)).digest("base64");
  for (const request of [signed(shop.domain,"customers/data_request",raw+" ",randomUUID(),signature),signed(shop.domain,"customers/data_request",raw,randomUUID(),"invalid")])
    assert.equal((await receivePrivacyWebhook(request,"customers/data_request")).status,401);
  assert.equal(await prisma.privacyReceipt.count({where:{shopDomain:shop.domain}}),0);
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:shop.id}}),0);
  assert.equal((await receivePrivacyWebhook(signed(shop.domain,"customers/data_request",raw,randomUUID(),signature),"customers/data_request")).status,200);
  const stored = await prisma.privacyReceipt.findFirstOrThrow({where:{shopDomain:shop.domain}});
  assert.equal(JSON.stringify(stored.payload).includes("email"),false);
  assert.equal(JSON.stringify(stored.payload).includes("é"),false);
  assert.equal((stored.payload as Record<string,unknown>).customerKey,privacyHash(`customer:${shop.domain}:83001`));
});

test("lossless large routing IDs, signed domain/shop identity and malformed requests", async () => {
  const shop = await fixture(false);
  const big = "900719925474099312345";
  const shopId = shop.shopifyId!.split("/").at(-1)!;
  const raw = `{"shop_domain":"${shop.domain}","shop_id":${shopId},"customer":{"id":${big},"email":"123456@example.invalid"},"orders_requested":[${big}],"data_request":{"id":${big}}}`;
  assert.equal((parsePrivacyBody(raw).customer as Record<string,unknown>).id,big);
  assert.equal((await receivePrivacyWebhook(signed(shop.domain,"customers/data_request",raw),"customers/data_request")).status,200);
  const stored = await prisma.privacyReceipt.findFirstOrThrow({where:{shopDomain:shop.domain}});
  assert.deepEqual(stored.payload,{orders_requested:[big],requestId:big,customerKey:privacyHash(`customer:${shop.domain}:${big}`)});
  for (const body of [raw.replace(`"shop_id":${shopId}`,'"shop_id":999999'),raw.replace(shop.domain,"foreign.myshopify.com"),raw.replace(`[${big}]`,'[null]')])
    assert.equal((await receivePrivacyWebhook(signed(shop.domain,"customers/data_request",body),"customers/data_request")).status,400);
  assert.equal(await prisma.privacyReceipt.count({where:{shopDomain:shop.domain}}),1);
});

test("database outage never acknowledges a durable privacy receipt", () => {
  const child = spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",`
    import {createHmac} from 'node:crypto';
    import {receivePrivacyWebhook} from './app/privacy-webhook.server.ts';
    import db,{authLockDb} from './app/db.server.ts';
    const body=JSON.stringify({shop_domain:'privacy-outage.myshopify.com',shop_id:81001,orders_requested:[82001],customer:{id:83001},data_request:{id:84001}});
    const response=await receivePrivacyWebhook(new Request('https://app.example.test/webhooks/privacy',{method:'POST',body,headers:{'x-shopify-topic':'customers/data_request','x-shopify-shop-domain':'privacy-outage.myshopify.com','x-shopify-webhook-id':'outage','x-shopify-hmac-sha256':createHmac('sha256',process.env.SHOPIFY_API_SECRET).update(body).digest('base64')}}),'customers/data_request');
    if(response.status!==503) process.exitCode=1;
    await Promise.all([db.$disconnect(),authLockDb.$disconnect()]);
  `],{env:{...process.env,DATABASE_URL:"postgresql://synthetic:synthetic@127.0.0.1:1/unavailable?connect_timeout=1"},windowsHide:true,stdio:"pipe",timeout:15000});
  assert.equal(child.status,0,"Isolated unavailable database must return 503");
});

test("valid HMAC customer payload cannot be relabelled as destructive shop/topic webhook", async () => {
  const shop = await fixture(false);
  const common = {shop_domain:shop.domain,shop_id:shop.shopifyId!.split("/").at(-1),customer:{id:"83001"}};
  const dataRequest = JSON.stringify({...common,orders_requested:["82001"],data_request:{id:"84001"}});
  const redact = JSON.stringify({...common,orders_to_redact:["82001"]});
  for (const [topic,raw] of [["shop/redact",dataRequest],["shop/redact",redact],["customers/redact",dataRequest],["customers/data_request",redact]]) {
    assert.equal((await receivePrivacyWebhook(signed(shop.domain,topic,raw),topic)).status,400);
  }
  assert.equal(await prisma.privacyReceipt.count({where:{shopDomain:shop.domain}}),0);
  assert.equal(await prisma.shop.count({where:{domain:shop.domain}}),1);
});

test("export contains only signed shop/order membership and encrypted evaluation/decision history", async () => {
  const a = await fixture(), b = await fixture();
  const id = "gid://shopify/Order/82001";
  await ingest(a,id); await ingest(a,"gid://shopify/Order/82002"); await ingest(b,id);
  const exception = (await listExceptions(a.principal)).find(row=>row.ruleKey==="high_order_value" && row.orderId===id)!;
  await actOnException(a.principal,exception.id,{action:"ignore",reason:"NOT_RELEVANT",expectedRevision:exception.revision});
  const request = await receipt(a,"customers/data_request",["82001","99999"]);
  assert.equal((await processOnePrivacyJob()).status,"completed");
  const result = await getPrivacyExport(a.principal,request.id);
  assert.equal(result.requestId,"84001");
  assert.deepEqual(result.records.map((record:{order:{id:string}})=>record.order.id),[id]);
  assert.equal(result.records[0].evaluations.length,2);
  const decision = result.records[0].exceptions.find((value:{ruleKey:string})=>value.ruleKey==="high_order_value");
  assert.equal(decision.state,"ignored");
  assert.ok(decision.history.some((value:{kind:string})=>value.kind==="decision"));
  assert.equal(JSON.stringify(result).includes(actor),false);
  assert.equal(await getPrivacyExport(b.principal,request.id),null);
  assert.equal(await getPrivacyExport({...a.principal,generation:a.generation+1},request.id),null);
  const stored = await prisma.privacyReceipt.findUniqueOrThrow({where:{id:request.id}});
  assert.ok(stored.encryptedExport);
  assert.equal(stored.encryptedExport.includes(id),false);
});

test("duplicate receipt is idempotent and independent row lock excludes a second claimant", async () => {
  const shop = await fixture(false);
  const delivery = randomUUID();
  const original = await receipt(shop,"customers/data_request",[],delivery);
  assert.equal((await receipt(shop,"customers/data_request",[],delivery)).id,original.id);
  assert.equal(await prisma.privacyReceipt.count({where:{shopDomain:shop.domain}}),1);
  let unlock!:()=>void, locked!:()=>void;
  const ready = new Promise<void>(resolve=>{locked=resolve;});
  const release = new Promise<void>(resolve=>{unlock=resolve;});
  const holder = authLockDb.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "PrivacyReceipt" WHERE "id"=${original.id} FOR UPDATE`;locked();await release;});
  await ready;
  try { assert.deepEqual(await processOnePrivacyJob(),{processed:false}); }
  finally { unlock(); await holder; }
  const results = await Promise.all([processOnePrivacyJob(),processOnePrivacyJob()]);
  assert.equal(results.filter(value=>value.processed).length,1);
  assert.equal((await prisma.privacyReceipt.findUniqueOrThrow({where:{id:original.id}})).attempts,1);
  assert.deepEqual(await processOnePrivacyJob(),{processed:false});
});

test("privacy claim eligibility and future lease remain UTC under a non-UTC PostgreSQL session timezone", async () => {
  const shop = await fixture(false);
  const request = await receipt(shop,"customers/data_request",[]);
  const [{timezone}] = await prisma.$queryRaw<Array<{timezone:string}>>`SELECT current_setting('TimeZone') AS timezone`;
  await prisma.$executeRaw`SET TIME ZONE 'Pacific/Auckland'`;
  let locked!:()=>void, inspect!:()=>void;
  const ready = new Promise<void>(resolve=>{locked=resolve;});
  const inspecting = new Promise<void>(resolve=>{inspect=resolve;});
  const now = new Date();
  const holder = authLockDb.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${shop.domain}, 0))`;
    locked(); await inspecting;
    for (let attempt=0; attempt<100; attempt++) {
      const claimed = await tx.privacyReceipt.findUniqueOrThrow({where:{id:request.id}});
      if (claimed.status==="processing") {
        assert.equal(claimed.attempts,1);
        assert.equal(claimed.leaseUntil?.toISOString(),new Date(now.getTime()+60_000).toISOString());
        assert.ok(claimed.leaseUntil && claimed.leaseUntil>now);
        return;
      }
      await new Promise(resolve=>setTimeout(resolve,5));
    }
    assert.fail("Eligible UTC privacy receipt was not claimed");
  });
  let worker: ReturnType<typeof processOnePrivacyJob> | undefined;
  try {
    await ready;
    worker = processOnePrivacyJob(now);
    inspect();
    await holder;
    assert.equal((await worker).status,"completed");
  } finally {
    inspect(); await holder.catch(()=>{}); await worker?.catch(()=>{});
    await prisma.$queryRaw`SELECT set_config('TimeZone',${timezone},false)`;
  }
});

test("redaction cascades snapshots/evaluations/exceptions/history, clears jobs/checkpoint and preserves another shop", async () => {
  const a = await fixture(), b = await fixture();
  const id = "gid://shopify/Order/82003";
  await ingest(a,id); await ingest(b,id);
  const exception = (await listExceptions(a.principal))[0];
  await acceptOrderJob(a.domain,randomUUID(),id);
  await prisma.orderSyncState.create({data:{shopId:a.id,generation:a.generation,nextRunAt:new Date(),phase:"waiting",pendingJobIds:[]}});
  const exportRequest = await receipt(a,"customers/data_request",["82003"]);
  await processOnePrivacyJob();
  assert.ok(await getPrivacyExport(a.principal,exportRequest.id));
  await receipt(a,"customers/redact",["82003"]);
  assert.equal(await getPrivacyExport(a.principal,exportRequest.id),null);
  assert.equal((await processOnePrivacyJob()).status,"completed");
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:a.id,orderId:id}}),0);
  assert.equal(await prisma.ruleEvaluation.count({where:{shopId:a.id,orderId:id}}),0);
  assert.equal(await prisma.exceptionRecord.count({where:{shopId:a.id,orderId:id}}),0);
  assert.equal(await prisma.exceptionHistory.count({where:{exceptionId:exception.id}}),0);
  assert.equal(await prisma.orderJob.count({where:{shopId:a.id,orderId:id}}),0);
  assert.equal(await prisma.orderSyncState.count({where:{shopId:a.id}}),0);
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:b.id,orderId:id}}),1);
  assert.equal(await blocked(a.domain,id,a.installedAt),true);
  assert.equal(await blocked(b.domain,id,b.installedAt),false);
  assert.equal((await acceptOrderJob(a.domain,randomUUID(),id)).accepted,false);
  await assert.rejects(getException(b.principal,exception.id),error=>(error as {status:number}).status===404);
});

test("in-flight authoritative fetch and after-write evidence cannot resurrect erased data", async () => {
  const shop = await fixture();
  const id = "gid://shopify/Order/82004", value = order(id);
  await acceptOrderJob(shop.domain,randomUUID(),id);
  const result = await processOneOrderJob(async()=>{
    await receipt(shop,"customers/redact",["82004"]);
    assert.equal((await processOnePrivacyJob()).status,"completed");
    return value;
  });
  assert.notEqual(result.status,"completed");
  assert.equal(result.evaluations,undefined);
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:shop.id,orderId:id}}),0);
  const secondId = "gid://shopify/Order/82005";
  await acceptOrderJob(shop.domain,randomUUID(),secondId);
  const second = await processOneOrderJob(async()=>order(secondId),{afterWrite:async()=>{
    await receipt(shop,"customers/redact",["82005"]);
    await processOnePrivacyJob();
  }});
  assert.notEqual(second.status,"completed");
  assert.equal(second.evaluations,undefined);
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:shop.id,orderId:secondId}}),0);
});

test("reconciliation skips permanently erased IDs and completes a usable surviving order", async () => {
  const shop = await fixture();
  const erased = "gid://shopify/Order/82006", kept = "gid://shopify/Order/82007";
  await receipt(shop,"customers/redact",["82006"]); await processOnePrivacyJob();
  const values = [order(erased),order(kept)];
  const now = new Date();
  assert.equal((await advanceOrderSync(shop.id,async()=>({orders:values.map(value=>({id:value.id,createdAt:value.createdAt,updatedAt:value.updatedAt})),hasNextPage:false,endCursor:null}),now)).advanced,true);
  assert.deepEqual((await prisma.orderJob.findMany({where:{shopId:shop.id}})).map(value=>value.orderId),[kept]);
  await processOneOrderJob(async()=>values[1]);
  await advanceOrderSync(shop.id,async()=>{throw Error("NO_NEXT_PAGE_EXPECTED");},new Date(now.getTime()+100));
  assert.equal((await prisma.orderSyncState.findUniqueOrThrow({where:{shopId:shop.id}})).phase,"idle");
});

test("privacy processing remains available after uninstall; new verified reinstall permits ordinary new work", async () => {
  const shop = await fixture();
  await ingest(shop,"gid://shopify/Order/82008");
  await acceptOrderJob(shop.domain,randomUUID(),"gid://shopify/Order/82009");
  await deactivateShop(shop.domain,randomUUID());
  assert.deepEqual(await processOneOrderJob(async()=>{throw Error("UNINSTALLED_FETCH_FORBIDDEN");}),{processed:false});
  await receipt(shop,"customers/redact",["82008"]);
  assert.equal((await processOnePrivacyJob()).status,"completed");
  await receipt(shop,"shop/redact");
  assert.equal((await processOnePrivacyJob()).status,"completed");
  assert.equal(await prisma.shop.count({where:{domain:shop.domain}}),0);
  assert.equal(await prisma.session.count({where:{shop:shop.domain}}),0);
  const reinstall = await activateShop(shop.domain,shop.shopifyId!);
  assert.equal(await blocked(shop.domain,undefined,reinstall.installedAt),false);
  assert.equal((await acceptOrderJob(shop.domain,randomUUID(),"gid://shopify/Order/82010")).accepted,true);
  assert.equal((await acceptOrderJob(shop.domain,randomUUID(),"gid://shopify/Order/82008")).accepted,false);
});

test("journal survives deletion transaction crash and retry completes safely", async () => {
  const shop = await fixture();
  const id = "gid://shopify/Order/82011";
  await ingest(shop,id);
  const request = await receipt(shop,"customers/redact",["82011"]);
  assert.equal((await processOnePrivacyJob(new Date(),{afterJournal:()=>{throw Error("SIMULATED_CRASH_AFTER_FSYNC");}})).status,"retry_or_failed");
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:shop.id,orderId:id}}),1);
  assert.equal(await blocked(shop.domain,id,shop.installedAt),true);
  assert.ok(readDeletionJournal().some(value=>value.orderKey===privacyHash(`order:${shop.domain}:${id}`)));
  assert.equal((await processOnePrivacyJob(new Date(Date.now()+150_000))).status,"completed");
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:shop.id,orderId:id}}),0);
  assert.equal((await prisma.privacyReceipt.findUniqueOrThrow({where:{id:request.id}})).attempts,2);
});

test("restored old snapshots and jobs are blocked by independent journal before sweep and erased by replay", async () => {
  const shop = await fixture();
  const id = "gid://shopify/Order/82012";
  await ingest(shop,id);
  const oldSnapshot = await prisma.orderSnapshot.findFirstOrThrow({where:{shopId:shop.id,orderId:id}});
  const oldJob = await prisma.orderJob.findFirstOrThrow({where:{shopId:shop.id,orderId:id}});
  await receipt(shop,"customers/redact",["82012"]); await processOnePrivacyJob();
  await prisma.privacyDeletion.deleteMany({where:{shopKey:privacyHash(`shop:${shop.domain}`)}});
  await prisma.orderSnapshot.create({data:oldSnapshot});
  await prisma.orderJob.create({data:{...oldJob,status:"pending",attempts:0,leaseToken:null,leaseUntil:null}});
  assert.equal(await blocked(shop.domain,id,shop.installedAt),true);
  let fetched = false;
  await processOneOrderJob(async()=>{fetched=true;return order(id);});
  assert.equal(fetched,false);
  await applyPrivacyJournal();
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:shop.id,orderId:id}}),0);
  assert.equal(await prisma.orderJob.count({where:{shopId:shop.id,orderId:id}}),0);
  assert.equal(await prisma.privacyDeletion.count({where:{shopKey:privacyHash(`shop:${shop.domain}`)}}),1);
});

test("missing, truncated and tampered journal fail closed without ordinary writes", async () => {
  const shop = await fixture(false);
  const original = readFileSync(journal,"utf8");
  try {
    process.env.PRIVACY_JOURNAL_PATH = `${journal}.missing`;
    await assert.rejects(acceptOrderJob(shop.domain,randomUUID(),"gid://shopify/Order/82013"),/PRIVACY_JOURNAL_UNAVAILABLE/);
    process.env.PRIVACY_JOURNAL_PATH = journal;
    for (const corrupt of ['{"entry":',original+'{"entry":{"shopKey":"'+'0'.repeat(64)+'","orderKey":"","deletedAt":"2026-01-01T00:00:00Z"},"signature":"'+'0'.repeat(64)+'"}\n']) {
      writeFileSync(journal,corrupt);
      await assert.rejects(blocked(shop.domain,undefined,shop.installedAt),/PRIVACY_JOURNAL_UNAVAILABLE/);
    }
    assert.equal(await prisma.orderJob.count({where:{shopId:shop.id}}),0);
  } finally { process.env.PRIVACY_JOURNAL_PATH=journal; writeFileSync(journal,original); }
});

test("exports expire within order retention and completed receipts purge; unresolved work is retained visibly", async () => {
  const shop = await fixture();
  await ingest(shop,"gid://shopify/Order/82014");
  const request = await receipt(shop,"customers/data_request",["82014"]);
  await processOnePrivacyJob();
  const ready = await prisma.privacyReceipt.findUniqueOrThrow({where:{id:request.id}});
  const snapshot = await prisma.orderSnapshot.findFirstOrThrow({where:{shopId:shop.id}});
  assert.ok(ready.exportExpiresAt && ready.exportExpiresAt<=snapshot.expiresAt);
  assert.equal(await markPrivacyExportDelivered(shop.principal,request.id,true),true);
  const preparedOnly = await receipt(shop,"customers/data_request",[]);
  await processOnePrivacyJob();
  assert.equal(await getPrivacyExport(shop.principal,request.id,new Date(Date.now()+8*DAY)),null);
  await purgePrivacy(new Date(Date.now()+8*DAY));
  assert.equal((await prisma.privacyReceipt.findUniqueOrThrow({where:{id:request.id}})).encryptedExport,null);
  const unresolved = await receipt(shop,"customers/data_request",[]);
  await purgePrivacy(new Date(Date.now()+31*DAY));
  assert.equal(await prisma.privacyReceipt.count({where:{id:request.id}}),0);
  assert.equal((await prisma.privacyReceipt.findUniqueOrThrow({where:{id:preparedOnly.id}})).deliveredAt,null);
  assert.equal((await prisma.privacyReceipt.findUniqueOrThrow({where:{id:unresolved.id}})).status,"pending");
  await purgeExpiredOrders(new Date(Date.now()+31*DAY));
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:shop.id}}),0);
  assert.equal(await prisma.exceptionHistory.count({where:{exception:{shopId:shop.id}}}),0);
});

test("prepared export is not delivered: confirmed tenant handoff has encrypted idempotent actor audit", async () => {
  const a = await fixture(false), b = await fixture(false);
  const request = await receipt(a,"customers/data_request",[]);
  await processOnePrivacyJob();
  assert.equal((await prisma.privacyReceipt.findUniqueOrThrow({where:{id:request.id}})).deliveredAt,null);
  assert.deepEqual(await privacyStatus(),{backlog:0,failed:0,awaitingHandoff:1,overdue:0});
  await assert.rejects(markPrivacyExportDelivered(a.principal,request.id,false),/HANDOFF_CONFIRMATION_REQUIRED/);
  assert.equal(await markPrivacyExportDelivered(b.principal,request.id,true),false);
  const handoffAt = new Date();
  assert.equal(await markPrivacyExportDelivered(a.principal,request.id,true,handoffAt),true);
  const delivered = await prisma.privacyReceipt.findUniqueOrThrow({where:{id:request.id}});
  assert.equal(delivered.deliveredAt?.toISOString(),handoffAt.toISOString());
  assert.ok(delivered.encryptedDelivery);
  assert.equal(delivered.encryptedDelivery.includes(actor),false);
  assert.deepEqual(JSON.parse(openOrder(delivered.encryptedDelivery,`privacy-delivery:${request.id}:${a.domain}`)),{actor,at:handoffAt.toISOString(),reason:"VERIFIED_MERCHANT_HANDOFF"});
  assert.equal(await markPrivacyExportDelivered(a.principal,request.id,true,new Date(handoffAt.getTime()+1000)),true);
  const duplicate = await prisma.privacyReceipt.findUniqueOrThrow({where:{id:request.id}});
  assert.equal(duplicate.deliveredAt?.toISOString(),handoffAt.toISOString());
  assert.equal(duplicate.encryptedDelivery,delivered.encryptedDelivery);
  assert.deepEqual(await privacyStatus(),{backlog:0,failed:0,awaitingHandoff:0,overdue:0});
});

test("privacy status exposes safe backlog, failed and overdue counts including undelivered prepared exports", async () => {
  const shop = await fixture(false);
  const old = new Date(Date.now()-31*DAY);
  const prepared = await receipt(shop,"customers/data_request",[]);
  await processOnePrivacyJob();
  const failed = await receipt(shop,"customers/redact",[]);
  await prisma.privacyReceipt.update({where:{id:prepared.id},data:{receivedAt:old}});
  await prisma.privacyReceipt.update({where:{id:failed.id},data:{receivedAt:old,status:"failed",errorCode:"PRIVACY_PROCESSING_UNAVAILABLE"}});
  const summary = await privacyStatus();
  assert.deepEqual(summary,{backlog:1,failed:1,awaitingHandoff:1,overdue:2});
  assert.equal(JSON.stringify(summary).includes(shop.domain),false);
  assert.equal(JSON.stringify(summary).includes("83001"),false);
});

test("authentic delayed shop redaction conservatively purges active reinstallation without trusting unsigned timestamps", async () => {
  const shop = await fixture(false);
  await deactivateShop(shop.domain,randomUUID());
  const current = await activateShop(shop.domain,shop.shopifyId!);
  assert.equal(current.active,true);
  assert.equal(current.generation,shop.generation+1);
  await acceptOrderJob(shop.domain,randomUUID(),"gid://shopify/Order/82015");
  const request = await receipt(shop,"shop/redact");
  assert.equal((await processOnePrivacyJob()).status,"completed");
  assert.equal(await prisma.shop.count({where:{domain:shop.domain}}),0);
  assert.equal(await prisma.orderJob.count({where:{shopId:current.id}}),0);
  assert.equal((await prisma.privacyReceipt.findUniqueOrThrow({where:{id:request.id}})).status,"completed");
  assert.equal(await blocked(shop.domain,undefined,current.installedAt),true);
});

test("online sessions discard staff profile PII while preserving encrypted credentials and required identity", async () => {
  const shop = await fixture(false);
  const token = "synthetic-online-token-not-real";
  const session = new Session({id:`online_${shop.domain}_901`,shop:shop.domain,state:"",isOnline:true,scope:"read_orders",accessToken:token,
    onlineAccessInfo:{expires_in:3600,associated_user_scope:"read_orders",associated_user:{id:901,first_name:"Discarded",last_name:"Synthetic",email:"discarded@example.invalid",email_verified:true,locale:"en",account_owner:true,collaborator:false}}});
  const storage = new EncryptedSessionStorage(prisma);
  assert.equal(await storage.storeSession(session),true);
  const stored = await prisma.session.findUniqueOrThrow({where:{id:session.id}});
  for (const field of [stored.firstName,stored.lastName,stored.email,stored.locale]) assert.equal(field??"","");
  assert.equal(stored.userId,901n);
  assert.notEqual(stored.accessToken,token);
  assert.equal((await storage.loadSession(session.id))?.accessToken,token);
  assert.equal(session.onlineAccessInfo?.associated_user.email,"discarded@example.invalid","Original caller object must remain unchanged");
});

test("privacy deletion waits for an earlier authenticated credential write and then removes both shop and credentials", async () => {
  const shop = await fixture(false);
  const storage = new EncryptedSessionStorage(prisma);
  const session = new Session({id:`offline_${shop.domain}`,shop:shop.domain,state:"",isOnline:false,accessToken:"synthetic-delayed-credential",scope:"read_orders"});
  let ready!:()=>void, finishWrite!:()=>void;
  const locked = new Promise<void>(resolve=>{ready=resolve;});
  const resume = new Promise<void>(resolve=>{finishWrite=resolve;});
  const auth = withAuthLock(shop.domain,async()=>{
    ready(); await resume;
    assert.equal(await storage.storeSession(session),true);
    assert.equal(await authOperation(shop.domain)!.tx.session.count({where:{shop:shop.domain}}),1);
    assert.equal(await storage.loadSession(session.id),undefined,"Pending privacy erasure must already block session reads");
    assert.equal(await prisma.session.count({where:{shop:shop.domain}}),0,"Uncommitted credential must not escape the auth transaction");
  });
  await locked;
  const request = await receipt(shop,"shop/redact");
  let completed = false;
  const worker = processOnePrivacyJob().then(result=>{completed=true;return result;});
  try {
    await awaitPrivacyClaim(request.id);
    assert.equal(completed,false);
    assert.equal(await prisma.shop.count({where:{domain:shop.domain}}),1);
  } finally { finishWrite(); await auth; }
  assert.equal((await worker).status,"completed");
  assert.equal(await prisma.session.count({where:{shop:shop.domain}}),0);
  assert.equal(await prisma.shop.count({where:{domain:shop.domain}}),0);
});

test("privacy worker with an earlier clock purges verified reinstall completed before its auth lock", async () => {
  const shop = await fixture(false);
  await deactivateShop(shop.domain,randomUUID());
  const earlierClock = new Date(Date.now()-1000);
  let ready!:()=>void, unlock!:()=>void;
  const locked = new Promise<void>(resolve=>{ready=resolve;});
  const resume = new Promise<void>(resolve=>{unlock=resolve;});
  const auth = withAuthLock(shop.domain,async()=>{
    const current = await activateShop(shop.domain,shop.shopifyId!);
    assert.ok(current.installedAt>earlierClock);
    ready(); await resume;
    return current;
  });
  await locked;
  // Activation and credentials now commit with the auth mutex. Intake can wait
  // on the lifecycle lock; never await it while deliberately holding that lock.
  const pendingReceipt = receipt(shop,"shop/redact");
  unlock(); const current=await auth;
  const request = await pendingReceipt;
  await prisma.privacyReceipt.update({where:{id:request.id},data:{availableAt:earlierClock}});
  const worker = processOnePrivacyJob(earlierClock);
  assert.equal((await worker).status,"completed");
  assert.equal(await prisma.shop.count({where:{domain:shop.domain}}),0);
  assert.equal(await blocked(shop.domain,undefined,current.installedAt),true);
});

test("restored active shop marker disables ordinary eligibility before privacy sweep", async () => {
  const shop = await fixture(false);
  const backup = await prisma.shop.findUniqueOrThrow({where:{id:shop.id}});
  await receipt(shop,"shop/redact"); await processOnePrivacyJob();
  await prisma.privacyDeletion.deleteMany({where:{shopKey:privacyHash(`shop:${shop.domain}`)}});
  await prisma.shop.create({data:backup});
  assert.equal((await prisma.shop.findUniqueOrThrow({where:{id:shop.id}})).active,true);
  assert.equal(await canRunOrdinaryJob(shop.domain,shop.generation),false);
  await applyPrivacyJournal();
  assert.equal(await prisma.shop.count({where:{domain:shop.domain}}),0);
});

test("privacy failures use bounded retries then remain failed and blocked for operator escalation", async () => {
  const shop = await fixture(false);
  const row = await receipt(shop,"customers/redact",["82999"]);
  const workingPath = process.env.PRIVACY_JOURNAL_PATH!;
  try {
    process.env.PRIVACY_JOURNAL_PATH = `${workingPath}.missing`;
    for (let attempt = 0; attempt < 5; attempt++) {
      const now = new Date(Date.now()+attempt*1_000_000);
      assert.equal((await processOnePrivacyJob(now)).status,"retry_or_failed");
      const current = await prisma.privacyReceipt.findUniqueOrThrow({where:{id:row.id}});
      assert.equal(current.attempts,attempt+1);
      assert.equal(current.status,attempt === 4 ? "failed" : "retry");
      assert.equal(current.completedAt,null);
    }
    assert.deepEqual(await processOnePrivacyJob(new Date(Date.now()+10_000_000)),{processed:false});
  } finally { process.env.PRIVACY_JOURNAL_PATH = workingPath; }
  assert.equal(await blocked(shop.domain,"gid://shopify/Order/82999",shop.installedAt),true);
  await purgePrivacy(new Date(Date.now()+60*DAY));
  assert.equal((await prisma.privacyReceipt.findUniqueOrThrow({where:{id:row.id}})).status,"failed");
});

test("journal restore erases orphan credentials but preserves a later verified installation", async () => {
  const shop = await fixture(false);
  const storage = new EncryptedSessionStorage(prisma);
  const session = new Session({id:`offline_${shop.domain}`,shop:shop.domain,state:"",isOnline:false,scope:"read_orders",accessToken:"synthetic-pre-erasure-credential"});
  await storage.storeSession(session);
  const oldRow = await prisma.session.findUniqueOrThrow({where:{id:session.id}});
  await receipt(shop,"shop/redact");
  assert.equal((await processOnePrivacyJob()).status,"completed");
  assert.equal(await prisma.shop.count({where:{domain:shop.domain}}),0);
  await prisma.privacyDeletion.deleteMany({where:{shopKey:privacyHash(`shop:${shop.domain}`)}});
  await prisma.session.create({data:oldRow}); // Isolated old backup fragment.
  assert.equal(await storage.loadSession(session.id),undefined);
  await applyPrivacyJournal();
  assert.equal(await prisma.session.count({where:{shop:shop.domain}}),0);
  const current = await activateShop(shop.domain,shop.shopifyId!);
  await storage.storeSession(new Session({...session.toObject(),accessToken:"synthetic-post-reinstall-credential"}));
  await applyPrivacyJournal();
  assert.equal((await storage.loadSession(session.id))?.accessToken,"synthetic-post-reinstall-credential");
  assert.equal((await prisma.shop.findUniqueOrThrow({where:{id:current.id}})).active,true);
});

test("export of retained but privacy-blocked evidence retries instead of reporting an empty result", async () => {
  const shop = await fixture();
  const id = "gid://shopify/Order/82016";
  await ingest(shop, id);
  const request = await receipt(shop, "customers/data_request", ["82016"]);
  await prisma.privacyReceipt.update({where:{id:request.id},data:{receivedAt:new Date(Date.now()-30_000)}});
  const redaction = await receipt(shop, "customers/redact", ["82016"]);
  assert.equal((await processOnePrivacyJob()).status, "retry_or_failed");
  const blockedExport = await prisma.privacyReceipt.findUniqueOrThrow({where:{id:request.id}});
  assert.equal(blockedExport.status, "retry");
  assert.equal(blockedExport.encryptedExport, null);
  assert.equal(blockedExport.completedAt, null);
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:shop.id,orderId:id}}), 1);
  assert.equal((await processOnePrivacyJob()).status, "completed");
  assert.equal((await prisma.privacyReceipt.findUniqueOrThrow({where:{id:redaction.id}})).status, "completed");
  await prisma.privacyReceipt.update({where:{id:request.id},data:{availableAt:new Date()}});
  assert.equal((await processOnePrivacyJob()).status, "completed");
  assert.deepEqual((await getPrivacyExport(shop.principal,request.id)).records, []);
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:shop.id,orderId:id}}), 0);
});
