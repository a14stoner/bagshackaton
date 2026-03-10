import { z } from "zod";
import { runRewardDraw } from "../modules/draws/reward-engine";
import { getTokenByMint } from "../services/repositories";

const drawSchema = z.object({
  tokenMint: z.string().min(32),
  treasuryBalance: z.coerce.number().nonnegative().optional()
});

export async function registerAdminRoutes(app: any): Promise<void> {
  app.post("/admin/resync", async () => {
    return {
      accepted: true,
      mode: "manual-resync-not-enabled"
    };
  });

  app.post("/admin/run-draw", async (request: any) => {
    const payload = drawSchema.parse(request.body);
    const token = await getTokenByMint(payload.tokenMint);
    const treasuryBalance = payload.treasuryBalance ?? Number(token?.treasury_balance ?? 0);
    return runRewardDraw(payload.tokenMint, treasuryBalance, 0.42);
  });
}
