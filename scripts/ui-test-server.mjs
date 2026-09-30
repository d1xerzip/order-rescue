// Disposable browser QA only. No real .env is loaded and no Shopify account is contacted.
import { spawn } from "node:child_process";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { localPostgres } from "./postgres.mjs";

const port = 3108;
const origin = `http://127.0.0.1:${port}`;
const run = (args, env) => new Promise((yes, no) => {
  const child = spawn(process.execPath, args, { env, stdio: "inherit", windowsHide: true });
  child.once("error", no);
  child.once("exit", code => code === 0 ? yes() : no(new Error(`UI_TEST_EXIT_${code}`)));
});

if (!process.argv.includes("--child")) {
  const { pg, url } = await localPostgres({ testing: true });
  const name = `rescue_ui_test_${Date.now()}`;
  try {
    await pg.createDatabase(name);
    const journal = resolve(`.local/test/${name}.privacy.jsonl`);
    await writeFile(journal, "", { flag: "wx" });
    const env = { ...process.env, DATABASE_URL: `${url(name)}&connection_limit=2`,
      SESSION_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      PRIVACY_LEDGER_KEY: randomBytes(32).toString("base64"), PRIVACY_JOURNAL_PATH: journal,
      ORDER_RESCUE_DISPOSABLE_TEST_DB: "1", UI_TEST_MODE: "1", RUN_MODE: "test", NODE_ENV: "production",
      SHOPIFY_API_KEY: "synthetic-ui-api-key", SHOPIFY_API_SECRET: randomBytes(32).toString("hex"),
      SHOPIFY_APP_URL: "https://app.example.test" };
    delete env.HOST;
    await run(["node_modules/prisma/build/index.js", "migrate", "deploy"], env);
    await run(["--import", "tsx", "scripts/ui-test-server.mjs", "--child"], env);
  } finally { await pg.stop(); }
} else {
  if (process.env.UI_TEST_MODE !== "1" || process.env.RUN_MODE !== "test" || process.env.ORDER_RESCUE_DISPOSABLE_TEST_DB !== "1") throw new Error("UI_TEST_GUARD");
  const dbUrl = new URL(process.env.DATABASE_URL);
  if (dbUrl.hostname !== "127.0.0.1" || dbUrl.port !== "55433" || !/^\/rescue_ui_test_\d+$/.test(dbUrl.pathname)) throw new Error("UI_TEST_DATABASE_GUARD");
  const domains = ["merchant-a.myshopify.com", "merchant-b.myshopify.com", "merchant-onboarding.myshopify.com"];
  const { setAbstractFetchFunc } = await import("@shopify/shopify-api/runtime");
  const { Session } = await import("@shopify/shopify-api");
  const fakeFetch = async input => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const index = domains.indexOf(url.hostname);
    if (url.protocol !== "https:" || index < 0) throw new Error("UI_TEST_NETWORK_BLOCKED");
    if (url.pathname.endsWith("/graphql.json")) return Response.json({ data: { shop: { id: `gid://shopify/Shop/${8001 + index}`, myshopifyDomain: domains[index] } } });
    if (url.pathname === "/admin/oauth/access_token") return Response.json({ access_token: "synthetic-ui-access", scope: "read_orders", expires_in: 3600, refresh_token: "synthetic-ui-refresh", refresh_token_expires_in: 86400 });
    throw new Error("UI_TEST_NETWORK_BLOCKED");
  };
  global.fetch = fakeFetch;
  setAbstractFetchFunc(fakeFetch);
  const { default: prisma, authLockDb } = await import("../app/db.server.ts");
  const { activateShop } = await import("../app/storage.server.ts");
  const { sessionStorage } = await import("../app/shopify.server.ts");
  const { saveRuleSettings } = await import("../app/exceptions.server.ts");
  const { acceptOrderJob, processOneOrderJob } = await import("../app/order-jobs.server.ts");
  const shops = [];
  const snapshots = new Map();
  let serial = 9100;
  const createOrder = async (index, { amount = "150.00", quantity = 6, unavailable = false } = {}) => {
    const id = `gid://shopify/Order/${++serial}`;
    const stamp = new Date().toISOString();
    const snapshot = { id, createdAt: stamp, updatedAt: stamp, cancelledAt: { available: true, value: null },
      total: unavailable ? { available: false, reason: "TOTAL_UNAVAILABLE" } : { available: true, value: { amount, currencyCode: "CAD" } },
      lines: unavailable ? { available: false, reason: "LINES_UNAVAILABLE" } : { available: true, value: [{ id: `gid://shopify/LineItem/${serial}`, currentQuantity: quantity }] } };
    snapshots.set(id, snapshot);
    await acceptOrderJob(domains[index], randomUUID(), id);
    const processed = await processOneOrderJob(async () => snapshot);
    if (processed.status !== "completed") throw new Error("UI_TEST_SEED_FAILED");
    return id;
  };
  for (const [index, domain] of domains.entries()) {
    const shop = await activateShop(domain, `gid://shopify/Shop/${8001 + index}`);
    await prisma.shop.update({ where: { id: shop.id }, data: { installedAt: new Date(Date.now() - 60_000) } });
    shops.push(shop);
    await sessionStorage.storeSession(new Session({ id: `offline_${domain}`, shop: domain, state: "", isOnline: false,
      scope: "read_orders", accessToken: "synthetic-ui-access", expires: new Date(Date.now() + 3600000),
      refreshToken: "synthetic-ui-refresh", refreshTokenExpires: new Date(Date.now() + 86400000) }));
    if (index === 2) continue;
    const principal = { shopId: shop.id, generation: shop.generation, actor: "123" };
    await saveRuleSettings(principal, "high_order_value", { enabled: true, threshold: "100.00", currencyCode: "CAD" }, 0);
    await saveRuleSettings(principal, "high_line_quantity", { enabled: true, threshold: 5 }, 0);
    await createOrder(index);
    await prisma.orderSyncState.create({ data: { shopId: shop.id, generation: shop.generation, phase: "idle", nextRunAt: new Date(Date.now() + 3600000), lastSuccessAt: new Date() } });
  }
  const { createRequestHandler } = await import("react-router");
  const build = await import("../build/server/index.js");
  const handle = createRequestHandler(build, "production");
  let failNext = false;
  let dropNext = false;
  // One human QA session; selection is deliberately shared by its two test tabs.
  // Keep this entirely in the disposable adapter, independent of browser cookies.
  let selectedIndex = 0;
  const report = { qaActions: 0, actionErrors: 0, foreignReadStatus: null, foreignWriteStatus: null, foreignUnchanged: null, failedActions: 0, droppedActions: 0 };
  const token = index => {
    const now = Math.floor(Date.now() / 1000);
    const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const body = Buffer.from(JSON.stringify({ iss: `https://${domains[index]}/admin`, dest: `https://${domains[index]}`, aud: process.env.SHOPIFY_API_KEY, sub: "123", iat: now, nbf: now - 1, exp: now + 60, sid: randomUUID(), jti: randomUUID() })).toString("base64url");
    return `${head}.${body}.${createHmac("sha256", process.env.SHOPIFY_API_SECRET).update(`${head}.${body}`).digest("base64url")}`;
  };
  const escape = text => String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  // Script belongs to the standalone QA shell, never the React application HTML.
  const controls = `<script>document.addEventListener('click',async event=>{const button=event.target.closest('button[name="action"]');const link=event.target.closest('a');if(button){event.preventDefault();button.disabled=true;try{const response=await fetch('/__test/action',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({action:button.value})});if(!response.ok)throw new Error('QA action failed');location.reload()}catch{document.getElementById('qa-status').textContent='QA action failed; inspect safe report.';button.disabled=false}}else if(link&&link.getAttribute('href').startsWith('/__test/select?')){event.preventDefault();await fetch(link.getAttribute('href'));location.reload()}else if(link&&!link.target){event.preventDefault();location.assign(link.getAttribute('href'))}})</script>`;
  const shell = (index, narrow) => {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order Rescue synthetic QA</title><style>body{font:15px system-ui;margin:20px;background:#f5f7f9;color:#14232b}nav{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}a,button{padding:9px;border:1px solid #8999a5;border-radius:5px;background:white;color:#14232b}iframe{width:${narrow ? "390px" : "100%"};max-width:100%;height:1000px;border:1px solid #8798a5;background:white}pre{white-space:pre-wrap}</style></head><body><h1>Order Rescue · synthetic browser QA</h1><p>Disposable local database. Mock Shopify transport + real SDK server authentication. No live Shopify orders.</p><nav><a href="/__test/select?shop=0">Shop A</a><a href="/__test/select?shop=1">Shop B</a><a href="/__test/select?shop=2">Onboarding store</a><a href="/__test?narrow=1">Narrow viewport (390px)</a><a href="/__test">Wide viewport</a><a href="/preview" target="_blank">Open second app tab</a><a href="/__test/report">Browser report</a></nav><form method="post" action="/__test/action"><nav>${["create-order","create-many","unavailable","partial-sync","fail-next-action","drop-next-action","foreign-probe","reevaluate","history-many"].map(action => `<button name="action" value="${action}">${action}</button><a href="/__test/action?action=${action}">Run ${action}</a>`).join("")}</nav></form><p id="qa-status" role="status">Selected: ${escape(domains[index])}</p><iframe title="Order Rescue merchant workflow" src="/preview"></iframe><details><summary>Safe QA report</summary><pre>${escape(JSON.stringify(report, null, 2))}</pre></details>${controls}</body></html>`;
  };
  const server = createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, origin);
    if (incoming.headers.host !== `127.0.0.1:${port}` || (incoming.headers.origin && incoming.headers.origin !== origin)) { outgoing.writeHead(403); outgoing.end(); return; }
    const index = selectedIndex;
    try {
      if (url.pathname === "/favicon.ico") { outgoing.writeHead(204); outgoing.end(); return; }
      if (url.pathname === "/__test/select") {
        const selected = Number(url.searchParams.get("shop"));
        if (![0, 1, 2].includes(selected)) throw new Error("UI_TEST_UNKNOWN_SHOP");
        selectedIndex = selected;
        outgoing.writeHead(303, { Location: "/__test" }); outgoing.end(); return;
      }
      if (url.pathname === "/__test" || url.pathname === "/") { outgoing.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); outgoing.end(shell(index, url.searchParams.has("narrow"))); return; }
      const chunks = [];
      for await (const chunk of incoming) { chunks.push(chunk); if (chunks.reduce((n, c) => n + c.length, 0) > 16384) throw new Error("UI_TEST_BODY_LIMIT"); }
      const body = Buffer.concat(chunks);
      if (url.pathname === "/__test/report") {
        outgoing.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" }); outgoing.end(JSON.stringify({ ...report, createdOrders: snapshots.size })); return;
      }
      if (url.pathname === "/__test/action" && ["GET", "POST"].includes(incoming.method)) {
        // GET links are deliberate controls of this disposable QA adapter only.
        const action = incoming.method === "GET" ? url.searchParams.get("action") : new URLSearchParams(body.toString()).get("action");
        report.qaActions++;
        if (action === "fail-next-action") failNext = true;
        else if (action === "drop-next-action") dropNext = true;
        else if (action === "create-order") await createOrder(index);
        else if (action === "create-many") for (let n = 0; n < 27; n++) await createOrder(index, { quantity: 3 });
        else if (action === "unavailable") await createOrder(index, { unavailable: true });
        else if (action === "partial-sync") await prisma.orderSyncState.upsert({ where: { shopId: shops[index].id }, create: { shopId: shops[index].id, generation: 1, phase: "retry", nextRunAt: new Date(), lastError: "SYNC_PAGE_UNAVAILABLE" }, update: { phase: "retry", lastError: "SYNC_PAGE_UNAVAILABLE", lastSuccessAt: null } });
        else if (action === "history-many") {
          const row = await prisma.orderSnapshot.findFirstOrThrow({ where: { shopId: shops[index].id } });
          const snapshot = snapshots.get(row.orderId);
          for (let n = 0; n < 25; n++) {
            snapshot.updatedAt = new Date().toISOString();
            snapshot.total = { available: true, value: { amount: `${200 + n}.00`, currencyCode: "CAD" } };
            await acceptOrderJob(domains[index], randomUUID(), row.orderId);
            await processOneOrderJob(async () => global.structuredClone(snapshot));
          }
        } else if (action === "reevaluate") {
          for (const row of await prisma.orderSnapshot.findMany({ where: { shopId: shops[index].id } })) {
            const snapshot = snapshots.get(row.orderId);
            if (!snapshot) continue;
            await acceptOrderJob(domains[index], randomUUID(), row.orderId);
            await processOneOrderJob(async () => snapshot);
          }
        } else if (action === "foreign-probe") {
          const foreign = await prisma.exceptionRecord.findFirstOrThrow({ where: { shopId: shops[index === 1 ? 0 : 1].id } });
          const before = JSON.stringify(foreign);
          const request = method => new Request(`https://app.example.test/api/exceptions/${foreign.id}`, { method,
            headers: { authorization: `Bearer ${token(index)}`, "content-type": "application/json" },
            ...(method === "POST" ? { body: JSON.stringify({ action: "resolve", reason: "REVIEW_COMPLETED", expectedRevision: foreign.revision }) } : {}) });
          report.foreignReadStatus = (await handle(request("GET"))).status;
          report.foreignWriteStatus = (await handle(request("POST"))).status;
          report.foreignUnchanged = before === JSON.stringify(await prisma.exceptionRecord.findUnique({ where: { id: foreign.id } }));
        }
        outgoing.writeHead(303, { Location: "/__test" }); outgoing.end(); return;
      }
      if (url.pathname.startsWith("/assets/") || url.pathname === "/favicon.svg") {
        const base = resolve("build/client");
        const path = resolve(base, `.${decodeURIComponent(url.pathname)}`);
        if (!path.startsWith(base + sep) || !(await stat(path)).isFile()) throw new Error("UI_TEST_ASSET_NOT_FOUND");
        const types = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
        outgoing.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream" }); outgoing.end(await readFile(path)); return;
      }
      if (url.pathname.startsWith("/api/") && !["GET", "HEAD"].includes(incoming.method)) {
        if (dropNext) { dropNext = false; report.droppedActions++; incoming.socket.destroy(); return; }
        if (failNext) { failNext = false; report.failedActions++; outgoing.writeHead(503, { "Content-Type": "application/json" }); outgoing.end('{"error":"SERVICE_UNAVAILABLE"}'); return; }
      }
      // Auth is injected by this loopback-only adapter, never by application code.
      const headers = new Headers(incoming.headers);
      headers.set("authorization", `Bearer ${token(index)}`);
      headers.set("host", "app.example.test");
      const request = new Request(`https://app.example.test${incoming.url}`, { method: incoming.method, headers,
        ...(["GET", "HEAD"].includes(incoming.method) ? {} : { body }) });
      const response = await handle(request);
      const responseHeaders = Object.fromEntries(response.headers);
      delete responseHeaders["content-security-policy"];
      const responseBody = Buffer.from(await response.arrayBuffer());
      delete responseHeaders["content-length"];
      outgoing.writeHead(response.status, responseHeaders); outgoing.end(responseBody);
    } catch { if (url.pathname === "/__test/action") report.actionErrors++; outgoing.writeHead(500, { "Content-Type": "text/plain" }); outgoing.end("UI_TEST_REQUEST_FAILED"); }
  });
  server.listen(port, "127.0.0.1", () => console.log(`Synthetic browser QA ready: ${origin}/__test`));
  const stop = async () => { server.close(); await Promise.all([prisma.$disconnect(), authLockDb.$disconnect()]); process.exit(0); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
}
