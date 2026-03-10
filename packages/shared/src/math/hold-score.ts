export type HoldScoreInput = {
  holdHours: number;
  percentSupply: number;
  sellRatio: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeSellRatio(totalAcquired: number, soldAmount: number): number {
  if (totalAcquired <= 0) {
    return soldAmount > 0 ? 1 : 0;
  }

  return clamp(soldAmount / totalAcquired, 0, 1);
}

export function calculateHoldScore(input: HoldScoreInput): number {
  const holdHours = Math.max(0, input.holdHours);
  const percentSupply = clamp(input.percentSupply, 0, 1);
  const sellRatio = clamp(input.sellRatio, 0, 1);

  if (holdHours <= 0 || percentSupply <= 0 || sellRatio >= 1) {
    return 0;
  }

  const score =
    holdHours *
    Math.sqrt(percentSupply) *
    10 *
    Math.pow(1 - Math.sqrt(sellRatio), 2);

  return Number(score.toFixed(6));
}
