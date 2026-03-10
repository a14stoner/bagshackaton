import {
  getLatestWinnerByMint,
  getTokenByMint,
  listDrawsByMint,
  listHoldersByMintPaged,
  listRecentDraws,
  listTokens
} from "../services/repositories";

export async function registerTokenRoutes(app: any): Promise<void> {
  app.get("/tokens", async (request: any) => {
    const query = request.query ?? {};
    const trackedOnly = query.trackedOnly === undefined ? true : query.trackedOnly !== "false";
    return listTokens(trackedOnly);
  });

  app.get("/tokens/:mint", async (request: any, reply: any) => {
    const token = await getTokenByMint(request.params.mint);
    if (!token) {
      return reply.notFound("Token not found");
    }
    return token;
  });

  app.get("/tokens/:mint/holders", async (request: any) => {
    const query = request.query ?? {};
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 50)));
    const offset = Math.max(0, Number(query.offset ?? 0));
    const search = typeof query.search === "string" && query.search.trim().length > 0 ? query.search.trim() : null;
    const sortBy =
      query.sortBy === "percent_supply" ||
      query.sortBy === "current_balance" ||
      query.sortBy === "hold_duration_hours" ||
      query.sortBy === "sell_ratio" ||
      query.sortBy === "first_buy_time"
        ? query.sortBy
        : "hold_score";
    const sortOrder = query.sortOrder === "asc" ? "asc" : "desc";

    const rows = await listHoldersByMintPaged({
      mint: request.params.mint,
      limit,
      offset,
      search,
      sortBy,
      sortOrder
    });

    return {
      items: rows.map(({ total_count, ...row }: any) => row),
      total: rows[0]?.total_count ?? 0,
      limit,
      offset
    };
  });

  app.get("/tokens/:mint/draws", async (request: any) =>
    listDrawsByMint(request.params.mint)
  );

  app.get("/tokens/:mint/winner", async (request: any) =>
    getLatestWinnerByMint(request.params.mint)
  );

  app.get("/draws", async (request: any) => {
    const query = request.query ?? {};
    if (typeof query.mint === "string" && query.mint.trim().length > 0) {
      return listDrawsByMint(query.mint.trim());
    }
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 100)));
    return listRecentDraws(limit);
  });
}
