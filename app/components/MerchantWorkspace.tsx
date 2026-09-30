import { useCallback, useEffect, useRef, useState } from "react";
import type { RuleKey, RuleResult } from "../rules/contracts";

type SettingsRow = { revision: number; settings: { ruleKey: RuleKey; enabled: boolean; threshold: string | number; currencyCode?: string } };
type HistoryItem = { id: string; revision: number; kind: string; at: string; action?: string; reason?: string; fromState?: string; toState?: string; result: RuleResult; freshness?: string[] };
type ExceptionItem = { id: string; orderId: string; ruleKey: RuleKey; state: string; revision: number; currentEvaluation: RuleResult; freshness: string[]; orderUrl: string | null };
type Detail = ExceptionItem & { history: HistoryItem[]; historyNextCursor: string | null; latestDecision?: HistoryItem | null };
type EvaluationItem = { orderId: string; result: RuleResult; freshness: string[]; orderUrl: string | null };
type Page<T> = { items: T[]; nextCursor: string | null };
type SyncStatus = { phase: string; lastSuccessAt: string | null; nextRunAt: string | null; lastError: string | null; backlog: number; failed: number };
type View = "inbox" | "settings";

const ruleNames: Record<RuleKey, string> = { high_order_value: "High order value", high_line_quantity: "High line-item quantity" };
const reasons: Record<string, string> = {
  NOT_CONFIGURED: "A threshold has not been set.", RULE_DISABLED: "This rule is disabled.", INACTIVE_INSTALLATION: "Order monitoring is inactive.",
  ORDER_CANCELLED: "This order is cancelled and excluded.", OUTSIDE_MONITORING_WINDOW: "This order is outside the monitoring window.", ELIGIBILITY_UNAVAILABLE: "Required order status or dates are unavailable.",
  INVALID_DATA: "Required order data could not be evaluated.", INVALID_CONFIGURATION: "The rule settings could not be evaluated.", AMOUNT_UNAVAILABLE: "The current order total is unavailable.",
  LINES_UNAVAILABLE: "Complete line-item quantities are unavailable.", EMPTY_LINES: "There are no eligible line items.", CURRENCY_UNSUPPORTED: "This currency cannot currently be evaluated.",
  CURRENCY_MISMATCH: "The order and threshold currencies differ. No conversion was applied.", ABOVE_THRESHOLD: "The current value is strictly above your threshold.", AT_OR_BELOW_THRESHOLD: "The current value is at or below your threshold.",
};
const freshnessLabels: Record<string, string> = {
  SETTINGS_CHANGED: "Settings changed; this order has not yet been checked with them.", PROCESSING_DISABLED: "Order monitoring is paused.",
  PROCESSING_PENDING: "An order update is waiting to be checked.", PROCESSING_IN_PROGRESS: "An order update is being checked.", PROCESSING_RETRY: "An order update is waiting to retry.",
  PROCESSING_FAILED: "An order update could not be checked.", SYNCHRONIZATION_GAP: "Synchronization is incomplete or overdue; newer changes may be missing.",
};
const outcomeNames = { matched: "Needs review", not_matched: "Threshold not exceeded", not_applicable: "Not applicable", unknown: "Unable to evaluate" };
const orderNumber = (id: string) => id.split("/").at(-1) || "Unavailable";
const time = (value: string | null) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not yet completed";

