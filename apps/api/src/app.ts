import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import Fastify from "fastify";
import type { BagsIndexer } from "./indexer/bags-indexer";
import { registerAdminRoutes } from "./routes/admin";
import { registerSystemRoutes } from "./routes/system";
import { registerTokenRoutes } from "./routes/tokens";
import { logger } from "./services/logger";

export async function buildApp(indexer: BagsIndexer) {
  const app = Fastify({ loggerInstance: logger });
  app.decorate("indexer", indexer);
  await app.register(cors, { origin: true });
  await app.register(sensible);
  await registerTokenRoutes(app);
  await registerSystemRoutes(app);
  await registerAdminRoutes(app);
  return app;
}
