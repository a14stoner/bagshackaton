import { randomUUID } from "node:crypto";
import { env } from "../config/env";
import { logger } from "../services/logger";
import {
  createTokenClaimRun,
  getTokenClaimableState,
  listTrackedTokenMints,
  updateTokenTreasury,
  upsertTokenClaimableState
} from "../services/repositories";
import {
  extractClaimableLamports,
  extractTransactionCount,
  getClaimTransactionsV3,
  getClaimablePositions,
  lamportsToSolString,
  resolveTokenMint
} from "../services/bags-api";

export class FeeClaimSyncWorker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  start() {
    if (!env.BAGS_API_KEY) {
      logger.warn("BAGS_API_KEY is not configured. Fee claim sync worker is disabled.");
      return;
    }

    logger.info(
      {
        intervalSeconds: env.CLAIM_SYNC_INTERVAL_SECONDS,
        requestClaimTransactions: env.CLAIM_REQUEST_TRANSACTIONS
      },
      "Fee claim sync worker started"
    );

    void this.runIteration();
    this.timer = setInterval(() => {
      void this.runIteration();
    }, env.CLAIM_SYNC_INTERVAL_SECONDS * 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runIteration() {
    if (this.inFlight) {
      logger.debug("Fee claim sync iteration skipped because previous run is still in flight");
      return;
    }

    this.inFlight = true;
    try {
      const trackedTokens = await listTrackedTokenMints();
      if (trackedTokens.length === 0) {
        logger.debug("Fee claim sync found no tracked tokens");
        return;
      }

      for (const token of trackedTokens) {
        await this.syncToken(token.mint);
      }
    } catch (error) {
      logger.error({ err: error }, "Fee claim sync iteration failed");
    } finally {
      this.inFlight = false;
    }
  }

  private async syncToken(tokenMint: string) {
    const receiverWallet = env.TARGET_FEE_RECEIVER_WALLET;
    const now = new Date();

    const claimablePositions = await getClaimablePositions(receiverWallet);
    const tokenPositions = claimablePositions.filter((position) => resolveTokenMint(position) === tokenMint);
    const claimableLamports = tokenPositions.reduce((sum, position) => sum + extractClaimableLamports(position), 0n);
    const claimableSol = lamportsToSolString(claimableLamports);
    const previousState = await getTokenClaimableState(tokenMint);
    const previousLamports = previousState ? BigInt(previousState.claimable_lamports) : 0n;
    const generatedDeltaLamports = claimableLamports > previousLamports ? claimableLamports - previousLamports : 0n;

    await upsertTokenClaimableState({
      tokenMint,
      receiverWallet,
      claimableLamports: claimableLamports.toString(),
      claimableSol,
      positionsCount: tokenPositions.length,
      payload: {
        positions: tokenPositions
      },
      lastSyncedAt: now
    });

    if (generatedDeltaLamports > 0n) {
      const generatedDeltaSol = lamportsToSolString(generatedDeltaLamports);
      await updateTokenTreasury({
        tokenMint,
        generatedFeesDelta: generatedDeltaSol,
        treasuryBalanceDelta: generatedDeltaSol
      });
    }

    logger.info(
      {
        tokenMint,
        receiverWallet,
        claimableLamports: claimableLamports.toString(),
        claimableSol,
        generatedDeltaLamports: generatedDeltaLamports.toString(),
        positions: tokenPositions.length
      },
      "Updated claimable state"
    );

    if (!env.CLAIM_REQUEST_TRANSACTIONS || claimableLamports <= 0n) {
      return;
    }

    try {
      const claimTransactions = await getClaimTransactionsV3({
        receiverWallet,
        tokenMint
      });
      const txCount = extractTransactionCount(claimTransactions);

      await createTokenClaimRun({
        id: randomUUID(),
        tokenMint,
        receiverWallet,
        claimableLamports: claimableLamports.toString(),
        claimableSol,
        txCount,
        success: true,
        error: null,
        responsePayload: claimTransactions,
        requestedAt: now
      });

      logger.info(
        {
          tokenMint,
          claimableSol,
          txCount
        },
        "Requested claim transactions"
      );
    } catch (error) {
      await createTokenClaimRun({
        id: randomUUID(),
        tokenMint,
        receiverWallet,
        claimableLamports: claimableLamports.toString(),
        claimableSol,
        txCount: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        responsePayload: {},
        requestedAt: now
      });
      throw error;
    }
  }
}
