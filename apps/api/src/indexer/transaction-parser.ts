import { createRequire } from "node:module";
import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import dammV2Idl from "./idls/damm_v2.json";
import dynamicBondingCurveIdl from "./idls/dynamic_bonding_curve.json";
import feeShareV2Idl from "./idls/fee_share_v2.json";
import type { IndexedEvent } from "./types";

const require = createRequire(import.meta.url);
const yellowstoneModule = require("@triton-one/yellowstone-grpc") as {
  txEncode: {
    encoding: { Json: number };
    encode: (message: unknown, encoding: number, maxSupportedTransactionVersion?: number, showRewards?: boolean) => any;
  };
};
const txEncode = yellowstoneModule.txEncode;
const bs58Module = require("bs58") as {
  default?: { encode(value: Uint8Array | Buffer): string; decode(value: string): Uint8Array };
  encode?: (value: Uint8Array | Buffer) => string;
  decode?: (value: string) => Uint8Array;
};
const bs58 = bs58Module.default ?? bs58Module;

type YellowstoneUpdate = {
  transaction?: {
    slot?: number | string | bigint;
    transaction?: unknown;
  };
};

type EncodedTokenBalance = {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount: {
    amount: string;
    decimals: number;
    uiAmount?: number | null;
    uiAmountString?: string;
  };
};

type EncodedInstruction = {
  accounts: Array<number | string>;
  data: string;
  programIdIndex: number;
};

type EncodedInnerInstructionGroup = {
  index: number;
  instructions: EncodedInstruction[];
};

type EncodedJsonTransaction = {
  slot?: number | string | bigint;
  blockTime?: number | string | null;
  meta?: {
    err?: unknown;
    logMessages?: string[];
    preBalances?: Array<number | string | bigint>;
    postBalances?: Array<number | string | bigint>;
    preTokenBalances?: EncodedTokenBalance[];
    postTokenBalances?: EncodedTokenBalance[];
    loadedAddresses?: {
      writable?: string[];
      readonly?: string[];
    };
    innerInstructions?: EncodedInnerInstructionGroup[];
  };
  transaction?: {
    signatures?: string[];
    message?: {
      accountKeys?: string[];
      instructions?: EncodedInstruction[];
    };
  };
};

const PROGRAM_IDS = {
  dammV2: "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG",
  dynamicBondingCurve: "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN",
  wsol: "So11111111111111111111111111111111111111112",
  usdc: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  usdt: "Es9vMFrzaCERmJfrF4H2NQ6KxuxMxDPk9vywgqbiZ9er",
  feeShareV1: "FEEhPbKVKnco9EXnaY3i4R5rQVUx91wgVfu8qokixywi",
  feeShareV2: "FEE2tBhCKAt7shrod19QttSVREUYPiyMzoku1mL1gqVK"
} as const;

const dammV2Coder = new BorshCoder(dammV2Idl as any);
const dynamicBondingCurveCoder = new BorshCoder(dynamicBondingCurveIdl as any);
const feeShareV2Coder = new BorshCoder(feeShareV2Idl as any);
const dammV2EventParser = new EventParser(new PublicKey(PROGRAM_IDS.dammV2), dammV2Coder as any);
const dynamicBondingCurveEventParser = new EventParser(
  new PublicKey(PROGRAM_IDS.dynamicBondingCurve),
  dynamicBondingCurveCoder as any
);
const feeShareV2EventParser = new EventParser(new PublicKey(PROGRAM_IDS.feeShareV2), feeShareV2Coder as any);
const dammV2EventCoder = dammV2Coder.events;
const dynamicBondingCurveEventCoder = dynamicBondingCurveCoder.events;
const feeShareV2EventCoder = feeShareV2Coder.events;
const dammV2InstructionCoder = dammV2Coder.instruction;
const dynamicBondingCurveInstructionCoder = dynamicBondingCurveCoder.instruction;
const feeShareV2InstructionCoder = feeShareV2Coder.instruction;

type AnchorInstructionMatch = {
  source: "message" | "inner";
  programId: string;
  name: string;
  data: Record<string, unknown>;
  accounts: string[];
};

export function parseYellowstoneUpdate(update: YellowstoneUpdate): IndexedEvent[] {
  const decoded = tryDecodeTransaction(update);
  return parseEncodedTransaction(decoded, update.transaction?.slot);
}

