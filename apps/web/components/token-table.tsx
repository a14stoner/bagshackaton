import Link from "next/link";
import { Countdown } from "./countdown";
import { formatSol, shortenAddress } from "../lib/format";

type Token = {
  mint: string;
  symbol: string;
  name: string;
  image_uri: string | null;
  status: string;
  lifecycle_phase: "DISCOVERY" | "DBC" | "DAMM";
  holder_count: number;
  treasury_balance: string;
  total_fees_distributed: string;
  claimable_sol: string;
  latest_winner_wallet: string | null;
  next_draw_at: string | null;
};

function phaseClass(phase: Token["lifecycle_phase"]) {
  if (phase === "DAMM") return "pill pill--blue";
  if (phase === "DBC") return "pill pill--violet";
  return "pill";
}

export function TokenTable({ tokens }: { tokens: Token[] }) {
  if (tokens.length === 0) {
    return (
      <section className="panel">
        <h2 className="section-title">Tracked Tokens</h2>
        <p className="muted">No tracked tokens yet. As soon as the target wallet appears in fee receivers, cards show up here.</p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="section-title">Tracked Tokens</h2>
      <div className="token-grid">
        {tokens.map((token) => (
          <Link key={token.mint} href={`/tokens/${token.mint}`} className="token-card">
            <div className="token-card-top">
              <div className="token-ident">
                {token.image_uri ? <img src={token.image_uri} alt={token.symbol} /> : null}
                <div>
                  <p className="token-name">{token.symbol}</p>
                  <p className="token-meta">{token.name}</p>
                </div>
              </div>
              <span className={phaseClass(token.lifecycle_phase)}>{token.lifecycle_phase}</span>
            </div>

            <p className="token-meta" style={{ marginTop: 10 }}>
              {shortenAddress(token.mint, 6, 6)}
            </p>

            <div className="token-stats">
              <div className="token-stat">
                <div className="token-stat-label">Holders</div>
                <div className="token-stat-value mono">{token.holder_count}</div>
              </div>
              <div className="token-stat">
                <div className="token-stat-label">Treasury</div>
                <div className="token-stat-value mono">{formatSol(token.treasury_balance)} SOL</div>
              </div>
              <div className="token-stat">
                <div className="token-stat-label">Open claimable</div>
                <div className="token-stat-value mono">{formatSol(token.claimable_sol)} SOL</div>
              </div>
              <div className="token-stat">
                <div className="token-stat-label">Rewards Distributed</div>
                <div className="token-stat-value mono">{formatSol(token.total_fees_distributed)} SOL</div>
              </div>
              <div className="token-stat">
                <div className="token-stat-label">Latest Winner</div>
                <div className="token-stat-value" title={token.latest_winner_wallet ?? "Pending"}>
                  {token.latest_winner_wallet ? shortenAddress(token.latest_winner_wallet) : "Pending"}
                </div>
              </div>
              <div className="token-stat">
                <div className="token-stat-label">Next Draw</div>
                <div className="token-stat-value">
                  <Countdown targetAt={token.next_draw_at} />
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
