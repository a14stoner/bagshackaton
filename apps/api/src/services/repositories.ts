import { randomUUID } from "node:crypto";
import { pgPool } from "../db/client";
import { logger } from "./logger";

export type CreateTokenInput = {
  mint: string;
  symbol: string;
  name: string;
  metadataUri?: string | null;
  imageUri?: string | null;
  metadataSyncedAt?: Date | null;
  creationSlot: bigint;
  createdAt: Date;
  feeConfigAccount?: string | null;
  totalSupply: string;
  status?: "DISCOVERED" | "TRACKED" | "MIGRATED" | "INACTIVE";
};

export async function upsertToken(input: CreateTokenInput): Promise<void> {
  await pgPool.query(
    `INSERT INTO tokens (mint, symbol, name, metadata_uri, image_uri, metadata_synced_at, creation_slot, created_at, fee_config_account, total_supply, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (mint) DO UPDATE
     SET symbol = COALESCE(NULLIF(EXCLUDED.symbol, 'UNKNOWN'), tokens.symbol),
          name = COALESCE(NULLIF(EXCLUDED.name, 'Migrated Token'), tokens.name),
          metadata_uri = COALESCE(EXCLUDED.metadata_uri, tokens.metadata_uri),
          image_uri = COALESCE(EXCLUDED.image_uri, tokens.image_uri),
          metadata_synced_at = COALESCE(EXCLUDED.metadata_synced_at, tokens.metadata_synced_at),
          fee_config_account = COALESCE(EXCLUDED.fee_config_account, tokens.fee_config_account),
          total_supply = COALESCE(EXCLUDED.total_supply, tokens.total_supply),
          status = CASE
           WHEN tokens.status = 'MIGRATED' THEN 'MIGRATED'
           WHEN EXCLUDED.status = 'MIGRATED' THEN 'MIGRATED'
           WHEN tokens.status = 'TRACKED' AND EXCLUDED.status = 'DISCOVERED' THEN 'TRACKED'
           WHEN EXCLUDED.status = 'TRACKED' THEN 'TRACKED'
           ELSE EXCLUDED.status
         END`,
    [
      input.mint,
      input.symbol,
      input.name,
      input.metadataUri ?? null,
      input.imageUri ?? null,
      input.metadataSyncedAt ?? null,
      input.creationSlot.toString(),
      input.createdAt,
      input.feeConfigAccount ?? null,
      input.totalSupply,
      input.status ?? "DISCOVERED"
    ]
  );
}

export async function replaceFeeReceivers(input: {
  tokenMint: string;
  receivers: {
    wallet: string;
    allocationBps: number;
    isTarget: boolean;
    resolvedWallet?: string | null;
    receiverType?: string;
  }[];
}): Promise<void> {
  const client = await pgPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM fee_receivers WHERE token_mint = $1", [input.tokenMint]);
    for (const receiver of input.receivers) {
      await client.query(
        "INSERT INTO fee_receivers (token_mint, wallet, resolved_wallet, receiver_type, allocation_bps, is_target) VALUES ($1,$2,$3,$4,$5,$6)",
        [
          input.tokenMint,
          receiver.wallet,
          receiver.resolvedWallet ?? null,
          receiver.receiverType ?? "wallet",
          receiver.allocationBps,
          receiver.isTarget
        ]
      );
    }
    await client.query(
      `UPDATE tokens
       SET status = CASE
         WHEN EXISTS (SELECT 1 FROM fee_receivers WHERE token_mint = $1 AND is_target = TRUE) THEN 'TRACKED'
         ELSE status
       END
       WHERE mint = $1`,
      [input.tokenMint]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function hasTargetFeeReceiver(tokenMint: string): Promise<boolean> {
  const result = await pgPool.query(
    `SELECT EXISTS (
      SELECT 1
      FROM fee_receivers
      WHERE token_mint = $1
        AND is_target = TRUE
    ) AS is_tracked`,
    [tokenMint]
  );
  return Boolean(result.rows[0]?.is_tracked);
}

export async function insertNormalizedEvent(input: {
  id?: string;
  tokenMint: string;
  type: string;
  signature: string;
  slot: bigint;
  occurredAt: Date;
  payload: unknown;
}): Promise<boolean> {
  const id = input.id ?? randomUUID();
  const payload = normalizeJsonValue(input.payload);
  const result = await pgPool.query(
    `INSERT INTO normalized_events (id, token_mint, type, signature, slot, occurred_at, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT DO NOTHING`,
    [id, input.tokenMint, input.type, input.signature, input.slot.toString(), input.occurredAt, payload]
  );
  return (result.rowCount ?? 0) > 0;
}

function normalizeJsonValue(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, currentValue) =>
      typeof currentValue === "bigint" ? currentValue.toString() : currentValue
    )
  );
}

