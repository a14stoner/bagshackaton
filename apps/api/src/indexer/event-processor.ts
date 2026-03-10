import { Connection, PublicKey } from "@solana/web3.js";
import { isTrackedFeeReceiver } from "@bags/shared";
import { env } from "../config/env";
import { applyLedgerEvent, type HolderState } from "../modules/holders/accounting";
import {
  hasTargetFeeReceiver,
  insertNormalizedEvent,
  insertSwap,
  insertTransfer,
  replaceFeeReceivers,
  saveHolderSnapshot,
  updateTokenMetadata,
  upsertCheckpoint,
  upsertToken
} from "../services/repositories";
import { fetchOffchainMetadata, fetchOnchainTokenMetadataWithTimeout } from "../services/token-metadata";
import { logger } from "../services/logger";
import type { IndexedEvent } from "./types";

type HolderCache = Map<string, HolderState>;
const metadataConnection = new Connection(env.RPC_URL, "confirmed");
const metadataSyncInFlight = new Set<string>();
const feeConfigProbeInFlight = new Set<string>();
const FEE_SHARE_V2_PROGRAM_ID = new PublicKey("FEE2tBhCKAt7shrod19QttSVREUYPiyMzoku1mL1gqVK");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");

export class IndexerEventProcessor {
  private holders: HolderCache = new Map();

  constructor(private readonly targetFeeReceiverWallet: string) {}