export function parseRpcJsonTransaction(transaction: unknown): IndexedEvent[] {
  const decoded = isEncodedJsonTransaction(transaction) ? normalizeEncodedTransaction(transaction) : null;
  return parseEncodedTransaction(decoded, decoded?.slot);
}

function parseEncodedTransaction(
  decoded: EncodedJsonTransaction | null,
  fallbackSlot: number | string | bigint | undefined
): IndexedEvent[] {
  if (!decoded || !decoded.transaction?.message || decoded.meta?.err) {
    return [];
  }

  const signature = decoded.transaction.signatures?.[0] ?? "";
  const slot = toBigInt(decoded.slot ?? fallbackSlot ?? 0);
  const occurredAt = toDate(decoded.blockTime);
  const accountKeys = getResolvedAccountKeys(decoded);
  const instructionMatches = extractAnchorInstructionMatches(decoded, accountKeys);
  const anchorEvents = extractAnchorEvents(decoded, accountKeys);
  const events: IndexedEvent[] = [];
  let swapDetected = false;

  for (const match of instructionMatches.dynamic) {
    if (isSwapEvent(match.name)) {
      const swap = buildSwapFromAnchor(decoded.meta, accountKeys, signature, slot, occurredAt, "bonding_curve", match.data);
      if (swap) {
        swapDetected = true;
        events.push(swap);
      }
      continue;
    }

    if (isTokenCreateInstruction(match.name)) {
      const mint = findLargestNonWsolMint(decoded.meta);
      if (mint) {
        events.push({
          kind: "token_discovered",
          mint,
          symbol: "UNKNOWN",
          name: "Bags Token",
          feeConfigAccount: null,
          totalSupply: "1000000000",
          slot,
          signature,
          occurredAt
        });
      }
    }
  }

  for (const match of instructionMatches.damm) {
    if (!isSwapEvent(match.name)) {
      continue;
    }
    const swap = buildSwapFromAnchor(decoded.meta, accountKeys, signature, slot, occurredAt, "damm", match.data);
    if (swap) {
      swapDetected = true;
      events.push(swap);
    }
  }

  for (const event of anchorEvents.dynamic) {
    if (isSwapEvent(event.name)) {
      const swap = buildSwapFromAnchor(decoded.meta, accountKeys, signature, slot, occurredAt, "bonding_curve", event.data);
      if (swap) {
        swapDetected = true;
        events.push(swap);
      }
      continue;
    }

    if (isMigrationEvent(event.name)) {
      const mint = findLargestNonWsolMint(decoded.meta);
      if (mint) {
        events.push({
          kind: "migration",
          mint,
          signature,
          slot,
          occurredAt
        });
      }
    }
  }

  for (const event of anchorEvents.damm) {
    if (!isSwapEvent(event.name)) {
      continue;
    }
    const swap = buildSwapFromAnchor(decoded.meta, accountKeys, signature, slot, occurredAt, "damm", event.data);
    if (swap) {
      swapDetected = true;
      events.push(swap);
    }
  }

  for (const event of anchorEvents.feeShareV2) {
    const feeConfigEvent = buildFeeConfiguredEventFromAnchorEvent(event, signature, slot, occurredAt);
    if (feeConfigEvent) {
      events.push(feeConfigEvent);
    }
  }

  for (const match of instructionMatches.feeShareV2) {
    const feeConfigEvent = buildFeeConfiguredEventFromFeeInstruction(match, signature, slot, occurredAt);
    if (feeConfigEvent) {
      events.push(feeConfigEvent);
    }
  }

  if (!swapDetected && instructionMatches.dynamic.length === 0 && instructionMatches.damm.length === 0) {
    events.push(...buildTransferEvents(decoded.meta, signature, slot, occurredAt));
  }

  return dedupeEvents(events);
}