export async function upsertCheckpoint(id: string, slot: bigint, signature: string | null): Promise<void> {
  await pgPool.query(
    `INSERT INTO indexer_checkpoint (id, last_processed_slot, last_processed_signature, updated_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (id) DO UPDATE
     SET last_processed_slot = EXCLUDED.last_processed_slot,
         last_processed_signature = EXCLUDED.last_processed_signature,
         updated_at = NOW()`,
    [id, slot.toString(), signature]
  );
}

export async function getCheckpoint(id: string): Promise<{ lastProcessedSlot: bigint; lastProcessedSignature: string | null } | null> {
  const result = await pgPool.query(
    `SELECT last_processed_slot, last_processed_signature
     FROM indexer_checkpoint
     WHERE id = $1
     LIMIT 1`,
    [id]
  );
  if (!result.rows[0]) {
    return null;
  }
  return {
    lastProcessedSlot: BigInt(result.rows[0].last_processed_slot),
    lastProcessedSignature: result.rows[0].last_processed_signature ?? null
  };
}

export async function insertSwap(input: {
  id: string;
  tokenMint: string;
  signature: string;
  slot: bigint;
  pool: string;
  side: string;
  traderWallet: string;
  amountIn: string;
  amountOut: string;
  price: string;
  occurredAt: Date;
}): Promise<void> {
  await pgPool.query(
    `INSERT INTO swaps (id, token_mint, signature, slot, pool, side, trader_wallet, amount_in, amount_out, price, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO NOTHING`,
    [
      input.id,
      input.tokenMint,
      input.signature,
      input.slot.toString(),
      input.pool,
      input.side,
      input.traderWallet,
      input.amountIn,
      input.amountOut,
      input.price,
      input.occurredAt
    ]
  );
}

export async function insertTransfer(input: {
  id: string;
  tokenMint: string;
  signature: string;
  slot: bigint;
  fromWallet: string;
  toWallet: string;
  amount: string;
  occurredAt: Date;
}): Promise<void> {
  await pgPool.query(
    `INSERT INTO transfers (id, token_mint, signature, slot, from_wallet, to_wallet, amount, occurred_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO NOTHING`,
    [
      input.id,
      input.tokenMint,
      input.signature,
      input.slot.toString(),
      input.fromWallet,
      input.toWallet,
      input.amount,
      input.occurredAt
    ]
  );
}

export async function listTokens(trackedOnly = true) {
  const whereClause = trackedOnly
    ? `WHERE EXISTS (
         SELECT 1
         FROM fee_receivers fr
         WHERE fr.token_mint = t.mint
           AND fr.is_target = TRUE
       )`
    : "";
  const result = await pgPool.query(
    `SELECT t.mint,
            t.symbol,
            t.name,
            t.metadata_uri,
            t.image_uri,
            t.metadata_synced_at,
            t.creation_slot,
            t.status,
            t.fee_config_account,
            COALESCE(hc.holder_count, 0) AS holder_count,
            COALESCE(ls.pool, NULL) AS latest_pool,
            CASE
              WHEN t.status = 'MIGRATED' OR ls.pool = 'damm' THEN 'DAMM'
              WHEN ls.pool = 'bonding_curve' THEN 'DBC'
              ELSE 'DISCOVERY'
            END AS lifecycle_phase,
            t.treasury_balance,
            t.total_fees_generated,
            t.total_fees_claimed,
            t.total_fees_distributed,
            t.latest_winner_wallet,
            t.next_draw_at,
            COALESCE(tcs.claimable_sol, 0) AS claimable_sol,
            COALESCE(tcs.claimable_lamports, 0) AS claimable_lamports,
            COALESCE(tcs.positions_count, 0) AS claimable_positions_count,
            tcs.last_synced_at AS claimable_last_synced_at,
            tcr.claimable_sol AS last_claim_request_sol,
            tcr.claimed_sol AS last_claimed_sol,
            tcr.tx_count AS last_claim_request_tx_count,
            tcr.requested_at AS last_claim_request_at
     FROM tokens t
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS holder_count
       FROM holders
       WHERE token_mint = t.mint
     ) hc ON TRUE
     LEFT JOIN token_claimable_state tcs ON tcs.token_mint = t.mint
     LEFT JOIN LATERAL (
       SELECT pool
       FROM swaps
       WHERE token_mint = t.mint
       ORDER BY occurred_at DESC
       LIMIT 1
     ) ls ON TRUE
     LEFT JOIN LATERAL (
        SELECT claimable_sol, claimed_sol, tx_count, requested_at
        FROM token_claim_runs
       WHERE token_mint = t.mint AND success = TRUE
       ORDER BY requested_at DESC
       LIMIT 1
     ) tcr ON TRUE
     ${whereClause}
     ORDER BY t.created_at DESC`
  );
  return result.rows;
}

