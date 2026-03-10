import { env } from "./config/env";
import { buildApp } from "./app";
import { runMigrations } from "./db/bootstrap";
import { BagsIndexer } from "./indexer/bags-indexer";
import { scheduleRecurringDraws } from "./workers/draw-scheduler";
import { startDrawWorker } from "./workers/draw-worker";
import { FeeClaimSyncWorker } from "./workers/fee-claim-sync";
import { TokenMetadataSyncWorker } from "./workers/token-metadata-sync";

async function main() {
  await runMigrations();
  await scheduleRecurringDraws();
  startDrawWorker();

  const indexer = new BagsIndexer();
  const feeClaimSyncWorker = new FeeClaimSyncWorker();
  const tokenMetadataSyncWorker = new TokenMetadataSyncWorker();
  await indexer.start();
  feeClaimSyncWorker.start();
  tokenMetadataSyncWorker.start();

  const app = await buildApp(indexer);
  await app.listen({ host: "0.0.0.0", port: env.PORT });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
