import { getIndexerState, healthcheck } from "../services/repositories";

export async function registerSystemRoutes(app: any): Promise<void> {
  app.get("/system/health", async () => healthcheck());
  app.get("/system/indexer", async () => ({
    ...(await getIndexerState()),
    runtime: app.indexer.getHealth()
  }));
}
