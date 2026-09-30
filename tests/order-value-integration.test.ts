import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";
import prisma, { authLockDb } from "../app/db.server";
import { activateShop } from "../app/storage.server";
import { acceptOrderJob, processOneOrderJob } from "../app/order-jobs.server";
import { validateHighOrderValueSettings } from "../app/rules/high-order-value";
import { evaluateStoredOrderValue } from "../app/order-evaluation.server";

const domains:string[]=[];
const stamp=new Date(Date.now()-10_000).toISOString();
const id="gid://shopify/Order/881";
const snapshot=(amount="100.01",cancelledAt:string|null=null)=>({id,createdAt:stamp,updatedAt:stamp,
  cancelledAt:{available:true,value:cancelledAt},total:{available:true,value:{amount,currencyCode:"CAD"}},
  lines:{available:false,reason:"LINES_UNAVAILABLE"}});
before(()=>{assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB,"1");assert.equal(new URL(process.env.DATABASE_URL!).hostname,"127.0.0.1");});
afterEach(async()=>{await prisma.orderJob.deleteMany({where:{shop:{domain:{in:domains}}}});});
after(async()=>{await prisma.shop.deleteMany({where:{domain:{in:domains}}});await Promise.all([prisma.$disconnect(),authLockDb.$disconnect()]);});
async function fixture(){const domain=`value-${randomUUID()}.myshopify.com`;domains.push(domain);const shop=await activateShop(domain);return prisma.shop.update({where:{id:shop.id},data:{installedAt:new Date(Date.now()-60_000)}});}
const settings=(shopId:string,threshold="100.00")=>validateHighOrderValueSettings(shopId,{shopId,ruleKey:"high_order_value",settingsVersion:"settings-1",enabled:true,threshold,currencyCode:"CAD"});
async function run(shop:{id:string;domain:string},value= snapshot(),threshold="100.00") {
  await acceptOrderJob(shop.domain,randomUUID(),id);
  return processOneOrderJob(async()=>value,{valueSettings:settings(shop.id,threshold)});
}
test("existing ingestion job produces value result with distinct explicit tenant settings; no default threshold",async()=>{
  const a=await fixture(),b=await fixture();
  const first=await run(a),second=await run(b,snapshot(),"200.00");
  assert.equal(first.status,"completed");assert.equal(first.evaluation?.outcome,"matched");
  assert.equal(second.evaluation?.outcome,"not_matched");
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:{in:[a.id,b.id]}}}),2);
  await acceptOrderJob(a.domain,randomUUID(),id);
  const absent=await processOneOrderJob(async()=>snapshot());
  assert.equal(absent.evaluation?.reasonCode,"NOT_CONFIGURED");
});
test("stale delivery evaluates the stored newer winner; equal timestamp changes get a distinct source digest",async()=>{
  const shop=await fixture();
  const newer={...snapshot(),updatedAt:new Date(Date.parse(stamp)+1000).toISOString()};
  const first=await run(shop,newer);
  const stale=await run(shop,snapshot("90.00"));
  assert.equal(stale.evaluation?.outcome,"matched");
  assert.equal(stale.evaluation?.sourceSnapshotVersion,first.evaluation?.sourceSnapshotVersion);
  const equal=await run(shop,{...newer,total:snapshot("90.00").total});
  assert.equal(equal.evaluation?.outcome,"not_matched");
  assert.notEqual(equal.evaluation?.sourceSnapshotVersion,first.evaluation?.sourceSnapshotVersion);
});
test("unknown money and cancellation propagate through the one job path",async()=>{
  const shop=await fixture();
  const missing={...snapshot(),total:{available:false,reason:"TOTAL_UNAVAILABLE"}};
  await acceptOrderJob(shop.domain,randomUUID(),id);
  const result=await processOneOrderJob(async()=>missing,{valueSettings:settings(shop.id)});
  assert.equal(result.evaluation?.outcome,"unknown");
  assert.equal(result.evaluation?.reasonCode,"AMOUNT_UNAVAILABLE");
  const cancel=await run(shop,snapshot("100.01",stamp));
  assert.equal(cancel.evaluation?.outcome,"not_applicable");
  assert.equal(cancel.evaluation?.reasonCode,"ORDER_CANCELLED");
});
test("foreign settings fail before snapshot fetch or evidence exposure",async()=>{
  const a=await fixture(),b=await fixture();let fetched=false;
  await acceptOrderJob(a.domain,randomUUID(),id);
  const result=await processOneOrderJob(async()=>{fetched=true;return snapshot();},{valueSettings:settings(b.id)});
  assert.equal(fetched,false);assert.equal(result.evaluation,undefined);
  assert.equal(result.status,"failed");
  assert.equal((await prisma.orderJob.findFirstOrThrow({where:{shopId:a.id}})).errorCode,"RULE_TENANT_MISMATCH");
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:a.id}}),0);
  await prisma.orderJob.deleteMany({where:{shopId:a.id}});
});
test("crash after snapshot write exposes no result and replay completes without extra snapshot",async()=>{
  const shop=await fixture();await acceptOrderJob(shop.domain,randomUUID(),id);
  await assert.rejects(processOneOrderJob(async()=>snapshot(),{valueSettings:settings(shop.id),afterWrite:()=>{throw Error("SIMULATED_CRASH");}}),/SIMULATED_CRASH/);
  const job=await prisma.orderJob.findFirstOrThrow({where:{shopId:shop.id}});
  const replay=await processOneOrderJob(async()=>snapshot(),{now:new Date(job.leaseUntil!.getTime()+1),valueSettings:settings(shop.id)});
  assert.equal(replay.evaluation?.outcome,"matched");
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:shop.id}}),1);
});
test("adapter fingerprints canonical content, including equal timestamp changes; identical explicit input is deterministic",()=>{
  const context={shopId:"synthetic-shop",generation:1,active:true,monitoringStartedAt:new Date(Date.parse(stamp)-1000).toISOString(),evaluatedAt:new Date(Date.parse(stamp)+1000).toISOString()};
  const s=settings(context.shopId); const first=evaluateStoredOrderValue(snapshot(),context,s);
  const reordered=Object.fromEntries(Object.entries(snapshot()).reverse());
  assert.deepEqual(evaluateStoredOrderValue(reordered,context,s),first);
  assert.notEqual(evaluateStoredOrderValue(snapshot("90.00"),context,s).sourceSnapshotVersion,first.sourceSnapshotVersion);
});
test("invalid explicit settings reject before fetching and never become an empty/safe evaluation",async()=>{
  const shop=await fixture();await acceptOrderJob(shop.domain,randomUUID(),id);let fetched=false;
  const invalid={...settings(shop.id),threshold:"-1"};
  const result=await processOneOrderJob(async()=>{fetched=true;return snapshot();},{valueSettings:invalid});
  assert.equal(fetched,false);assert.equal(result.status,"failed");assert.equal(result.evaluation,undefined);
  assert.equal((await prisma.orderJob.findFirstOrThrow({where:{shopId:shop.id}})).errorCode,"INVALID_CONFIGURATION");
});
test("lost completion lease cannot expose already computed rule evidence",async()=>{
  const shop=await fixture();await acceptOrderJob(shop.domain,randomUUID(),id);
  const result=await processOneOrderJob(async()=>snapshot(),{valueSettings:settings(shop.id),afterWrite:async()=>{
    await prisma.orderJob.updateMany({where:{shopId:shop.id},data:{leaseUntil:new Date(0)}});
  }});
  assert.equal(result.status,"lease_lost");assert.equal(result.evaluation,undefined);
});

