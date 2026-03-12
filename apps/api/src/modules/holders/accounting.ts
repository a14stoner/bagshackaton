import { calculateHoldScore, normalizeSellRatio } from "@bags/shared";

export type HolderState = {
  wallet: string;
  totalAcquired: number;
  currentBalance: number;
  totalSold: number;
  transferredOut: number;
  transferredIn: number;
  firstBuyTime: Date | null;
  lastActivityTime: Date | null;
  holdDurationHours: number;
  percentSupply: number;
  sellRatio: number;
  holdScore: number;
  wins: number;
  cooldownUntilDraw: number | null;
};

export type HolderLedgerEvent =
  | { type: "buy"; wallet: string; amount: number; occurredAt: Date }
  | { type: "sell"; wallet: string; amount: number; occurredAt: Date }
  | { type: "transfer_in"; wallet: string; amount: number; occurredAt: Date }
  | { type: "transfer_out"; wallet: string; amount: number; occurredAt: Date };

export function applyLedgerEvent(
  current: HolderState | undefined,
  event: HolderLedgerEvent,
  totalSupply: number,
  now: Date = event.occurredAt
): HolderState {
  const base: HolderState = current ?? {
    wallet: event.wallet,
    totalAcquired: 0,
    currentBalance: 0,
    totalSold: 0,
    transferredOut: 0,
    transferredIn: 0,
    firstBuyTime: null,
    lastActivityTime: null,
    holdDurationHours: 0,
    percentSupply: 0,
    sellRatio: 0,
    holdScore: 0,
    wins: 0,
    cooldownUntilDraw: null
  };

  if (event.type === "buy") {
    base.totalAcquired += event.amount;
    base.currentBalance += event.amount;
    base.firstBuyTime ??= event.occurredAt;
  }

  if (event.type === "sell") {
    base.totalSold += event.amount;
    base.currentBalance = Math.max(0, base.currentBalance - event.amount);
  }

  if (event.type === "transfer_in") {
    base.transferredIn += event.amount;
    base.totalAcquired += event.amount;
    base.currentBalance += event.amount;
    base.firstBuyTime ??= event.occurredAt;
  }

  if (event.type === "transfer_out") {
    base.transferredOut += event.amount;
    base.totalSold += event.amount;
    base.currentBalance = Math.max(0, base.currentBalance - event.amount);
  }

  base.lastActivityTime = event.occurredAt;
  base.holdDurationHours = base.firstBuyTime
    ? Math.max(0, (now.getTime() - base.firstBuyTime.getTime()) / 3_600_000)
    : 0;
  base.percentSupply = totalSupply > 0 ? base.currentBalance / totalSupply : 0;
  base.sellRatio = normalizeSellRatio(base.totalAcquired, base.totalSold);
  base.holdScore = calculateHoldScore({
    holdHours: base.holdDurationHours,
    percentSupply: base.percentSupply,
    sellRatio: base.sellRatio
  });

  return base;
}

export function refreshHolderState(
  current: HolderState,
  totalSupply: number,
  now: Date = new Date()
): HolderState {
  const next: HolderState = {
    ...current
  };

  next.holdDurationHours = next.firstBuyTime
    ? Math.max(0, (now.getTime() - next.firstBuyTime.getTime()) / 3_600_000)
    : 0;
  next.percentSupply = totalSupply > 0 ? next.currentBalance / totalSupply : 0;
  next.sellRatio = normalizeSellRatio(next.totalAcquired, next.totalSold);
  next.holdScore = calculateHoldScore({
    holdHours: next.holdDurationHours,
    percentSupply: next.percentSupply,
    sellRatio: next.sellRatio
  });

  return next;
}
