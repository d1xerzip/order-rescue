import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before,after,test } from 'node:test';
import prisma,{authLockDb} from '../app/db.server';
import { activateShop } from '../app/storage.server';
import { saveRuleSettings } from '../app/exceptions.server';
import { acceptOrderJob,processOneOrderJob,purgeExpiredOrders } from '../app/order-jobs.server';
import { getOrderSyncStatus } from '../app/order-sync.server';
import { SnapshotError } from '../app/order-snapshot.server';
const domains:string[]=[];
before(()=>{const url=new URL(process.env.DATABASE_URL!);assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB,'1');assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55433');assert.match(url.pathname,/^\/rescue_test_\d+$/);});
after(async()=>{await prisma.shop.deleteMany({where:{domain:{in:domains}}});await Promise.all([prisma.$disconnect(),authLockDb.$disconnect()]);});
async function fixture(){const domain=`reliability-${randomUUID()}.myshopify.com`;domains.push(domain);const shop=await activateShop(domain);await prisma.shop.update({where:{id:shop.id},data:{installedAt:new Date(Date.now()-60000)}});return shop;}
test('order throttle hints are honored up to one hour and excessive delay becomes observable failed work',async()=>{
 const shop=await fixture();const now=new Date();
 for(const [id,hint,expected] of [['870001',3600000,'retry'],['870002',3600001,'failed']] as const){
  const receipt=await acceptOrderJob(shop.domain,randomUUID(),`gid://shopify/Order/${id}`);
  const clock=new Date(Math.max(now.getTime(),Date.now())+1);
  const result=await processOneOrderJob(async()=>{throw new SnapshotError('API_THROTTLED',hint);},{now:clock});assert.equal(result.status,expected);
  const job=await prisma.orderJob.findUniqueOrThrow({where:{id:receipt.jobId}});
  assert.equal(job.availableAt.getTime(),clock.getTime()+3600000);
  assert.equal(job.errorCode,expected==='retry'?'API_THROTTLED':'THROTTLE_DELAY_EXCESSIVE');
  assert.equal(job.attempts,1);assert.equal(job.leaseToken,null);
 }
 assert.equal((await getOrderSyncStatus(shop.id)).failed,1);
 assert.equal((await processOneOrderJob(async()=>{throw Error('MUST_NOT_FETCH_EARLY');})).processed,false);
 // Keep this fixture out of subsequent global-claim tests without changing production retry policy.
 await prisma.shop.update({where:{id:shop.id},data:{jobsEnabled:false}});
});
test('fifth post-persistence crash is swept to ATTEMPTS_EXHAUSTED without a sixth claim or duplicate effect',async()=>{
 const shop=await fixture();const principal={shopId:shop.id,generation:shop.generation,actor:'synthetic'};
 await saveRuleSettings(principal,'high_order_value',{enabled:true,threshold:'100.00',currencyCode:'CAD'},0);
 await saveRuleSettings(principal,'high_line_quantity',{enabled:true,threshold:5},0);
 const stamp=new Date(Date.now()-1000).toISOString();const value={id:'gid://shopify/Order/870003',legacyResourceId:'870003',createdAt:stamp,updatedAt:stamp,cancelledAt:{available:true,value:null},total:{available:true,value:{amount:'100.01',currencyCode:'CAD'}},lines:{available:true,value:[{id:'gid://shopify/LineItem/870003',currentQuantity:6}]}};
 const receipt=await acceptOrderJob(shop.domain,randomUUID(),value.id);let now=new Date(Date.now()+1);
 for(let attempt=1;attempt<=5;attempt++){
  await assert.rejects(processOneOrderJob(async()=>value,{now,afterWrite:()=>{throw Error('SYNTHETIC_CRASH');}}),/SYNTHETIC_CRASH/);
  const job=await prisma.orderJob.findUniqueOrThrow({where:{id:receipt.jobId}});assert.equal(job.attempts,attempt);assert.equal(job.status,'processing');now=new Date(job.leaseUntil!.getTime()+1);
 }
 assert.equal((await processOneOrderJob(async()=>value,{now})).processed,false);
 await purgeExpiredOrders(now);
 const failed=await prisma.orderJob.findUniqueOrThrow({where:{id:receipt.jobId}});assert.equal(failed.status,'failed');assert.equal(failed.errorCode,'ATTEMPTS_EXHAUSTED');assert.equal(failed.attempts,5);
 assert.equal((await getOrderSyncStatus(shop.id)).failed,1);
 assert.equal(await prisma.orderSnapshot.count({where:{shopId:shop.id}}),1);
 assert.equal(await prisma.exceptionRecord.count({where:{shopId:shop.id}}),2);
 assert.equal(await prisma.exceptionHistory.count({where:{exception:{shopId:shop.id}}}),2);
});
