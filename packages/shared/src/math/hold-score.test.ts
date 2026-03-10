import { describe, expect, it } from "vitest";
import { calculateHoldScore, normalizeSellRatio } from "./hold-score";
import { selectWeightedWinner } from "./winner-selection";

describe("calculateHoldScore", () => {
  it("matches the hackathon example", () => {
    expect(calculateHoldScore({ holdHours: 48, percentSupply: 0.01, sellRatio: 0.25 })).toBe(12);
  });

  it("returns zero when fully sold", () => {
    expect(calculateHoldScore({ holdHours: 10, percentSupply: 0.2, sellRatio: 1 })).toBe(0);
  });
});

describe("normalizeSellRatio", () => {
  it("handles empty acquisition safely", () => {
    expect(normalizeSellRatio(0, 0)).toBe(0);
    expect(normalizeSellRatio(0, 5)).toBe(1);
  });
});

describe("selectWeightedWinner", () => {
  it("skips candidates in cooldown", () => {
    const winner = selectWeightedWinner({
      drawNumber: 4,
      random: 0.1,
      candidates: [
        { wallet: "cooldown", score: 100, cooldownUntilDraw: 8 },
        { wallet: "active", score: 30, cooldownUntilDraw: null }
      ]
    });

    expect(winner?.wallet).toBe("active");
  });
});
