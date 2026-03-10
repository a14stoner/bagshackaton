import { apiFetch } from "../../lib/api";
import { formatSol, shortenAddress } from "../../lib/format";

type Draw = {
  token_mint: string;
  draw_number: number;
  winner_wallet: string | null;
  score: number | null;
  reward_amount: string;
  tx_signature: string | null;
  dry_run: boolean;
  created_at: string;
};

export default async function DrawHistoryPage() {
  const draws = await apiFetch<Draw[]>("/draws?limit=150").catch(() => []);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <section className="hero">
        <h1 className="hero-title">Draw History</h1>
        <p className="hero-subtitle">All recent reward draws across tracked tokens with winner, score, payout amount, and transaction status.</p>
      </section>

      <section className="panel">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Token</th>
                <th>Winner</th>
                <th>Score</th>
                <th>Reward</th>
                <th>Tx Signature</th>
                <th>Mode</th>
              </tr>
            </thead>
            <tbody>
              {draws.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No draws found yet.
                  </td>
                </tr>
              ) : (
                draws.map((draw) => (
                  <tr key={`${draw.token_mint}:${draw.draw_number}:${draw.created_at}`}>
                    <td>{new Date(draw.created_at).toLocaleString()}</td>
                    <td title={draw.token_mint}>{shortenAddress(draw.token_mint, 6, 6)}</td>
                    <td title={draw.winner_wallet ?? "No winner"}>
                      {draw.winner_wallet ? shortenAddress(draw.winner_wallet, 6, 6) : "No winner"}
                    </td>
                    <td className="mono">{draw.score ? Number(draw.score).toFixed(3) : "-"}</td>
                    <td className="mono">{formatSol(draw.reward_amount)} SOL</td>
                    <td title={draw.tx_signature ?? "N/A"}>{draw.tx_signature ? shortenAddress(draw.tx_signature, 6, 6) : "N/A"}</td>
                    <td>
                      <span className={draw.dry_run ? "pill pill--danger" : "pill pill--green"}>
                        {draw.dry_run ? "dry-run" : "live"}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