  async process(event: IndexedEvent): Promise<void> {
    logIndexedEvent(event);

    if (event.kind === "token_discovered") {
      await upsertToken({
        mint: event.mint,
        symbol: event.symbol,
        name: event.name,
        creationSlot: event.slot,
        createdAt: event.occurredAt,
        feeConfigAccount: event.feeConfigAccount,
        totalSupply: event.totalSupply
      });
      void syncTokenMetadataNow(event.mint);
      void probeFeeConfigNow(event.mint);
      const inserted = await insertNormalizedEvent({
        id: `${event.signature}:token_discovered:${event.mint}`,
        tokenMint: event.mint,
        type: "TOKEN_CREATED",
        signature: event.signature,
        slot: event.slot,
        occurredAt: event.occurredAt,
        payload: event
      });
      if (!inserted) {
        return;
      }
    }

    if (event.kind === "fee_configured") {
      await upsertToken({
        mint: event.mint,
        symbol: "UNKNOWN",
        name: "Bags Token",
        creationSlot: event.slot,
        createdAt: event.occurredAt,
        feeConfigAccount: event.feeConfigAccount,
        totalSupply: "1000000000",
        status: "DISCOVERED"
      });
      const inserted = await insertNormalizedEvent({
        id: `${event.signature}:fee_configured:${event.mint}`,
        tokenMint: event.mint,
        type: "FEE_CONFIGURED",
        signature: event.signature,
        slot: event.slot,
        occurredAt: event.occurredAt,
        payload: event
      });
      if (!inserted) {
        return;
      }
      await replaceFeeReceivers({
        tokenMint: event.mint,
        receivers: event.receivers.map((receiver) => ({
          wallet: receiver.wallet,
          allocationBps: receiver.allocationBps,
          isTarget: isTrackedFeeReceiver([receiver], this.targetFeeReceiverWallet)
        }))
      });
    }

    if (event.kind === "swap") {
      if (!env.INDEXER_INDEX_ALL_SWAPS && !(await hasTargetFeeReceiver(event.mint))) {
        logger.debug({ mint: event.mint, kind: event.kind, signature: event.signature }, "Skipping untracked token event");
        return;
      }
      await ensureTokenExists(event.mint, event.slot, event.occurredAt);

      const inserted = await insertNormalizedEvent({
        id: `${event.signature}:${event.kind}:${event.traderWallet}:${event.mint}:${event.side}`,
        tokenMint: event.mint,
        type: event.pool === "damm" ? "DAMM_SWAP" : event.side === "buy" ? "BUY" : "SELL",
        signature: event.signature,
        slot: event.slot,
        occurredAt: event.occurredAt,
        payload: event
      });
      if (!inserted) {
        return;
      }

      await insertSwap({
        id: `${event.signature}:${event.side}:${event.traderWallet}`,
        tokenMint: event.mint,
        signature: event.signature,
        slot: event.slot,
        pool: event.pool,
        side: event.side,
        traderWallet: event.traderWallet,
        amountIn: event.amountIn,
        amountOut: event.amountOut,
        price: event.price,
        occurredAt: event.occurredAt
      });

      const cacheKey = `${event.mint}:${event.traderWallet}`;
      const amount = event.side === "buy" ? Number(event.amountOut) : Number(event.amountIn);
      const next = applyLedgerEvent(
        this.holders.get(cacheKey),
        { type: event.side, wallet: event.traderWallet, amount, occurredAt: event.occurredAt },
        1_000_000_000
      );
      this.holders.set(cacheKey, next);
      await persistHolder(event.mint, next);
    }

    if (event.kind === "transfer") {
      if (!(await hasTargetFeeReceiver(event.mint))) {
        logger.debug({ mint: event.mint, kind: event.kind, signature: event.signature }, "Skipping untracked token event");
        return;
      }

      const inserted = await insertNormalizedEvent({
        id: `${event.signature}:${event.kind}:${event.fromWallet}:${event.toWallet}:${event.mint}`,
        tokenMint: event.mint,
        type: "TRANSFER",
        signature: event.signature,
        slot: event.slot,
        occurredAt: event.occurredAt,
        payload: event
      });
      if (!inserted) {
        return;
      }

      await insertTransfer({
        id: `${event.signature}:${event.fromWallet}:${event.toWallet}`,
        tokenMint: event.mint,
        signature: event.signature,
        slot: event.slot,
        fromWallet: event.fromWallet,
        toWallet: event.toWallet,
        amount: event.amount,
        occurredAt: event.occurredAt
      });

      const sourceKey = `${event.mint}:${event.fromWallet}`;
      const destKey = `${event.mint}:${event.toWallet}`;
      const source = applyLedgerEvent(
        this.holders.get(sourceKey),
        { type: "transfer_out", wallet: event.fromWallet, amount: Number(event.amount), occurredAt: event.occurredAt },
        1_000_000_000
      );
      const dest = applyLedgerEvent(
        this.holders.get(destKey),
        { type: "transfer_in", wallet: event.toWallet, amount: Number(event.amount), occurredAt: event.occurredAt },
        1_000_000_000
      );
      this.holders.set(sourceKey, source);
      this.holders.set(destKey, dest);
      await Promise.all([persistHolder(event.mint, source), persistHolder(event.mint, dest)]);
    }

    if (event.kind === "migration") {
      if (!(await hasTargetFeeReceiver(event.mint))) {
        logger.debug({ mint: event.mint, kind: event.kind, signature: event.signature }, "Skipping untracked token event");
        return;
      }

      const inserted = await insertNormalizedEvent({
        id: `${event.signature}:migration:${event.mint}`,
        tokenMint: event.mint,
        type: "MIGRATION",
        signature: event.signature,
        slot: event.slot,
        occurredAt: event.occurredAt,
        payload: event
      });
      if (!inserted) {
        return;
      }
      await upsertToken({
        mint: event.mint,
        symbol: "UNKNOWN",
        name: "Migrated Token",
        creationSlot: event.slot,
        createdAt: event.occurredAt,
        totalSupply: "1000000000",
        status: "MIGRATED"
      });
    }

    await upsertCheckpoint("bags-meteora-indexer", event.slot, "signature" in event ? event.signature : null);
  }
}

async function persistHolder(tokenMint: string, holder: HolderState): Promise<void> {
  await saveHolderSnapshot({
    tokenMint,
    wallet: holder.wallet,
    totalAcquired: holder.totalAcquired.toString(),
    currentBalance: holder.currentBalance.toString(),
    totalSold: holder.totalSold.toString(),
    transferredOut: holder.transferredOut.toString(),
    transferredIn: holder.transferredIn.toString(),
    firstBuyTime: holder.firstBuyTime,
    lastActivityTime: holder.lastActivityTime,
    holdDurationHours: holder.holdDurationHours,
    percentSupply: holder.percentSupply,
    sellRatio: holder.sellRatio,
    holdScore: holder.holdScore,
    wins: holder.wins,
    cooldownUntilDraw: holder.cooldownUntilDraw
  });
}

async function ensureTokenExists(mint: string, slot: bigint, occurredAt: Date): Promise<void> {
  await upsertToken({
    mint,
    symbol: "UNKNOWN",
    name: "Unresolved Bags Token",
    creationSlot: slot,
    createdAt: occurredAt,
    totalSupply: "1000000000",
    status: "DISCOVERED"
  });
}

