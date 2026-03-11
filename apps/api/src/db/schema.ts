import {
  bigint,
  boolean,
  doublePrecision,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from "drizzle-orm/pg-core";

export const tokenStatusEnum = pgEnum("token_status", [
  "DISCOVERED",
  "TRACKED",
  "MIGRATED",
  "INACTIVE"
]);

export const eventTypeEnum = pgEnum("event_type", [
  "TOKEN_CREATED",
  "FEE_CONFIGURED",
  "BUY",
  "SELL",
  "TRANSFER",
  "MIGRATION",
  "DAMM_SWAP"
]);

export const tokens = pgTable("tokens", {
  mint: text("mint").primaryKey(),
  symbol: text("symbol").notNull(),
  name: text("name").notNull(),
  metadataUri: text("metadata_uri"),
  imageUri: text("image_uri"),
  metadataSyncedAt: timestamp("metadata_synced_at", { withTimezone: true }),
  creationSlot: bigint("creation_slot", { mode: "bigint" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  status: tokenStatusEnum("status").notNull().default("DISCOVERED"),
  feeConfigAccount: text("fee_config_account"),
  totalSupply: numeric("total_supply", { precision: 32, scale: 0 }).notNull(),
  treasuryBalance: numeric("treasury_balance", { precision: 32, scale: 9 }).notNull().default("0"),
  totalFeesGenerated: numeric("total_fees_generated", { precision: 32, scale: 9 }).notNull().default("0"),
  totalFeesDistributed: numeric("total_fees_distributed", { precision: 32, scale: 9 }).notNull().default("0"),
  latestWinnerWallet: text("latest_winner_wallet"),
  nextDrawAt: timestamp("next_draw_at", { withTimezone: true })
});

export const feeReceivers = pgTable(
  "fee_receivers",
  {
    tokenMint: text("token_mint").notNull().references(() => tokens.mint, { onDelete: "cascade" }),
    wallet: text("wallet").notNull(),
    resolvedWallet: text("resolved_wallet"),
    receiverType: text("receiver_type").notNull().default("wallet"),
    allocationBps: integer("allocation_bps").notNull(),
    isTarget: boolean("is_target").notNull().default(false)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tokenMint, table.wallet] })
  })
);

export const normalizedEvents = pgTable(
  "normalized_events",
  {
    id: text("id").primaryKey(),
    tokenMint: text("token_mint").notNull().references(() => tokens.mint, { onDelete: "cascade" }),
    type: eventTypeEnum("type").notNull(),
    signature: text("signature").notNull(),
    slot: bigint("slot", { mode: "bigint" }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").notNull()
  },
  (table) => ({
    signatureIdx: uniqueIndex("normalized_events_signature_type_idx").on(table.signature, table.type)
  })
);

export const swaps = pgTable("swaps", {
  id: text("id").primaryKey(),
  tokenMint: text("token_mint").notNull().references(() => tokens.mint, { onDelete: "cascade" }),
  signature: text("signature").notNull(),
  slot: bigint("slot", { mode: "bigint" }).notNull(),
  pool: text("pool").notNull(),
  side: text("side").notNull(),
  traderWallet: text("trader_wallet").notNull(),
  amountIn: numeric("amount_in", { precision: 32, scale: 9 }).notNull(),
  amountOut: numeric("amount_out", { precision: 32, scale: 9 }).notNull(),
  price: numeric("price", { precision: 32, scale: 12 }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull()
});

export const transfers = pgTable("transfers", {
  id: text("id").primaryKey(),
  tokenMint: text("token_mint").notNull().references(() => tokens.mint, { onDelete: "cascade" }),
  signature: text("signature").notNull(),
  slot: bigint("slot", { mode: "bigint" }).notNull(),
  fromWallet: text("from_wallet").notNull(),
  toWallet: text("to_wallet").notNull(),
  amount: numeric("amount", { precision: 32, scale: 9 }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull()
});

export const holders = pgTable(
  "holders",
  {
    tokenMint: text("token_mint").notNull().references(() => tokens.mint, { onDelete: "cascade" }),
    wallet: text("wallet").notNull(),
    totalAcquired: numeric("total_acquired", { precision: 32, scale: 9 }).notNull().default("0"),
    currentBalance: numeric("current_balance", { precision: 32, scale: 9 }).notNull().default("0"),
    totalSold: numeric("total_sold", { precision: 32, scale: 9 }).notNull().default("0"),
    transferredOut: numeric("transferred_out", { precision: 32, scale: 9 }).notNull().default("0"),
    transferredIn: numeric("transferred_in", { precision: 32, scale: 9 }).notNull().default("0"),
    firstBuyTime: timestamp("first_buy_time", { withTimezone: true }),
    lastActivityTime: timestamp("last_activity_time", { withTimezone: true }),
    holdDurationHours: doublePrecision("hold_duration_hours").notNull().default(0),
    percentSupply: doublePrecision("percent_supply").notNull().default(0),
    sellRatio: doublePrecision("sell_ratio").notNull().default(0),
    holdScore: doublePrecision("hold_score").notNull().default(0),
    wins: integer("wins").notNull().default(0),
    cooldownUntilDraw: integer("cooldown_until_draw")
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tokenMint, table.wallet] })
  })
);

