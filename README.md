# Bags Holder Rewards Platform

Full-stack Bags hackathon project for indexing Bags launches on Meteora, filtering tracked fee-share receivers, computing holder scores, and running periodic holder reward draws.

## Architecture

- `apps/api`: Fastify API, indexer service skeleton, holder accounting, reward engine, migrations, tests.
  - Includes periodic Bags fee-share sync for tracked tokens (`claimable-positions` and `claim-txs/v3`).
- `apps/web`: Next.js dashboard for tracked tokens, treasury, winners, and holder leaderboard.
- `packages/shared`: Shared domain types, protocol helpers, hold score math, weighted winner logic.
- `packages/ui`: Reusable presentation components for the dashboard.

## Indexer Design

The backend is structured for a hybrid indexer:

- Live mode consumes Yellowstone gRPC transactions from Bags/Meteora programs.
- Decoding output is normalized into `normalized_events` to support duplicate protection and replay-safe processing.
- Holder balances and score snapshots are derived from normalized swaps and transfers.

Current repository state provides the production-oriented processing pipeline and persistence contract, with protocol decoding isolated in `apps/api/src/indexer`.

## Database Schema

Core tables:

- `tokens`
- `fee_receivers`
- `normalized_events`
- `swaps`
- `transfers`
- `holders`
- `holder_scores`
- `draws`
- `payouts`
- `token_claimable_state`
- `token_claim_runs`
- `indexer_checkpoint`

The SQL migration lives at [apps/api/src/db/migrations.sql](/c:/Dateiablage/CODE_WORKSPACE/NEWBAGPLAY/apps/api/src/db/migrations.sql).

## Hold Score Formula

`score = holdHours * sqrt(percentSupply) * 10 * (1 - sqrt(sellRatio))^2`

Rules implemented:

- `sellRatio = sold / totalAcquired`
- Transfers out count as sold
- `sellRatio = 1` yields `score = 0`

Reference implementation: [hold-score.ts](/c:/Dateiablage/CODE_WORKSPACE/NEWBAGPLAY/packages/shared/src/math/hold-score.ts)

## Reward Engine

- Draw interval uses `DRAW_INTERVAL_MINUTES`
- Cooldown uses `WINNER_COOLDOWN_DRAWS`
- Reward size is randomized between `REWARD_PERCENT_MIN` and `REWARD_PERCENT_MAX`
- Holders with score `<= 0` are excluded
- Cooldown winners are excluded until their cooldown expires
- Draw and payout history are persisted

Engine entry point: [reward-engine.ts](/c:/Dateiablage/CODE_WORKSPACE/NEWBAGPLAY/apps/api/src/modules/draws/reward-engine.ts)

## Local Setup

1. Copy `.env.example` to `.env`.
2. Install dependencies with `pnpm install`.
3. Run the backend with `pnpm --filter @bags/api dev`.
4. Run the frontend with `pnpm --filter @bags/web dev`.

## Docker Setup

1. Ensure `.env` exists.
2. Start services with `docker compose up --build`.
3. The API will be available at `http://localhost:4000`.

Compose file: [docker-compose.yml](/c:/Dateiablage/CODE_WORKSPACE/NEWBAGPLAY/docker-compose.yml)

## Environment Variables

- `RPC_URL`
- `GRPC_ENDPOINT`
- `GRPC_TOKEN`
- `GRPC_COMMITMENT`
- `INDEXER_PROGRAM_INCLUDE`
- `INDEXER_INDEX_ALL_SWAPS`
- `INDEXER_SUPPRESS_PROCESSING_ERRORS`
- `TARGET_FEE_RECEIVER_WALLET`
- `BAGS_API_BASE_URL`
- `BAGS_API_KEY`
- `CLAIM_SYNC_INTERVAL_SECONDS`
- `CLAIM_REQUEST_TRANSACTIONS`
- `TOKEN_METADATA_SYNC_INTERVAL_SECONDS`
- `TOKEN_METADATA_SYNC_BATCH_SIZE`
- `DATABASE_URL`
- `REDIS_URL`
- `DRAW_INTERVAL_MINUTES`
- `WINNER_COOLDOWN_DRAWS`
- `REWARD_PERCENT_MIN`
- `REWARD_PERCENT_MAX`
- `REWARD_DRY_RUN`
- `REWARD_PAYER_SECRET_KEY`
- `PORT`
- `NEXT_PUBLIC_API_URL`

## Testing

Run:

```bash
pnpm --filter @bags/api test
pnpm --filter @bags/shared test
```

Included coverage targets:

- Hold score formula
- Sell ratio logic
- Holder accounting
- Winner selection
- Cooldown logic
- Event ingestion idempotency foundations through normalized event keys

## Deployment

- Deploy `apps/web` to Vercel with `NEXT_PUBLIC_API_URL` pointing to the API.
- Deploy `apps/api` to a Node/Docker host with PostgreSQL and Redis.
- Point the API at a mainnet Solana RPC endpoint.
- Run the indexer and draw scheduler as part of the API process or split them into dedicated workers.

## Reviewer Notes

- The codebase is organized to keep protocol-specific decoding separate from business logic.
- Shared math and selection logic are isolated for deterministic testing.
- The current indexer layer is scaffolded for Bags/Meteora production indexing without hard-coding a single unstable RPC strategy into the domain layer.