export function summarizeYellowstoneUpdate(update: YellowstoneUpdate) {
  const decoded = tryDecodeTransaction(update);
  if (!decoded?.transaction?.message) {
    return { decoded: false };
  }

  const accountKeys = getResolvedAccountKeys(decoded);
  const anchorEvents = extractAnchorEvents(decoded, accountKeys);
  const instructionMatches = extractAnchorInstructionMatches(decoded, accountKeys);
  const rawInstructionCounts = getProgramInstructionCounts(decoded, accountKeys);
  const targetInstructionCount = rawInstructionCounts.dynamic + rawInstructionCounts.damm + rawInstructionCounts.feeShareV2;
  const targetMatchCount =
    instructionMatches.dynamic.length + instructionMatches.damm.length + instructionMatches.feeShareV2.length;
  const targetEventCount = anchorEvents.dynamic.length + anchorEvents.damm.length + anchorEvents.feeShareV2.length;
  const logMessagesSample = (decoded.meta?.logMessages ?? []).slice(0, 8);
  const hasNoiseLogs = logMessagesSample.some((line) => {
    const normalized = line.toLowerCase();
    return (
      normalized.includes("no arbitrage profit found") ||
      normalized.includes("no arb opportunity found") ||
      normalized.includes("no arb found")
    );
  });
  const setupOnlyLogs =
    logMessagesSample.length > 0 &&
    logMessagesSample.every((line) => {
      const normalized = line.toLowerCase();
      return (
        normalized.includes("computebudget111111111111111111111111111111") ||
        normalized.includes("program log: createidempotent") ||
        normalized.includes("program log: instruction: getaccountdatasize") ||
        normalized.includes("atokengpvbdgvxr1b2hvzbsiqw5xwh25eftnslja8knl") ||
        normalized.includes("tokenkegqfezyinwajbnbgkpfxcwubvf9ss623vq5da") ||
        normalized.includes("11111111111111111111111111111111") ||
        normalized.includes("program return:")
      );
    });
  const candidateMints = extractCandidateTokenMints(decoded.meta);

  return {
    decoded: true,
    signature: decoded.transaction.signatures?.[0] ?? "",
    slot: String(decoded.slot ?? update.transaction?.slot ?? ""),
    failed: Boolean(decoded.meta?.err),
    error: normalizeErrorValue(decoded.meta?.err),
    hasTargetActivity: targetInstructionCount > 0 || targetMatchCount > 0 || targetEventCount > 0,
    hasNoiseLogs,
    setupOnlyLogs,
    rawInstructionCounts,
    instructionMatches: {
      dynamic: instructionMatches.dynamic.map((match) => match.name),
      damm: instructionMatches.damm.map((match) => match.name),
      feeShareV2: instructionMatches.feeShareV2.map((match) => match.name)
    },
    anchorEvents: {
      dynamic: anchorEvents.dynamic.map((event) => event.name),
      damm: anchorEvents.damm.map((event) => event.name),
      feeShareV2: anchorEvents.feeShareV2.map((event) => event.name)
    },
    candidateMints,
    logMessagesSample
  };
}

function extractCandidateTokenMints(meta: EncodedJsonTransaction["meta"]): string[] {
  const balances = [...(meta?.preTokenBalances ?? []), ...(meta?.postTokenBalances ?? [])];
  const unique = new Set<string>();
  for (const balance of balances) {
    if (!isCandidateTokenMint(balance.mint)) {
      continue;
    }
    unique.add(balance.mint);
    if (unique.size >= 8) {
      break;
    }
  }
  return [...unique];
}

function buildSwapFromAnchor(
  meta: EncodedJsonTransaction["meta"],
  accountKeys: string[],
  signature: string,
  slot: bigint,
  occurredAt: Date,
  pool: "bonding_curve" | "damm",
  anchorData: Record<string, unknown>
): IndexedEvent | null {
  const tokenDeltas = getTokenBalanceDeltas(meta).filter((entry) => entry.mint !== PROGRAM_IDS.wsol && entry.delta !== 0);
  if (tokenDeltas.length === 0) {
    return null;
  }

  const primaryTokenDelta = tokenDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
  if (!primaryTokenDelta || !isCandidateTokenMint(primaryTokenDelta.mint)) {
    return null;
  }

  const traderWallet = resolveTraderWallet(primaryTokenDelta.owner ?? "", accountKeys, meta);
  if (!traderWallet) {
    return null;
  }

  let side: "buy" | "sell" = primaryTokenDelta.delta > 0 ? "buy" : "sell";
  let tokenAmount = Math.abs(primaryTokenDelta.delta);
  let solAmount = 0;

  const ownerWsolDelta = getTokenBalanceDeltas(meta).find(
    (entry) => entry.owner === traderWallet && entry.mint === PROGRAM_IDS.wsol && entry.delta !== 0
  );
  if (ownerWsolDelta) {
    solAmount = Math.abs(ownerWsolDelta.delta);
    side = ownerWsolDelta.delta < 0 ? "buy" : "sell";
  } else {
    const traderIndex = accountKeys.findIndex((key) => key === traderWallet);
    if (traderIndex !== -1) {
      const nativeDelta = getNativeBalanceDelta(meta, traderIndex);
      if (nativeDelta !== 0) {
        solAmount = Math.abs(nativeDelta);
        side = nativeDelta < 0 ? "buy" : "sell";
      }
    }
  }

  // Fallback: some routed swaps do not expose owner-level WSOL/native deltas.
  // Use the largest absolute WSOL token delta in the tx so swap is still captured.
  if (solAmount <= 0) {
    const anyWsolDelta = getTokenBalanceDeltas(meta)
      .filter((entry) => entry.mint === PROGRAM_IDS.wsol && entry.delta !== 0)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
    if (anyWsolDelta) {
      solAmount = Math.abs(anyWsolDelta.delta);
    }
  }

  const anchorAmounts = extractAnchorSwapAmounts(pool, anchorData);
  if (anchorAmounts) {
    if (anchorAmounts.tokenAmount > 0) {
      tokenAmount = anchorAmounts.tokenAmount;
    }
    if (anchorAmounts.solAmount > 0) {
      solAmount = anchorAmounts.solAmount;
    }
  }

  if (tokenAmount <= 0 || solAmount <= 0) {
    return null;
  }

  return {
    kind: "swap",
    mint: primaryTokenDelta.mint,
    signature,
    slot,
    traderWallet,
    side,
    amountIn: side === "buy" ? solAmount.toString() : tokenAmount.toString(),
    amountOut: side === "buy" ? tokenAmount.toString() : solAmount.toString(),
    price: (solAmount / tokenAmount).toString(),
    pool,
    occurredAt
  };
}

