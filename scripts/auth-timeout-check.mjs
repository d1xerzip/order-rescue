import EmbeddedPostgres from 'embedded-postgres';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdirSync,writeFileSync,openSync,closeSync} from 'node:fs';
import {resolve} from 'node:path';

// Own new loopback cluster only; never import .env.local or accept an external URL.
if(process.argv.length!==2)throw Error('NO_ARGUMENTS_ALLOWED');
const stamp=Date.now(),port=55436,dir=resolve(`.local/auth-timeout-${stamp}`);
mkdirSync(resolve('.local'),{recursive:true});mkdirSync(dir);
const probe=createServer();await new Promise((yes,no)=>{probe.once('error',no);probe.listen(port,'127.0.0.1',yes);});await new Promise(yes=>probe.close(yes));
const password=randomBytes(32).toString('hex'),name=`rescue_auth_timeout_${stamp}`;
const pg=new EmbeddedPostgres({databaseDir:resolve(dir,'postgres'),user:'synthetic',password,port,authMethod:'scram-sha-256',persistent:true,createPostgresUser:false,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
const journal=resolve(dir,'independent-privacy.jsonl');writeFileSync(journal,'',{flag:'wx'});
const env={...process.env,DATABASE_URL:`postgresql://synthetic:${password}@127.0.0.1:${port}/${name}?schema=public&connection_limit=1&connect_timeout=2`,
 SESSION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),PRIVACY_LEDGER_KEY:randomBytes(32).toString('base64'),PRIVACY_JOURNAL_PATH:journal,
 AUTH_TIMEOUT_DIAGNOSTIC:'1',ORDER_RESCUE_DISPOSABLE_TEST_DB:'1',RUN_MODE:'test',NODE_ENV:'test',
 SHOPIFY_API_KEY:'synthetic-api-key',SHOPIFY_API_SECRET:'synthetic-test-secret-not-real',SHOPIFY_APP_URL:'https://app.example.test'};
const log=openSync(resolve(dir,'private-run.log'),'w');
const run=args=>new Promise((yes,no)=>{const p=spawn(process.execPath,args,{env,windowsHide:true,stdio:['ignore',log,log],timeout:110000});p.once('error',no);p.once('exit',code=>code===0?yes():no(Error('DIAGNOSTIC_CHILD_FAILED')));});
let running=false;
try{await pg.initialise();await pg.start();running=true;await pg.createDatabase(name);
 await run(['node_modules/prisma/build/index.js','migrate','deploy']);
 await run(['--import','tsx','scripts/auth-timeout-fixture.ts']);
 console.log('AUTH_TIMEOUT_DIAGNOSTIC_RECORDED: docs/evidence/auth-timeout/result.json (read acceptance status; diagnostic completion is not a fix)');
}catch{process.exitCode=1;console.error('AUTH_TIMEOUT_DIAGNOSTIC_FAILED: inspect private log');}
finally{if(running)await pg.stop();closeSync(log);}
