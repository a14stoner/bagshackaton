import { LeaderboardPageClient } from "../../components/leaderboard-page-client";
import { apiFetch } from "../../lib/api";

type Token = {
  mint: string;
  symbol: string;
  lifecycle_phase: "DISCOVERY" | "DBC" | "DAMM";
};

export default async function LeaderboardPage() {
  const tokens = await apiFetch<Token[]>("/tokens?trackedOnly=true").catch(() => []);
  return <LeaderboardPageClient tokens={tokens} />;
}
