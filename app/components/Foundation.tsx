export interface FoundationProps {
  shopLabel: string;
  connected: boolean;
  preview?: boolean;
}
export default function Foundation({
  shopLabel,
  connected,
  preview = false,
}: FoundationProps) {
  return (
    <main className="rescue-shell">
      {preview && (
        <div className="preview-notice" role="status">
          LOCAL PREVIEW · Synthetic display only. Shopify installation is not
          verified.
        </div>
      )}
      <header className="rescue-header">
        <a href={preview ? "/preview" : "/app"} className="brand">
          <span className="brand-mark">OR</span>Order Rescue
        </a>
        <span className="release-tag">Foundation · 0.1</span>
      </header>
      <section className="hero">
        <p className="eyebrow">YOUR ORDER REVIEW WORKSPACE</p>
        <h1>
          A little more clarity.
          <br />
          Before the next step.
        </h1>
        <p className="hero-copy">
          A home for reviewing order exceptions.
          <br />
          You stay in control of every decision.
        </p>
      </section>
      <div className="foundation-grid">
        <section className="connection-card" aria-labelledby="connection-title">
          <div className="card-top">
            <span className="connection-dot" />
            <span>
              {connected
                ? "App session verified"
                : "Shopify connection pending"}
            </span>
          </div>
          <h2 id="connection-title">Your store</h2>
          <p className="store-name">{shopLabel}</p>
          <p>
            {connected
              ? "This workspace is scoped to your authenticated Shopify store."
              : "Open Order Rescue from Shopify Admin after installation to connect your store."}
          </p>
          <dl>
            <div>
              <dt>Order access</dt>
              <dd>Not checked</dd>
            </div>
            <div>
              <dt>Order monitoring</dt>
              <dd>Not started</dd>
            </div>
            <div>
              <dt>Shopify order changes</dt>
              <dd>Never performed</dd>
            </div>
          </dl>
        </section>
        <section className="next-card">
          <p className="eyebrow">WHAT COMES NEXT</p>
          <h2>A focused review flow</h2>
          <ol className="steps">
            <li>
              <span>01</span>
              <div>
                <h3>Choose what matters</h3>
                <p>Set thresholds for order value and item quantity.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Review the evidence</h3>
                <p>See why an order needs your attention.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Make the call</h3>
                <p>Resolve or ignore an alert inside Order Rescue.</p>
              </div>
            </li>
          </ol>
          <p className="scope-note">
            Planned features. No orders have been imported or evaluated by this
            foundation.
          </p>
        </section>
      </div>
      <footer>
        <span>Built for deliberate decisions.</span>
        <span>Read-only Shopify integration · Free first release</span>
      </footer>
    </main>
  );
}
