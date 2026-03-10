export function shortenAddress(value: string, head = 4, tail = 4): string {
  if (!value || value.length <= head + tail + 1) {
    return value;
  }
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export function formatSol(value: string | number | null | undefined, fractionDigits = 3): string {
  const numberValue = Number(value ?? 0);
  if (!Number.isFinite(numberValue)) {
    return "0";
  }
  return numberValue.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits
  });
}

export function formatPercent(value: number | string | null | undefined, fractionDigits = 2): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) {
    return "0%";
  }
  return `${(n * 100).toFixed(fractionDigits)}%`;
}
