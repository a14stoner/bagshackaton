import { TokenTable } from "../../components/token-table";
import { apiFetch } from "../../lib/api";

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

export default async function TokensPage() {
  const tokens = await apiFetch<Token[]>("/tokens?trackedOnly=true").catch(() => []);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="hero">
        <h1 className="hero-title">Tracked Tokens</h1>
        <p className="hero-subtitle">
          All tracked Bags launches where the configured fee receiver wallet is entitled to creator fees.
        </p>
      </section>

      <TokenTable tokens={tokens.filter((token) => token.status === "TRACKED" || token.status === "MIGRATED")} />
    </div>
  );
}
