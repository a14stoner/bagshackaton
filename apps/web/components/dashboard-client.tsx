"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/api";
import { formatSol } from "../lib/format";
import { Countdown } from "./countdown";
import { TokenTable } from "./token-table";

type Token = {
  mint: string;
  symbol: string;
  name: string;
  image_uri: string | null;
  status: string;
  lifecycle_phase: "DISCOVERY" | "DBC" | "DAMM";
  holder_count: number;
  treasury_balance: string;
  claimable_sol: string;
  total_fees_distributed: string;
  latest_winner_wallet: string | null;
  next_draw_at: string | null;
};

export function DashboardClient({ initialTokens }: { initialTokens: Token[] }) {
  const {
    data: tokens = initialTokens,
    isPending,
    isError
  } = useQuery({
    queryKey: ["tokens"],
    queryFn: () => apiFetch<Token[]>("/tokens?trackedOnly=true"),
    initialData: initialTokens,
    staleTime: 10_000
  });

  const trackedTokens = tokens.filter((token) => token.status === "TRACKED" || token.status === "MIGRATED");
  const treasury = trackedTokens.reduce((sum, token) => sum + Number(token.treasury_balance ?? 0), 0);
  const claimable = trackedTokens.reduce((sum, token) => sum + Number(token.claimable_sol ?? 0), 0);
  const holderCount = trackedTokens.reduce((sum, token) => sum + Number(token.holder_count ?? 0), 0);
  const rewards = trackedTokens.reduce((sum, token) => sum + Number(token.total_fees_distributed ?? 0), 0);
  const nextDraw = trackedTokens.find((token) => token.next_draw_at)?.next_draw_at ?? null;
  const status = trackedTokens.length > 0 ? "Holding tokens earns rewards." : "Waiting for tracked fee receivers.";

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="hero">
        <h1 className="hero-title">Bags Holder Rewards Platform</h1>
        <p className="hero-subtitle">
          Track Bags launches, detect creator fee share, score long-term holders, and run transparent weighted reward draws.
        </p>
        <p style={{ marginTop: 14, fontWeight: 700 }}>{status}</p>
        <div className="metric-grid">
          <div className="metric-card">
            <div className="metric-label">Tracked Tokens</div>
            <div className="metric-value mono">{trackedTokens.length}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Total Holders</div>
            <div className="metric-value mono">{holderCount}</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Treasury</div>
            <div className="metric-value mono">{formatSol(treasury)} SOL</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Open Claimable</div>
            <div className="metric-value mono">{formatSol(claimable)} SOL</div>
          </div>
          <div className="metric-card">
            <div className="metric-label">Next Draw Countdown</div>
            <div className="metric-value">
              <Countdown targetAt={nextDraw} />
            </div>
            <div className="metric-label" style={{ marginTop: 6 }}>
              Rewards distributed: {formatSol(rewards)} SOL
            </div>
          </div>
        </div>
      </section>

      {isError ? (
        <section className="panel">
          <h2 className="section-title">Data Error</h2>
          <p className="muted">Could not load token data from API. Check backend connectivity and retry.</p>
        </section>
      ) : null}

      {isPending && initialTokens.length === 0 ? (
        <section className="token-grid">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div key={idx} className="token-card">
              <div className="skeleton" style={{ height: 22, width: "45%" }} />
              <div className="skeleton" style={{ height: 14, width: "70%", marginTop: 10 }} />
              <div className="token-stats">
                {Array.from({ length: 6 }).map((__, statIdx) => (
                  <div key={statIdx} className="token-stat">
                    <div className="skeleton" style={{ height: 11, width: "70%" }} />
                    <div className="skeleton" style={{ height: 16, width: "50%", marginTop: 8 }} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      ) : (
        <TokenTable tokens={trackedTokens} />
      )}
    </div>
  );
}
