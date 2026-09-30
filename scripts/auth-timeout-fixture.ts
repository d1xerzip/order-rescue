import assert from 'node:assert/strict';
import {createServer,type ServerResponse} from 'node:http';
import {createHash,createHmac,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {Session} from '@shopify/shopify-api';
import {setAbstractFetchFunc} from '@shopify/shopify-api/runtime';
import prisma,{authLockDb} from '../app/db.server';
import {sessionStorage} from '../app/shopify.server';
import {authenticatedBackground} from '../app/auth.server';
import {activateShop,canRunOrdinaryJob} from '../app/storage.server';
import {lifecycleWebhook} from '../app/webhooks.server';

const db=new URL(process.env.DATABASE_URL!);
assert.equal(process.env.AUTH_TIMEOUT_DIAGNOSTIC,'1');assert.equal(process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB,'1');
assert.equal(db.hostname,'127.0.0.1');assert.equal(db.port,'55436');assert.match(db.pathname,/^\/rescue_auth_timeout_\d+$/);
// Proposed acceptance fixed before observation; this diagnostic does not alter app timeouts.
const targets={refreshSettlesWithinMs:15000,lateCredentialWriteAfterUninstall:false,ordinaryAccessAfterUninstall:false};
const sourceFiles=['app/auth.server.ts','app/auth-lock.server.ts','app/order-runtime.server.ts','app/session-storage.server.ts','app/shopify.server.ts','package-lock.json','scripts/auth-timeout-check.mjs','scripts/auth-timeout-fixture.ts'];
const fingerprint=()=>Object.fromEntries(sourceFiles.map(f=>[f,createHash('sha256').update(readFileSync(f,'utf8').replaceAll('\r\n','\n').trimEnd()+'\n').digest('hex')]));
const sourceSha256=fingerprint();
const a='timeout-a.myshopify.com',b='timeout-b.myshopify.com';
const originalFetch=globalThis.fetch;
let held:ServerResponse|undefined,requests=0,suppliedSignals=0,abortedSockets=0;
let seenResolve:()=>void=()=>{};const seen=new Promise<void>(yes=>{seenResolve=yes;});
const abortCleanup=new AbortController();
const startedAt=new Date().toISOString();
function reply(res:ServerResponse,label:string){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({access_token:`synthetic-${label}`,scope:'read_orders',expires_in:3600,refresh_token:`synthetic-refresh-${label}`,refresh_token_expires_in:86400}));}
const server=createServer(async(req,res)=>{
 for await(const chunk of req){void chunk; /* consume only, never log or persist request tokens */}
 requests++;res.on('close',()=>{if(!res.writableEnded)abortedSockets++;});
 if(req.url==='/stall'){held=res;seenResolve();return;}
 if(req.url==='/delayed'){await delay(200);reply(res,'delayed');return;}
 res.writeHead(404);res.end();
});
await new Promise<void>((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',()=>yes());});
const address=server.address();assert.ok(address&&typeof address!=='string');
// The official SDK still constructs/executes refresh requests. Only the test transport
// redirects two known fictional domains to this owned HTTP server; no DNS/TLS to Shopify.
globalThis.fetch=async(input,init)=>{
 const target=new URL(input instanceof Request?input.url:String(input));
 assert.ok([a,b].includes(target.hostname));assert.equal(target.protocol,'https:');assert.equal(target.pathname,'/admin/oauth/access_token');
 const existing=init?.signal??(input instanceof Request?input.signal:undefined);if(existing)suppliedSignals++;
 const signal=existing?AbortSignal.any([existing,abortCleanup.signal]):abortCleanup.signal;
 return originalFetch(`http://127.0.0.1:${address.port}/${target.hostname===a?'stall':'delayed'}`,{...init,signal});
};
setAbstractFetchFunc(globalThis.fetch);
const watchdog=setTimeout(()=>abortCleanup.abort(),95000);
function observe<T>(operation:Promise<T>){let settled=false;const promise=operation.then(value=>{settled=true;return {ok:true as const,value};},error=>{settled=true;return {ok:false as const,errorName:error?.name??'Error',errorCode:error?.code??null};});return {get settled(){return settled;},promise};}
function signed(topic:string,domain:string,payload:unknown){const body=JSON.stringify(payload);return new Request('https://app.example.test/webhooks/test',{method:'POST',body,headers:{'x-shopify-topic':topic,'x-shopify-shop-domain':domain,'x-shopify-api-version':'2026-07','x-shopify-webhook-id':randomUUID(),'x-shopify-hmac-sha256':createHmac('sha256',process.env.SHOPIFY_API_SECRET!).update(body).digest('base64')}});}
try{
 const shops=[];for(const domain of [a,b]){shops.push(await activateShop(domain));await sessionStorage.storeSession(new Session({id:`offline_${domain}`,shop:domain,state:'',isOnline:false,scope:'read_orders',accessToken:'synthetic-expired',expires:new Date(Date.now()-60000),refreshToken:'synthetic-refresh',refreshTokenExpires:new Date(Date.now()+86400000)}));}
 const delayedStart=performance.now();await authenticatedBackground(b,shops[1].generation);const delayedMs=Math.round(performance.now()-delayedStart);
 const rotated=await sessionStorage.loadSession(`offline_${b}`);assert.equal(rotated?.accessToken,'synthetic-delayed');
 const row=await prisma.session.findUniqueOrThrow({where:{id:`offline_${b}`}});assert.notEqual(row.accessToken,'synthetic-delayed');assert.match(row.accessToken,/^v1:/);
 const start=performance.now();const stalled=observe(authenticatedBackground(a,shops[0].generation));
 await Promise.race([seen,delay(5000).then(()=>{throw Error('LOCAL_REQUEST_NOT_RECEIVED');})]);
 await delay(Math.max(0,targets.refreshSettlesWithinMs+1000-(performance.now()-start)));
 const settledAt16s=stalled.settled;
 const socketOpenAt16s=Boolean(held&&!held.destroyed&&!held.writableEnded);
 // Observe actual production60s transaction expiry; no accelerated clock or injected timeout.
 await delay(Math.max(0,65000-(performance.now()-start)));
 const settledAt65s=stalled.settled, socketOpenAt65s=Boolean(held&&!held.destroyed&&!held.writableEnded);
 const uninstallStart=performance.now();const uninstall=await lifecycleWebhook(signed('app/uninstalled',a,{myshopify_domain:a}),'app/uninstalled');
 assert.equal(uninstall.status,200);const uninstallMs=Math.round(performance.now()-uninstallStart);
 const sessionsBeforeLateReply=await prisma.session.count({where:{shop:a}});assert.equal(sessionsBeforeLateReply,0);
 const ordinaryBefore=await canRunOrdinaryJob(a,shops[0].generation);assert.equal(ordinaryBefore,false);
 const privacy=await lifecycleWebhook(signed('customers/data_request',a,{shop_domain:a,shop_id:91001,orders_requested:[],customer:{id:92001}}),'customers/data_request');assert.equal(privacy.status,200);
 assert.ok(held);if(!held.destroyed)reply(held,'late');
 const result=await stalled.promise;const elapsedMs=Math.round(performance.now()-start);
 const late=await prisma.session.findUnique({where:{id:`offline_${a}`}});
 const lateWrite=Boolean(late);if(late){assert.match(late.accessToken,/^v1:/);assert.notEqual(late.accessToken,'synthetic-late');}
 let denied=false;try{await authenticatedBackground(a,shops[0].generation);}catch{denied=true;}assert.equal(denied,true);
 const recoveryStart=performance.now();await authenticatedBackground(b,shops[1].generation);const recoveryMs=Math.round(performance.now()-recoveryStart);
 const checks={refreshBound:settledAt16s&&!socketOpenAt16s,noLateWrite:!lateWrite,ordinaryAccessBlocked:denied,privacyIntakeAvailable:privacy.status===200,otherShopRecovery:true};
 assert.deepEqual(fingerprint(),sourceSha256,'Source changed during diagnostic');
 const evidence={format:1,recordedAt:new Date().toISOString(),startedAt,version:JSON.parse(readFileSync('package.json','utf8')).version,synthetic:true,
  transport:'real loopback HTTP sockets; official SDK refresh; local destination forwarding only',database:'new isolated PostgreSQL cluster55436',targets,sourceSha256,
  observations:{delayedRefreshMs:delayedMs,delayedCredentialEncrypted:true,settledAt16s,socketOpenAt16s,settledAt65s,socketOpenAt65s,elapsedUntilManualLateReplyMs:elapsedMs,
   suppliedSignals,abortedSockets,requests,uninstallMs,sessionsBeforeLateReply,lateCredentialWriteAfterUninstall:lateWrite,lateCredentialEncrypted:late?true:null,
   finalAuthPromise:result.ok?'resolved':{errorName:result.errorName,errorCode:result.errorCode},ordinaryAccessDeniedAfterUninstall:denied,privacyReceiptStatus:privacy.status,otherShopRecoveryMs:recoveryMs},
  checks,acceptance:Object.values(checks).every(Boolean)?'PASS':'FAIL',diagnosticCompleted:true,advisoryRemediated:false,
  limitations:['No real Shopify, TLS, DNS, production proxy or customer data','Manual late server reply ends the stalled request; no proof of autonomous eventual cancellation','Current advisory unaffected; no runtime fix applied','Privacy intake accepted; export/deletion processing not claimed']};
 mkdirSync('docs/evidence/auth-timeout',{recursive:true});writeFileSync('docs/evidence/auth-timeout/result.json',JSON.stringify(evidence,null,2)+'\n');
}finally{clearTimeout(watchdog);abortCleanup.abort();globalThis.fetch=originalFetch;setAbstractFetchFunc(originalFetch);server.closeAllConnections();await new Promise<void>(yes=>server.close(()=>yes()));await Promise.all([prisma.$disconnect(),authLockDb.$disconnect()]);}
