import { describe, expect, it, vi } from "vitest";

vi.mock("../src/config/env", () => ({
  env: {
    BAGS_API_BASE_URL: "https://public-api-v2.bags.fm",
    BAGS_API_KEY: "test-key"
  }
}));

describe("bags api helpers", async () => {
  const { extractClaimableLamports, extractTransactionCount, lamportsToSolString, resolveTokenMint } = await import(
    "../src/services/bags-api"
  );

  it("resolves token mint and claimable lamports from claimable position payload", () => {
    const position = {
      tokenMint: "TokenMint111",
      totalClaimablePositionLamportsUserShare: "123456789"
    };

    expect(resolveTokenMint(position)).toBe("TokenMint111");
    expect(extractClaimableLamports(position)).toBe(123456789n);
    expect(lamportsToSolString(123456789n)).toBe("0.123456789");
  });

  it("extracts transaction count from multiple response shapes", () => {
    expect(extractTransactionCount({ transactions: [1, 2, 3] })).toBe(3);
    expect(extractTransactionCount({ txs: [1] })).toBe(1);
    expect(extractTransactionCount({ data: [1, 2] })).toBe(2);
    expect(extractTransactionCount([])).toBe(0);
  });
});
