import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const bs58Module = require("bs58") as { default?: { encode(value: Buffer): string }; encode?: (value: Buffer) => string };
const bs58 = bs58Module.default ?? bs58Module;

vi.mock("../src/config/env", () => ({
  env: {
    GRPC_COMMITMENT: "CONFIRMED",
    GRPC_ENDPOINT: "http://localhost:10000",
    GRPC_TOKEN: "",
    INDEXER_PROGRAM_INCLUDE: "ProgramA, ProgramB "
  }
}));

vi.mock("@coral-xyz/anchor", () => {
  class BorshCoder {
    constructor(_: unknown) {}
  }

  class EventParser {
    private readonly programId: string;

    constructor(programId: { toBase58?: () => string } | string) {
      this.programId = typeof programId === "string" ? programId : programId?.toBase58?.() ?? "";
    }

    *parseLogs(logMessages: string[]) {
      const joined = logMessages.join("\n").toLowerCase();
      if (this.programId === "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN") {
        if (joined.includes("anchor-event:dbc-swap")) {
          yield {
            name: "Swap",
            data: {
              in_amount: 0.49999,
              out_amount: 2.5
            }
          };
        }
        return;
      }

      if (this.programId === "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG" && joined.includes("anchor-event:damm-swap2")) {
        yield {
          name: "Swap2",
          data: {
            swap_result: {
              output_amount: 7.5,
              included_fee_input_amount: 0.25
            }
          }
        };
      }

      if (this.programId === "FEE2tBhCKAt7shrod19QttSVREUYPiyMzoku1mL1gqVK" && joined.includes("anchor-event:fee-config")) {
        yield {
          name: "FeeConfigSnapshotEventV2",
          data: {
            base_mint: "8JgragHRBj8nNqhdkBqMsPw46SNjHt3YZ1BEKnZMNByC",
            fee_config: "8fN7mP1Kwbx2wVxN9mU5h9Q8fU5v2uWqT2g7fY4jvW4w",
            claimers: [
              "TargetFeeReceiver11111111111111111111111111111",
              "AnotherReceiver11111111111111111111111111111"
            ],
            bps: [7000, 3000]
          }
        };
      }
    }
  }

  return { BorshCoder, EventParser };
});

