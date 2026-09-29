# Next task — P06B

P06A0.4.0 implements only high_order_value and its existing-job integration. Read RULES.md, P05-RULE-CONTRACT.md, P06A-HIGH-ORDER-VALUE.md and STATUS.md.

Next prompt: Implement only the approved high_line_quantity rule with explicit state and the shared result contract. Preserve strictly-greater per-line currentQuantity, no sum/SKU aggregation, complete pagination, refund/removal/fulfillment and cancellation semantics. Turn P05 quantity fixtures into executable tests. Reuse the single existing ingestion/evaluation path and trusted tenant settings boundary. Do not add exception lifecycle, UI, Shopify fields/scopes or order mutations. Keep settings/evaluation persistence limitations explicit unless separately authorized. Preserve P04 NOT RUN checks; do not repeat install cycles. Use a new branch, proportionate checks, README/CHANGELOG updates, sanitized main merge and next minor tag.
