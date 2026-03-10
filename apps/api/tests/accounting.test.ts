import { describe, expect, it } from "vitest";
import { calculateHoldScore, normalizeSellRatio, selectWeightedWinner } from "@bags/shared";
import { applyLedgerEvent } from "../src/modules/holders/accounting";

describe("hold score formula", () => {
  it("matches the specification example", () => {
    expect(
      calculateHoldScore({
        holdHours: 48,
        percentSupply: 0.01,
        sellRatio: 0.25
      })
    ).toBe(12);
  });

  it("drops to zero when sell ratio reaches one", () => {
    expect(calculateHoldScore({ holdHours: 48, percentSupply: 0.01, sellRatio: 1 })).toBe(0);
  });
});

describe("sell ratio logic", () => {
  it("treats transferred out as sold through holder accounting", () => {
    const bought = applyLedgerEvent(
      undefined,
      { type: "buy", wallet: "wallet-1", amount: 100, occurredAt: new Date("2026-03-07T00:00:00Z") },
      1_000,
      new Date("2026-03-07T12:00:00Z")
    );
    const transferred = applyLedgerEvent(
      bought,
      { type: "transfer_out", wallet: "wallet-1", amount: 40, occurredAt: new Date("2026-03-07T13:00:00Z") },
      1_000,
      new Date("2026-03-08T00:00:00Z")
    );

    expect(transferred.totalSold).toBe(40);
    expect(transferred.sellRatio).toBeCloseTo(0.4);
  });

  it("clamps over-selling at one", () => {
    expect(normalizeSellRatio(10, 20)).toBe(1);
  });
});

describe("winner selection", () => {
  it("chooses weighted candidates and honors cooldown", () => {
    const winner = selectWeightedWinner({
      drawNumber: 10,
      random: 0.21,
      candidates: [
        { wallet: "cold", score: 100, cooldownUntilDraw: 10 },
        { wallet: "live-a", score: 20, cooldownUntilDraw: null },
        { wallet: "live-b", score: 80, cooldownUntilDraw: null }
      ]
    });

    expect(winner?.wallet).toBe("live-b");
  });
});