export const holderScores = pgTable(
  "holder_scores",
  {
    tokenMint: text("token_mint").notNull().references(() => tokens.mint, { onDelete: "cascade" }),
    wallet: text("wallet").notNull(),
    drawNumber: integer("draw_number").notNull(),
    score: doublePrecision("score").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tokenMint, table.wallet, table.drawNumber] })
  })
);

export const draws = pgTable("draws", {
  id: text("id").primaryKey(),
  tokenMint: text("token_mint").notNull().references(() => tokens.mint, { onDelete: "cascade" }),
  drawNumber: integer("draw_number").notNull(),
  winnerWallet: text("winner_wallet"),
  score: doublePrecision("score"),
  rewardAmount: numeric("reward_amount", { precision: 32, scale: 9 }).notNull(),
  txSignature: text("tx_signature"),
  dryRun: boolean("dry_run").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const payouts = pgTable("payouts", {
  id: text("id").primaryKey(),
  drawId: text("draw_id").notNull().references(() => draws.id, { onDelete: "cascade" }),
  tokenMint: text("token_mint").notNull().references(() => tokens.mint, { onDelete: "cascade" }),
  winnerWallet: text("winner_wallet").notNull(),
  amount: numeric("amount", { precision: 32, scale: 9 }).notNull(),
  txSignature: text("tx_signature"),
  dryRun: boolean("dry_run").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull()
});

export const tokenClaimableState = pgTable("token_claimable_state", {
  tokenMint: text("token_mint").primaryKey().references(() => tokens.mint, { onDelete: "cascade" }),
  receiverWallet: text("receiver_wallet").notNull(),
  claimableLamports: numeric("claimable_lamports", { precision: 32, scale: 0 }).notNull().default("0"),
  claimableSol: numeric("claimable_sol", { precision: 32, scale: 9 }).notNull().default("0"),
  positionsCount: integer("positions_count").notNull().default(0),
  payload: jsonb("payload").notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull()
});

export const tokenClaimRuns = pgTable("token_claim_runs", {
  id: text("id").primaryKey(),
  tokenMint: text("token_mint").notNull().references(() => tokens.mint, { onDelete: "cascade" }),
  receiverWallet: text("receiver_wallet").notNull(),
  claimableLamports: numeric("claimable_lamports", { precision: 32, scale: 0 }).notNull(),
  claimableSol: numeric("claimable_sol", { precision: 32, scale: 9 }).notNull(),
  txCount: integer("tx_count").notNull().default(0),
  success: boolean("success").notNull().default(true),
  error: text("error"),
  responsePayload: jsonb("response_payload").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull()
});

export const indexerCheckpoint = pgTable("indexer_checkpoint", {
  id: text("id").primaryKey(),
  lastProcessedSlot: bigint("last_processed_slot", { mode: "bigint" }).notNull().default(0n),
  lastProcessedSignature: text("last_processed_signature"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});
