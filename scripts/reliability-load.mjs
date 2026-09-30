// P10B isolated synthetic runner. Never reads .env.local or reuses an existing cluster.
import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:net";
const serial=Date.now();
const dir=resolve(`.local/p10b-load-${serial}`);
mkdirSync(resolve('.local'),{recursive:true});
mkdirSync(dir,{recursive:false});
const probe=createServer();
await new Promise((yes,no)=>{probe.once('error',no);probe.listen(55434,'127.0.0.1',yes);});
await new Promise(yes=>probe.close(yes));
const password=randomBytes(32).toString('hex');
const pg=new EmbeddedPostgres({databaseDir:resolve(dir,'postgres'),user:'synthetic',password,port:55434,
  authMethod:'scram-sha-256',persistent:true,createPostgresUser:false,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
const database=`rescue_reliability_${serial}`;
const journal=resolve(dir,'current-privacy.jsonl');
writeFileSync(journal,'',{flag:'wx'});
const env={...process.env,DATABASE_URL:`postgresql://synthetic:${password}@127.0.0.1:55434/${database}?schema=public&connection_limit=4&connect_timeout=1`,
  SESSION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),PRIVACY_LEDGER_KEY:randomBytes(32).toString('base64'),PRIVACY_JOURNAL_PATH:journal,
  P10B_LOAD_DIR:dir,P10B_LOAD_MODE:'1',ORDER_RESCUE_DISPOSABLE_TEST_DB:'1',RUN_MODE:'test',NODE_ENV:'test',ORDER_INGESTION_ENABLED:'1',
  SHOPIFY_API_KEY:'synthetic-reliability-key',SHOPIFY_API_SECRET:randomBytes(32).toString('hex'),SHOPIFY_APP_URL:'https://app.example.test'};
delete env.HOST;
const log=openSync(resolve(dir,'private-run.log'),'w');
const run=args=>new Promise((yes,no)=>{const child=spawn(process.execPath,args,{env,windowsHide:true,stdio:['ignore',log,log,'ipc']});
 child.on('message',async message=>{
  try { if(message==='outage-stop'){await pg.stop();child.send('outage-stopped');}
    if(message==='outage-start'){await pg.start();child.send('outage-started');} }
  catch { child.send('outage-control-failed'); }
 });
 child.once('error',no);child.once('exit',code=>code===0?yes():no(Error('P10B_CHILD_FAILED')));});
try {
 await pg.initialise();await pg.start();await pg.createDatabase(database);
 await run(['node_modules/prisma/build/index.js','migrate','deploy']);
 await run(['--import','tsx','scripts/reliability-load.ts']);
 console.log('P10B_LOAD_PASS: docs/evidence/p10b/load.json');
} catch { console.error('P10B_LOAD_FAILED: inspect private run log; no live database was used');process.exitCode=1; }
finally {await pg.stop();closeSync(log);}