class RequestError extends Error { constructor(public status: number) { super("Request failed"); } }
async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }, cache: "no-store" });
  if (!response.ok) throw new RequestError(response.status);
  if (!response.headers.get("content-type")?.includes("application/json")) throw new RequestError(503);
  return response.json() as Promise<T>;
}
function errorText(error: unknown, write = false) {
  if (error instanceof RequestError) {
    if (error.status === 409) return "This record changed in another tab or during an order update. Load the latest saved version before trying again.";
    if (error.status === 401 || error.status === 403) return "Your app session could not be verified. Reopen Order Rescue from Shopify Admin.";
    if (error.status === 404) return "This record is no longer available in your store.";
    if (error.status === 400) return "Check your settings. Supply a valid non-negative threshold and, for order value, a supported currency code.";
  }
  return write ? "We could not confirm that your change was saved. Load the latest saved version before retrying." : "We could not load this information. Check your connection and try again.";
}
function ErrorNotice({ message, retry, label = "Try again" }: { message: string; retry?: () => void; label?: string }) {
  return <div className="workspace-notice is-error" role="alert"><p>{message}</p>{retry && <button type="button" className="text-button" onClick={retry}>{label}</button>}</div>;
}
function Status({ state }: { state: string }) { return <span className={`status-pill status-${state}`}>{state === "acknowledged" ? "In review" : state.charAt(0).toUpperCase() + state.slice(1)}</span>; }
function Freshness({ reasons: codes }: { reasons: string[] }) {
  return codes.length ? <div className="workspace-notice is-warning"><strong>Latest changes may be missing</strong><ul>{codes.map(code => <li key={code}>{freshnessLabels[code] || "The latest check is incomplete."}</li>)}</ul></div> : null;
}
function Evidence({ result }: { result: RuleResult }) {
  const evidence = result.evidence;
  return <div className="evidence-block">
    <span className={`outcome-label outcome-${result.outcome}`}>{outcomeNames[result.outcome]}</span>
    <p>{result.reasonCode === "ABOVE_THRESHOLD" && result.ruleKey === "high_line_quantity" ? "At least one eligible line is strictly above your per-line threshold." : reasons[result.reasonCode] || "This check could not be completed."}</p>
    {evidence.kind === "value" && <dl className="evidence-facts"><div><dt>Current order total</dt><dd>{evidence.amount} {evidence.currencyCode}</dd></div><div><dt>Your threshold</dt><dd>{evidence.threshold} {evidence.currencyCode}</dd></div></dl>}
    {evidence.kind === "lines" && <><dl className="evidence-facts"><div><dt>Threshold per line</dt><dd>{evidence.threshold}</dd></div>{"maxQuantity" in evidence && <div><dt>Largest current line quantity</dt><dd>{evidence.maxQuantity}</dd></div>}{"lineCount" in evidence && <div><dt>Eligible lines</dt><dd>{evidence.lineCount}</dd></div>}</dl>{"matchingLines" in evidence && <ul className="matching-lines">{evidence.matchingLines.map(line => <li key={line.id}><span>Line {orderNumber(line.id)}</span><strong>Quantity {line.currentQuantity}</strong></li>)}</ul>}</>}
    {evidence.kind === "unavailable" && evidence.expectedCurrency && <p className="muted">Threshold currency: {evidence.expectedCurrency}. Order currency: {evidence.observedCurrency || "unavailable"}.</p>}
    <p className="evidence-date">Checked {time(result.evaluatedAt)} · Order updated {result.sourceUpdatedAt ? time(result.sourceUpdatedAt) : "date unavailable"}</p>
  </div>;
}

