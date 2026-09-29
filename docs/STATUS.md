# Public source status

Version 0.1.0, P03 source update. Implemented: embedded authentication, encrypted sessions, tenant records/lifecycle, minimal privacy intake, authenticated orders/create receipt, PostgreSQL durable jobs, retry/crash recovery and minimal encrypted order snapshots. See [ingestion](P03-INGESTION.md).

Implementation verification: ten ingestion integration tests and seven snapshot tests passed across targeted runs; typecheck/lint passed. Earlier foundation checks remain recorded in PUBLIC-REVIEW.md. The private development workflow also verified genuine delivery and matching snapshots in two development stores after repairing SDK response-header handling. Private identities, raw data and operational receipts are excluded; this public checkout is not independently connected or live-verified. No tests were repeated solely for publication.

Missing: bounded missed-order recovery, business rules, exceptions/UI, full privacy processing, production infrastructure/access approval and listing. Not production ready. Next: P04 bounded recovery; see NEXT.md.
