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