function buildTransferEvents(
  meta: EncodedJsonTransaction["meta"],
  signature: string,
  slot: bigint,
  occurredAt: Date
): IndexedEvent[] {
  const deltas = getTokenBalanceDeltas(meta).filter((entry) => entry.mint !== PROGRAM_IDS.wsol && entry.delta !== 0);
  const byMint = new Map<string, typeof deltas>();

  for (const delta of deltas) {
    if (!isCandidateTokenMint(delta.mint) || !delta.owner || !isLikelyWallet(delta.owner)) {
      continue;
    }
    const existing = byMint.get(delta.mint) ?? [];
    existing.push(delta);
    byMint.set(delta.mint, existing);
  }

  const transfers: IndexedEvent[] = [];
  for (const [mint, entries] of byMint.entries()) {
    if (entries.length !== 2) {
      continue;
    }
    const outgoing = entries.find((entry) => entry.delta < 0);
    const incoming = entries.find((entry) => entry.delta > 0);
    if (!outgoing || !incoming || !outgoing.owner || !incoming.owner || outgoing.owner === incoming.owner) {
      continue;
    }

    const outgoingAmount = Math.abs(outgoing.delta);
    const incomingAmount = Math.abs(incoming.delta);
    const amount = Math.min(outgoingAmount, incomingAmount);
    if (amount <= 0) {
      continue;
    }

    const difference = Math.abs(outgoingAmount - incomingAmount);
    const differenceRatio = difference / Math.max(outgoingAmount, incomingAmount);
    if (differenceRatio > 0.02) {
      continue;
    }

    transfers.push({
      kind: "transfer",
      mint,
      signature,
      slot,
      fromWallet: outgoing.owner,
      toWallet: incoming.owner,
      amount: amount.toString(),
      occurredAt
    });
  }

  return transfers;
}

function extractAnchorSwapAmounts(
  pool: "bonding_curve" | "damm",
  eventData: Record<string, unknown>
): { tokenAmount: number; solAmount: number } | null {
  if (pool === "bonding_curve") {
    const tokenAmount = toEventNumber(eventData.out_amount);
    const solAmount = toEventNumber(eventData.in_amount);
    if (tokenAmount > 0 && solAmount > 0) {
      return { tokenAmount, solAmount };
    }
    return null;
  }

  const swapResult = eventData.swap_result as Record<string, unknown> | undefined;
  const tokenAmount = toEventNumber(swapResult?.output_amount);
  const solAmount =
    toEventNumber(swapResult?.included_fee_input_amount) ||
    toEventNumber(swapResult?.excluded_fee_input_amount) ||
    toEventNumber((eventData.params as Record<string, unknown> | undefined)?.amount_0);
  if (tokenAmount > 0 && solAmount > 0) {
    return { tokenAmount, solAmount };
  }
  return null;
}