export async function getTokenByMint(mint: string) {
  const result = await pgPool.query(
    `SELECT t.mint,
            t.symbol,
            t.name,
            t.metadata_uri,
            t.image_uri,
            t.metadata_synced_at,
            t.creation_slot,
            t.status,
            t.fee_config_account,
            COALESCE(hc.holder_count, 0) AS holder_count,
            COALESCE(ls.pool, NULL) AS latest_pool,
            CASE
              WHEN t.status = 'MIGRATED' OR ls.pool = 'damm' THEN 'DAMM'
              WHEN ls.pool = 'bonding_curve' THEN 'DBC'
              ELSE 'DISCOVERY'
            END AS lifecycle_phase,
            t.total_supply,
            t.treasury_balance,
            t.total_fees_generated,
            t.total_fees_claimed,
            t.total_fees_distributed,
            t.latest_winner_wallet,
            t.next_draw_at,
            COALESCE(tcs.claimable_sol, 0) AS claimable_sol,
            COALESCE(tcs.claimable_lamports, 0) AS claimable_lamports,
            COALESCE(tcs.positions_count, 0) AS claimable_positions_count,
            tcs.last_synced_at AS claimable_last_synced_at,
            tcr.claimable_sol AS last_claim_request_sol,
            tcr.claimed_sol AS last_claimed_sol,
            tcr.tx_count AS last_claim_request_tx_count,
            tcr.requested_at AS last_claim_request_at
     FROM tokens t
     LEFT JOIN LATERAL (
       SELECT COUNT(*)::int AS holder_count
       FROM holders
       WHERE token_mint = t.mint
     ) hc ON TRUE
     LEFT JOIN token_claimable_state tcs ON tcs.token_mint = t.mint
     LEFT JOIN LATERAL (
       SELECT pool
       FROM swaps
       WHERE token_mint = t.mint
       ORDER BY occurred_at DESC
       LIMIT 1
     ) ls ON TRUE
     LEFT JOIN LATERAL (
        SELECT claimable_sol, claimed_sol, tx_count, requested_at
        FROM token_claim_runs
       WHERE token_mint = t.mint AND success = TRUE
       ORDER BY requested_at DESC
       LIMIT 1
     ) tcr ON TRUE
     WHERE t.mint = $1`,
    [mint]
  );
  return result.rows[0] ?? null;
}

