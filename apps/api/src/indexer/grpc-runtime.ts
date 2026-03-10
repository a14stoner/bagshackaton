import { createRequire } from "node:module";
import { env } from "../config/env";

const require = createRequire(import.meta.url);
const YellowstoneModule = require("@triton-one/yellowstone-grpc");
const YellowstoneClient = YellowstoneModule.default as new (endpoint: string, token?: string) => any;
const CommitmentLevel = YellowstoneModule.CommitmentLevel as {
  PROCESSED: number;
  CONFIRMED: number;
  FINALIZED: number;
};

const COMMITMENT_MAP: Record<typeof env.GRPC_COMMITMENT, number> = {
  PROCESSED: CommitmentLevel.PROCESSED,
  CONFIRMED: CommitmentLevel.CONFIRMED,
  FINALIZED: CommitmentLevel.FINALIZED
};

export function createYellowstoneClient() {
  return new YellowstoneClient(env.GRPC_ENDPOINT, env.GRPC_TOKEN || undefined);
}

export function getGrpcCommitment(): number {
  return COMMITMENT_MAP[env.GRPC_COMMITMENT];
}

export function buildTransactionSubscriptionRequest() {
  const accountInclude = env.INDEXER_PROGRAM_INCLUDE.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return {
    commitment: getGrpcCommitment(),
    transactions: {
      meteoraBags: {
        accountInclude,
        accountExclude: [],
        accountRequired: []
      }
    }
  };
}

export async function openTransactionSubscription(client: any) {
  const request = buildTransactionSubscriptionRequest();
  return client.subscribeOnce({}, {}, request.transactions, {}, {}, {}, {}, request.commitment, []);
}
