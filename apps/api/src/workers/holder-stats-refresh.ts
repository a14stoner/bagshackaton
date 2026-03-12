import { env } from "../config/env";
import { logger } from "../services/logger";
import { refreshTrackedHolderStats } from "../modules/holders/refresh";

export class HolderStatsRefreshWorker {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  start() {
    logger.info(
      {
        intervalSeconds: env.HOLDER_STATS_REFRESH_INTERVAL_SECONDS
      },
      "Holder stats refresh worker started"
    );
    void this.runIteration();
    this.timer = setInterval(() => {
      void this.runIteration();
    }, env.HOLDER_STATS_REFRESH_INTERVAL_SECONDS * 1000);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async runIteration() {
    if (this.inFlight) {
      logger.debug("Holder stats refresh skipped because previous run is still in flight");
      return;
    }

    this.inFlight = true;
    try {
      await refreshTrackedHolderStats(new Date());
    } catch (error) {
      logger.error({ err: error }, "Holder stats refresh iteration failed");
    } finally {
      this.inFlight = false;
    }
  }
}
