import { env } from "../config/env";

const LAMPORTS_PER_SOL = 1_000_000_000n;

type UnknownRecord = Record<string, unknown>;

export type BagsClaimablePosition = UnknownRecord & {
  tokenMint?: string;
  baseMint?: string;
  quoteMint?: string;
};

export type BagsClaimTransactionsResponse = UnknownRecord;
export type BagsClaimTransactionEnvelope = {
  serializedTransaction: string;
};

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return trimmed.endsWith("/api/v1") ? trimmed : `${trimmed}/api/v1`;
}

function buildUrl(path: string, query?: Record<string, string>) {
  const normalizedPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(normalizedPath, `${normalizeBaseUrl(env.BAGS_API_BASE_URL)}/`);
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
      ...(env.BAGS_API_KEY ? { Authorization: `Bearer ${env.BAGS_API_KEY}` } : {}),
      ...(init?.headers ?? {})
    }
  });

  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const body = parseResponseBody(text, contentType);
  if (!response.ok) {
    throw new Error(`Bags API ${response.status} ${response.statusText}: ${formatErrorBody(body, text)}`);
  }
  if (body === null) {
    throw new Error(`Bags API returned empty response body for ${buildUrl(path, query)}`);
  }
  return body as T;
}

export async function getClaimablePositions(receiverWallet: string): Promise<BagsClaimablePosition[]> {
  const response = unwrapApiResponse(
    await request<unknown>(
      "/token-launch/claimable-positions",
      {
        method: "GET"
      },
      {
        wallet: receiverWallet
      }
    )
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
  return unwrapApiResponse(
    await request<BagsClaimTransactionsResponse>(`/token-launch/claim-txs/v3`, {
      method: "POST",
      body: JSON.stringify({
        feeClaimer: input.receiverWallet,
        tokenMint: input.tokenMint
      })
    })
  ) as BagsClaimTransactionsResponse;
}

function unwrapApiResponse(response: unknown): unknown {
  if (!response || typeof response !== "object") {
    return response;
  }
  if ("response" in response) {
    return (response as { response?: unknown }).response;
  }
  return response;
}

function parseResponseBody(text: string, contentType: string): unknown {
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  const looksJson = contentType.includes("application/json") || trimmed.startsWith("{") || trimmed.startsWith("[");
  if (!looksJson) {
    throw new Error(`Bags API returned non-JSON response: ${trimmed.slice(0, 200)}`);
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch (error) {
    throw new Error(
      `Failed to parse Bags API JSON response: ${error instanceof Error ? error.message : String(error)}; body=${trimmed.slice(0, 200)}`
    );
  }
}

function formatErrorBody(parsedBody: unknown, rawText: string): string {
  if (parsedBody && typeof parsedBody === "object") {
    return JSON.stringify(parsedBody);
  }
  return rawText.slice(0, 500);
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
    readLamports(position.totalClaimableLamportsUserShare) ||
    readLamports(position.virtualPoolClaimableLamportsUserShare) + readLamports(position.dammPoolClaimableLamportsUserShare) ||
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

export function extractSerializedClaimTransactions(response: unknown): BagsClaimTransactionEnvelope[] {
  if (Array.isArray(response)) {
    return response
      .map(extractSerializedTransaction)
      .filter((serializedTransaction): serializedTransaction is string => Boolean(serializedTransaction))
      .map((serializedTransaction) => ({ serializedTransaction }));
  }
  if (!response || typeof response !== "object") {
    return [];
  }
  const maybeArrays = [
    (response as { transactions?: unknown[] }).transactions,
    (response as { txs?: unknown[] }).txs,
    (response as { claimTransactions?: unknown[] }).claimTransactions,
    (response as { data?: unknown[] }).data
  ];
  for (const candidate of maybeArrays) {
    if (Array.isArray(candidate)) {
      return candidate
        .map(extractSerializedTransaction)
        .filter((serializedTransaction): serializedTransaction is string => Boolean(serializedTransaction))
        .map((serializedTransaction) => ({ serializedTransaction }));
    }
  }
  return [];
}

function extractSerializedTransaction(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const maybeSerialized =
    candidate.serializedTransaction ??
    candidate.serialized_transaction ??
    candidate.transaction ??
    candidate.tx ??
    candidate.base64;
  return typeof maybeSerialized === "string" && maybeSerialized.trim().length > 0 ? maybeSerialized.trim() : null;
}
