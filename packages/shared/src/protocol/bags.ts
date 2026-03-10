export const MAX_FEE_RECEIVERS = 100;

export type FeeReceiverConfig = {
  wallet: string;
  allocationBps: number;
};

export type ParsedFeeConfig = {
  account: string;
  receivers: FeeReceiverConfig[];
};

export function isTrackedFeeReceiver(
  receivers: FeeReceiverConfig[],
  targetWallet: string,
): boolean {
  return receivers.some((receiver) => receiver.wallet === targetWallet);
}
