import { describe, expect, it } from "vitest";
import { decodeMetadataAccount } from "../src/services/token-metadata";

function encodeBorshString(value: string): Buffer {
  const text = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(text.length, 0);
  return Buffer.concat([length, text]);
}

describe("decodeMetadataAccount", () => {
  it("decodes name, symbol, and uri from borsh metadata strings", () => {
    const header = Buffer.alloc(1 + 32 + 32, 0);
    const raw = Buffer.concat([
      header,
      encodeBorshString("Bags Test"),
      encodeBorshString("BAGT"),
      encodeBorshString("https://example.com/metadata.json")
    ]);

    const decoded = decodeMetadataAccount(raw);
    expect(decoded).toEqual({
      name: "Bags Test",
      symbol: "BAGT",
      uri: "https://example.com/metadata.json"
    });
  });

  it("returns null for truncated metadata", () => {
    expect(decodeMetadataAccount(Buffer.alloc(10))).toBeNull();
  });
});