async function syncTokenMetadataNow(mint: string): Promise<void> {
  if (metadataSyncInFlight.has(mint)) {
    logger.debug({ mint }, "Skipping immediate metadata sync (already in flight)");
    return;
  }
  metadataSyncInFlight.add(mint);
  try {
    logger.info({ mint }, "Token metadata sync requested (immediate)");
    const onchain = await fetchOnchainTokenMetadataWithTimeout(
      metadataConnection,
      mint,
      env.TOKEN_METADATA_ONCHAIN_TIMEOUT_MS
    );
    if (!onchain) {
      logger.info({ mint }, "Token metadata not available yet (immediate)");
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
      "Token metadata synced (immediate)"
    );
  } catch (error) {
    logger.warn({ err: error, mint }, "Immediate token metadata sync failed");
  } finally {
    metadataSyncInFlight.delete(mint);
  }
}

async function probeFeeConfigNow(mint: string): Promise<void> {
  if (feeConfigProbeInFlight.has(mint)) {
    return;
  }
  feeConfigProbeInFlight.add(mint);

  const retries = 4;
  const delayMs = 2000;

  try {
    logger.info({ mint }, "Fee config sync requested (immediate)");
    const feeConfigAccount = deriveFeeShareConfigPda(mint);

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const accountInfo = await metadataConnection.getAccountInfo(feeConfigAccount, "confirmed");
      if (accountInfo?.data) {
        logger.info(
          {
            mint,
            feeConfigAccount: feeConfigAccount.toBase58(),
            dataLength: accountInfo.data.length,
            attempt
          },
          "Fee config account detected (immediate)"
        );
        return;
      }

      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    logger.info(
      {
        mint,
        feeConfigAccount: feeConfigAccount.toBase58()
      },
      "Fee config account not available yet (immediate)"
    );
  } catch (error) {
    logger.warn({ err: error, mint }, "Immediate fee config sync probe failed");
  } finally {
    feeConfigProbeInFlight.delete(mint);
  }
}

function deriveFeeShareConfigPda(baseMint: string): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("fee_share_config"), new PublicKey(baseMint).toBuffer(), WSOL_MINT.toBuffer()],
    FEE_SHARE_V2_PROGRAM_ID
  );
  return pda;
}

function logIndexedEvent(event: IndexedEvent): void {
  if (event.kind === "token_discovered") {
    if (!env.INDEXER_LOG_TOKEN_DISCOVERY) {
      return;
    }
    logger.info(
      {
        event: event.kind,
        mint: event.mint,
        symbol: event.symbol,
        name: event.name,
        feeConfigAccount: event.feeConfigAccount,
        signature: event.signature,
        slot: event.slot.toString()
      },
      "Indexed token event"
    );
    return;
  }

  if (event.kind === "fee_configured") {
    if (!env.INDEXER_LOG_FEE_CONFIG) {
      return;
    }
    logger.info(
      {
        event: event.kind,
        mint: event.mint,
        feeConfigAccount: event.feeConfigAccount,
        receiverCount: event.receivers.length,
        receivers: event.receivers,
        signature: event.signature,
        slot: event.slot.toString()
      },
      "Indexed fee configuration event"
    );
    return;
  }

  if (event.kind === "swap") {
    if (!env.INDEXER_LOG_SWAPS) {
      return;
    }
    logger.info(
      {
        event: event.kind,
        mint: event.mint,
        buyer: event.side === "buy" ? event.traderWallet : undefined,
        seller: event.side === "sell" ? event.traderWallet : undefined,
        traderWallet: event.traderWallet,
        side: event.side,
        solAmount: event.side === "buy" ? event.amountIn : event.amountOut,
        tokenAmount: event.side === "buy" ? event.amountOut : event.amountIn,
        amountIn: event.amountIn,
        amountOut: event.amountOut,
        price: event.price,
        pool: event.pool,
        signature: event.signature,
        slot: event.slot.toString()
      },
      "Indexed swap event"
    );
    return;
  }

  if (event.kind === "transfer") {
    if (!env.INDEXER_LOG_TRANSFERS) {
      return;
    }
    logger.info(
      {
        event: event.kind,
        mint: event.mint,
        fromWallet: event.fromWallet,
        toWallet: event.toWallet,
        amount: event.amount,
        signature: event.signature,
        slot: event.slot.toString()
      },
      "Indexed transfer event"
    );
    return;
  }

  if (!env.INDEXER_LOG_MIGRATIONS) {
    return;
  }

  logger.info(
    {
      event: event.kind,
      mint: event.mint,
      signature: event.signature,
      slot: event.slot.toString()
    },
    "Indexed migration event"
  );
}
