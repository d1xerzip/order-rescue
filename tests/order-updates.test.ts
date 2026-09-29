import assert from "node:assert/strict";
import { randomUUID, createHmac } from "node:crypto";
import { after, before, test } from "node:test";
import prisma, { authLockDb } from "../app/db.server";
import { activateShop } from "../app/storage.server";
import { acceptOrderJob, processOneOrderJob, purgeExpiredOrders } from "../app/order-jobs.server";
import { openOrder } from "../app/order-crypto.server";
import { receiveOrderCreated } from "../app/order-webhook.server";
import { SnapshotError } from "../app/order-snapshot.server";

const domains: string[] = [];
const id = "gid://shopify/Order/9991";
const now = new Date();
const stamp = new Date(now.getTime() - 10_000).toISOString();
const value = (amount = "20.00", cancelledAt: string | null = null) => ({ id, createdAt: stamp, updatedAt: stamp,
  cancelledAt: {available:true,value:cancelledAt},total:{available:true,value:{amount,currencyCode:"USD"}},
  lines:{available:true,value:[{id:"gid://shopify/LineItem/1",currentQuantity:2}]} });
before(() => {
  assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB,"1");
  assert.equal(new URL(process.env.DATABASE_URL!).hostname,"127.0.0.1");
  process.env.ORDER_INGESTION_ENABLED="1";
});
after(async () => {
  await prisma.shop.deleteMany({where:{domain:{in:domains}}});
  await Promise.all([prisma.$disconnect(),authLockDb.$disconnect()]);
});
async function fixture() {
  const domain = `updates-${randomUUID()}.myshopify.com`; domains.push(domain);
  const shop = await activateShop(domain);
  await prisma.shop.update({where:{id:shop.id},data:{installedAt:new Date(now.getTime()-60_000)}});
  return shop;
}
async function stored(shopId:string) {
  const row=await prisma.orderSnapshot.findFirstOrThrow({where:{shopId}});
  return JSON.parse(openOrder(row.encryptedSnapshot,`${shopId}:1:${id}`));
}
test("reverse notifications reread current state; equal timestamp cancellation repairs fields; older API state cannot regress",async()=>{
  const shop=await fixture();
  for(const delivery of ["new-delivery","old-delivery"]) {
    await acceptOrderJob(shop.domain,delivery,id);
    assert.equal((await processOneOrderJob(async()=>value("25.00"))).status,"completed");
  }
  assert.deepEqual(await stored(shop.id),value("25.00"));
  await acceptOrderJob(shop.domain,"equal-time-cancel",id);
  assert.equal((await processOneOrderJob(async()=>value("25.00",stamp))).status,"completed");
  assert.deepEqual(await stored(shop.id),value("25.00",stamp));
  await acceptOrderJob(shop.domain,"older-api",id);
  const old={...value(),createdAt:new Date(now.getTime()-20_000).toISOString(),updatedAt:new Date(now.getTime()-15_000).toISOString()};
  await processOneOrderJob(async()=>old);
  assert.deepEqual(await stored(shop.id),value("25.00",stamp));
});
test("webhook and reconciliation jobs cannot read the same order concurrently",async()=>{
  const shop=await fixture();
  await acceptOrderJob(shop.domain,"webhook",id);
  let unblock!:()=>void, entered!:()=>void;
  const gate=new Promise<void>(r=>unblock=r), started=new Promise<void>(r=>entered=r);
  const first=processOneOrderJob(async()=>{entered();await gate;return value();});
  await started;
  await acceptOrderJob(shop.domain,"sync:test",id);
  let secondRead=false;
  assert.equal((await processOneOrderJob(async()=>{secondRead=true;return value("30.00");})).status,"retry");
  assert.equal(secondRead,false);
  unblock(); assert.equal((await first).status,"completed");
  await prisma.orderJob.updateMany({where:{shopId:shop.id,status:"retry"},data:{availableAt:new Date(0)}});
  assert.equal((await processOneOrderJob(async()=>value("30.00"))).status,"completed");
  assert.deepEqual(await stored(shop.id),value("30.00"));
});
test("updated and cancelled topics authenticate original bytes before durable receipt",async()=>{
  const shop=await fixture();
  for(const topic of ["orders/updated","orders/cancelled"]) {
    const body=JSON.stringify({admin_graphql_api_id:id});
    const headers={"x-shopify-shop-domain":shop.domain,"x-shopify-topic":topic,"x-shopify-webhook-id":randomUUID(),
      "x-shopify-hmac-sha256":createHmac("sha256",process.env.SHOPIFY_API_SECRET!).update(body).digest("base64")};
    assert.equal((await receiveOrderCreated(new Request("https://example.test",{method:"POST",body:body+" ",headers}),topic)).status,401);
    assert.equal((await receiveOrderCreated(new Request("https://example.test",{method:"POST",body,headers}),topic)).status,200);
    await processOneOrderJob(async()=>value());
  }
  assert.equal(await prisma.orderJob.count({where:{shopId:shop.id}}),2);
});
test("durable retry respects throttle delay and expired read-lock metadata is removed",async()=>{
  const shop=await fixture();
  await acceptOrderJob(shop.domain,"throttle",id);
  const now = new Date();
  assert.equal((await processOneOrderJob(async()=>{throw new SnapshotError("API_THROTTLED",180_000);},{now})).status,"retry");
  const job=await prisma.orderJob.findFirstOrThrow({where:{shopId:shop.id}});
  assert.equal(job.availableAt.getTime(),now.getTime()+180_000);
  assert.equal(job.errorCode,"API_THROTTLED");
  await prisma.orderReadLock.create({data:{shopId:shop.id,generation:1,orderId:id,token:"expired",expiresAt:new Date(0)}});
  await purgeExpiredOrders(now);
  assert.equal(await prisma.orderReadLock.count({where:{shopId:shop.id}}),0);
});