describe("yellowstone grpc runtime", async () => {
  const { buildTransactionSubscriptionRequest } = await import("../src/indexer/grpc-runtime");
  const { parseYellowstoneUpdate } = await import("../src/indexer/transaction-parser");

  it("builds a transaction subscription request with program filters", () => {
    const request = buildTransactionSubscriptionRequest();
    expect(request.transactions.meteoraBags.accountInclude).toEqual(["ProgramA", "ProgramB"]);
  });

  it("decodes signature, mint, trader, and swap amounts from a dynamic amm swap instruction", () => {
    if (!bs58.encode) {
      throw new Error("bs58.encode is unavailable in test runtime");
    }
    const swapDiscriminator = bs58.encode(Buffer.from([248, 198, 158, 145, 225, 117, 135, 200]));
    const events = parseYellowstoneUpdate({
      transaction: {
        slot: 123,
        transaction: {
          slot: 123n,
          blockTime: 1_700_000_000,
          meta: {
            err: null,
            fee: 5_000,
            logMessages: ["Program log: anchor-event:dbc-swap"],
            preBalances: [2_000_000_000],
            postBalances: [2_000_000_000],
            preTokenBalances: [
              {
                accountIndex: 1,
                mint: "So11111111111111111111111111111111111111112",
                owner: "Buyer1111111111111111111111111111111111111",
                uiTokenAmount: {
                  amount: "1000000",
                  decimals: 6,
                  uiAmount: 1,
                  uiAmountString: "1"
                }
              },
              {
                accountIndex: 2,
                mint: "4swoALYuvetDK6N3ak1Knc1bMLbm7nzkxCW1nqjPWGRV",
                owner: "Buyer1111111111111111111111111111111111111",
                uiTokenAmount: {
                  amount: "0",
                  decimals: 6,
                  uiAmount: 0,
                  uiAmountString: "0"
                }
              }
            ],
            postTokenBalances: [
              {
                accountIndex: 1,
                mint: "So11111111111111111111111111111111111111112",
                owner: "Buyer1111111111111111111111111111111111111",
                uiTokenAmount: {
                  amount: "500010",
                  decimals: 6,
                  uiAmount: 0.50001,
                  uiAmountString: "0.50001"
                }
              },
              {
                accountIndex: 2,
                mint: "4swoALYuvetDK6N3ak1Knc1bMLbm7nzkxCW1nqjPWGRV",
                owner: "Buyer1111111111111111111111111111111111111",
                uiTokenAmount: {
                  amount: "2500000",
                  decimals: 6,
                  uiAmount: 2.5,
                  uiAmountString: "2.5"
                }
              }
            ]
          },
          transaction: {
            signatures: ["5xQFakeSig111111111111111111111111111111111111111111111111111"],
            message: {
              accountKeys: [
                "Pool111111111111111111111111111111111111111",
                "UserWsolAta11111111111111111111111111111111",
                "UserTokenAta1111111111111111111111111111111",
                "VaultA1111111111111111111111111111111111111",
                "VaultB1111111111111111111111111111111111111",
                "TokenVaultA111111111111111111111111111111111",
                "TokenVaultB111111111111111111111111111111111",
                "VaultLpMintA1111111111111111111111111111111",
                "VaultLpMintB1111111111111111111111111111111",
                "VaultLpA11111111111111111111111111111111111",
                "VaultLpB11111111111111111111111111111111111",
                "ProtocolFee11111111111111111111111111111111",
                "Buyer1111111111111111111111111111111111111",
                "VaultProgram1111111111111111111111111111111",
                "TokenProgram11111111111111111111111111111111",
                "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"
              ],
              instructions: [
                {
                  accounts: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
                  data: swapDiscriminator,
                  programIdIndex: 15
                }
              ]
            }
          }
        }
      }
    });

    const swapEvent = events.find((event) => event.kind === "swap");
    expect(swapEvent).toBeDefined();
    expect(swapEvent).toMatchObject({
      kind: "swap",
      mint: "4swoALYuvetDK6N3ak1Knc1bMLbm7nzkxCW1nqjPWGRV",
      signature: "5xQFakeSig111111111111111111111111111111111111111111111111111",
      traderWallet: "Buyer1111111111111111111111111111111111111",
      side: "buy",
      amountIn: "0.49999",
      amountOut: "2.5",
      pool: "bonding_curve"
    });
  });

  it("falls back to native SOL balance deltas when cpamm swap does not expose a WSOL token delta", () => {
    if (!bs58.encode) {
      throw new Error("bs58.encode is unavailable in test runtime");
    }

    const swap2Discriminator = bs58.encode(Buffer.from([65, 75, 63, 76, 235, 91, 91, 136]));
    const trader = "Buyer1111111111111111111111111111111111111";
    const mint = "4swoALYuvetDK6N3ak1Knc1bMLbm7nzkxCW1nqjPWGRV";
    const events = parseYellowstoneUpdate({
      transaction: {
        slot: 456,
        transaction: {
          slot: 456n,
          blockTime: 1_700_000_100,
          meta: {
            err: null,
            fee: 5_000,
            logMessages: ["Program log: anchor-event:damm-swap2"],
            preBalances: [0, 0, 0, 0, 1_500_000_000],
            postBalances: [0, 0, 0, 0, 1_250_000_000],
            preTokenBalances: [
              {
                accountIndex: 2,
                mint,
                owner: trader,
                uiTokenAmount: {
                  amount: "0",
                  decimals: 6,
                  uiAmount: 0,
                  uiAmountString: "0"
                }
              }
            ],
            postTokenBalances: [
              {
                accountIndex: 2,
                mint,
                owner: trader,
                uiTokenAmount: {
                  amount: "7500000",
                  decimals: 6,
                  uiAmount: 7.5,
                  uiAmountString: "7.5"
                }
              }
            ]
          },
          transaction: {
            signatures: ["4NativeSolFallbackSig1111111111111111111111111111111111111111111"],
            message: {
              accountKeys: [
                "PoolAuthority1111111111111111111111111111111",
                "Pool111111111111111111111111111111111111111",
                "UserTokenAta1111111111111111111111111111111",
                "VaultA1111111111111111111111111111111111111",
                trader,
                "VaultB1111111111111111111111111111111111111",
                "So11111111111111111111111111111111111111112",
                mint,
                "TokenProgram11111111111111111111111111111111",
                "TokenProgram22222222222222222222222222222222",
                "Referral1111111111111111111111111111111111",
                "EventAuthority1111111111111111111111111111",
                "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"
              ],
              instructions: [
                {
                  accounts: [0, 1, 2, 2, 3, 5, 6, 7, 4, 8, 9, 10, 11, 12],
                  data: swap2Discriminator,
                  programIdIndex: 12
                }
              ]
            }
          }
        }
      }
    });

    const swapEvent = events.find((event) => event.kind === "swap");
    expect(swapEvent).toBeDefined();
    expect(swapEvent).toMatchObject({
      kind: "swap",
      mint,
      traderWallet: trader,
      side: "buy",
      amountIn: "0.25",
      amountOut: "7.5",
      pool: "damm"
    });
  });

  it("decodes fee share config snapshot events into fee_configured", () => {
    const events = parseYellowstoneUpdate({
      transaction: {
        slot: 789,
        transaction: {
          slot: 789n,
          blockTime: 1_700_000_200,
          meta: {
            err: null,
            logMessages: ["Program log: anchor-event:fee-config"],
            preTokenBalances: [],
            postTokenBalances: []
          },
          transaction: {
            signatures: ["5FeeConfigSig111111111111111111111111111111111111111111111111111"],
            message: {
              accountKeys: [
                "FEE2tBhCKAt7shrod19QttSVREUYPiyMzoku1mL1gqVK"
              ],
              instructions: []
            }
          }
        }
      }
    });

    const feeEvent = events.find((event) => event.kind === "fee_configured");
    expect(feeEvent).toBeDefined();
    expect(feeEvent).toMatchObject({
      kind: "fee_configured",
      mint: "8JgragHRBj8nNqhdkBqMsPw46SNjHt3YZ1BEKnZMNByC",
      feeConfigAccount: "8fN7mP1Kwbx2wVxN9mU5h9Q8fU5v2uWqT2g7fY4jvW4w",
      receivers: [
        { wallet: "TargetFeeReceiver11111111111111111111111111111", allocationBps: 7000 },
        { wallet: "AnotherReceiver11111111111111111111111111111", allocationBps: 3000 }
      ]
    });
  });
});
