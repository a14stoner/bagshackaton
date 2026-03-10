import { apiFetch } from "../../../lib/api";
import { formatSol, shortenAddress } from "../../../lib/format";
import { Countdown } from "../../../components/countdown";
import { CopyButton } from "../../../components/copy-button";
import { TokenLeaderboard } from "../../../components/token-leaderboard";

type Draw = {
  draw_number: number;
  winner_wallet: string | null;
  score: number | null;
  reward_amount: string;
  tx_signature: string | null;
  dry_run: boolean;
  created_at: string;
};

type Token = {
  mint: string;
  symbol: string;
  name: string;
  metadata_uri: string | null;
  image_uri: string | null;
  status: string;
  lifecycle_phase: "DISCOVERY" | "DBC" | "DAMM";
  latest_pool: "bonding_curve" | "damm" | null;
  holder_count: number;
  treasury_balance: string;
  claimable_sol: string;
  claimable_positions_count: number;
  total_fees_generated: string;
  total_fees_distributed: string;
  latest_winner_wallet: string | null;
  next_draw_at: string | null;
};

export default async function TokenPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = await params;
  const [token, draws] = await Promise.all([
    apiFetch<Token>(`/tokens/${mint}`),
    apiFetch<Draw[]>(`/tokens/${mint}/draws`).catch(() => [])
  ]);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="hero">
        <div className="token-card-top">
          <div className="token-ident">
            {token.image_uri ? <img src={token.image_uri} alt={token.symbol} /> : null}
            <div>
              <h1 className="hero-title" style={{ margin: 0 }}>
                {token.name} ({token.symbol})
              </h1>
              <p className="hero-subtitle">
                {shortenAddress(token.mint, 8, 8)} <CopyButton value={token.mint} />
              </p>
            </div>
          </div>
          <span className={`pill ${token.lifecycle_phase === "DAMM" ? "pill--blue" : token.lifecycle_phase === "DBC" ? "pill--violet" : ""}`}>
            {token.lifecycle_phase}
          </span>
        </div>

        <div className="metric-grid">
          <div className="metric-card">
            <div className="metric-label">Holder Count</div>
            <div className="metric-value mono">{token.holder_count}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Treasury Balance</div>
            <div className="metric-value mono">{formatSol(token.treasury_balance)} SOL</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Open Claimable</div>
            <div className="metric-value mono">{formatSol(token.claimable_sol)} SOL</div>
            <div className="metric-label" style={{ marginTop: 5 }}>
              Positions: {token.claimable_positions_count}
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Next Draw Countdown</div>
            <div className="metric-value">
              <Countdown targetAt={token.next_draw_at} />
            </div>
            <div className="metric-label" style={{ marginTop: 5 }}>
              Draw interval: every 15 minutes
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Latest Winner</div>
            <div className="metric-value" title={token.latest_winner_wallet ?? "Pending"}>
              {token.latest_winner_wallet ? shortenAddress(token.latest_winner_wallet, 6, 6) : "Pending"}
            </div>
            <div className="metric-label" style={{ marginTop: 5 }}>
              Distributed: {formatSol(token.total_fees_distributed)} SOL
            </div>
          </div>
        </div>
      </section>

      <div className="split-grid">
        <TokenLeaderboard mint={token.mint} />

        <div style={{ display: "grid", gap: 14 }}>
          <section className="panel">
            <h2 className="section-title">Draw History</h2>
            {draws.length === 0 ? <p className="muted">No draws yet for this token.</p> : null}
            {draws.length > 0 ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Winner</th>
                      <th>Score</th>
                      <th>Reward</th>
                      <th>Tx</th>
                      <th>Mode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draws.map((draw) => (
                      <tr key={draw.draw_number}>
                        <td>{new Date(draw.created_at).toLocaleString()}</td>
                        <td>{draw.winner_wallet ? shortenAddress(draw.winner_wallet, 5, 5) : "No winner"}</td>
                        <td className="mono">{draw.score ? Number(draw.score).toFixed(3) : "-"}</td>
                        <td className="mono">{formatSol(draw.reward_amount)} SOL</td>
                        <td title={draw.tx_signature ?? "N/A"}>{draw.tx_signature ? shortenAddress(draw.tx_signature, 6, 6) : "N/A"}</td>
                        <td>
                          <span className={draw.dry_run ? "pill pill--danger" : "pill pill--green"}>
                            {draw.dry_run ? "dry-run" : "live"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>

          <section className="panel">
            <h2 className="section-title">Reward Explanation</h2>
            <p className="muted">
              Rewards are distributed from creator fees. Each draw selects a winner weighted by Hold Score, excluding holders with non-positive scores and wallets in cooldown.
            </p>
          </section>

          <section className="panel">
            <h2 className="section-title">Hold Score Formula</h2>
            <p className="mono">score = holdHours * sqrt(percentSupply) * 10 * (1 - sqrt(sellRatio))²</p>
            <p className="muted">holdHours: how long tokens are held.</p>
            <p className="muted">percentSupply: wallet balance divided by total supply.</p>
            <p className="muted">sellRatio: sold divided by total acquired (transfers out count as sold).</p>
          </section>
        </div>
      </div>
    </div>
  );
}
