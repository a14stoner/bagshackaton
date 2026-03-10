export type WeightedCandidate = {
  wallet: string;
  score: number;
  cooldownUntilDraw: number | null;
};

export type WinnerSelectionInput = {
  drawNumber: number;
  candidates: WeightedCandidate[];
  random: number;
};

export function selectWeightedWinner(input: WinnerSelectionInput): WeightedCandidate | null {
  const eligible = input.candidates.filter(
    (candidate) =>
      candidate.score > 0 &&
      (candidate.cooldownUntilDraw === null || candidate.cooldownUntilDraw < input.drawNumber),
  );

  if (eligible.length === 0) {
    return null;
  }

  const totalWeight = eligible.reduce((sum, candidate) => sum + candidate.score, 0);
  if (totalWeight <= 0) {
    return null;
  }

  let cursor = Math.min(Math.max(input.random, 0), 0.999999999) * totalWeight;
  for (const candidate of eligible) {
    cursor -= candidate.score;
    if (cursor <= 0) {
      return candidate;
    }
  }

  return eligible.at(-1) ?? null;
}