function extractAnchorEvents(decoded: EncodedJsonTransaction, accountKeys: string[]) {
  const dynamic: Array<{ name: string; data: Record<string, unknown> }> = [];
  const damm: Array<{ name: string; data: Record<string, unknown> }> = [];
  const feeShareV2: Array<{ name: string; data: Record<string, unknown> }> = [];
  const logMessages = decoded.meta?.logMessages ?? [];

  try {
    for (const event of dynamicBondingCurveEventParser.parseLogs(logMessages)) {
      dynamic.push({ name: event.name, data: event.data as Record<string, unknown> });
    }
  } catch {
    // ignore malformed logs
  }

  try {
    for (const event of dammV2EventParser.parseLogs(logMessages)) {
      damm.push({ name: event.name, data: event.data as Record<string, unknown> });
    }
  } catch {
    // ignore malformed logs
  }

  try {
    for (const event of feeShareV2EventParser.parseLogs(logMessages)) {
      feeShareV2.push({ name: event.name, data: event.data as Record<string, unknown> });
    }
  } catch {
    // ignore malformed logs
  }

  for (const instruction of collectInstructions(decoded, accountKeys)) {
    if (instruction.programId === PROGRAM_IDS.dammV2) {
      const event = decodeAnchorEventFromInstructionData(instruction.data, dammV2EventCoder as { decode?: (data: string) => any });
      if (event) {
        damm.push(event);
      }
      continue;
    }

    if (instruction.programId === PROGRAM_IDS.dynamicBondingCurve) {
      const event = decodeAnchorEventFromInstructionData(
        instruction.data,
        dynamicBondingCurveEventCoder as { decode?: (data: string) => any }
      );
      if (event) {
        dynamic.push(event);
      }
      continue;
    }

    if (instruction.programId === PROGRAM_IDS.feeShareV2) {
      const event = decodeAnchorEventFromInstructionData(
        instruction.data,
        feeShareV2EventCoder as { decode?: (data: string) => any }
      );
      if (event) {
        feeShareV2.push(event);
      }
    }
  }

  return { dynamic, damm, feeShareV2 };
}

function extractAnchorInstructionMatches(decoded: EncodedJsonTransaction, accountKeys: string[]) {
  const dynamic: AnchorInstructionMatch[] = [];
  const damm: AnchorInstructionMatch[] = [];
  const feeShareV2: AnchorInstructionMatch[] = [];

  for (const instruction of collectInstructions(decoded, accountKeys)) {
    if (instruction.programId === PROGRAM_IDS.dynamicBondingCurve) {
      const decodedInstruction = decodeAnchorInstructionData(
        instruction.data,
        dynamicBondingCurveInstructionCoder as { decode?: (ix: string, encoding?: "hex" | "base58") => any }
      );
      if (decodedInstruction) {
        dynamic.push({
          source: instruction.source,
          programId: instruction.programId,
          name: decodedInstruction.name,
          data: decodedInstruction.data,
          accounts: instruction.accounts
        });
      }
      continue;
    }

    if (instruction.programId === PROGRAM_IDS.dammV2) {
      const decodedInstruction = decodeAnchorInstructionData(
        instruction.data,
        dammV2InstructionCoder as { decode?: (ix: string, encoding?: "hex" | "base58") => any }
      );
      if (decodedInstruction) {
        damm.push({
          source: instruction.source,
          programId: instruction.programId,
          name: decodedInstruction.name,
          data: decodedInstruction.data,
          accounts: instruction.accounts
        });
      }
      continue;
    }

    if (instruction.programId === PROGRAM_IDS.feeShareV2) {
      const decodedInstruction = decodeAnchorInstructionData(
        instruction.data,
        feeShareV2InstructionCoder as { decode?: (ix: string, encoding?: "hex" | "base58") => any }
      );
      if (decodedInstruction) {
        feeShareV2.push({
          source: instruction.source,
          programId: instruction.programId,
          name: decodedInstruction.name,
          data: decodedInstruction.data,
          accounts: instruction.accounts
        });
      }
    }
  }

  return { dynamic, damm, feeShareV2 };
}

function decodeAnchorInstructionData(
  instructionData: string,
  instructionCoder: { decode?: (ix: string, encoding?: "hex" | "base58") => { name: string; data: Record<string, unknown> } | null }
): { name: string; data: Record<string, unknown> } | null {
  if (!instructionData || !instructionCoder?.decode) {
    return null;
  }

  try {
    return instructionCoder.decode(instructionData, "base58");
  } catch {
    return null;
  }
}