function RuleForm({ ruleKey, row, onSaved, reload }: { ruleKey: RuleKey; row?: SettingsRow; onSaved: (row: SettingsRow) => void; reload: () => Promise<SettingsRow[]> }) {
  const [threshold, setThreshold] = useState(row ? String(row.settings.threshold) : "");
  const [currency, setCurrency] = useState(row?.settings.currencyCode || "");
  const [enabled, setEnabled] = useState(row?.settings.enabled || false);
  const [baseRevision, setBaseRevision] = useState(row?.revision || 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const valueRule = ruleKey === "high_order_value";
  const edit = () => { setSaved(false); setError(""); };
  function loadRow(next?: SettingsRow) {
    setThreshold(next ? String(next.settings.threshold) : ""); setCurrency(next?.settings.currencyCode || "");
    setEnabled(next?.settings.enabled || false); setBaseRevision(next?.revision || 0); setSaved(false); setError("");
  }
  // A server refresh never silently discards a merchant's unsaved form.
  async function loadSaved() { setBusy(true); try { const rows = await reload(); loadRow(rows.find(next => next.settings.ruleKey === ruleKey)); } catch (e) { setError(errorText(e)); } finally { setBusy(false); } }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setSaved(false);
    try {
      const normalized = valueRule ? threshold : Number(threshold);
      if (!threshold || (!valueRule && (!/^\d+$/.test(threshold) || !Number.isSafeInteger(normalized)))) throw new RequestError(400);
      const result = await request<SettingsRow>("/api/rule-settings", { method: "PUT", body: JSON.stringify({ ruleKey, settings: { enabled, threshold: normalized, ...(valueRule ? { currencyCode: currency.trim().toUpperCase() } : {}) }, expectedRevision: baseRevision }) });
      setBaseRevision(result.revision); onSaved(result); setSaved(true);
    } catch (e) { setError(errorText(e, true)); } finally { setBusy(false); }
  }
  return <form className="rule-card" onSubmit={save} aria-labelledby={`${ruleKey}-title`}>
    <div className="section-heading"><span className="rule-number">{valueRule ? "01" : "02"}</span><div><h2 id={`${ruleKey}-title`}>{ruleNames[ruleKey]}</h2><p>{valueRule ? "Compare the current order total in your chosen currency." : "Compare each eligible line separately. Quantities are never combined."}</p></div></div>
    <label className="check-label"><input type="checkbox" checked={enabled} disabled={busy} onChange={e => { setEnabled(e.target.checked); edit(); }} />Enable this rule</label>
    <div className="rule-fields"><label htmlFor={`${ruleKey}-threshold`}>{valueRule ? "Order value threshold" : "Quantity threshold"}<input id={`${ruleKey}-threshold`} type="text" inputMode={valueRule ? "decimal" : "numeric"} value={threshold} required disabled={busy} autoComplete="off" onChange={e => { setThreshold(e.target.value); edit(); }} aria-describedby={`${ruleKey}-help`} /></label>
    {valueRule && <label htmlFor="rule-currency">Currency code<input id="rule-currency" type="text" value={currency} required maxLength={4} autoComplete="off" disabled={busy} onChange={e => { setCurrency(e.target.value); edit(); }} aria-describedby={`${ruleKey}-help`} /></label>}</div>
    <p id={`${ruleKey}-help`} className="field-help">{valueRule ? "Matches only above this amount, after discounts and returns. No currency conversion. Enter the currency explicitly, for example CAD." : "Matches only above this whole-number threshold, using each line's current quantity after removals and refunds."} Cancelled orders are excluded. No threshold is supplied for you.</p>
    {(row?.revision || 0) !== baseRevision && <div className="workspace-notice is-warning">Saved settings have changed. Your unsaved form is preserved; load saved settings to replace it.</div>}
    {error && <ErrorNotice message={error} retry={busy ? undefined : () => void loadSaved()} label="Load saved settings" />}
    <div className="form-actions"><button type="submit" className="primary-button" disabled={busy}>{busy ? "Saving or loading…" : "Save rule"}</button><button type="button" className="text-button" disabled={busy} onClick={() => void loadSaved()}>Load saved settings</button>{saved && <span className="save-confirmation" role="status">Saved</span>}</div>
    <p className="field-help">Changes apply when orders are next checked. Existing evidence stays marked out of date until then. Closed alerts stay closed.</p>
  </form>;
}

