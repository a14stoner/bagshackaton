import { Connection, PublicKey } from "@solana/web3.js";
import { isTrackedFeeReceiver } from "@bags/shared";
import { env } from "../config/env";
import { applyLedgerEvent, type HolderState } from "../modules/holders/accounting";
import {
  hasTargetFeeReceiver,
  getTokenRuntimeByMint,
  insertNormalizedEvent,
  insertSwap,
  insertTransfer,
  replaceFeeReceivers,
  saveHolderSnapshot,
  updateTokenMetadata,
  upsertCheckpoint,
  upsertToken
} from "../services/repositories";
import { fetchOffchainMetadata, fetchOnchainTokenMetadataWithTimeout, fetchTokenSupply } from "../services/token-metadata";
import { logger } from "../services/logger";
import { resolveFeeReceiver, type ResolvedFeeReceiver } from "./fee-receiver-resolver";
import type { IndexedEvent } from "./types";

type HolderCache = Map<string, HolderState>;
const metadataConnection = new Connection(env.RPC_URL, "confirmed");
const metadataSyncInFlight = new Set<string>();
const feeConfigProbeInFlight = new Set<string>();
const FEE_SHARE_V2_PROGRAM_ID = new PublicKey("FEE2tBhCKAt7shrod19QttSVREUYPiyMzoku1mL1gqVK");
const WSOL_MINT = new PublicKey("So11111111111111111111111111111111111111112");
const receiverResolutionCache = new Map<string, ResolvedFeeReceiver>();

