import { refreshHolderState, type HolderState } from "./accounting";
import { getTokenRuntimeByMint, listHoldersByMint, listTrackedTokensForDraws, saveHolderSnapshot } from "../../services/repositories";

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toDateOrNull(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toHolderState(row: any): HolderState {
  return {
    wallet: row.wallet,
    totalAcquired: toNumber(row.total_acquired),
    currentBalance: toNumber(row.current_balance),
    totalSold: toNumber(row.total_sold),
    transferredOut: toNumber(row.transferred_out),
    transferredIn: toNumber(row.transferred_in),
    firstBuyTime: toDateOrNull(row.first_buy_time),
    lastActivityTime: toDateOrNull(row.last_activity_time),
    holdDurationHours: toNumber(row.hold_duration_hours),
    percentSupply: toNumber(row.percent_supply),
    sellRatio: toNumber(row.sell_ratio),
    holdScore: toNumber(row.hold_score),
    wins: Number(row.wins ?? 0),
    cooldownUntilDraw: row.cooldown_until_draw === null || row.cooldown_until_draw === undefined ? null : Number(row.cooldown_until_draw)
  };
}

export async function refreshHolderStatsForToken(tokenMint: string, now = new Date()): Promise<void> {
  const tokenRuntime = await getTokenRuntimeByMint(tokenMint);
  if (!tokenRuntime) {
    return;
  }
  const totalSupply = toNumber(tokenRuntime.total_supply);
  const holders = await listHoldersByMint(tokenMint);
  for (const row of holders) {
    const refreshed = refreshHolderState(toHolderState(row), totalSupply, now);
    await saveHolderSnapshot({
      tokenMint,
      wallet: refreshed.wallet,
      totalAcquired: refreshed.totalAcquired.toString(),
      currentBalance: refreshed.currentBalance.toString(),
      totalSold: refreshed.totalSold.toString(),
      transferredOut: refreshed.transferredOut.toString(),
      transferredIn: refreshed.transferredIn.toString(),
      firstBuyTime: refreshed.firstBuyTime,
      lastActivityTime: refreshed.lastActivityTime,
      holdDurationHours: refreshed.holdDurationHours,
      percentSupply: refreshed.percentSupply,
      sellRatio: refreshed.sellRatio,
      holdScore: refreshed.holdScore,
      wins: refreshed.wins,
      cooldownUntilDraw: refreshed.cooldownUntilDraw
    });
  }
}

export async function refreshTrackedHolderStats(now = new Date()): Promise<void> {
  const tokens = await listTrackedTokensForDraws();
  for (const token of tokens) {
    await refreshHolderStatsForToken(token.mint, now);
  }
}
