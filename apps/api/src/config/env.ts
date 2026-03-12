import "dotenv/config";
import { z } from "zod";

const booleanFromEnv = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no", "off"].includes(normalized)) {
        return false;
      }
    }
    return value;
  }, z.boolean().default(defaultValue));

const envSchema = z.object({
  RPC_URL: z.string().url(),
  GRPC_ENDPOINT: z.string().default("http://grpc.solanavibestation.com:10000"),
  GRPC_TOKEN: z.string().default(""),
  GRPC_COMMITMENT: z.enum(["PROCESSED", "CONFIRMED", "FINALIZED"]).default("CONFIRMED"),
  INDEXER_PROGRAM_INCLUDE: z.string().default(""),
  INDEXER_INDEX_ALL_SWAPS: booleanFromEnv(false),
  INDEXER_SUPPRESS_PROCESSING_ERRORS: booleanFromEnv(false),
  INDEXER_LOG_EMPTY_DECODES: booleanFromEnv(true),
  INDEXER_LOG_TRACKED_DECODE_MISSES: booleanFromEnv(true),
  INDEXER_EMPTY_DECODE_ONLY_TARGET: booleanFromEnv(true),
  INDEXER_EMPTY_DECODE_INCLUDE_FAILED: booleanFromEnv(false),
  INDEXER_EMPTY_DECODE_INCLUDE_NOISE_LOGS: booleanFromEnv(false),
  INDEXER_EMPTY_DECODE_INCLUDE_SETUP_ONLY: booleanFromEnv(false),
  INDEXER_LOG_TOKEN_DISCOVERY: booleanFromEnv(true),
  INDEXER_LOG_FEE_CONFIG: booleanFromEnv(true),
  INDEXER_LOG_MIGRATIONS: booleanFromEnv(true),
  INDEXER_LOG_SWAPS: booleanFromEnv(true),
  INDEXER_LOG_TRANSFERS: booleanFromEnv(true),
  TARGET_FEE_RECEIVER_WALLET: z.string().min(32),
  BAGS_API_BASE_URL: z.string().url().default("https://public-api-v2.bags.fm"),
  BAGS_API_KEY: z.string().default(""),
  CLAIM_SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  CLAIM_REQUEST_TRANSACTIONS: booleanFromEnv(true),
  CLAIM_EXECUTE_TRANSACTIONS: booleanFromEnv(true),
  CLAIMER_SECRET_KEY: z.string().default(""),
  TOKEN_METADATA_ONCHAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
  TOKEN_METADATA_SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(120),
  TOKEN_METADATA_SYNC_BATCH_SIZE: z.coerce.number().int().positive().default(25),
  HOLDER_STATS_REFRESH_INTERVAL_SECONDS: z.coerce.number().int().positive().default(15),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  DRAW_INTERVAL_MINUTES: z.coerce.number().int().positive().default(15),
  WINNER_COOLDOWN_DRAWS: z.coerce.number().int().nonnegative().default(8),
  REWARD_PERCENT_MIN: z.coerce.number().positive().default(0.1),
  REWARD_PERCENT_MAX: z.coerce.number().positive().default(5),
  REWARD_DRY_RUN: booleanFromEnv(true),
  REWARD_PAYER_SECRET_KEY: z.string().default(""),
  PORT: z.coerce.number().int().positive().default(4000)
});

export const env = envSchema.parse(process.env);
