import { env } from "../config/env";

const LAMPORTS_PER_SOL = 1_000_000_000n;

type UnknownRecord = Record<string, unknown>;

export type BagsClaimablePosition = UnknownRecord & {
  tokenMint?: string;
  baseMint?: string;
  quoteMint?: string;
};

export type BagsClaimTransactionsResponse = UnknownRecord;

function buildUrl(path: string, query?: Record<string, string>) {
  const url = new URL(path, env.BAGS_API_BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function request<T>(path: string, init?: RequestInit, query?: Record<string, string>): Promise<T> {
  const response = await fetch(buildUrl(path, query), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.BAGS_API_KEY,
      ...(init?.headers ?? {})
    }
  });

  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    throw new Error(`Bags API ${response.status} ${response.statusText}: ${text}`);
  }
  return body as T;
}

export async function getClaimablePositions(receiverWallet: string): Promise<BagsClaimablePosition[]> {
  const response = await request<unknown>(
    "/token-launch/claimable-positions",
    {
      method: "GET"
    },
    {
      wallet: receiverWallet
    }
  );

  if (Array.isArray(response)) {
    return response as BagsClaimablePosition[];
  }
  if (response && typeof response === "object" && Array.isArray((response as { data?: unknown[] }).data)) {
    return (response as { data: BagsClaimablePosition[] }).data;
  }
  return [];
}

export async function getClaimTransactionsV3(input: {
  receiverWallet: string;
  tokenMint: string;
}): Promise<BagsClaimTransactionsResponse> {
  return request<BagsClaimTransactionsResponse>(`/token-launch/claim-txs/v3`, {
    method: "POST",
    body: JSON.stringify({
      feeClaimer: input.receiverWallet,
      tokenMint: input.tokenMint
    })
  });
}

export function resolveTokenMint(position: BagsClaimablePosition): string | null {
  const candidates = [position.tokenMint, position.baseMint, position.quoteMint]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  return candidates[0] ?? null;
}

export function readLamports(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return 0n;
    }
    try {
      return BigInt(normalized);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

export function lamportsToSolString(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const fraction = lamports % LAMPORTS_PER_SOL;
  return `${whole}.${fraction.toString().padStart(9, "0")}`;
}

export function extractClaimableLamports(position: BagsClaimablePosition): bigint {
  return (
    readLamports(position.totalClaimablePositionLamportsUserShare) ||
    readLamports(position.totalClaimablePositionLamports) ||
    readLamports(position.userClaimablePositionLamports) ||
    0n
  );
}

export function extractTransactionCount(response: unknown): number {
  if (Array.isArray(response)) {
    return response.length;
  }
  if (!response || typeof response !== "object") {
    return 0;
  }
  const maybeArrays = [
    (response as { transactions?: unknown[] }).transactions,
    (response as { txs?: unknown[] }).txs,
    (response as { claimTransactions?: unknown[] }).claimTransactions,
    (response as { data?: unknown[] }).data
  ];
  for (const candidate of maybeArrays) {
    if (Array.isArray(candidate)) {
      return candidate.length;
    }
  }
  return 0;
}