function decodeAnchorEventFromInstructionData(
  instructionData: string,
  eventCoder: { decode?: (data: string) => { name: string; data: Record<string, unknown> } | null }
): { name: string; data: Record<string, unknown> } | null {
  if (!instructionData || !eventCoder?.decode) {
    return null;
  }

  try {
    if (!bs58.decode) {
      return null;
    }
    const bytes = bs58.decode(instructionData);
    const base64Data = Buffer.from(bytes).toString("base64");
    return eventCoder.decode(base64Data);
  } catch {
    return null;
  }
}

function collectInstructions(decoded: EncodedJsonTransaction, accountKeys: string[]) {
  const topLevel = (decoded.transaction?.message?.instructions ?? []).map((ix) => ({
    source: "message" as const,
    programId: accountKeys[ix.programIdIndex] ?? "",
    data: ix.data,
    accounts: resolveInstructionAccounts(ix.accounts, accountKeys)
  }));
  const inner = (decoded.meta?.innerInstructions ?? []).flatMap((group) =>
    (group.instructions ?? []).map((ix) => ({
      source: "inner" as const,
      programId: accountKeys[ix.programIdIndex] ?? "",
      data: ix.data,
      accounts: resolveInstructionAccounts(ix.accounts, accountKeys)
    }))
  );
  return [...topLevel, ...inner];
}

function resolveInstructionAccounts(
  accounts: EncodedInstruction["accounts"] | unknown,
  accountKeys: string[]
): string[] {
  if (Array.isArray(accounts)) {
    return accounts
      .map((index) => accountKeys[Number(index)] ?? "")
      .filter(Boolean);
  }

  if (accounts && typeof accounts === "object") {
    return Object.values(accounts as Record<string, unknown>)
      .map((index) => accountKeys[Number(index)] ?? "")
      .filter(Boolean);
  }

  return [];
}

function getProgramInstructionCounts(decoded: EncodedJsonTransaction, accountKeys: string[]) {
  const instructions = collectInstructions(decoded, accountKeys);
  return {
    dynamic: instructions.filter((ix) => ix.programId === PROGRAM_IDS.dynamicBondingCurve).length,
    damm: instructions.filter((ix) => ix.programId === PROGRAM_IDS.dammV2).length,
    feeShareV2: instructions.filter((ix) => ix.programId === PROGRAM_IDS.feeShareV2).length
  };
}

function isSwapEvent(name: string): boolean {
  return name.toLowerCase().includes("swap");
}

function isTokenCreateInstruction(name: string): boolean {
  const normalized = name.toLowerCase();
  return (
    normalized === "initialize_virtual_pool_with_spl_token" ||
    normalized === "initialize_virtual_pool_with_token2022" ||
    normalized === "create_virtual_pool_metadata"
  );
}

function isMigrationEvent(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("poolcreated") || normalized.includes("poolenabled");
}

function buildFeeConfiguredEventFromAnchorEvent(
  event: { name: string; data: Record<string, unknown> },
  signature: string,
  slot: bigint,
  occurredAt: Date
): IndexedEvent | null {
  const name = event.name.toLowerCase();
  if (!name.includes("feeconfig")) {
    return null;
  }

  const tokenMint = toPubkeyString(event.data.base_mint);
  const feeConfigAccount = toPubkeyString(event.data.fee_config);
  if (!tokenMint || !feeConfigAccount || !isCandidateTokenMint(tokenMint)) {
    return null;
  }

  const claimers = toPubkeyArray(event.data.claimers ?? event.data.new_claimers);
  const bps = toNumericArray(event.data.bps ?? event.data.new_bps);
  if (claimers.length === 0 || claimers.length !== bps.length) {
    return null;
  }

  const receivers = claimers
    .map((wallet, index) => ({ wallet, allocationBps: Math.max(0, Math.floor(bps[index] ?? 0)) }))
    .filter((entry) => entry.wallet && Number.isFinite(entry.allocationBps));

  if (receivers.length === 0) {
    return null;
  }

  return {
    kind: "fee_configured",
    mint: tokenMint,
    feeConfigAccount,
    receivers,
    slot,
    signature,
    occurredAt
  };
}

