import { Connection, PublicKey } from "@solana/web3.js";

const TOKEN_METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

type OnchainMetadata = {
  name: string;
  symbol: string;
  uri: string;
};

type OffchainMetadata = {
  image: string | null;
};

export async function fetchTokenSupply(connection: Connection, mint: string): Promise<string | null> {
  try {
    const supply = await connection.getTokenSupply(new PublicKey(mint), "confirmed");
    return supply.value.amount ?? null;
  } catch {
    return null;
  }
}

export function deriveMetadataPda(mint: string): PublicKey {
  const mintKey = new PublicKey(mint);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mintKey.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID
  );
  return pda;
}

export async function fetchOnchainTokenMetadata(connection: Connection, mint: string): Promise<OnchainMetadata | null> {
  return fetchOnchainTokenMetadataWithTimeout(connection, mint, 4000);
}

export async function fetchOnchainTokenMetadataWithTimeout(
  connection: Connection,
  mint: string,
  timeoutMs: number
): Promise<OnchainMetadata | null> {
  const metadataPda = deriveMetadataPda(mint);
  const accountInfo = await Promise.race([
    connection.getAccountInfo(metadataPda, "confirmed"),
    new Promise<null>((_, reject) =>
      setTimeout(() => reject(new Error(`Onchain metadata lookup timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
  if (!accountInfo?.data) {
    return null;
  }
  return decodeMetadataAccount(accountInfo.data);
}

export async function fetchOffchainMetadata(uri: string): Promise<OffchainMetadata> {
  const sanitizedUri = uri.trim();
  if (!sanitizedUri.startsWith("http://") && !sanitizedUri.startsWith("https://")) {
    return { image: null };
  }

  const response = await fetch(sanitizedUri, {
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) {
    return { image: null };
  }

  const body = (await response.json()) as { image?: unknown };
  return {
    image: typeof body.image === "string" && body.image.trim().length > 0 ? body.image.trim() : null
  };
}

export function decodeMetadataAccount(data: Buffer): OnchainMetadata | null {
  const minimumLength = 1 + 32 + 32;
  if (data.length < minimumLength) {
    return null;
  }

  let cursor = 1 + 32 + 32;
  const nameField = readBorshString(data, cursor);
  cursor += nameField.span;
  const symbolField = readBorshString(data, cursor);
  cursor += symbolField.span;
  const uriField = readBorshString(data, cursor);
  const name = nameField.value;
  const symbol = symbolField.value;
  const uri = uriField.value;

  if (name || symbol || uri) {
    return { name, symbol, uri };
  }

  // Fallback for unexpected legacy padding-only layouts.
  const fixedName = readFixedUtf8(data, 1 + 32 + 32, 32);
  const fixedSymbol = readFixedUtf8(data, 1 + 32 + 32 + 32, 10);
  const fixedUri = readFixedUtf8(data, 1 + 32 + 32 + 32 + 10, 200);

  return { name: fixedName, symbol: fixedSymbol, uri: fixedUri };
}

function readFixedUtf8(buffer: Buffer, offset: number, length: number): string {
  return buffer
    .subarray(offset, offset + length)
    .toString("utf8")
    .replace(/\0/g, "")
    .trim();
}

function readBorshString(buffer: Buffer, offset: number): { value: string; span: number } {
  if (offset + 4 > buffer.length) {
    return { value: "", span: 0 };
  }
  const length = buffer.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  if (length <= 0 || end > buffer.length) {
    return { value: "", span: 4 };
  }
  return {
    value: buffer
      .subarray(start, end)
      .toString("utf8")
      .replace(/\0/g, "")
      .trim(),
    span: 4 + length
  };
}
