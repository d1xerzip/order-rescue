# Local setup

Use a Node release satisfying package.json engines and npm. PostgreSQL is required. The optional local runner uses loopback port 55432; tests use 55433. Ensure those ports are free. The lockfile pins dependencies; do not upgrade it merely to start this edition.

```powershell
npm ci
npm run db:generate
npm run db:local
```

Keep the database terminal open. The runner creates a local database plus random credentials/key in ignored .local and .env.local. It does not overwrite an existing environment file. Use a new disposable checkout for this source edition; never copy a real environment/database into it.

In another terminal, from the same directory:

```powershell
node --env-file=.env.local node_modules/prisma/build/index.js migrate deploy
npm run preview:local
```

Open http://127.0.0.1:3000/preview. The preview uses synthetic display data; it is not a Shopify session or a bypass for tenant APIs. Do not run migrations against production. Keep the encryption key stable for persisted sessions.

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

Tests use a unique disposable PostgreSQL database with mocked Shopify transport; they do not validate a live installation. Stop the preview/database with Ctrl+C when finished. Local fixtures persist under ignored .local.

GET /healthz checks the process. GET /readyz checks configuration/database and can return 503 without Shopify configuration. A 200 readiness result does not establish live API access. Production preview is disabled.

For real development installation, use an independently configured registration and the official Shopify CLI authentication flow under the account owner's access. shopify.app.toml is an unlinked template. Keep credentials in ignored environment files or a secret manager. See [access preparation](P03-ACCESS-PLAN.md); no order access is assumed.

## P03 worker
See [P03-INGESTION.md](P03-INGESTION.md) for gated subscription/worker setup and targeted tests. Use migration 0002_order_ingestion after 0001_foundation. Never apply this edition migration history to a private deployment with differently named migrations.

## P07 schema preparation
P07 adds settings/evaluation/exception/history tables. The new migration was applied only by npm test to a fresh disposable database. After selecting the intended local development database and supplying its existing environment privately, run npm run db:generate and npm run db:migrate before starting the updated app/worker. Do not reset the database or apply this to production. No merchant settings are seeded; configure explicit settings through the authenticated P07 API (documented in P07-LIFECYCLE.md), with UI deferred to P08. A source update alone does not migrate the currently running dev database.

## P08 local browser workflow
Run npm run build, then node scripts/ui-test-server.mjs. Open http://127.0.0.1:3108/__test. It creates a fresh disposable PostgreSQL database on55433, fictional shops and explicit CAD100/quantity5 settings; the onboarding shop starts without settings. It uses actual routes/SDK authentication and mocked Shopify transport. Never run it against a real database or alongside npm test. QA controls and shared shop selection are test-only; reload app tabs after switching fictional shops. Ctrl+C stops the QA runtime. Production /preview cannot enter QA mode without all three explicit test guards. See P08-MERCHANT-WORKFLOW.md for actual local evidence and live NOT RUN gates. Existing dev schema migration was applied with preservation evidence; no real thresholds seeded.
