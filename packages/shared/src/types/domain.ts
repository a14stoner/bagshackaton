import type { TokenLifecycleStatus } from "../protocol/meteora";

export type TokenRecord = {
  mint: string;
  symbol: string;
  name: string;
  creationSlot: bigint;
  status: TokenLifecycleStatus;
  feeConfigAccount: string | null;
  treasuryBalance: string;
  totalFeesGenerated: string;
  totalFeesDistributed: string;
  latestWinnerWallet: string | null;
  nextDrawAt: string | null;
};

export type HolderRecord = {
  wallet: string;
  tokenMint: string;
  totalAcquired: string;
  currentBalance: string;
  totalSold: string;
  transferredOut: string;
  transferredIn: string;
  firstBuyTime: string | null;
  lastActivityTime: string | null;
  holdDurationHours: number;
  percentSupply: number;
  sellRatio: number;
  holdScore: number;
  wins: number;
  cooldownUntilDraw: number | null;
};
