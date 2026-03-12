import { randomUUID } from "node:crypto";
import { Connection, Keypair, Transaction, VersionedTransaction, sendAndConfirmRawTransaction } from "@solana/web3.js";
import bs58 from "bs58";
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
  extractSerializedClaimTransactions,
  extractTransactionCount,
  getClaimTransactionsV3,
  getClaimablePositions,
  lamportsToSolString,
  resolveTokenMint
} from "../services/bags-api";

export class FeeClaimSyncWorker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private readonly connection = new Connection(env.RPC_URL, "confirmed");
  private readonly claimer = resolveClaimerKeypair();

  start() {
    if (!env.BAGS_API_KEY) {
      logger.warn("BAGS_API_KEY is not configured. Fee claim sync worker is disabled.");
      return;
    }

    logger.info(
      {
        intervalSeconds: env.CLAIM_SYNC_INTERVAL_SECONDS,
        requestClaimTransactions: env.CLAIM_REQUEST_TRANSACTIONS,
        executeClaimTransactions: env.CLAIM_EXECUTE_TRANSACTIONS && Boolean(this.claimer)
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
      const receiverWallet = env.TARGET_FEE_RECEIVER_WALLET;
      const claimablePositions = await getClaimablePositions(receiverWallet);
      const positionsByMint = new Map<string, typeof claimablePositions>();
      for (const position of claimablePositions) {
        const tokenMint = resolveTokenMint(position);
        if (!tokenMint) {
          continue;
        }
        const existing = positionsByMint.get(tokenMint) ?? [];
        existing.push(position);
        positionsByMint.set(tokenMint, existing);
      }

      for (const token of trackedTokens) {
        await this.syncToken(token.mint, positionsByMint.get(token.mint) ?? []);
      }
    } catch (error) {
      logger.error({ err: error }, "Fee claim sync iteration failed");
    } finally {
      this.inFlight = false;
    }
  }

  private async syncToken(tokenMint: string, tokenPositions: Awaited<ReturnType<typeof getClaimablePositions>>) {
    const receiverWallet = env.TARGET_FEE_RECEIVER_WALLET;
    const now = new Date();

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
        generatedFeesDelta: generatedDeltaSol
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

    let txCount = 0;
    let txSignatures: string[] = [];
    let claimedLamports = 0n;
    let claimTransactions: unknown = {};
    try {
      claimTransactions = await getClaimTransactionsV3({
        receiverWallet,
        tokenMint
      });
      txCount = extractTransactionCount(claimTransactions);
      if (env.CLAIM_EXECUTE_TRANSACTIONS && this.claimer && txCount > 0) {
        txSignatures = await executeClaimTransactions(this.connection, this.claimer, claimTransactions);
        const refreshedPositions = await getClaimablePositions(receiverWallet);
        const refreshedTokenPositions = refreshedPositions.filter((position) => resolveTokenMint(position) === tokenMint);
        const remainingLamports = refreshedTokenPositions.reduce(
          (sum, position) => sum + extractClaimableLamports(position),
          0n
        );
        claimedLamports = claimableLamports > remainingLamports ? claimableLamports - remainingLamports : 0n;
        await upsertTokenClaimableState({
          tokenMint,
          receiverWallet,
          claimableLamports: remainingLamports.toString(),
          claimableSol: lamportsToSolString(remainingLamports),
          positionsCount: refreshedTokenPositions.length,
          payload: {
            positions: refreshedTokenPositions
          },
          lastSyncedAt: new Date()
        });
        if (claimedLamports > 0n) {
          const claimedSol = lamportsToSolString(claimedLamports);
          await updateTokenTreasury({
            tokenMint,
            claimedFeesDelta: claimedSol,
            treasuryBalanceDelta: claimedSol
          });
        }
      }

      await createTokenClaimRun({
        id: randomUUID(),
        tokenMint,
        receiverWallet,
        claimableLamports: claimableLamports.toString(),
        claimableSol,
        claimedLamports: claimedLamports.toString(),
        claimedSol: lamportsToSolString(claimedLamports),
        txCount,
        txSignatures,
        success: true,
        error: null,
        responsePayload: claimTransactions,
        requestedAt: now
      });

      logger.info(
        {
          tokenMint,
          claimableSol,
          txCount,
          claimedSol: lamportsToSolString(claimedLamports),
          txSignatures
        },
        env.CLAIM_EXECUTE_TRANSACTIONS && txSignatures.length > 0
          ? "Executed claim transactions"
          : "Requested claim transactions"
      );
    } catch (error) {
      await createTokenClaimRun({
        id: randomUUID(),
        tokenMint,
        receiverWallet,
        claimableLamports: claimableLamports.toString(),
        claimableSol,
        claimedLamports: claimedLamports.toString(),
        claimedSol: lamportsToSolString(claimedLamports),
        txCount: 0,
        txSignatures,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        responsePayload: claimTransactions,
        requestedAt: now
      });
      throw error;
    }
  }
}

async function executeClaimTransactions(
  connection: Connection,
  claimer: Keypair,
  response: unknown
): Promise<string[]> {
  const transactions = extractSerializedClaimTransactions(response);
  const signatures: string[] = [];
  for (const envelope of transactions) {
    const rawBytes = Buffer.from(envelope.serializedTransaction, "base64");
    try {
      const versioned = VersionedTransaction.deserialize(rawBytes);
      versioned.sign([claimer]);
      const signature = await sendAndConfirmRawTransaction(connection, Buffer.from(versioned.serialize()), {
        commitment: "confirmed"
      });
      signatures.push(signature);
      continue;
    } catch {
      const legacy = Transaction.from(rawBytes);
      legacy.partialSign(claimer);
      const signature = await sendAndConfirmRawTransaction(connection, legacy.serialize(), {
        commitment: "confirmed"
      });
      signatures.push(signature);
    }
  }
  return signatures;
}

function resolveClaimerKeypair(): Keypair | null {
  const secret = env.CLAIMER_SECRET_KEY || env.REWARD_PAYER_SECRET_KEY;
  if (!secret) {
    return null;
  }
  const trimmed = secret.trim();
  const keypair = trimmed.startsWith("[")
    ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed) as number[]))
    : Keypair.fromSecretKey(bs58.decode(trimmed));
  if (keypair.publicKey.toBase58() !== env.TARGET_FEE_RECEIVER_WALLET) {
    logger.warn(
      {
        targetFeeReceiverWallet: env.TARGET_FEE_RECEIVER_WALLET,
        claimerWallet: keypair.publicKey.toBase58()
      },
      "Claim execution disabled because claimer wallet does not match TARGET_FEE_RECEIVER_WALLET"
    );
    return null;
  }
  return keypair;
}
