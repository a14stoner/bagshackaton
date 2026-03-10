import { Connection } from "@solana/web3.js";
import { env } from "../config/env";
import { logger } from "../services/logger";
import { listTokensForMetadataSync, updateTokenMetadata } from "../services/repositories";
import { fetchOffchainMetadata, fetchOnchainTokenMetadataWithTimeout } from "../services/token-metadata";

export class TokenMetadataSyncWorker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private readonly connection = new Connection(env.RPC_URL, "confirmed");

  start() {
    logger.info(
      {
        intervalSeconds: env.TOKEN_METADATA_SYNC_INTERVAL_SECONDS,
        batchSize: env.TOKEN_METADATA_SYNC_BATCH_SIZE
      },
      "Token metadata sync worker started"
    );

    void this.runIteration();
    this.timer = setInterval(() => {
      void this.runIteration();
    }, env.TOKEN_METADATA_SYNC_INTERVAL_SECONDS * 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runIteration() {
    if (this.inFlight) {
      logger.debug("Token metadata sync iteration skipped because previous run is still in flight");
      return;
    }

    this.inFlight = true;
    try {
      const tokens = await listTokensForMetadataSync(env.TOKEN_METADATA_SYNC_BATCH_SIZE);
      if (tokens.length === 0) {
        return;
      }

      for (const token of tokens) {
        await this.syncToken(token.mint);
      }
    } catch (error) {
      logger.error({ err: error }, "Token metadata sync iteration failed");
    } finally {
      this.inFlight = false;
    }
  }

  private async syncToken(mint: string) {
    try {
      const onchain = await fetchOnchainTokenMetadataWithTimeout(
        this.connection,
        mint,
        env.TOKEN_METADATA_ONCHAIN_TIMEOUT_MS
      );
      if (!onchain) {
        return;
      }

      const offchain = onchain.uri ? await fetchOffchainMetadata(onchain.uri) : { image: null };

      await updateTokenMetadata({
        mint,
        name: onchain.name || null,
        symbol: onchain.symbol || null,
        metadataUri: onchain.uri || null,
        imageUri: offchain.image,
        metadataSyncedAt: new Date()
      });

      logger.info(
        {
          mint,
          symbol: onchain.symbol || null,
          metadataUri: onchain.uri || null,
          imageUri: offchain.image
        },
        "Token metadata synced"
      );
    } catch (error) {
      logger.debug({ err: error, mint }, "Token metadata sync failed for mint");
    }
  }
}
