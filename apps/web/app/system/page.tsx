import { apiFetch } from "../../lib/api";

type Health = { ok: boolean };
type IndexerState = {
  checkpoint: {
    last_processed_slot: string;
    last_processed_signature: string | null;
    updated_at: string;
  } | null;
  normalizedEventCount: number;
  runtime?: {
    running: boolean;
    grpcEndpoint: string;
    targetFeeReceiverWallet: string;
    mode: string;
  };
};

export default async function SystemPage() {
  const [health, indexer] = await Promise.all([
    apiFetch<Health>("/system/health").catch(() => ({ ok: false })),
    apiFetch<IndexerState>("/system/indexer").catch(() => ({ checkpoint: null, normalizedEventCount: 0, runtime: undefined }))
  ]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <section className="hero">
        <h1 className="hero-title">System Status</h1>
        <p className="hero-subtitle">Operational status for API and live Yellowstone indexer stream.</p>
      </section>

      <section className="metric-grid">
        <div className="metric-card">
          <div className="metric-label">API Health</div>
          <div className="metric-value">{health.ok ? "Healthy" : "Unhealthy"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Indexer Runtime</div>
          <div className="metric-value">{indexer.runtime?.running ? "Running" : "Stopped"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Mode</div>
          <div className="metric-value">{indexer.runtime?.mode ?? "unknown"}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Normalized Events</div>
          <div className="metric-value mono">{indexer.normalizedEventCount}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Last Slot</div>
          <div className="metric-value mono">{indexer.checkpoint?.last_processed_slot ?? "N/A"}</div>
        </div>
      </section>

      <section className="panel">
        <h2 className="section-title">Indexer Details</h2>
        <p className="muted">gRPC Endpoint: {indexer.runtime?.grpcEndpoint ?? "N/A"}</p>
        <p className="muted">Target Fee Receiver: {indexer.runtime?.targetFeeReceiverWallet ?? "N/A"}</p>
        <p className="muted">Last Signature: {indexer.checkpoint?.last_processed_signature ?? "N/A"}</p>
        <p className="muted">Updated At: {indexer.checkpoint?.updated_at ?? "N/A"}</p>
      </section>
    </div>
  );
}
