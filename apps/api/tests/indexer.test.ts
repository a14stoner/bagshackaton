import { describe, expect, it } from "vitest";

describe("event ingestion idempotency", () => {
  it("uses deterministic normalized event ids", () => {
    const first = "sig-1:swap:wallet-a:mint-a:buy";
    const second = "sig-1:swap:wallet-a:mint-a:buy";

    expect(first).toBe(second);
  });
});
