import { Worker } from "bullmq";
import { env } from "../config/env";
import { listTrackedTokensForDraws } from "../services/repositories";
import { logger } from "../services/logger";
import { runRewardDraw } from "../modules/draws/reward-engine";
import { createBullConnection } from "./draw-scheduler";
import { updateTokenTreasury } from "../services/repositories";

export function startDrawWorker() {
  const worker = new Worker(
    "reward-draws",
    async (job) => {
      if (job.name !== "run-draws") {
        return;
      }

      const trackedTokens = await listTrackedTokensForDraws();
      const nextDrawAt = new Date(Date.now() + env.DRAW_INTERVAL_MINUTES * 60_000);
      logger.info(
        {
          trackedTokenCount: trackedTokens.length,
          nextDrawAt
        },
        "Starting tracked token draw iteration"
      );
      for (const token of trackedTokens) {
        await updateTokenTreasury({
          tokenMint: token.mint,
          nextDrawAt
        });
        logger.info(
          {
            tokenMint: token.mint,
            nextDrawAt
          },
          "Tracked token next draw scheduled"
        );
        const treasuryBalance = Number(token.treasury_balance ?? 0);
        if (!Number.isFinite(treasuryBalance) || treasuryBalance <= 0) {
          logger.info(
            {
              tokenMint: token.mint,
              treasuryBalance
            },
            "Skipping tracked token draw because treasury is empty"
          );
          continue;
        }

        const result = await runRewardDraw(token.mint, treasuryBalance);
        logger.info(
          {
            tokenMint: token.mint,
            drawNumber: result.drawNumber,
            winnerWallet: result.winnerWallet,
            rewardAmount: result.rewardAmount,
            rewardPercent: result.rewardPercent,
            txSignature: result.txSignature
          },
          "Completed scheduled reward draw"
        );
      }
    },
    {
      connection: createBullConnection()
    }
  );

  worker.on("failed", (job, err) => {
    logger.error({ jobId: job?.id, jobName: job?.name, err }, "Draw worker job failed");
  });

  logger.info("Draw worker started");
  return worker;
}
