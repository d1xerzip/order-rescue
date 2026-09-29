// Explicit development-store read-only Shopify check; writes only local app state.
import assert from "node:assert/strict";
import prisma, { authLockDb } from "../app/db.server";
import { validateShopDomain } from "../app/storage.server";
import { advanceOrderSync, getOrderSyncStatus } from "../app/order-sync.server";
import { fetchOrderPage, fetchOrderSnapshot } from "../app/order-snapshot.server";
import { shopOrderGraphql } from "../app/order-runtime.server";
import { processOneOrderJob } from "../app/order-jobs.server";
import { openOrder } from "../app/order-crypto.server";

assert.equal(process.env.ORDER_INGESTION_ENABLED,"1");
assert.ok(["127.0.0.1","localhost"].includes(new URL(process.env.DATABASE_URL!).hostname));
const domains=process.argv.slice(2).map(validateShopDomain);
assert.ok(domains.length>0 && domains.length<=2);
try {
  for(let index=0;index<domains.length;index++) {
    const shop=await prisma.shop.findUniqueOrThrow({where:{domain:domains[index]}});
    assert.ok(shop.active && shop.jobsEnabled && shop.shopifyId);
    const graphql=shopOrderGraphql(shop.domain,shop.generation);
    const expected={domain:shop.domain,shopifyId:shop.shopifyId!};
    for(let step=0;step<200;step++) {
      await advanceOrderSync(shop.id,({windowStart,windowEnd,cursor})=>
        fetchOrderPage(graphql,expected,{from:windowStart,to:windowEnd,after:cursor}));
      const state=await getOrderSyncStatus(shop.id);
      if(state.phase==="idle" && state.lastSuccessAt) break;
      assert.ok(!["failed","retry"].includes(state.phase),state.lastError ?? "SYNC_INCOMPLETE");
      await processOneOrderJob(async(job,tenant)=> {
        assert.ok(domains.includes(tenant.domain),"UNSELECTED_SHOP_JOB");
        assert.ok(tenant.shopifyId);
        return fetchOrderSnapshot(shopOrderGraphql(tenant.domain,tenant.generation),job.orderId,
          {domain:tenant.domain,shopifyId:tenant.shopifyId});
      });
    }
    const state=await prisma.orderSyncState.findUniqueOrThrow({where:{shopId:shop.id}});
    assert.equal(state.phase,"idle"); assert.ok(state.lastSuccessAt && state.windowStart && state.windowEnd);
    let cursor:string|null=null;
    const expectedIds=new Set<string>();
    let exactMatches=0;
    for(let page=0;page<10;page++) {
      const result=await fetchOrderPage(graphql,expected,{from:state.windowStart!,to:state.windowEnd!,after:cursor});
      for(const order of result.orders) {
        expectedIds.add(order.id);
        const authoritative=await fetchOrderSnapshot(graphql,order.id,expected);
        const stored=await prisma.orderSnapshot.findUniqueOrThrow({where:{shopId_generation_orderId:{shopId:shop.id,generation:shop.generation,orderId:order.id}}});
        assert.deepEqual(JSON.parse(openOrder(stored.encryptedSnapshot,`${shop.id}:${shop.generation}:${order.id}`)),authoritative);
        assert.ok(authoritative.total.available && authoritative.lines.available && authoritative.cancelledAt.available);
        exactMatches++;
      }
      if(!result.hasNextPage) break;
      assert.ok(page<9,"LIVE_CHECK_LIMIT"); cursor=result.endCursor;
    }
    const stored=await prisma.orderSnapshot.findMany({where:{shopId:shop.id,generation:shop.generation,orderCreatedAt:{gte:state.windowStart!,lte:state.windowEnd!}}});
    assert.deepEqual(new Set(stored.map(row=>row.orderId)),expectedIds);
    console.log(JSON.stringify({store:index+1,source:"Shopify GraphQL 2026-07",phase:state.phase,lastSuccessAt:state.lastSuccessAt,discovered:expectedIds.size,exactMatches,idsAndApprovedFieldsMatch:true}));
  }
} catch { console.error("LIVE_SYNC_CHECK_INCOMPLETE");process.exitCode=1; }
finally {await Promise.all([prisma.$disconnect(),authLockDb.$disconnect()]);}
