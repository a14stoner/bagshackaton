import { DashboardClient } from "../components/dashboard-client";
import { apiFetch } from "../lib/api";

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

export default async function HomePage() {
  const tokens = await apiFetch<Token[]>("/tokens?trackedOnly=true").catch(() => []);
  return <DashboardClient initialTokens={tokens} />;
}
