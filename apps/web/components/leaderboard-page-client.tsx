"use client";

import { useState } from "react";
import { TokenLeaderboard } from "./token-leaderboard";

type TokenOption = {
  mint: string;
  symbol: string;
  lifecycle_phase: "DISCOVERY" | "DBC" | "DAMM";
};

export function LeaderboardPageClient({ tokens }: { tokens: TokenOption[] }) {
  const [selectedMint, setSelectedMint] = useState(tokens[0]?.mint ?? "");

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <section className="hero">
        <h1 className="hero-title">Holder Leaderboard</h1>
        <p className="hero-subtitle">Explore holders, scores, win chances, cooldowns, and wallet behavior for tracked tokens.</p>
        <div className="toolbar" style={{ marginTop: 14 }}>
          <select className="select" value={selectedMint} onChange={(event: any) => setSelectedMint(event.target.value)}>
            {tokens.map((token) => (
              <option key={token.mint} value={token.mint}>
                {token.symbol} • {token.lifecycle_phase}
              </option>
            ))}
          </select>
        </div>
      </section>
      {selectedMint ? <TokenLeaderboard mint={selectedMint} /> : <section className="panel">No tracked tokens found.</section>}
    </div>
  );
}