export async function listTokensForMetadataSync(limit: number) {
  const result = await pgPool.query(
    `SELECT mint
     FROM tokens
     WHERE metadata_uri IS NULL
       OR metadata_synced_at IS NULL
       OR symbol = 'UNKNOWN'
       OR name = 'Bags Token'
       OR name = 'Unresolved Bags Token'
     ORDER BY metadata_synced_at NULLS FIRST, created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows as Array<{ mint: string }>;
}

export async function updateTokenMetadata(input: {
  mint: string;
  name: string | null;
  symbol: string | null;
  metadataUri: string | null;
  imageUri: string | null;
  totalSupply?: string | null;
  metadataSyncedAt: Date;
}) {
  await pgPool.query(
    `UPDATE tokens
     SET name = COALESCE(NULLIF($2, ''), name),
         symbol = COALESCE(NULLIF($3, ''), symbol),
         metadata_uri = COALESCE($4, metadata_uri),
         image_uri = COALESCE($5, image_uri),
         total_supply = COALESCE($6, total_supply),
         metadata_synced_at = $7
     WHERE mint = $1`,
    [input.mint, input.name, input.symbol, input.metadataUri, input.imageUri, input.totalSupply ?? null, input.metadataSyncedAt]
  );
}

export async function listTrackedTokenMints() {
  const result = await pgPool.query(
    `SELECT DISTINCT t.mint, t.symbol
     FROM tokens t
     INNER JOIN fee_receivers fr
       ON fr.token_mint = t.mint
      AND fr.is_target = TRUE
     ORDER BY t.mint ASC`
  );
  return result.rows as Array<{ mint: string; symbol: string }>;
}

export async function listTrackedTokensForDraws() {
  const result = await pgPool.query(
    `SELECT DISTINCT t.mint, t.symbol, t.treasury_balance, t.total_supply, t.next_draw_at
     FROM tokens t
     INNER JOIN fee_receivers fr
       ON fr.token_mint = t.mint
      AND fr.is_target = TRUE
     ORDER BY t.mint ASC`
  );
  return result.rows as Array<{ mint: string; symbol: string; treasury_balance: string; total_supply: string; next_draw_at: Date | null }>;
}

export async function upsertTokenClaimableState(input: {
  tokenMint: string;
  receiverWallet: string;
  claimableLamports: string;
  claimableSol: string;
  positionsCount: number;
  payload: unknown;
  lastSyncedAt: Date;
}): Promise<void> {
  const payload = normalizeJsonValue(input.payload);
  await pgPool.query(
    `INSERT INTO token_claimable_state (
      token_mint, receiver_wallet, claimable_lamports, claimable_sol, positions_count, payload, last_synced_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (token_mint) DO UPDATE SET
      receiver_wallet = EXCLUDED.receiver_wallet,
      claimable_lamports = EXCLUDED.claimable_lamports,
      claimable_sol = EXCLUDED.claimable_sol,
      positions_count = EXCLUDED.positions_count,
      payload = EXCLUDED.payload,
      last_synced_at = EXCLUDED.last_synced_at`,
    [
      input.tokenMint,
      input.receiverWallet,
      input.claimableLamports,
      input.claimableSol,
      input.positionsCount,
      payload,
      input.lastSyncedAt
    ]
  );
}

export async function getTokenClaimableState(tokenMint: string) {
  const result = await pgPool.query(
    `SELECT token_mint, claimable_lamports, claimable_sol, last_synced_at
     FROM token_claimable_state
     WHERE token_mint = $1
     LIMIT 1`,
    [tokenMint]
  );
  return result.rows[0] ?? null;
}

export async function createTokenClaimRun(input: {
  id: string;
  tokenMint: string;
  receiverWallet: string;
  claimableLamports: string;
  claimableSol: string;
  claimedLamports: string;
  claimedSol: string;
  txCount: number;
  txSignatures: string[];
  success: boolean;
  error: string | null;
  responsePayload: unknown;
  requestedAt: Date;
}): Promise<void> {
  const responsePayload = normalizeJsonValue(input.responsePayload);
  const txSignatures = normalizeJsonValue(input.txSignatures);
  await pgPool.query(
    `INSERT INTO token_claim_runs (
      id, token_mint, receiver_wallet, claimable_lamports, claimable_sol, claimed_lamports, claimed_sol, tx_count, tx_signatures, success, error, response_payload, requested_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      input.id,
      input.tokenMint,
      input.receiverWallet,
      input.claimableLamports,
      input.claimableSol,
      input.claimedLamports,
      input.claimedSol,
      input.txCount,
      txSignatures,
      input.success,
      input.error,
      responsePayload,
      input.requestedAt
    ]
  );
}

export async function listHoldersByMint(mint: string) {
  const result = await pgPool.query(
    `SELECT wallet, token_mint, total_acquired, current_balance, total_sold, transferred_out, transferred_in,
            first_buy_time, last_activity_time, hold_duration_hours, percent_supply, sell_ratio, hold_score, wins, cooldown_until_draw
     FROM holders WHERE token_mint = $1 ORDER BY hold_score DESC, current_balance DESC`,
    [mint]
  );
  return result.rows;
}

export async function listHoldersByMintPaged(input: {
  mint: string;
  limit: number;
  offset: number;
  search: string | null;
  sortBy: "hold_score" | "percent_supply" | "current_balance" | "hold_duration_hours" | "sell_ratio" | "first_buy_time";
  sortOrder: "asc" | "desc";
}) {
  const sortColumnMap: Record<typeof input.sortBy, string> = {
    hold_score: "hold_score",
    percent_supply: "percent_supply",
    current_balance: "current_balance",
    hold_duration_hours: "hold_duration_hours",
    sell_ratio: "sell_ratio",
    first_buy_time: "first_buy_time"
  };
  const sortColumn = sortColumnMap[input.sortBy] ?? "hold_score";
  const sortOrder = input.sortOrder === "asc" ? "ASC" : "DESC";
  const result = await pgPool.query(
    `SELECT wallet, token_mint, total_acquired, current_balance, total_sold, transferred_out, transferred_in,
            first_buy_time, last_activity_time, hold_duration_hours, percent_supply, sell_ratio, hold_score, wins, cooldown_until_draw,
            COUNT(*) OVER()::int AS total_count
     FROM holders
     WHERE token_mint = $1
       AND ($2::text IS NULL OR wallet ILIKE '%' || $2 || '%')
     ORDER BY ${sortColumn} ${sortOrder}, wallet ASC
     LIMIT $3 OFFSET $4`,
    [input.mint, input.search, input.limit, input.offset]
  );
  return result.rows;
}

export async function listDrawsByMint(mint: string) {
  const result = await pgPool.query(
    `SELECT id, token_mint, draw_number, winner_wallet, score, reward_amount, tx_signature, dry_run, created_at
     FROM draws WHERE token_mint = $1 ORDER BY draw_number DESC`,
    [mint]
  );
  return result.rows;
}

export async function listRecentDraws(limit: number) {
  const result = await pgPool.query(
    `SELECT id, token_mint, draw_number, winner_wallet, score, reward_amount, tx_signature, dry_run, created_at
     FROM draws
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

export async function getLatestWinnerByMint(mint: string) {
  const result = await pgPool.query(
    `SELECT id, token_mint, draw_number, winner_wallet, score, reward_amount, tx_signature, dry_run, created_at
     FROM draws WHERE token_mint = $1 AND winner_wallet IS NOT NULL ORDER BY draw_number DESC LIMIT 1`,
    [mint]
  );
  return result.rows[0] ?? null;
}

export async function getIndexerState() {
  const [checkpoint, eventCount] = await Promise.all([
    pgPool.query("SELECT * FROM indexer_checkpoint ORDER BY updated_at DESC LIMIT 1"),
    pgPool.query("SELECT COUNT(*)::int AS count FROM normalized_events")
  ]);
  return {
    checkpoint: checkpoint.rows[0] ?? null,
    normalizedEventCount: eventCount.rows[0]?.count ?? 0
  };
}

export async function healthcheck() {
  await pgPool.query("SELECT 1");
  return { ok: true };
}

export async function updateTokenTreasury(input: {
  tokenMint: string;
  generatedFeesDelta?: string | null;
  claimedFeesDelta?: string | null;
  distributedFeesDelta?: string | null;
  treasuryBalance?: string | null;
  treasuryBalanceDelta?: string | null;
  latestWinnerWallet?: string | null;
  nextDrawAt?: Date | null;
}): Promise<void> {
  await pgPool.query(
    `UPDATE tokens
     SET total_fees_generated = total_fees_generated + COALESCE($2, 0),
         total_fees_claimed = total_fees_claimed + COALESCE($3, 0),
         total_fees_distributed = total_fees_distributed + COALESCE($4, 0),
         treasury_balance = COALESCE($5, treasury_balance + COALESCE($6, 0)),
         latest_winner_wallet = COALESCE($7, latest_winner_wallet),
         next_draw_at = COALESCE($8, next_draw_at)
     WHERE mint = $1`,
    [
      input.tokenMint,
      input.generatedFeesDelta ?? null,
      input.claimedFeesDelta ?? null,
      input.distributedFeesDelta ?? null,
      input.treasuryBalance ?? null,
      input.treasuryBalanceDelta ?? null,
      input.latestWinnerWallet ?? null,
      input.nextDrawAt ?? null
    ]
  );
}

export async function getTokenRuntimeByMint(tokenMint: string) {
  const result = await pgPool.query(
    `SELECT mint, total_supply, treasury_balance, next_draw_at
     FROM tokens
     WHERE mint = $1
     LIMIT 1`,
    [tokenMint]
  );
  return result.rows[0] ?? null;
}

export async function saveHolderSnapshot(input: {
  tokenMint: string;
  wallet: string;
  totalAcquired: string;
  currentBalance: string;
  totalSold: string;
  transferredOut: string;
  transferredIn: string;
  firstBuyTime: Date | null;
  lastActivityTime: Date | null;
  holdDurationHours: number;
  percentSupply: number;
  sellRatio: number;
  holdScore: number;
  wins?: number;
  cooldownUntilDraw?: number | null;
}): Promise<void> {
  await pgPool.query(
    `INSERT INTO holders (
      token_mint, wallet, total_acquired, current_balance, total_sold, transferred_out, transferred_in,
      first_buy_time, last_activity_time, hold_duration_hours, percent_supply, sell_ratio, hold_score, wins, cooldown_until_draw
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
    ON CONFLICT (token_mint, wallet) DO UPDATE SET
      total_acquired = EXCLUDED.total_acquired,
      current_balance = EXCLUDED.current_balance,
      total_sold = EXCLUDED.total_sold,
      transferred_out = EXCLUDED.transferred_out,
      transferred_in = EXCLUDED.transferred_in,
      first_buy_time = EXCLUDED.first_buy_time,
      last_activity_time = EXCLUDED.last_activity_time,
      hold_duration_hours = EXCLUDED.hold_duration_hours,
      percent_supply = EXCLUDED.percent_supply,
      sell_ratio = EXCLUDED.sell_ratio,
      hold_score = EXCLUDED.hold_score,
      wins = COALESCE(holders.wins, 0),
      cooldown_until_draw = COALESCE(EXCLUDED.cooldown_until_draw, holders.cooldown_until_draw)`,
    [
      input.tokenMint,
      input.wallet,
      input.totalAcquired,
      input.currentBalance,
      input.totalSold,
      input.transferredOut,
      input.transferredIn,
      input.firstBuyTime,
      input.lastActivityTime,
      input.holdDurationHours,
      input.percentSupply,
      input.sellRatio,
      input.holdScore,
      input.wins ?? 0,
      input.cooldownUntilDraw ?? null
    ]
  );
}

export async function saveHolderScore(input: {
  tokenMint: string;
  wallet: string;
  drawNumber: number;
  score: number;
  computedAt: Date;
}): Promise<void> {
  await pgPool.query(
    `INSERT INTO holder_scores (token_mint, wallet, draw_number, score, computed_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (token_mint, wallet, draw_number) DO UPDATE SET score = EXCLUDED.score, computed_at = EXCLUDED.computed_at`,
    [input.tokenMint, input.wallet, input.drawNumber, input.score, input.computedAt]
  );
}

export async function createDraw(input: {
  id: string;
  tokenMint: string;
  drawNumber: number;
  winnerWallet: string | null;
  score: number | null;
  rewardAmount: string;
  txSignature: string | null;
  dryRun: boolean;
  createdAt: Date;
}): Promise<void> {
  await pgPool.query(
    `INSERT INTO draws (id, token_mint, draw_number, winner_wallet, score, reward_amount, tx_signature, dry_run, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.id,
      input.tokenMint,
      input.drawNumber,
      input.winnerWallet,
      input.score,
      input.rewardAmount,
      input.txSignature,
      input.dryRun,
      input.createdAt
    ]
  );
}

export async function createPayout(input: {
  id: string;
  drawId: string;
  tokenMint: string;
  winnerWallet: string;
  amount: string;
  txSignature: string | null;
  dryRun: boolean;
  createdAt: Date;
}): Promise<void> {
  await pgPool.query(
    `INSERT INTO payouts (id, draw_id, token_mint, winner_wallet, amount, tx_signature, dry_run, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      input.id,
      input.drawId,
      input.tokenMint,
      input.winnerWallet,
      input.amount,
      input.txSignature,
      input.dryRun,
      input.createdAt
    ]
  );
}

export async function getNextDrawNumber(tokenMint: string): Promise<number> {
  const result = await pgPool.query(
    "SELECT COALESCE(MAX(draw_number), 0) + 1 AS next_draw FROM draws WHERE token_mint = $1",
    [tokenMint]
  );
  return Number(result.rows[0]?.next_draw ?? 1);
}

export async function incrementHolderWin(tokenMint: string, wallet: string, cooldownUntilDraw: number): Promise<void> {
  await pgPool.query(
    "UPDATE holders SET wins = wins + 1, cooldown_until_draw = $3 WHERE token_mint = $1 AND wallet = $2",
    [tokenMint, wallet, cooldownUntilDraw]
  );
  logger.info({ tokenMint, wallet, cooldownUntilDraw }, "Updated winner cooldown");
}