export class IndexerEventProcessor {
  private holders: HolderCache = new Map();
  private tokenSupplyCache = new Map<string, number>();

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
      const resolvedReceivers = await resolveReceiversWithOwners(event.receivers);
      const trackedReceivers = resolvedReceivers.filter((receiver) =>
        isTrackedFeeReceiver(
          [{ wallet: receiver.resolvedWallet, allocationBps: receiver.allocationBps }],
          this.targetFeeReceiverWallet
        )
      );
      await replaceFeeReceivers({
        tokenMint: event.mint,
        receivers: resolvedReceivers.map((receiver) => ({
          wallet: receiver.wallet,
          resolvedWallet: receiver.resolvedWallet,
          receiverType: receiver.receiverType,
          allocationBps: receiver.allocationBps,
          isTarget: isTrackedFeeReceiver([{ wallet: receiver.resolvedWallet, allocationBps: receiver.allocationBps }], this.targetFeeReceiverWallet)
        }))
      });
      logger.info(
        {
          mint: event.mint,
          feeConfigAccount: event.feeConfigAccount,
          receiverCount: resolvedReceivers.length,
          trackedReceiverCount: trackedReceivers.length,
          trackedReceivers
        },
        trackedReceivers.length > 0 ? "Tracked token fee receivers synchronized" : "Untracked token fee receivers synchronized"
      );
    }

    if (event.kind === "swap") {
      const isTrackedToken = await hasTargetFeeReceiver(event.mint);
      if (!env.INDEXER_INDEX_ALL_SWAPS && !isTrackedToken) {
        logger.debug({ mint: event.mint, kind: event.kind, signature: event.signature }, "Skipping untracked token event");
        return;
      }
      if (isTrackedToken) {
        logger.info(
          {
            mint: event.mint,
            pool: event.pool,
            side: event.side,
            traderWallet: event.traderWallet,
            amountIn: event.amountIn,
            amountOut: event.amountOut,
            signature: event.signature,
            slot: event.slot.toString()
          },
          "Tracked token swap decoded"
        );
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

      const totalSupply = await this.getTokenSupply(event.mint, event.slot, event.occurredAt);
      const cacheKey = `${event.mint}:${event.traderWallet}`;
      const amount = event.side === "buy" ? Number(event.amountOut) : Number(event.amountIn);
      const next = applyLedgerEvent(
        this.holders.get(cacheKey),
        { type: event.side, wallet: event.traderWallet, amount, occurredAt: event.occurredAt },
        totalSupply
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

      const totalSupply = await this.getTokenSupply(event.mint, event.slot, event.occurredAt);
      const sourceKey = `${event.mint}:${event.fromWallet}`;
      const destKey = `${event.mint}:${event.toWallet}`;
      const source = applyLedgerEvent(
        this.holders.get(sourceKey),
        { type: "transfer_out", wallet: event.fromWallet, amount: Number(event.amount), occurredAt: event.occurredAt },
        totalSupply
      );
      const dest = applyLedgerEvent(
        this.holders.get(destKey),
        { type: "transfer_in", wallet: event.toWallet, amount: Number(event.amount), occurredAt: event.occurredAt },
        totalSupply
      );
      this.holders.set(sourceKey, source);
      this.holders.set(destKey, dest);
      await Promise.all([persistHolder(event.mint, source), persistHolder(event.mint, dest)]);
      logger.info(
        {
          mint: event.mint,
          fromWallet: event.fromWallet,
          toWallet: event.toWallet,
          amount: event.amount,
          signature: event.signature
        },
        "Tracked token transfer persisted"
      );
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

  private async getTokenSupply(mint: string, slot: bigint, occurredAt: Date): Promise<number> {
    const cached = this.tokenSupplyCache.get(mint);
    if (cached && cached > 0) {
      return cached;
    }
    await ensureTokenExists(mint, slot, occurredAt);
    const tokenRuntime = await getTokenRuntimeByMint(mint);
    const parsed = Number(tokenRuntime?.total_supply ?? 0);
    const totalSupply = Number.isFinite(parsed) && parsed > 0 ? parsed : 1_000_000_000;
    this.tokenSupplyCache.set(mint, totalSupply);
    return totalSupply;
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
    const totalSupply = await fetchTokenSupply(metadataConnection, mint);
    await updateTokenMetadata({
      mint,
      name: onchain.name || null,
      symbol: onchain.symbol || null,
      metadataUri: onchain.uri || null,
      imageUri: offchain.image,
      totalSupply,
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
        const decoded = decodeFeeShareConfigAccount(accountInfo.data);
        if (!decoded || decoded.receivers.length === 0) {
          logger.warn(
            {
              mint,
              feeConfigAccount: feeConfigAccount.toBase58(),
              dataLength: accountInfo.data.length,
              attempt
            },
            "Fee config account detected but could not decode receivers (immediate)"
          );
          return;
        }

        await upsertToken({
          mint,
          symbol: "UNKNOWN",
          name: "Bags Token",
          creationSlot: 0n,
          createdAt: new Date(),
          feeConfigAccount: feeConfigAccount.toBase58(),
          totalSupply: "1000000000",
          status: "DISCOVERED"
        });
        const resolvedReceivers = await resolveReceiversWithOwners(decoded.receivers);
        const trackedReceivers = resolvedReceivers.filter((receiver) =>
          isTrackedFeeReceiver(
            [{ wallet: receiver.resolvedWallet, allocationBps: receiver.allocationBps }],
            env.TARGET_FEE_RECEIVER_WALLET
          )
        );
        await replaceFeeReceivers({
          tokenMint: mint,
          receivers: resolvedReceivers.map((receiver) => ({
            wallet: receiver.wallet,
            resolvedWallet: receiver.resolvedWallet,
            receiverType: receiver.receiverType,
            allocationBps: receiver.allocationBps,
            isTarget: isTrackedFeeReceiver(
              [{ wallet: receiver.resolvedWallet, allocationBps: receiver.allocationBps }],
              env.TARGET_FEE_RECEIVER_WALLET
            )
          }))
        });
        await insertNormalizedEvent({
          id: `fee-config-probe:${mint}:${feeConfigAccount.toBase58()}`,
          tokenMint: mint,
          type: "FEE_CONFIGURED",
          signature: `fee-config-probe:${mint}`,
          slot: 0n,
          occurredAt: new Date(),
          payload: {
            kind: "fee_configured_probe",
            mint,
            feeConfigAccount: feeConfigAccount.toBase58(),
            receivers: resolvedReceivers
          }
        });

        logger.info(
          {
            mint,
            feeConfigAccount: feeConfigAccount.toBase58(),
            receiverCount: resolvedReceivers.length,
            trackedReceiverCount: trackedReceivers.length,
            trackedReceivers,
            receivers: resolvedReceivers,
            dataLength: accountInfo.data.length,
            attempt
          },
          "Fee config synced from account (immediate)"
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

function decodeFeeShareConfigAccount(
  data: Buffer
): { receivers: Array<{ wallet: string; allocationBps: number }> } | null {
  const buffer = Buffer.from(data);
  // Anchor discriminator (8) + FeeShareConfigHeader (176) + vec claimers + vec bps.
  const baseOffset = 8 + 176;
  if (buffer.length < baseOffset + 8) {
    return null;
  }

  let cursor = baseOffset;
  const claimersLen = buffer.readUInt32LE(cursor);
  cursor += 4;
  if (!Number.isFinite(claimersLen) || claimersLen <= 0 || claimersLen > 100) {
    return null;
  }

  const claimers: string[] = [];
  for (let i = 0; i < claimersLen; i += 1) {
    if (cursor + 32 > buffer.length) {
      return null;
    }
    claimers.push(new PublicKey(buffer.subarray(cursor, cursor + 32)).toBase58());
    cursor += 32;
  }

  if (cursor + 4 > buffer.length) {
    return null;
  }
  const bpsLen = buffer.readUInt32LE(cursor);
  cursor += 4;
  if (!Number.isFinite(bpsLen) || bpsLen !== claimersLen || bpsLen <= 0 || bpsLen > 100) {
    return null;
  }

  const bps: number[] = [];
  for (let i = 0; i < bpsLen; i += 1) {
    if (cursor + 2 > buffer.length) {
      return null;
    }
    bps.push(buffer.readUInt16LE(cursor));
    cursor += 2;
  }

  const receivers = claimers
    .map((wallet, index) => ({ wallet, allocationBps: bps[index] ?? 0 }))
    .filter((entry) => entry.wallet && entry.wallet !== "11111111111111111111111111111111")
    .filter((entry) => entry.allocationBps > 0);

  return receivers.length > 0 ? { receivers } : null;
}

async function resolveReceiversWithOwners(
  receivers: Array<{ wallet: string; allocationBps: number }>
): Promise<Array<{ wallet: string; resolvedWallet: string; receiverType: string; allocationBps: number }>> {
  return Promise.all(
    receivers.map(async (receiver) => {
      const cached = receiverResolutionCache.get(receiver.wallet);
      if (cached) {
        return {
          wallet: receiver.wallet,
          resolvedWallet: cached.resolvedWallet,
          receiverType: cached.receiverType,
          allocationBps: receiver.allocationBps
        };
      }

      const resolvedReceiver = await resolveFeeReceiver(metadataConnection, receiver.wallet);
      receiverResolutionCache.set(receiver.wallet, resolvedReceiver);
      return {
        wallet: receiver.wallet,
        resolvedWallet: resolvedReceiver.resolvedWallet,
        receiverType: resolvedReceiver.receiverType,
        allocationBps: receiver.allocationBps
      };
    })
  );
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