function buildFeeConfiguredEventFromFeeInstruction(
  instruction: AnchorInstructionMatch,
  signature: string,
  slot: bigint,
  occurredAt: Date
): IndexedEvent | null {
  const instructionName = instruction.name.toLowerCase();
  if (instructionName !== "create_fee_config") {
    return null;
  }

  const tokenMint = instruction.accounts.find((account) => isCandidateTokenMint(account));
  if (!tokenMint) {
    return null;
  }

  const params = (instruction.data.params as Record<string, unknown> | undefined) ?? {};
  const bps = toNumericArray(params.bps);
  if (bps.length === 0) {
    return null;
  }

  const candidateClaimers = instruction.accounts
    .slice(-bps.length)
    .filter((account) => isLikelyWallet(account))
    .slice(0, bps.length);
  if (candidateClaimers.length !== bps.length) {
    return null;
  }

  const receivers = candidateClaimers
    .map((wallet, index) => ({ wallet, allocationBps: Math.max(0, Math.floor(bps[index] ?? 0)) }))
    .filter((entry) => Number.isFinite(entry.allocationBps));
  if (receivers.length !== bps.length) {
    return null;
  }

  const feeConfigAccount = deriveFeeShareConfigPda(tokenMint);
  if (!feeConfigAccount) {
    return null;
  }

  return {
    kind: "fee_configured",
    mint: tokenMint,
    feeConfigAccount,
    receivers,
    slot,
    signature,
    occurredAt
  };
}

function getTokenBalanceDeltas(meta: EncodedJsonTransaction["meta"]) {
  const deltas = new Map<string, { mint: string; owner?: string; delta: number }>();

  for (const pre of meta?.preTokenBalances ?? []) {
    deltas.set(`${pre.accountIndex}:${pre.mint}`, {
      mint: pre.mint,
      owner: pre.owner,
      delta: -toTokenAmount(pre.uiTokenAmount.amount, pre.uiTokenAmount.decimals)
    });
  }

  for (const post of meta?.postTokenBalances ?? []) {
    const key = `${post.accountIndex}:${post.mint}`;
    const existing = deltas.get(key);
    deltas.set(key, {
      mint: post.mint,
      owner: post.owner ?? existing?.owner,
      delta: (existing?.delta ?? 0) + toTokenAmount(post.uiTokenAmount.amount, post.uiTokenAmount.decimals)
    });
  }

  return [...deltas.values()];
}

function findLargestNonWsolMint(meta: EncodedJsonTransaction["meta"]): string | null {
  const balances = meta?.postTokenBalances ?? meta?.preTokenBalances ?? [];
  let selected: { mint: string; amount: number } | null = null;

  for (const balance of balances) {
    if (!isCandidateTokenMint(balance.mint)) {
      continue;
    }
    const amount = toTokenAmount(balance.uiTokenAmount.amount, balance.uiTokenAmount.decimals);
    if (!selected || amount > selected.amount) {
      selected = { mint: balance.mint, amount };
    }
  }

  return selected?.mint ?? null;
}

function resolveTraderWallet(traderFromDeltas: string, accountKeys: string[], meta: EncodedJsonTransaction["meta"]): string {
  if (isLikelyWallet(traderFromDeltas)) {
    return traderFromDeltas;
  }

  const pre = meta?.preBalances ?? [];
  const post = meta?.postBalances ?? [];
  let best: { wallet: string; delta: number } | null = null;
  const maxLength = Math.max(pre.length, post.length);
  for (let i = 0; i < maxLength; i += 1) {
    const wallet = accountKeys[i] ?? "";
    if (!isLikelyWallet(wallet)) {
      continue;
    }
    const delta = Number((toLamports(post[i] ?? 0) - toLamports(pre[i] ?? 0)).toFixed(9));
    if (delta === 0) {
      continue;
    }
    if (!best || Math.abs(delta) > Math.abs(best.delta)) {
      best = { wallet, delta };
    }
  }

  if (best?.wallet) {
    return best.wallet;
  }

  // Fallback to fee payer / first account key when delta-based owner discovery is unavailable.
  const feePayer = accountKeys[0] ?? "";
  if (isLikelyWallet(feePayer)) {
    return feePayer;
  }

  return "";
}

function getResolvedAccountKeys(decoded: EncodedJsonTransaction): string[] {
  return [
    ...(decoded.transaction?.message?.accountKeys ?? []),
    ...(decoded.meta?.loadedAddresses?.writable ?? []),
    ...(decoded.meta?.loadedAddresses?.readonly ?? [])
  ];
}

