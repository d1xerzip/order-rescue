# Next slice

Version **0.2.0** contains P04 bounded recovery. Its actual and synthetic evidence, limitations and operations are recorded in [STATUS.md](STATUS.md) and [P04-SYNC.md](P04-SYNC.md).

## P05 — deterministic rule-input contract

Read [RULES.md](RULES.md), [PRODUCT.md](PRODUCT.md) and the [data inventory](ARCHITECTURE.md). Implement only deterministic input/outcome types, eligibility and source/config/rule version evidence for the accepted checks. Preserve exact monetary strings/currency, current line quantities, cancellation semantics, monitoring/retention boundaries and unavailable-versus-empty distinctions. Use server-authenticated tenant identity and meaningful synthetic acceptance examples. Actual rule evaluation belongs to the following milestones.

Do not add new data fields or scopes, historic backfill, order mutations, messaging, AI, billing or unrelated UI. Keep unresolved production privacy/access/infrastructure work visible. Actual update/cancellation webhook delivery and multi-page live synchronization remain unexecuted checks, distinct from passed synthetic cases.

No account changes, deployment or review submission are authorized by this handoff. Preserve already verified installation evidence; repeat checks only when a relevant change requires it.
