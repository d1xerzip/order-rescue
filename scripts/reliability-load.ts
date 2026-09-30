import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import prisma,{authLockDb} from '../app/db.server';
import { activateShop, deactivateShop } from '../app/storage.server';
import { saveRuleSettings } from '../app/exceptions.server';
import { receiveOrderCreated } from '../app/order-webhook.server';
import { acceptOrderJob, processOneOrderJob, purgeExpiredOrders } from '../app/order-jobs.server';
import { fetchOrderSnapshot, type OrderSnapshot } from '../app/order-snapshot.server';
import { advanceOrderSync, getOrderSyncStatus } from '../app/order-sync.server';
import { createOrderApi, OrderApiError } from '../app/order-api.server';
import { openOrder } from '../app/order-crypto.server';
import type { Shop } from '@prisma/client';

const url=new URL(process.env.DATABASE_URL!);
assert.equal(process.env.P10B_LOAD_MODE,'1');assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB,'1');
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55434');assert.match(url.pathname,/^\/rescue_reliability_\d+$/);
const dir=process.env.P10B_LOAD_DIR!;
assert.ok(resolve(dir).startsWith(resolve('.local')+ '/'.replace('/',process.platform==='win32'?'\\':'/')));
const envelope=JSON.parse(readFileSync('docs/fixtures/p10b-envelope.json','utf8'));
const sourceFiles=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
 const file=resolve(dir,entry.name);return entry.isDirectory()?sourceFiles(file):/\.(ts|tsx|css)$/.test(entry.name)?[file]:[];
});
const fingerprint=()=>Object.fromEntries([...sourceFiles('app'),...['prisma/schema.prisma','package.json','package-lock.json','scripts/reliability-load.ts','scripts/reliability-load.mjs','docs/fixtures/p10b-envelope.json'].map(f=>resolve(f))].sort().map(file=>[
 relative(process.cwd(),file).replaceAll('\\','/'),createHash('sha256').update(readFileSync(file,'utf8').replaceAll('\r\n','\n').trimEnd()+'\n').digest('hex')]));
const candidateSourceSha256=fingerprint();
const snapshots=new Map<string,OrderSnapshot>();
const owners=new Map<string,Shop>();
const originalFetch=globalThis.fetch;
// Only loopback HTTP traffic is permitted. Fake GraphQL is an injected transport,
// not an alternate route to Shopify or a bypass of browser permissions.
globalThis.fetch=async(input,init)=>{const target=new URL(input instanceof Request?input.url:String(input));
 if(target.hostname!=='127.0.0.1'||target.port!=='3114')throw Error('SYNTHETIC_NETWORK_ONLY');return originalFetch(input,init);};
