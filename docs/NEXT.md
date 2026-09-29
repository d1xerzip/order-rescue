# Next slice

P04: implement bounded recovery using existing tenant/generation guards and durable jobs. Verify current official order-query/pagination guidance. Recover eligible missed orders only after monitoring starts and within 30 days; no read_all_orders or historic backfill. Advance durable cursors only after persistence; retain coverage gaps on denied access or incomplete pagination. Test stale revisions, retry and interrupted pages with disposable fixtures. Do not add rules, UI or order mutations. No account settings, deployment or review submission is authorized by this document.
