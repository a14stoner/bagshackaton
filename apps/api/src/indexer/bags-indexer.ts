import { PublicKey } from "@solana/web3.js";
import { env } from "../config/env";
import { logger } from "../services/logger";
import { hasTargetFeeReceiver } from "../services/repositories";
import { buildTransactionSubscriptionRequest, createYellowstoneClient, openTransactionSubscription } from "./grpc-runtime";
import { IndexerEventProcessor } from "./event-processor";
import { parseYellowstoneUpdate, summarizeYellowstoneUpdate } from "./transaction-parser";

export class BagsIndexer {
  private readonly processor: IndexerEventProcessor;
  private readonly client = createYellowstoneClient();
  private running = false;
  private reconnectDelayMs = 1_000;
  private stream: any = null;
  private processingQueue: Promise<void> = Promise.resolve();
  private rawUpdateCount = 0;
  private decodedEventCount = 0;
  private emptyDecodeCount = 0;
  private rawUpdatesSinceLastLog = 0;
  private decodedEventsSinceLastLog = 0;
  private emptyDecodesSinceLastLog = 0;
  private throughputTimer: NodeJS.Timeout | null = null;
  private throughputLastLoggedAtMs = 0;

  constructor() {
    this.processor = new IndexerEventProcessor(env.TARGET_FEE_RECEIVER_WALLET);
  }

  async start(): Promise<void> {
    this.running = true;
    logger.info(
      {
        endpoint: env.GRPC_ENDPOINT,
        filters: buildTransactionSubscriptionRequest().transactions.meteoraBags.accountInclude
      },
      "Yellowstone indexer booted"
    );
    this.throughputTimer = setInterval(() => {
      if (!this.running) {
        return;
      }
      const nowMs = Date.now();
      const elapsedSeconds = Math.max(1, (nowMs - this.throughputLastLoggedAtMs) / 1000);
      logger.info(
        {
          txPerSecond: Number((this.rawUpdatesSinceLastLog / elapsedSeconds).toFixed(2)),
          decodedEventsPerSecond: Number((this.decodedEventsSinceLastLog / elapsedSeconds).toFixed(2)),
          emptyDecodesPerSecond: Number((this.emptyDecodesSinceLastLog / elapsedSeconds).toFixed(2))
        },
        "Yellowstone throughput"
      );
      this.rawUpdatesSinceLastLog = 0;
      this.decodedEventsSinceLastLog = 0;
      this.emptyDecodesSinceLastLog = 0;
      this.throughputLastLoggedAtMs = nowMs;
    }, 5000);
    this.throughputLastLoggedAtMs = Date.now();
    void this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.throughputTimer) {
      clearInterval(this.throughputTimer);
      this.throughputTimer = null;
    }
    if (this.stream) {
      this.stream.end?.();
      this.stream.destroy?.();
      this.stream = null;
    }
    logger.info("Indexer stopped");
  }

  getHealth() {
    return {
      running: this.running,
      grpcEndpoint: env.GRPC_ENDPOINT,
      targetFeeReceiverWallet: new PublicKey(env.TARGET_FEE_RECEIVER_WALLET).toBase58(),
      mode: "yellowstone-grpc"
    }
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.connectAndStream();
        this.reconnectDelayMs = 1_000;
      } catch (error) {
        if (env.INDEXER_SUPPRESS_PROCESSING_ERRORS) {
          logger.warn("Yellowstone stream failure (suppressed error details)");
        } else {
          logger.error({ err: error }, "Yellowstone stream failure");
        }
      }

      if (!this.running) {
        break;
      }

      logger.warn({ delayMs: this.reconnectDelayMs }, "Reconnecting Yellowstone stream");
      await new Promise((resolve) => setTimeout(resolve, this.reconnectDelayMs));
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, 30_000);
    }
  }

  private async connectAndStream(): Promise<void> {
    this.stream = await openTransactionSubscription(this.client);
    logger.info("Yellowstone subscription established");

    await new Promise<void>((resolve, reject) => {
      this.stream.on("data", (update: unknown) => {
        this.rawUpdateCount += 1;
        this.rawUpdatesSinceLastLog += 1;
        this.processingQueue = this.processingQueue
          .then(async () => {
            const events = parseYellowstoneUpdate(update as any);
            if (events.length === 0) {
              this.emptyDecodeCount += 1;
              this.emptyDecodesSinceLastLog += 1;
              const summary = summarizeYellowstoneUpdate(update as any) as EmptyDecodeSummary;
              const trackedMints = await findTrackedCandidateMints(summary);
              if (trackedMints.length > 0 && env.INDEXER_LOG_TRACKED_DECODE_MISSES) {
                logger.warn(
                  {
                    rawUpdateCount: this.rawUpdateCount,
                    emptyDecodeCount: this.emptyDecodeCount,
                    trackedMints,
                    summary
                  },
                  "Tracked token transaction failed to decode into indexed events"
                );
              }
              if (shouldLogEmptyDecodeSummary(summary) && (this.emptyDecodeCount <= 20 || this.emptyDecodeCount % 100 === 0)) {
                logger.info(
                  {
                    rawUpdateCount: this.rawUpdateCount,
                    emptyDecodeCount: this.emptyDecodeCount,
                    summary
                  },
                  "Yellowstone transaction did not decode into indexed events"
                );
              }
              return;
            }

            this.decodedEventCount += events.length;
            this.decodedEventsSinceLastLog += events.length;
            for (const event of events) {
              await this.processor.process(event);
            }
          })
          .catch((error) => {
            if (env.INDEXER_SUPPRESS_PROCESSING_ERRORS) {
              logger.warn("Failed to process Yellowstone update (suppressed error details)");
            } else {
              logger.error({ err: error }, "Failed to process Yellowstone update");
            }
          });
      });
      this.stream.on("error", reject);
      this.stream.on("end", async () => {
        await this.processingQueue;
        resolve();
      });
      this.stream.on("close", async () => {
        await this.processingQueue;
        resolve();
      });
    });
  }

}

type EmptyDecodeSummary = {
  decoded: boolean;
  signature?: string;
  failed?: boolean;
  hasNoiseLogs?: boolean;
  setupOnlyLogs?: boolean;
  hasTargetActivity?: boolean;
  candidateMints?: string[];
};

async function findTrackedCandidateMints(summary: EmptyDecodeSummary): Promise<string[]> {
  if (!summary.decoded || !summary.candidateMints?.length) {
    return [];
  }
  const checks = await Promise.all(
    summary.candidateMints.map(async (mint) => ({
      mint,
      tracked: await hasTargetFeeReceiver(mint)
    }))
  );
  return checks.filter((entry) => entry.tracked).map((entry) => entry.mint);
}

function shouldLogEmptyDecodeSummary(summary: EmptyDecodeSummary): boolean {
  if (!env.INDEXER_LOG_EMPTY_DECODES) {
    return false;
  }

  if (!summary.decoded) {
    return true;
  }

  if (!env.INDEXER_EMPTY_DECODE_INCLUDE_FAILED && summary.failed) {
    return false;
  }

  if (!env.INDEXER_EMPTY_DECODE_INCLUDE_NOISE_LOGS && summary.hasNoiseLogs) {
    return false;
  }

  if (!env.INDEXER_EMPTY_DECODE_INCLUDE_SETUP_ONLY && summary.setupOnlyLogs) {
    return false;
  }

  if (env.INDEXER_EMPTY_DECODE_ONLY_TARGET && !summary.hasTargetActivity) {
    return false;
  }

  return true;
}
