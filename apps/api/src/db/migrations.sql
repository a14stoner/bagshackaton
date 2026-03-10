DO $$ BEGIN
  CREATE TYPE token_status AS ENUM ('DISCOVERED', 'TRACKED', 'MIGRATED', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE event_type AS ENUM ('TOKEN_CREATED', 'FEE_CONFIGURED', 'BUY', 'SELL', 'TRANSFER', 'MIGRATION', 'DAMM_SWAP');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS tokens (
  mint TEXT PRIMARY KEY,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  metadata_uri TEXT,
  image_uri TEXT,
  metadata_synced_at TIMESTAMPTZ,
  creation_slot BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  status token_status NOT NULL DEFAULT 'DISCOVERED',
  fee_config_account TEXT,
  total_supply NUMERIC(32, 0) NOT NULL,
  treasury_balance NUMERIC(32, 9) NOT NULL DEFAULT 0,
  total_fees_generated NUMERIC(32, 9) NOT NULL DEFAULT 0,
  total_fees_distributed NUMERIC(32, 9) NOT NULL DEFAULT 0,
  latest_winner_wallet TEXT,
  next_draw_at TIMESTAMPTZ
);

ALTER TABLE tokens ADD COLUMN IF NOT EXISTS metadata_uri TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS image_uri TEXT;
ALTER TABLE tokens ADD COLUMN IF NOT EXISTS metadata_synced_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS fee_receivers (
  token_mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  allocation_bps INTEGER NOT NULL,
  is_target BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (token_mint, wallet)
);

CREATE TABLE IF NOT EXISTS normalized_events (
  id TEXT PRIMARY KEY,
  token_mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  type event_type NOT NULL,
  signature TEXT NOT NULL,
  slot BIGINT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS normalized_events_signature_type_idx
ON normalized_events(signature, type);

CREATE TABLE IF NOT EXISTS swaps (
  id TEXT PRIMARY KEY,
  token_mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  slot BIGINT NOT NULL,
  pool TEXT NOT NULL,
  side TEXT NOT NULL,
  trader_wallet TEXT NOT NULL,
  amount_in NUMERIC(32, 9) NOT NULL,
  amount_out NUMERIC(32, 9) NOT NULL,
  price NUMERIC(32, 12) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  token_mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  slot BIGINT NOT NULL,
  from_wallet TEXT NOT NULL,
  to_wallet TEXT NOT NULL,
  amount NUMERIC(32, 9) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS holders (
  token_mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  total_acquired NUMERIC(32, 9) NOT NULL DEFAULT 0,
  current_balance NUMERIC(32, 9) NOT NULL DEFAULT 0,
  total_sold NUMERIC(32, 9) NOT NULL DEFAULT 0,
  transferred_out NUMERIC(32, 9) NOT NULL DEFAULT 0,
  transferred_in NUMERIC(32, 9) NOT NULL DEFAULT 0,
  first_buy_time TIMESTAMPTZ,
  last_activity_time TIMESTAMPTZ,
  hold_duration_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
  percent_supply DOUBLE PRECISION NOT NULL DEFAULT 0,
  sell_ratio DOUBLE PRECISION NOT NULL DEFAULT 0,
  hold_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  cooldown_until_draw INTEGER,
  PRIMARY KEY (token_mint, wallet)
);

CREATE TABLE IF NOT EXISTS holder_scores (
  token_mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  wallet TEXT NOT NULL,
  draw_number INTEGER NOT NULL,
  score DOUBLE PRECISION NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (token_mint, wallet, draw_number)
);

CREATE TABLE IF NOT EXISTS draws (
  id TEXT PRIMARY KEY,
  token_mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  draw_number INTEGER NOT NULL,
  winner_wallet TEXT,
  score DOUBLE PRECISION,
  reward_amount NUMERIC(32, 9) NOT NULL,
  tx_signature TEXT,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  draw_id TEXT NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  token_mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  winner_wallet TEXT NOT NULL,
  amount NUMERIC(32, 9) NOT NULL,
  tx_signature TEXT,
  dry_run BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS token_claimable_state (
  token_mint TEXT PRIMARY KEY REFERENCES tokens(mint) ON DELETE CASCADE,
  receiver_wallet TEXT NOT NULL,
  claimable_lamports NUMERIC(32, 0) NOT NULL DEFAULT 0,
  claimable_sol NUMERIC(32, 9) NOT NULL DEFAULT 0,
  positions_count INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  last_synced_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS token_claim_runs (
  id TEXT PRIMARY KEY,
  token_mint TEXT NOT NULL REFERENCES tokens(mint) ON DELETE CASCADE,
  receiver_wallet TEXT NOT NULL,
  claimable_lamports NUMERIC(32, 0) NOT NULL,
  claimable_sol NUMERIC(32, 9) NOT NULL,
  tx_count INTEGER NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error TEXT,
  response_payload JSONB NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS indexer_checkpoint (
  id TEXT PRIMARY KEY,
  last_processed_slot BIGINT NOT NULL DEFAULT 0,
  last_processed_signature TEXT,
  updated_at TIMESTAMPTZ NOT NULL
);