test("both rules share one winning snapshot and independent settings versions in the existing job",async()=>{
  const shop=await fixture();
  const quantitySettings={shopId:shop.id,ruleKey:"high_line_quantity" as const,settingsVersion:"quantity-2",enabled:true,threshold:5};
  const withLines=(amount:string,quantities:number[])=>({...snapshot(amount),lines:{available:true as const,value:quantities.map((currentQuantity,index)=>({id:`gid://shopify/LineItem/${index+1}`,currentQuantity}))}});
  for(const [amount,quantities,outcome] of [["100.01",[6],"matched"],["99.99",[3,3],"not_matched"]] as const){
    await acceptOrderJob(shop.domain,randomUUID(),id);
    const result=await processOneOrderJob(async()=>withLines(amount,[...quantities]),{valueSettings:settings(shop.id),quantitySettings});
    assert.equal(result.status,"completed");
    const pair=result.evaluations!;
    assert.equal(pair.high_order_value.outcome,outcome);assert.equal(pair.high_line_quantity.outcome,outcome);
    assert.equal(pair.high_order_value.sourceSnapshotVersion,pair.high_line_quantity.sourceSnapshotVersion);
    assert.equal(pair.high_order_value.evaluatedAt,pair.high_line_quantity.evaluatedAt);
    assert.equal(pair.high_order_value.settingsVersion,"settings-1");assert.equal(pair.high_line_quantity.settingsVersion,"quantity-2");
  }
  assert.equal(await prisma.orderSnapshot.count({where:{shopId:shop.id}}),1);
});
test("quantity settings foreign tenant or invalid threshold fail before fetch",async()=>{
  const shop=await fixture();
  for(const [shopId,threshold,code] of [["foreign-shop",5,"RULE_TENANT_MISMATCH"],[shop.id,0,"INVALID_CONFIGURATION"]] as const){
    await acceptOrderJob(shop.domain,randomUUID(),id);let fetched=false;
    const result=await processOneOrderJob(async()=>{fetched=true;return snapshot();},{quantitySettings:{shopId,ruleKey:"high_line_quantity",settingsVersion:"q1",enabled:true,threshold}});
    assert.equal(fetched,false);assert.equal(result.evaluations,undefined);assert.equal(result.status,"failed");
    assert.equal((await prisma.orderJob.findFirstOrThrow({where:{shopId:shop.id}})).errorCode,code);
    await prisma.orderJob.deleteMany({where:{shopId:shop.id}});
  }
});
test("quantity unknown does not suppress value and completion fencing hides both results",async()=>{
  const shop=await fixture();
  const quantitySettings={shopId:shop.id,ruleKey:"high_line_quantity" as const,settingsVersion:"q1",enabled:true,threshold:5};
  await acceptOrderJob(shop.domain,randomUUID(),id);
  const result=await processOneOrderJob(async()=>snapshot(),{valueSettings:settings(shop.id),quantitySettings});
  assert.equal(result.evaluations?.high_order_value.outcome,"matched");
  assert.equal(result.evaluations?.high_line_quantity.reasonCode,"LINES_UNAVAILABLE");
  await acceptOrderJob(shop.domain,randomUUID(),id);
  const lost=await processOneOrderJob(async()=>snapshot(),{valueSettings:settings(shop.id),quantitySettings,afterWrite:async()=>{
    await prisma.orderJob.updateMany({where:{shopId:shop.id},data:{leaseUntil:new Date(0)}});
  }});
  assert.equal(lost.status,"lease_lost");assert.equal(lost.evaluations,undefined);assert.equal(lost.evaluation,undefined);
});
