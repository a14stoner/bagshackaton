export type IndexedTokenDiscoveredEvent = {
  kind: "token_discovered";
  mint: string;
  symbol: string;
  name: string;
  feeConfigAccount: string | null;
  totalSupply: string;
  slot: bigint;
  signature: string;
  occurredAt: Date;
};

export type IndexedFeeConfiguredEvent = {
  kind: "fee_configured";
  mint: string;
  feeConfigAccount: string;
  receivers: { wallet: string; allocationBps: number }[];
  slot: bigint;
  signature: string;
  occurredAt: Date;
};

export type IndexedSwapEvent = {
  kind: "swap";
  mint: string;
  signature: string;
  slot: bigint;
  traderWallet: string;
  side: "buy" | "sell";
  amountIn: string;
  amountOut: string;
  price: string;
  pool: "bonding_curve" | "damm";
  occurredAt: Date;
};

export type IndexedTransferEvent = {
  kind: "transfer";
  mint: string;
  signature: string;
  slot: bigint;
  fromWallet: string;
  toWallet: string;
  amount: string;
  occurredAt: Date;
};

export type IndexedMigrationEvent = {
  kind: "migration";
  mint: string;
  signature: string;
  slot: bigint;
  occurredAt: Date;
};

export type IndexedEvent =
  | IndexedTokenDiscoveredEvent
  | IndexedFeeConfiguredEvent
  | IndexedSwapEvent
  | IndexedTransferEvent
  | IndexedMigrationEvent;