function tryDecodeTransaction(update: YellowstoneUpdate): EncodedJsonTransaction | null {
  try {
    const rawTransaction = update.transaction?.transaction;
    if (!rawTransaction) {
      return null;
    }
    if (isEncodedJsonTransaction(rawTransaction)) {
      return normalizeEncodedTransaction(rawTransaction);
    }
    return normalizeEncodedTransaction(
      txEncode.encode(rawTransaction, txEncode.encoding.Json, undefined, false) as EncodedJsonTransaction
    );
  } catch {
    return null;
  }
}

function isEncodedJsonTransaction(value: unknown): value is EncodedJsonTransaction {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as EncodedJsonTransaction;
  return Boolean(candidate.transaction?.signatures && candidate.transaction?.message?.accountKeys);
}

function normalizeEncodedTransaction(transaction: EncodedJsonTransaction): EncodedJsonTransaction {
  return normalizeValue(transaction) as EncodedJsonTransaction;
}

function normalizeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    if (!bs58.encode) {
      return Buffer.from(value as Uint8Array).toString("hex");
    }
    return bs58.encode(Buffer.from(value as Uint8Array));
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)]));
  }

  return value;
}

function dedupeEvents(events: IndexedEvent[]): IndexedEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    const key =
      event.kind === "swap"
        ? `${event.kind}:${event.mint}:${event.signature}:${event.side}:${event.traderWallet}:${event.amountIn}:${event.amountOut}:${event.pool}`
        : event.kind === "transfer"
          ? `${event.kind}:${event.mint}:${event.signature}:${event.fromWallet}:${event.toWallet}:${event.amount}`
          : `${event.kind}:${event.mint}:${event.signature}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isLikelyWallet(value: string): boolean {
  if (!value || isKnownProgramLike(value)) {
    return false;
  }
  try {
    return PublicKey.isOnCurve(new PublicKey(value).toBytes());
  } catch {
    return false;
  }
}

function isCandidateTokenMint(value: string): boolean {
  return Boolean(value) && value !== PROGRAM_IDS.wsol && !isKnownProgramLike(value);
}

function isKnownProgramLike(value: string): boolean {
  return (
    value === PROGRAM_IDS.wsol ||
    value === PROGRAM_IDS.usdc ||
    value === PROGRAM_IDS.usdt ||
    value === PROGRAM_IDS.dammV2 ||
    value === PROGRAM_IDS.dynamicBondingCurve ||
    value === PROGRAM_IDS.feeShareV1 ||
    value === PROGRAM_IDS.feeShareV2 ||
    value === "ComputeBudget111111111111111111111111111111" ||
    value === "11111111111111111111111111111111" ||
    value === "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" ||
    value === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" ||
    value === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
  );
}

function getNativeBalanceDelta(meta: EncodedJsonTransaction["meta"], accountIndex: number): number {
  const pre = meta?.preBalances?.[accountIndex];
  const post = meta?.postBalances?.[accountIndex];
  if (pre === undefined && post === undefined) {
    return 0;
  }
  return Number((toLamports(post ?? 0) - toLamports(pre ?? 0)).toFixed(9));
}

function toEventNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number((value as { toString: () => string }).toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toPubkeyString(value: unknown): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && "toBase58" in value && typeof (value as { toBase58: unknown }).toBase58 === "function") {
    try {
      return (value as { toBase58: () => string }).toBase58();
    } catch {
      return "";
    }
  }
  if (typeof value === "object" && "toString" in value && typeof (value as { toString: unknown }).toString === "function") {
    try {
      const text = (value as { toString: () => string }).toString();
      return text === "[object Object]" ? "" : text;
    } catch {
      return "";
    }
  }
  return "";
}

function toPubkeyArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => toPubkeyString(entry)).filter(Boolean);
}

function toNumericArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => toEventNumber(entry));
}

function toTokenAmount(amount: string, decimals: number): number {
  return Number(amount) / 10 ** decimals;
}

function toLamports(value: number | string | bigint): number {
  return Number(value) / 10 ** 9;
}

function toBigInt(value: number | string | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function toDate(blockTime: number | string | null | undefined): Date {
  return blockTime ? new Date(Number(blockTime) * 1000) : new Date();
}

function deriveFeeShareConfigPda(baseMint: string): string | null {
  try {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fee_share_config"), new PublicKey(baseMint).toBuffer(), new PublicKey(PROGRAM_IDS.wsol).toBuffer()],
      new PublicKey(PROGRAM_IDS.feeShareV2)
    );
    return pda.toBase58();
  } catch {
    return null;
  }
}

function normalizeErrorValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
