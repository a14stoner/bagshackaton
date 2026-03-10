import { Queue } from "bullmq";
import { env } from "../config/env";

export function createBullConnection() {
  return {
    url: env.REDIS_URL
  };
}

export const drawQueue = new Queue("reward-draws", {
  connection: createBullConnection()
});

export async function scheduleRecurringDraws(): Promise<void> {
  await drawQueue.upsertJobScheduler(
    "recurring-draws",
    {
      every: env.DRAW_INTERVAL_MINUTES * 60_000
    },
    {
      name: "run-draws",
      data: {}
    }
  );
}