export default function MerchantWorkspace({ shopLabel, synthetic = false }: { shopLabel: string; synthetic?: boolean }) {
  const [view, setView] = useState<View>("inbox");
  const [stateFilter, setStateFilter] = useState("all");
  const [settings, setSettings] = useState<SettingsRow[] | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [inbox, setInbox] = useState<Page<ExceptionItem> | null>(null);
  const [inboxError, setInboxError] = useState("");
  const [inboxBusy, setInboxBusy] = useState(false);
  const [evaluations, setEvaluations] = useState<Page<EvaluationItem> | null>(null);
  const [evaluationError, setEvaluationError] = useState("");
  const [evaluationBusy, setEvaluationBusy] = useState(false);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [syncError, setSyncError] = useState("");
  const [syncCheckedAt, setSyncCheckedAt] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailBusy, setDetailBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [refreshBusy, setRefreshBusy] = useState(false);
  const detailController = useRef<AbortController | null>(null);
  const detailSequence = useRef(0);
  const listSequence = useRef(0);
  const evaluationSequence = useRef(0);
  const mounted = useRef(true);
  const detailHeading = useRef<HTMLHeadingElement>(null);

  const loadSettings = useCallback(async () => {
    try { const rows = await request<SettingsRow[]>("/api/rule-settings"); if (mounted.current) { setSettings(rows); setSettingsError(""); } return rows; }
    catch (e) { if (mounted.current) setSettingsError(errorText(e)); throw e; }
  }, []);
  const loadInbox = useCallback(async (cursor?: string) => {
    const sequence = ++listSequence.current; setInboxBusy(true); setInboxError("");
    try { const next = await request<Page<ExceptionItem>>(`/api/exceptions?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`); if (mounted.current && sequence === listSequence.current) setInbox(previous => cursor && previous ? { ...next, items: [...previous.items, ...next.items.filter(item => !previous.items.some(old => old.id === item.id))] } : next); }
    catch (e) { if (mounted.current && sequence === listSequence.current) setInboxError(errorText(e)); }
    finally { if (mounted.current && sequence === listSequence.current) setInboxBusy(false); }
  }, []);
  const loadEvaluations = useCallback(async (cursor?: string) => {
    const sequence = ++evaluationSequence.current; setEvaluationBusy(true); setEvaluationError("");
    try { const next = await request<Page<EvaluationItem>>(`/api/evaluations?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`); if (mounted.current && sequence === evaluationSequence.current) setEvaluations(previous => cursor && previous ? { ...next, items: [...previous.items, ...next.items.filter(item => !previous.items.some(old => old.orderId === item.orderId && old.result.ruleKey === item.result.ruleKey))] } : next); }
    catch (e) { if (mounted.current && sequence === evaluationSequence.current) setEvaluationError(errorText(e)); }
    finally { if (mounted.current && sequence === evaluationSequence.current) setEvaluationBusy(false); }
  }, []);
  const loadSync = useCallback(async () => {
    try { const next = await request<SyncStatus>("/api/sync"); if (mounted.current) { setSync(next); setSyncCheckedAt(Date.now()); setSyncError(""); } }
    catch (e) { if (mounted.current) setSyncError(errorText(e)); }
  }, []);
  const refresh = useCallback(async () => { setRefreshBusy(true); await Promise.allSettled([loadSettings(), loadInbox(), loadEvaluations(), loadSync()]); if (mounted.current) setRefreshBusy(false); }, [loadSettings, loadInbox, loadEvaluations, loadSync]);
  useEffect(() => { mounted.current = true; const sequenceRef = detailSequence; const start = setTimeout(() => { void refresh(); }, 0); return () => { clearTimeout(start); mounted.current = false; detailController.current?.abort(); ++sequenceRef.current; }; }, [refresh]);
  async function openDetail(id: string, cursor?: string) {
    detailController.current?.abort(); const controller = new AbortController(); detailController.current = controller;
    const sequence = ++detailSequence.current; setSelectedId(id); setDetailBusy(true); setDetailError(""); setActionMessage("");
    if (!cursor) setDetail(null);
    try { const next = await request<Detail>(`/api/exceptions/${encodeURIComponent(id)}?limit=20${cursor ? `&historyCursor=${encodeURIComponent(cursor)}` : ""}`, { signal: controller.signal });
      if (mounted.current && sequence === detailSequence.current) {
        setDetail(previous => cursor && previous?.id === id ? { ...next, history: [...previous.history, ...next.history.filter(item => !previous.history.some(old => old.id === item.id))] } : next);
        // A confirmed detail refresh must also update its loaded inbox row,
        // especially after another tab changed the merchant decision.
        setInbox(previous => previous ? { ...previous, items: previous.items.map(item => item.id === id ? next : item) } : previous);
        if (!cursor) requestAnimationFrame(() => detailHeading.current?.focus());
      }
    } catch (e) { if (mounted.current && sequence === detailSequence.current && !controller.signal.aborted) setDetailError(errorText(e)); }
    finally { if (mounted.current && sequence === detailSequence.current) setDetailBusy(false); }
  }
  function closeDetail() { detailController.current?.abort(); ++detailSequence.current; setSelectedId(null); setDetail(null); setDetailError(""); setActionMessage(""); }
  async function act(action: "acknowledge" | "resolve" | "ignore") {
    if (!detail) return;
    const sequence = detailSequence.current; const id = detail.id;
    setActionBusy(true); setDetailError(""); setActionMessage("");
    try { const next = await request<Detail>(`/api/exceptions/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ action, reason: { acknowledge: "REVIEW_STARTED", resolve: "REVIEW_COMPLETED", ignore: "NOT_RELEVANT" }[action], expectedRevision: detail.revision }) });
      if (mounted.current && sequence === detailSequence.current) { setDetail(next); setActionMessage(action === "acknowledge" ? "Review started and saved." : `Alert ${action === "resolve" ? "resolved" : "ignored"}. Your Shopify order was not changed.`); }
      if (mounted.current) setInbox(previous => previous ? { ...previous, items: previous.items.map(item => item.id === id ? next : item) } : previous);
    } catch (e) { if (mounted.current && sequence === detailSequence.current) setDetailError(errorText(e, true)); }
    finally { if (mounted.current) setActionBusy(false); }
  }
  const filteredItems = inbox?.items.filter(item => stateFilter === "all" || item.state === stateFilter) || [];
  const unconfigured = settings !== null && settings.length < 2;
  const incomplete = !sync || !sync.lastSuccessAt || !sync.nextRunAt || Date.parse(sync.nextRunAt) <= syncCheckedAt || sync.phase !== "idle" || Boolean(sync.lastError) || sync.backlog > 0 || sync.failed > 0;
  const terminal = detail?.state === "resolved" || detail?.state === "ignored";
  return <main className="rescue-shell merchant-workspace">
    {synthetic && <div className="preview-notice" role="status">LOCAL WORKFLOW CHECK · Synthetic data only. This is not a live Shopify session.</div>}
    <header className="rescue-header"><a href={synthetic ? "/preview" : "/app"} className="brand" aria-label="Order Rescue home"><span className="brand-mark">OR</span>Order Rescue</a><span className="workspace-store">{shopLabel}</span></header>
    <section className="workspace-hero"><div><p className="eyebrow">YOUR ORDER REVIEW WORKSPACE</p><h1>A clear next step.</h1><p className="hero-copy">Review the signal. Make the call. Stay in control.</p></div><button type="button" className="secondary-button" disabled={refreshBusy || actionBusy} onClick={() => { void refresh(); if (selectedId) void openDetail(selectedId); }}>{refreshBusy ? "Refreshing…" : "Refresh workspace"}</button></section>
    <nav className="workspace-tabs" aria-label="Workspace"><button type="button" aria-current={view === "inbox" ? "page" : undefined} onClick={() => setView("inbox")}>Exception inbox</button><button type="button" aria-current={view === "settings" ? "page" : undefined} onClick={() => setView("settings")}>Rule settings</button></nav>
    {unconfigured && <section className="onboarding-card"><div><p className="eyebrow">START WITH YOUR THRESHOLDS</p><h2>Choose what deserves a closer look.</h2><p>Set an order value and a quantity per line. Until a rule is configured, its orders cannot be evaluated against your preferences.</p></div><button type="button" className="primary-button" onClick={() => setView("settings")}>Set up rules <span aria-hidden="true">→</span></button></section>}
    <section className="sync-strip" aria-label="Monitoring status"><div><span className={`sync-dot ${incomplete ? "is-partial" : ""}`} /><strong>{syncError ? "Monitoring status unavailable" : !sync ? "Loading monitoring status…" : incomplete ? "Monitoring is incomplete" : "Latest synchronization completed"}</strong></div><p>Last successful sync: <strong>{time(sync?.lastSuccessAt || null)}</strong>{sync && <> · {sync.backlog} waiting · {sync.failed} need retry or review</>}</p>{sync?.lastError && <p>Some orders could not be refreshed. Previous evidence may be out of date.</p>}{syncError && <ErrorNotice message={syncError} retry={() => void loadSync()} />}</section>
    {view === "settings" ? <section aria-label="Rule settings"><div className="workspace-section-title"><div><h2>Your rules, your thresholds</h2><p>Only these two checks run. They do not edit Shopify orders.</p></div></div>{settingsError && <ErrorNotice message={settingsError} retry={() => { void loadSettings().catch(() => {}); }} />}{settings === null ? <p role="status">Loading saved settings…</p> : <div className="rule-grid">{(["high_order_value", "high_line_quantity"] as RuleKey[]).map(ruleKey => <RuleForm key={ruleKey} ruleKey={ruleKey} row={settings.find(row => row.settings.ruleKey === ruleKey)} onSaved={row => setSettings(previous => [...(previous || []).filter(old => old.settings.ruleKey !== ruleKey), row])} reload={loadSettings} />)}</div>}</section> : <>
      <section className="inbox-section" aria-labelledby="inbox-title"><div className="workspace-section-title"><div><h2 id="inbox-title">Exception inbox</h2><p>Review decisions and current order signals are kept separately.</p></div>{inbox && <label className="inbox-filter">Review state<select value={stateFilter} onChange={event => setStateFilter(event.target.value)}><option value="all">All states</option><option value="open">Open</option><option value="acknowledged">In review</option><option value="resolved">Resolved</option><option value="ignored">Ignored</option></select><span className="muted">{inbox.items.length} loaded{inbox.nextCursor ? " · filtering loaded records; more available" : ""}</span></label>}</div>
        {inboxError && <ErrorNotice message={inboxError} retry={() => void loadInbox(inbox?.nextCursor || undefined)} />}
        {!inbox && inboxBusy && <p className="loading-state" role="status">Loading exceptions…</p>}
        {inbox && !inbox.items.length && <div className="empty-state"><span className="empty-symbol" aria-hidden="true">◎</span><h3>{inbox.nextCursor ? "No visible exceptions on this page" : "No exceptions to review yet"}</h3><p>{unconfigured ? "Configure your rules to begin evaluating incoming orders." : "No matching alerts have been recorded. This does not mean every order has been evaluated."}</p><p>Check monitoring status and recent checks below for missing or incomplete information.</p></div>}
        {inbox && inbox.items.length > 0 && !filteredItems.length && <p className="empty-coverage">No loaded alerts have this review state.{inbox.nextCursor ? " Load more exceptions to check the next page." : ""}</p>}
        {inbox && (filteredItems.length > 0 || selectedId) && <div className="inbox-layout"><div className="exception-list">{filteredItems.map(item => <button className={`exception-row ${selectedId === item.id ? "is-selected" : ""}`} type="button" key={item.id} onClick={() => void openDetail(item.id)} disabled={actionBusy} aria-pressed={selectedId === item.id}><span className="exception-row-heading"><strong>Order {orderNumber(item.orderId)}</strong><Status state={item.state} /></span><span>{ruleNames[item.ruleKey]}</span><span className="row-summary">{outcomeNames[item.currentEvaluation.outcome]}{item.freshness.length > 0 ? " · May be out of date" : ""}</span><span className="row-link">View evidence <span aria-hidden="true">→</span></span></button>)}</div>
          <aside className="detail-panel" aria-label="Exception evidence" aria-busy={detailBusy || actionBusy}>{!selectedId ? <div className="detail-placeholder"><p className="eyebrow">THE FACTS BEHIND THE SIGNAL</p><h3>Select an exception</h3><p>See the current evidence, then record your review decision.</p></div> : <>{detailBusy && <p role="status">Loading evidence…</p>}{detailError && <ErrorNotice message={detailError} retry={actionBusy || detailBusy ? undefined : () => void openDetail(selectedId)} label="Load latest record" />}{detail && <><div className="detail-top"><p className="eyebrow">REVIEW · {ruleNames[detail.ruleKey]}</p><button type="button" className="text-button" disabled={actionBusy} onClick={closeDetail}>Close</button></div><h2 ref={detailHeading} tabIndex={-1}>Order {orderNumber(detail.orderId)}</h2><div className="detail-meta"><Status state={detail.state} />{detail.orderUrl ? <a className="shopify-link" href={detail.orderUrl} target="_blank" rel="noopener noreferrer">Open in Shopify <span aria-hidden="true">↗</span></a> : <span className="muted">Shopify link unavailable</span>}</div><Freshness reasons={detail.freshness} /><h3 className="evidence-heading">Current evidence</h3><Evidence result={detail.currentEvaluation} />
            {actionMessage && <p className="workspace-notice is-success" role="status">{actionMessage}</p>}
            {terminal ? <div className="decision-note"><strong>This alert stays {detail.state}.</strong><p>New order evidence does not reopen your decision. The current check above may differ from what you reviewed.</p></div> : <div className="decision-actions"><h3>Record your decision</h3><p><strong>Resolve</strong> closes this alert as reviewed. <strong>Ignore</strong> suppresses this alert as not relevant. Both stay closed even if the order changes. Neither repairs or changes the Shopify order.</p><div className="button-row"><button type="button" className="primary-button" disabled={actionBusy || detailBusy || Boolean(detailError)} onClick={() => void act("resolve")}>{actionBusy ? "Saving…" : "Resolve"}</button><button type="button" className="secondary-button" disabled={actionBusy || detailBusy || Boolean(detailError)} onClick={() => void act("ignore")}>Ignore</button>{detail.state === "open" && <button type="button" className="text-button" disabled={actionBusy || detailBusy || Boolean(detailError)} onClick={() => void act("acknowledge")}>Acknowledge</button>}</div></div>}
            {detail.latestDecision && <section className="decision-evidence"><h3>Evidence at the last merchant decision</h3><p className="muted">{detail.latestDecision.toState === "acknowledged" ? "Review started" : detail.latestDecision.toState === "resolved" ? "Review completed" : "Marked not relevant"} · {time(detail.latestDecision.at)}</p><Evidence result={detail.latestDecision.result} /></section>}
            <section className="history-section"><h3>Review history</h3><ol className="history-list">{detail.history.map(entry => <li key={entry.id}><strong>{entry.kind === "decision" ? entry.toState === "acknowledged" ? "Merchant started review" : entry.toState === "resolved" ? "Merchant resolved alert" : "Merchant ignored alert" : "Order evidence checked"}</strong><time dateTime={entry.at}>{time(entry.at)}</time><span>{outcomeNames[entry.result.outcome]}</span></li>)}</ol>{detail.historyNextCursor && <button type="button" className="text-button" disabled={detailBusy || actionBusy} onClick={() => void openDetail(detail.id, detail.historyNextCursor!)}>Load more history</button>}</section>
          </>}</>}</aside></div>}
      {inbox?.nextCursor && <button type="button" className="secondary-button load-more" disabled={inboxBusy} onClick={() => void loadInbox(inbox.nextCursor!)}>{inboxBusy ? "Loading…" : "Load more exceptions"}</button>}</section>
      <section className="coverage-section" aria-labelledby="coverage-title"><div className="workspace-section-title"><div><p className="eyebrow">CHECK COVERAGE, NOT A SAFETY SCORE</p><h2 id="coverage-title">Recent rule checks</h2><p>Unavailable data stays visible, even when no alert was created. A completed check covers only its stated rule.</p></div></div>{evaluationError && <ErrorNotice message={evaluationError} retry={() => void loadEvaluations(evaluations?.nextCursor || undefined)} />}{!evaluations && evaluationBusy && <p role="status">Loading recent checks…</p>}{evaluations && !evaluations.items.length && <p className="empty-coverage">No rule checks have been recorded yet. Order evaluation is not confirmed.</p>}{evaluations && evaluations.items.length > 0 && <ul className="evaluation-list">{evaluations.items.map(item => <li key={`${item.orderId}-${item.result.ruleKey}`}><div><strong>Order {orderNumber(item.orderId)}</strong><span>{ruleNames[item.result.ruleKey]}</span></div><div><span className={`outcome-label outcome-${item.result.outcome}`}>{outcomeNames[item.result.outcome]}</span><p>{item.result.reasonCode === "ABOVE_THRESHOLD" && item.result.ruleKey === "high_line_quantity" ? "At least one eligible line is above your per-line threshold." : reasons[item.result.reasonCode] || "Check incomplete."}</p>{item.freshness.length > 0 && <span className="stale-label">May be out of date</span>}</div></li>)}</ul>}{evaluations?.nextCursor && <button type="button" className="secondary-button load-more" disabled={evaluationBusy} onClick={() => void loadEvaluations(evaluations.nextCursor!)}>{evaluationBusy ? "Loading…" : "Load more checks"}</button>}</section>
    </>}
    <footer><span>Built for deliberate decisions.</span><span>Shopify orders stay unchanged. Your decisions live in Order Rescue.</span></footer>
  </main>;
}