function snapshot(serial:number,now=Date.now()-1000):OrderSnapshot {
 const id=`gid://shopify/Order/${serial}`;const stamp=new Date(now).toISOString();
 return {id,legacyResourceId:String(serial),createdAt:stamp,updatedAt:stamp,cancelledAt:{available:true,value:null},
  total:{available:true,value:{amount:serial%3===0?'100.00':'100.01',currencyCode:'CAD'}},
  lines:{available:true,value:Array.from({length:serial%3+1},(_,i)=>({id:`gid://shopify/LineItem/${serial*10+i}`,currentQuantity:serial%3===0?3:6}))}};
}
const crashFile=resolve(dir,'crash.json');
if(process.argv.includes('--crash')) {
 const value:OrderSnapshot=JSON.parse(readFileSync(crashFile,'utf8'));
 await processOneOrderJob(async()=>value,{afterWrite:()=>process.exit(73)});
 throw Error('CRASH_SEAM_NOT_REACHED');
}
const startedAt=new Date().toISOString();
const shops:Shop[]=[];
for(let i=0;i<3;i++){
 const shop=await activateShop(`load-${i}.myshopify.com`,`gid://shopify/Shop/${87000+i}`);
 await prisma.shop.update({where:{id:shop.id},data:{installedAt:new Date(Date.now()-60000)}});
 const principal={shopId:shop.id,generation:shop.generation,actor:'synthetic-operator'};
 await saveRuleSettings(principal,'high_order_value',{enabled:true,threshold:'100.00',currencyCode:'CAD'},0);
 await saveRuleSettings(principal,'high_line_quantity',{enabled:true,threshold:5},0);
 shops.push(shop);
}
const latencies:number[]=[];const receiptTimes:number[]=[];const perShop=shops.map(()=>[] as number[]);
let apiCalls=0,received=0,receiptErrors=0,workerErrors=0,maxOldest=0,maxBacklog=0,maxRss=process.memoryUsage().rss;
const transport=shops.map(shop=>async(query:string,options?:{variables?:Record<string,unknown>})=>{
 await delay(envelope.mockGraphqlLatencyMs);apiCalls++;
 const value=snapshots.get(String(options?.variables?.id));
 const data=query.includes('P03OrderAuthority')?{shop:{id:shop.shopifyId,myshopifyDomain:shop.domain},currentAppInstallation:{accessScopes:[{handle:'read_orders'}]}}:
  query.includes('P03OrderRevision')?{order:value?{id:value.id,updatedAt:value.updatedAt}:null}:
  {order:value?{id:value.id,legacyResourceId:value.legacyResourceId,createdAt:value.createdAt,updatedAt:value.updatedAt,cancelledAt:value.cancelledAt.available?value.cancelledAt.value:null,
    currentTotalPriceSet:{shopMoney:value.total.available?value.total.value:null},lineItems:{nodes:value.lines.available?value.lines.value:[],pageInfo:{hasNextPage:false,endCursor:null}}}:null};
 return Response.json({data,extensions:{cost:{requestedQueryCost:10,actualQueryCost:10,throttleStatus:{currentlyAvailable:990,restoreRate:100,maximumAvailable:1000}}}},
  {headers:{'X-Shopify-API-Version':'2026-07'}});
});
const load=async(job:{orderId:string},shop:{id:string;domain:string;shopifyId:string|null})=>{
 const index=shops.findIndex(s=>s.id===shop.id);assert.ok(index>=0);
 return fetchOrderSnapshot(transport[index],job.orderId,{shopifyId:shop.shopifyId!,domain:shop.domain});
};
const server=createServer(async(req,res)=>{
 try{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const topic=req.url?.endsWith('updated')?'orders/updated':'orders/create';
  const response=await receiveOrderCreated(new Request(`http://127.0.0.1:3114${req.url}`,{method:'POST',headers:req.headers as Record<string,string>,body:Buffer.concat(chunks)}),topic);
  res.writeHead(response.status);res.end();
 }catch{res.writeHead(503);res.end();}
});
await new Promise<void>(yes=>server.listen(3114,'127.0.0.1',yes));
async function send(index:number,value:OrderSnapshot,delivery=randomUUID(),topic='orders/create',invalid=false,measured=true){
 const body=JSON.stringify({admin_graphql_api_id:value.id});
 const begin=performance.now();const response=await fetch(`http://127.0.0.1:3114/webhooks/${topic==='orders/create'?'create':'updated'}`,{method:'POST',body,
 headers:{'x-shopify-topic':topic,'x-shopify-shop-domain':shops[index].domain,'x-shopify-webhook-id':delivery,
 'x-shopify-hmac-sha256':invalid?'invalid':createHmac('sha256',process.env.SHOPIFY_API_SECRET!).update(body).digest('base64')}});
 if(measured){receiptTimes.push(performance.now()-begin);received++;if(response.status!==200)receiptErrors++;}
 return response.status;
}
async function ipc(message:string,expected:string){await new Promise<void>((yes,no)=>{
 const timer=setTimeout(()=>{process.off('message',listener);no(Error('CONTROL_TIMEOUT'));},15000);
 const listener=(value:unknown)=>{if(value===expected){clearTimeout(timer);process.off('message',listener);yes();}else if(value==='outage-control-failed'){clearTimeout(timer);no(Error('CONTROL_FAILED'));}};
 process.on('message',listener);process.send!(message);
});}
const faults:Record<string,unknown>={};
try{
 const invalid=snapshot(800000);const before=await prisma.orderJob.count();
 assert.equal(await send(0,invalid,randomUUID(),'orders/create',true,false),401);assert.equal(await prisma.orderJob.count(),before);faults.invalidHmac='401; zero jobs';
 // A real shutdown/restart affects only this runner's dedicated cluster.
 await Promise.all([prisma.$disconnect(),authLockDb.$disconnect()]);await ipc('outage-stop','outage-stopped');
 const outageStart=performance.now();assert.equal(await send(0,invalid,randomUUID(),'orders/create',false,false),503);
 const outageReceiptMs=performance.now()-outageStart;
 await ipc('outage-start','outage-started');await prisma.$connect();assert.equal(await prisma.orderJob.count(),before);
 faults.databaseOutage={receipt:503,durableRowsAdded:0,receiptMs:Math.round(outageReceiptMs),reconnected:true};
 // Real child process death after the snapshot transaction, before completion.
 const crashed=snapshot(800001);snapshots.set(crashed.id,crashed);owners.set(crashed.id,shops[0]);writeFileSync(crashFile,JSON.stringify(crashed));
 await send(0,crashed,randomUUID(),'orders/create',false,false);
 const crashExit=await new Promise<number|null>((yes,no)=>{const child=spawn(process.execPath,['--import','tsx','scripts/reliability-load.ts','--crash'],{env:process.env,stdio:'ignore',windowsHide:true});child.once('error',no);child.once('exit',yes);});
 assert.equal(crashExit,73);
 const crashedJob=await prisma.orderJob.findFirstOrThrow({where:{orderId:crashed.id}});assert.equal(crashedJob.status,'processing');
 const crashHistory=await prisma.exceptionHistory.count();assert.equal(await prisma.orderSnapshot.count(),1);
 let producing=true;const runStarted=performance.now();
 const worker=(async()=>{while(producing||await prisma.orderJob.count({where:{status:{in:['pending','retry','processing']}}})){
   if(performance.now()-runStarted>180000)throw Error('DRAIN_DEADLINE');
   const result=await processOneOrderJob(load);
   if(result.processed){if(result.status!=='completed')workerErrors++;else{
     const row=await prisma.orderJob.findUniqueOrThrow({where:{id:result.jobId!}});
     const elapsed=Date.now()-row.receivedAt.getTime();
     if(row.id!==crashedJob.id){latencies.push(elapsed);perShop[shops.findIndex(s=>s.id===row.shopId)].push(elapsed);}
   }}else await delay(10);
 }} )();
 let monitoring=true;
 const monitor=(async()=>{while(monitoring){const pending=await prisma.orderJob.findMany({where:{status:{in:['pending','retry']},id:{not:crashedJob.id}},select:{receivedAt:true}});
  maxBacklog=Math.max(maxBacklog,pending.length);maxOldest=Math.max(maxOldest,...pending.map(j=>Date.now()-j.receivedAt.getTime()),0);maxRss=Math.max(maxRss,process.memoryUsage().rss);await delay(100);}})();
 let serial=810000;
 const expected=new Map<string,OrderSnapshot>();
 const publish=async(i:number,burst=false)=>{
  const index=burst?(i<96?0:i<108?1:2):(i%10<8?0:i%10===8?1:2);
  const value=snapshot(++serial);snapshots.set(value.id,value);expected.set(value.id,value);owners.set(value.id,shops[index]);
  const delivery=randomUUID();const calls=[send(index,value,delivery)];if(i%envelope.duplicateEvery===0)calls.push(send(index,value,delivery));
  for(const status of await Promise.all(calls))assert.equal(status,200);
 };
 for(let i=0;i<envelope.steadySeconds;i++){await delay(Math.max(0,runStarted+i*1000-performance.now()));await publish(i);}
 await delay(Math.max(0,runStarted+envelope.steadySeconds*1000-performance.now()));
 const burstStarted=performance.now();
 for(let i=0;i<envelope.burstOrders;i+=envelope.httpConcurrency)await Promise.all(Array.from({length:Math.min(envelope.httpConcurrency,envelope.burstOrders-i)},(_,n)=>publish(i+n,true)));
 producing=false;const lastReceiptAt=performance.now();await worker;const drainedAt=performance.now();monitoring=false;await monitor;
 const crashAfter=await prisma.orderJob.findUniqueOrThrow({where:{id:crashedJob.id}});
 assert.equal(crashAfter.status,'completed');assert.equal(crashAfter.attempts,2);
 const historyForCrash=await prisma.exceptionHistory.count({where:{exception:{orderId:crashed.id}}});assert.equal(historyForCrash,crashHistory);
 faults.processCrash={exit:crashExit,snapshotPersistedBeforeCrash:true,recoveredAttempts:2,duplicateHistory:false,configuredLeaseMs:60000};
 const rows=await prisma.orderSnapshot.findMany();assert.equal(rows.length,expected.size+1);
 const identity=(row:{shopId:string;generation:number;orderId:string})=>`${row.shopId}:${row.generation}:${row.orderId}`;
 const expectedIdentities=[...owners].map(([orderId,owner])=>`${owner.id}:${owner.generation}:${orderId}`).sort();
 assert.deepEqual(rows.map(identity).sort(),expectedIdentities);
 for(const row of rows)assert.deepEqual(JSON.parse(openOrder(row.encryptedSnapshot,identity(row))),snapshots.get(row.orderId));
 const evaluations=await prisma.ruleEvaluation.findMany();
 const expectedRules=expectedIdentities.flatMap(key=>['high_order_value','high_line_quantity'].map(rule=>`${key}:${rule}`)).sort();
 assert.deepEqual(evaluations.map(row=>`${identity(row)}:${row.ruleKey}`).sort(),expectedRules);
 const expectedExceptions:string[]=[];
 for(const row of evaluations){
  const key=`${identity(row)}:${row.ruleKey}`;
  const result=JSON.parse(openOrder(row.encryptedResult,`evaluation:${key}`));
  const matched=Number(row.orderId.split('/').at(-1))%3!==0;
  assert.equal(result.ruleKey,row.ruleKey);assert.equal(result.ruleVersion,'1.0.0');assert.ok(result.settingsVersion);
  assert.equal(result.outcome,matched?'matched':'not_matched');
  assert.equal(result.reasonCode,matched?'ABOVE_THRESHOLD':'AT_OR_BELOW_THRESHOLD');
  if(matched)expectedExceptions.push(key);
 }
 const exceptions=await prisma.exceptionRecord.findMany({include:{history:true}});
 assert.deepEqual(exceptions.map(row=>`${identity(row)}:${row.ruleKey}`).sort(),expectedExceptions.sort());
 for(const row of exceptions){assert.equal(row.state,'open');assert.equal(row.revision,1);assert.equal(row.history.length,1);assert.equal(row.history[0].kind,'observation');}
 assert.equal(await prisma.exceptionHistory.count(),expectedExceptions.length);
 const percentile=(values:number[],p:number)=>Math.round([...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*p)-1)]||0);
 const metrics={durationMs:Math.round(drainedAt-runStarted),steadyMs:60000,burstSubmissionMs:Math.round(lastReceiptAt-burstStarted),drainMs:Math.round(drainedAt-lastReceiptAt),
  receipts:received,uniqueProfileOrders:expected.size,duplicateReceipts:received-expected.size,receiptErrors,receiptErrorRate:receiptErrors/received,workerErrors,
  receiptP95Ms:percentile(receiptTimes,.95),receiptMaxMs:Math.round(Math.max(...receiptTimes)),processingP50Ms:percentile(latencies,.5),processingP95Ms:percentile(latencies,.95),processingMaxMs:Math.max(...latencies),
  oldestPendingMaxMs:maxOldest,maximumBacklog:maxBacklog,peakNodeRssMiB:Math.round(maxRss/1048576),apiCalls,
  shops:perShop.map((values,i)=>({label:`synthetic-${i+1}`,completed:values.length,p95Ms:percentile(values,.95),maxMs:Math.max(...values)}))};
 // Delayed jobs use the actual availableAt guard, with a deterministic test clock.
 const delayed=snapshot(820001);snapshots.set(delayed.id,delayed);const accepted=await acceptOrderJob(shops[1].domain,randomUUID(),delayed.id);
 const future=new Date(Date.now()+60000);await prisma.orderJob.update({where:{id:accepted.jobId},data:{availableAt:future}});
 assert.equal((await processOneOrderJob(load)).processed,false);assert.equal((await getOrderSyncStatus(shops[1].id)).backlog,1);
 assert.equal((await processOneOrderJob(load,{now:new Date(future.getTime()+1)})).status,'completed');faults.delayedJob='visible backlog; not claimed early; completed at eligible clock';
 // Missing event: two pages, interrupted second fetch, checkpoint retry and full field comparison.
 const missed=[snapshot(830001),snapshot(830002)];missed.forEach(v=>snapshots.set(v.id,v));
 const at=new Date();const page=(v:OrderSnapshot,cursor:string|null)=>({orders:[{id:v.id,createdAt:v.createdAt,updatedAt:v.updatedAt}],hasNextPage:cursor!==null,endCursor:cursor});
 await advanceOrderSync(shops[2].id,async()=>page(missed[0],'page-one'),at);
 assert.equal((await processOneOrderJob(load)).status,'completed');
 await advanceOrderSync(shops[2].id,async()=>{throw Error('SYNTHETIC_PAGE_INTERRUPTION');},new Date(at.getTime()+1000));
 const checkpoint=await prisma.orderSyncState.findUniqueOrThrow({where:{shopId:shops[2].id}});assert.equal(checkpoint.cursor,'page-one');assert.equal(checkpoint.phase,'retry');
 await advanceOrderSync(shops[2].id,async input=>{assert.equal(input.cursor,'page-one');return page(missed[1],null);},new Date(checkpoint.nextRunAt.getTime()+1));
 assert.equal((await processOneOrderJob(load,{now:new Date(checkpoint.nextRunAt.getTime()+1000)})).status,'completed');
 await advanceOrderSync(shops[2].id,async()=>{throw Error('UNEXPECTED_REFETCH');},new Date(checkpoint.nextRunAt.getTime()+2000));
 assert.equal((await getOrderSyncStatus(shops[2].id)).phase,'idle');
 for(const value of missed){const row=await prisma.orderSnapshot.findFirstOrThrow({where:{orderId:value.id}});assert.deepEqual(JSON.parse(openOrder(row.encryptedSnapshot,`${row.shopId}:${row.generation}:${row.orderId}`)),value);}
 faults.reconciliation={interruptedPage:'retry',cursorPreserved:true,missedOrdersRecovered:2,exactFields:true,completed:true};
 // Old delivery plus lower API state cannot replace the current authoritative snapshot.
 const newer={...missed[0],updatedAt:new Date(Date.now()).toISOString(),total:{available:true as const,value:{amount:'250.00',currencyCode:'CAD'}}};
 for(const value of [newer,missed[0]]){await acceptOrderJob(shops[2].domain,randomUUID(),value.id);assert.equal((await processOneOrderJob(async()=>value)).status,'completed');}
 const final=await prisma.orderSnapshot.findFirstOrThrow({where:{orderId:newer.id}});assert.deepEqual(JSON.parse(openOrder(final.encryptedSnapshot,`${final.shopId}:${final.generation}:${final.orderId}`)),newer);faults.outOfOrder='newer exact snapshot retained';
 // Safe transport errors exercise the real API wrapper; waits are recorded with a virtual clock.
 let now=0;const waits:number[]=[];let calls=0;
 const api=createOrderApi(async()=>{calls++;if(calls===1)throw new DOMException('synthetic timeout','TimeoutError');if(calls===2)return new Response('{}',{status:429,headers:{'Retry-After':'2'}});return Response.json({data:{ok:true}},{headers:{'X-Shopify-API-Version':'2026-07'}});},{now:()=>now,sleep:async ms=>{waits.push(ms);now+=ms;}});
 assert.deepEqual(await api.request('synthetic'),{ok:true});assert.deepEqual(waits,[1000,2000]);
 await assert.rejects(createOrderApi(async()=>Response.json({data:{order:{}},errors:[{extensions:{code:'ACCESS_DENIED'}}]},{headers:{'X-Shopify-API-Version':'2026-07'}})).request('synthetic'),/API_QUERY_FAILED/);
 faults.api={timeoutThenThrottleAttempts:calls,virtualBackoffMs:waits,http200Partial:'rejected'};
 // Actual five durable failed attempts; virtual future clock avoids minutes of idle time.
 const failing=snapshot(840001);const queued=await acceptOrderJob(shops[0].domain,randomUUID(),failing.id);
 for(let i=1;i<=5;i++){const job=await prisma.orderJob.findUniqueOrThrow({where:{id:queued.jobId}});const result=await processOneOrderJob(async()=>{throw new OrderApiError('API_UNAVAILABLE');},{now:new Date(Math.max(Date.now(),job.availableAt.getTime())+1)});assert.equal(result.status,i===5?'failed':'retry');}
 const failed=await prisma.orderJob.findUniqueOrThrow({where:{id:queued.jobId}});assert.equal(failed.attempts,5);assert.equal((await getOrderSyncStatus(shops[0].id)).failed,1);faults.boundedRetry={attempts:5,status:'failed',observable:true};
 const uninstalled=snapshot(850001);await acceptOrderJob(shops[1].domain,randomUUID(),uninstalled.id);await deactivateShop(shops[1].domain,randomUUID());
 let fetched=false;assert.equal((await processOneOrderJob(async()=>{fetched=true;return uninstalled;})).processed,false);assert.equal(fetched,false);await purgeExpiredOrders();
 assert.equal((await prisma.orderJob.findFirstOrThrow({where:{orderId:uninstalled.id}})).errorCode,'INACTIVE_INSTALLATION');faults.uninstall='queued work failed; zero upstream reads';
 const targets=envelope.targets;
 const checks={receiptErrors:metrics.receiptErrors===0,workerErrors:metrics.workerErrors===0,receiptP95:metrics.receiptP95Ms<=targets.receiptP95Ms,
 receiptMax:metrics.receiptMaxMs<=targets.receiptMaxMs,processingP95:metrics.processingP95Ms<=targets.processingP95Ms,oldestPending:metrics.oldestPendingMaxMs<=targets.oldestPendingMaxMs,
 drain:metrics.drainMs<=targets.drainMs,quietShops:metrics.shops.slice(1).every(s=>s.p95Ms<=targets.quietShopP95Ms),exactFields:true,exactTenantAndRuleIdentities:true,duplicateEffects:true};
 assert.deepEqual(fingerprint(),candidateSourceSha256,'Candidate source changed during load run');
 mkdirSync('docs/evidence/p10b',{recursive:true});writeFileSync('docs/evidence/p10b/load.json',JSON.stringify({format:1,version:JSON.parse(readFileSync('package.json','utf8')).version,
  candidateSourceSha256,sourceHashNormalization:'UTF-8, CRLF to LF, trim trailing file whitespace then one newline',
  startedAt,finishedAt:new Date().toISOString(),synthetic:true,envelope,metrics,faults,checks,pass:Object.values(checks).every(Boolean),
  limitations:['One local sample, not merchant capacity or real Shopify rate limits','Queue/normal snapshot transport measured; full CLI worker discovery scheduling not included in timed profile','Crash lease waited in real time; retry/delayed/sync backoff faults use explicit virtual clocks','Oldest pending sampling100ms; excludes deliberately crashed processing lease','No TLS/provider backup or real Shopify authentication/access validation']},null,2)+'\n');
 assert.ok(Object.values(checks).every(Boolean),'PROPOSED_ENVELOPE_FAILED');
}finally{globalThis.fetch=originalFetch;await new Promise<void>(yes=>server.close(()=>yes()));await Promise.all([prisma.$disconnect(),authLockDb.$disconnect()]);}
