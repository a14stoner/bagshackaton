export const METEORA_PROGRAM_HINTS = {
  bondingCurve: "Meteora Dynamic Bonding Curve",
  damm: "Meteora DAMM",
  locker: "Locker",
} as const;

export type TokenLifecycleStatus = "DISCOVERED" | "TRACKED" | "MIGRATED" | "INACTIVE";
