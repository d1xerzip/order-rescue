import { createHash, randomUUID } from "node:crypto";
import type { ExceptionRecord, OrderSnapshot, Prisma, RuleEvaluation, Shop } from "@prisma/client";
import prisma from "./db.server";
import { openOrder, sealOrder } from "./order-crypto.server";
import { validateHighOrderValueSettings } from "./rules/high-order-value";
import { validateHighLineQuantitySettings } from "./rules/high-line-quantity";
import { RuleConfigurationError, type HighLineQuantitySettings, type HighOrderValueSettings, type RuleKey, type RuleResult } from "./rules/contracts";

export type Principal = { shopId: string; generation: number; actor: string };
export class ExceptionError extends Error {
  constructor(public readonly status: number, public readonly code: string) { super(code); this.name = "ExceptionError"; }
}
type Settings = HighOrderValueSettings | HighLineQuantitySettings;
type Tx = Prisma.TransactionClient;
const keys: RuleKey[] = ["high_order_value", "high_line_quantity"];
const notFound = () => new ExceptionError(404, "NOT_FOUND");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function scope(row: {shopId: string; generation: number; orderId: string; ruleKey: string}) {
  return `${row.shopId}:${row.generation}:${row.orderId}:${row.ruleKey}`;
}
function settingsContext(shopId: string, generation: number, ruleKey: string) { return `rule-settings:${shopId}:${generation}:${ruleKey}`; }
function resultOf(row: RuleEvaluation): RuleResult { return JSON.parse(openOrder(row.encryptedResult, `evaluation:${scope(row)}`)); }
function checkRevision(revision: number) { if (!Number.isSafeInteger(revision) || revision < 0) throw new ExceptionError(400, "INVALID_REVISION"); }
async function withShop<T>(principal: Principal, fn: (tx: Tx, shop: Shop, now: Date) => Promise<T>) {
  if (!principal.shopId || !Number.isSafeInteger(principal.generation) || principal.generation < 1 || !principal.actor || principal.actor.length > 200) throw notFound();
  return prisma.$transaction(async tx => {
    const initial = await tx.shop.findUnique({where: {id: principal.shopId}});
    if (!initial) throw notFound();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${initial.domain}, 0))`;
    await tx.$queryRaw`SELECT "id" FROM "Shop" WHERE "id" = ${principal.shopId} FOR UPDATE`;
    const shop = await tx.shop.findUnique({where: {id: principal.shopId}});
    if (!shop?.active || shop.generation !== principal.generation) throw notFound();
    const blocked = await tx.privacyReceipt.findFirst({where:{shopDomain: shop.domain, status: "pending", topic:"shop/redact"},select:{id:true}});
    if (blocked) throw notFound();
    return fn(tx, shop, new Date());
  });
}
async function privacyBlocked(tx: Tx, shop: Shop, orderId: string) {
  return Boolean(await tx.privacyReceipt.findFirst({where:{shopDomain:shop.domain,status:"pending",OR:[{topic:"shop/redact"},{topic:"customers/redact",payload:{path:["orders_to_redact"],array_contains:[orderId.split("/").at(-1)!]}}]},select:{id:true}}));
}
export async function saveRuleSettings(principal: Principal, ruleKey: RuleKey, input: unknown, expectedRevision: number) {
  checkRevision(expectedRevision);
  if (!keys.includes(ruleKey) || !input || typeof input !== "object" || Array.isArray(input)) throw new ExceptionError(400,"INVALID_CONFIGURATION");
  const source = structuredClone(input) as Record<string,unknown>;
  const allowed = ruleKey === "high_order_value" ? ["enabled","threshold","currencyCode"] : ["enabled","threshold"];
  if (Object.keys(source).some(k => !allowed.includes(k))) throw new ExceptionError(400,"INVALID_CONFIGURATION");
  return withShop(principal, async (tx,shop,now) => {
    const key = {shopId:shop.id,generation:shop.generation,ruleKey};
    const previous = await tx.ruleSetting.findUnique({where:{shopId_generation_ruleKey:key}});
    if ((previous?.revision ?? 0) !== expectedRevision) throw new ExceptionError(409,"REVISION_CONFLICT");
    const settingsVersion = `settings:${randomUUID()}`;
    let settings: Settings;
    try {
      const candidate = {...source,shopId:shop.id,ruleKey,settingsVersion};
      settings = ruleKey === "high_order_value" ? validateHighOrderValueSettings(shop.id,candidate) : validateHighLineQuantitySettings(shop.id,candidate);
    } catch(error) {
      if (error instanceof RuleConfigurationError) throw new ExceptionError(400,"INVALID_CONFIGURATION");
      throw error;
    }
    const revision = expectedRevision + 1;
    const encryptedSettings = sealOrder(JSON.stringify({settings,actor:principal.actor,at:now.toISOString()}),settingsContext(shop.id,shop.generation,ruleKey));
    await tx.ruleSetting.upsert({where:{shopId_generation_ruleKey:key},create:{...key,revision,settingsVersion,encryptedSettings,updatedAt:now},update:{revision,settingsVersion,encryptedSettings,updatedAt:now}});
    return {revision,settings};
  });
}
export async function loadRuleSettings(tx: Tx, shop: Pick<Shop,"id"|"generation">): Promise<{valueSettings: HighOrderValueSettings|null;quantitySettings: HighLineQuantitySettings|null}> {
  const rows = await tx.ruleSetting.findMany({where:{shopId:shop.id,generation:shop.generation}});
  let valueSettings: HighOrderValueSettings|null = null;
  let quantitySettings: HighLineQuantitySettings|null = null;
  for (const row of rows) {
    const {settings} = JSON.parse(openOrder(row.encryptedSettings,settingsContext(shop.id,shop.generation,row.ruleKey)));
    if (settings.settingsVersion !== row.settingsVersion) throw new Error("INVALID_CONFIGURATION");
    if (row.ruleKey === "high_order_value") valueSettings = validateHighOrderValueSettings(shop.id,settings);
    else if (row.ruleKey === "high_line_quantity") quantitySettings = validateHighLineQuantitySettings(shop.id,settings);
    else throw new Error("INVALID_CONFIGURATION");
  }
  return {valueSettings,quantitySettings};
}
export async function listRuleSettings(principal: Principal) {
  return withShop(principal,async(tx,shop) => {
    const rows = await tx.ruleSetting.findMany({where:{shopId:shop.id,generation:shop.generation},orderBy:{ruleKey:"asc"}});
    return rows.map(row => ({revision:row.revision,settings:JSON.parse(openOrder(row.encryptedSettings,settingsContext(shop.id,shop.generation,row.ruleKey))).settings as Settings}));
  });
}
export async function persistRuleEvaluations(tx: Tx, shop: Shop, snapshot: OrderSnapshot, evaluations: Record<RuleKey,RuleResult>, now: Date) {
  if (!shop.active || !shop.jobsEnabled || snapshot.shopId !== shop.id || snapshot.generation !== shop.generation || snapshot.expiresAt <= now) throw notFound();
  for (const ruleKey of keys) {
    const result = evaluations[ruleKey];
    if (result.ruleKey !== ruleKey) throw new Error("INVALID_CONFIGURATION");
    const material = {...result, evaluatedAt: undefined};
    const fingerprint = createHash("sha256").update(canonical(material)).digest("hex");
    const key = {shopId:shop.id,generation:shop.generation,orderId:snapshot.orderId,ruleKey};
    const existing = await tx.ruleEvaluation.findUnique({where:{shopId_generation_orderId_ruleKey:key}});
    await tx.ruleEvaluation.upsert({where:{shopId_generation_orderId_ruleKey:key},create:{...key,fingerprint,encryptedResult:sealOrder(JSON.stringify(result),`evaluation:${scope(key)}`),checkedAt:now},update:{fingerprint,encryptedResult:sealOrder(JSON.stringify(result),`evaluation:${scope(key)}`),checkedAt:now}});
    if (existing?.fingerprint === fingerprint) continue;
    let exception = await tx.exceptionRecord.findUnique({where:{shopId_orderId_ruleKey:{shopId:shop.id,orderId:snapshot.orderId,ruleKey}}});
    if (exception && exception.generation !== shop.generation) throw new Error("INACTIVE_INSTALLATION");
    if (!exception && result.outcome !== "matched") continue;
    if (!exception) exception = await tx.exceptionRecord.create({data:{...key,state:"open",revision:1,createdAt:now,updatedAt:now}});
    else exception = await tx.exceptionRecord.update({where:{id:exception.id},data:{revision:{increment:1},updatedAt:now}});
    const id = randomUUID();
    await tx.exceptionHistory.create({data:{id,exceptionId:exception.id,revision:exception.revision,kind:"observation",at:now,encryptedDetail:sealOrder(JSON.stringify({result}),`history:${scope(exception)}:${exception.id}:${id}`)}});
  }
}
async function freshness(tx: Tx, shop: Shop, row: RuleEvaluation, now: Date) {
  const reasons: string[] = [];
  if (!shop.jobsEnabled) reasons.push("PROCESSING_DISABLED");
  const result = resultOf(row);
  const settings = await tx.ruleSetting.findUnique({where:{shopId_generation_ruleKey:{shopId:shop.id,generation:shop.generation,ruleKey:row.ruleKey}}});
  if ((settings?.settingsVersion ?? null) !== result.settingsVersion) reasons.push("SETTINGS_CHANGED");
  const jobs = await tx.orderJob.findMany({where:{shopId:shop.id,generation:shop.generation,orderId:row.orderId,expiresAt:{gt:now},status:{in:["pending","processing","retry","failed"]}},select:{status:true},distinct:["status"]});
  for (const status of ["pending","processing","retry","failed"]) if (jobs.some(j=>j.status===status)) reasons.push(status === "processing" ? "PROCESSING_IN_PROGRESS" : `PROCESSING_${status.toUpperCase()}`);
  const sync = await tx.orderSyncState.findUnique({where:{shopId:shop.id}});
  if (!sync || sync.generation !== shop.generation || !sync.lastSuccessAt || sync.lastError || sync.phase !== "idle" || sync.nextRunAt <= now) reasons.push("SYNCHRONIZATION_GAP");
  return reasons;
}
export type PageOptions = { limit?: number; cursor?: string | null };
export function pageOptions(request: Request, cursorName = "cursor"): PageOptions {
  const query = new URL(request.url).searchParams;
  const raw = query.get("limit");
  if (query.getAll("limit").length > 1 || query.getAll(cursorName).length > 1 || (raw !== null && !/^[1-9][0-9]*$/.test(raw)))
    throw new ExceptionError(400,"INVALID_PAGE");
  return {limit:raw === null ? undefined : Number(raw),cursor:query.get(cursorName)};
}
function pageBoundary(shop: Shop, route: string, options: PageOptions, numeric = false) {
  const limit = options.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new ExceptionError(400,"INVALID_PAGE");
  let after: string | number | undefined;
  if (options.cursor !== undefined && options.cursor !== null) {
    try {
      if (!/^[A-Za-z0-9_-]{1,1500}$/.test(options.cursor)) throw Error();
      const value = JSON.parse(Buffer.from(options.cursor,"base64url").toString("utf8"));
      if (!value || Object.keys(value).sort().join(",") !== "after,generation,route,shopId,v" || value.v !== 1 || value.shopId !== shop.id || value.generation !== shop.generation || value.route !== route) throw Error();
      if (numeric ? !Number.isSafeInteger(value.after) || value.after < 1 : typeof value.after !== "string" || !/^[0-9a-f-]{36}$/.test(value.after)) throw Error();
      after = value.after;
    } catch { throw new ExceptionError(400,"INVALID_CURSOR"); }
  }
  const next = (value: string | number) => Buffer.from(JSON.stringify({v:1,shopId:shop.id,generation:shop.generation,route,after:value})).toString("base64url");
  return {limit,after,next};
}
function orderUrl(shop: Shop, orderId: string) {
  const id = /^gid:\/\/shopify\/Order\/([1-9][0-9]*)$/.exec(orderId)?.[1];
  return id && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop.domain) ? `https://${shop.domain}/admin/orders/${id}` : null;
}
export async function listEvaluationsPage(principal: Principal, options: PageOptions = {}) {
  return withShop(principal,async(tx,shop,now) => {
    const page = pageBoundary(shop,"evaluations",options);
    const rows = await tx.ruleEvaluation.findMany({where:{shopId:shop.id,generation:shop.generation,snapshot:{expiresAt:{gt:now}},...(page.after ? {id:{gt:String(page.after)}} : {})},orderBy:{id:"asc"},take:page.limit+1});
    const scanned = rows.slice(0,page.limit);
    const items = [];
    for (const row of scanned) if (!await privacyBlocked(tx,shop,row.orderId)) items.push({id:row.id,orderId:row.orderId,orderUrl:orderUrl(shop,row.orderId),result:resultOf(row),freshness:await freshness(tx,shop,row,now)});
    return {items,nextCursor:rows.length > page.limit ? page.next(scanned.at(-1)!.id) : null};
  });
}
async function exceptionSummary(tx: Tx,shop: Shop,row: ExceptionRecord,now: Date) {
  const current = await tx.ruleEvaluation.findUnique({where:{shopId_generation_orderId_ruleKey:{shopId:shop.id,generation:shop.generation,orderId:row.orderId,ruleKey:row.ruleKey}}});
  if (!current) throw notFound();
  return {id:row.id,orderId:row.orderId,orderUrl:orderUrl(shop,row.orderId),ruleKey:row.ruleKey,state:row.state,revision:row.revision,priority:"review" as const,currentEvaluation:resultOf(current),freshness:await freshness(tx,shop,current,now)};
}
async function exceptionView(tx: Tx,shop: Shop,row: ExceptionRecord,now: Date,options: PageOptions = {}) {
  const page = pageBoundary(shop,`history:${row.id}`,options,true);
  const rows = await tx.exceptionHistory.findMany({where:{exceptionId:row.id,...(page.after ? {revision:{gt:Number(page.after)}} : {})},orderBy:{revision:"asc"},take:page.limit+1});
  const history = rows.slice(0,page.limit);
  const decision = await tx.exceptionHistory.findFirst({where:{exceptionId:row.id,kind:"decision"},orderBy:{revision:"desc"}});
  const latestDecision = decision ? {id:decision.id,revision:decision.revision,kind:decision.kind,at:decision.at,...JSON.parse(openOrder(decision.encryptedDetail,`history:${scope(row)}:${row.id}:${decision.id}`))} : null;
  return {latestDecision,...await exceptionSummary(tx,shop,row,now),history:history.map(h=>({id:h.id,revision:h.revision,kind:h.kind,at:h.at,...JSON.parse(openOrder(h.encryptedDetail,`history:${scope(row)}:${row.id}:${h.id}`))})),historyNextCursor:rows.length > page.limit ? page.next(history.at(-1)!.revision) : null};
}
async function visibleException(tx: Tx,shop: Shop,id: string,now: Date) {
  const row = await tx.exceptionRecord.findFirst({where:{id,shopId:shop.id,generation:shop.generation,snapshot:{expiresAt:{gt:now}}}});
  if (!row || await privacyBlocked(tx,shop,row.orderId)) throw notFound();
  return row;
}
export async function listExceptionsPage(principal: Principal, options: PageOptions = {}) {
  return withShop(principal,async(tx,shop,now) => {
    const page = pageBoundary(shop,"exceptions",options);
    const rows = await tx.exceptionRecord.findMany({where:{shopId:shop.id,generation:shop.generation,snapshot:{expiresAt:{gt:now}},...(page.after ? {id:{gt:String(page.after)}} : {})},orderBy:{id:"asc"},take:page.limit+1});
    const scanned = rows.slice(0,page.limit);
    const items = [];
    for(const row of scanned) if(!await privacyBlocked(tx,shop,row.orderId)) items.push(await exceptionSummary(tx,shop,row,now));
    return {items,nextCursor:rows.length > page.limit ? page.next(scanned.at(-1)!.id) : null};
  });
}
export async function getException(principal: Principal,id: string,options: PageOptions = {}) {
  return withShop(principal,async(tx,shop,now)=>exceptionView(tx,shop,await visibleException(tx,shop,id,now),now,options));
}
// Compatibility collectors for existing internal tests. HTTP and merchant loaders
// use page APIs; every database scan and history response is bounded.
export async function listEvaluations(principal: Principal) {
  const items: Awaited<ReturnType<typeof listEvaluationsPage>>["items"] = [];
  let cursor: string | null = null;
  do { const page = await listEvaluationsPage(principal,{cursor}); items.push(...page.items); cursor=page.nextCursor; } while(cursor);
  return items.sort((a,b)=>a.orderId.localeCompare(b.orderId) || a.result.ruleKey.localeCompare(b.result.ruleKey));
}
export async function listExceptions(principal: Principal) {
  const items: Awaited<ReturnType<typeof getException>>[] = [];
  let cursor: string | null = null;
  do {
    const page = await listExceptionsPage(principal,{cursor});
    for (const item of page.items) items.push(await getException(principal,item.id));
    cursor=page.nextCursor;
  } while(cursor);
  return items;
}
export type ExceptionAction = {action:"acknowledge"|"resolve"|"ignore";reason:"REVIEW_STARTED"|"REVIEW_COMPLETED"|"NOT_RELEVANT";expectedRevision:number};
export async function actOnException(principal: Principal,id: string,input: ExceptionAction) {
  checkRevision(input.expectedRevision);
  const mapping = {acknowledge:{state:"acknowledged",reason:"REVIEW_STARTED"},resolve:{state:"resolved",reason:"REVIEW_COMPLETED"},ignore:{state:"ignored",reason:"NOT_RELEVANT"}} as const;
  if (!Object.hasOwn(mapping, input.action)) throw new ExceptionError(400,"INVALID_ACTION");
  const choice = mapping[input.action];
  if (!choice || input.reason !== choice.reason) throw new ExceptionError(400,"INVALID_ACTION");
  return withShop(principal,async(tx,shop,now) => {
    const row = await visibleException(tx,shop,id,now);
    if (row.revision !== input.expectedRevision) throw new ExceptionError(409,"REVISION_CONFLICT");
    if (row.state === "resolved" || row.state === "ignored" || (input.action === "acknowledge" && row.state !== "open")) throw new ExceptionError(409,"INVALID_TRANSITION");
    const before = await exceptionSummary(tx,shop,row,now);
    const updated = await tx.exceptionRecord.update({where:{id:row.id},data:{state:choice.state,revision:{increment:1},updatedAt:now}});
    const historyId = randomUUID();
    const detail = {actor:principal.actor,action:input.action,reason:input.reason,fromState:row.state,toState:choice.state,result:before.currentEvaluation,freshness:before.freshness};
    await tx.exceptionHistory.create({data:{id:historyId,exceptionId:row.id,revision:updated.revision,kind:"decision",at:now,encryptedDetail:sealOrder(JSON.stringify(detail),`history:${scope(row)}:${row.id}:${historyId}`)}});
    return exceptionView(tx,shop,updated,now);
  });
}
