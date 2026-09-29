# Public source edition boundary

This edition contains portable application source, local test/runtime helpers, migrations, dependency lockfile, templates and technical specifications. Owner/account/machine-specific history and operational material are excluded.

Not included: original Git objects/config/remotes/authors, account-linked live helper scripts, live receipts, screenshots, PDFs, private audit histories, local paths, dev-store identities, app/organization identifiers, credentials, databases, dependencies, build artifacts or source maps. Upstream third-party license attribution is preserved.

The initial migration directory uses an edition-local neutral name; use a fresh database. Do not apply this edition's migration history to an existing private installation. No application behavior was changed to anonymize this edition.

No absolute anonymity guarantee is made. The project name and code can be correlated with other copies. Hosting under a personal account, signed commits, author emails, subsequent workflows/artifacts and server/operator records can identify a publisher. A fresh clean history and an appropriately chosen publishing identity are separate decisions. Never publish the original private history or turn a private operational repository public to distribute this edition.

Publication is pending explicit owner approval of this prepared edition and destination. This directory is an artifact, not a publication.

## Verification

One local run of this source edition completed: `npm test` 22/22 PASS with disposable PostgreSQL and mocked Shopify transport; `npm run typecheck`, `npm run lint`, `npm run build` PASS. The build reports framework future-option warnings and expected empty server-route chunks; no build failure. Dependencies were reused locally for validation; no dependency directory or generated output is distributed. A clean-machine `npm ci` was not rerun. No live Shopify checks, visual UI recheck or production tests are claimed.

Independent read-only content review found no known owner/account/machine markers or broken relative Markdown links. This is a bounded content review, not an absolute anonymity guarantee. The source archive uses only selected source files, normalized file-entry timestamps and no original filesystem ownership metadata. Checksums identify archive contents, not a publisher.
