import { Connection } from "@solana/web3.js";
import { fetchOffchainMetadata, fetchOnchainTokenMetadata } from "../src/services/token-metadata";

async function main() {
  const mint = process.argv[2];
  const rpcUrl = process.env.RPC_URL;

  if (!mint) {
    throw new Error("Usage: pnpm exec tsx scripts/test-token-metadata.ts <MINT>");
  }
  if (!rpcUrl) {
    throw new Error("RPC_URL is required");
  }

  const connection = new Connection(rpcUrl, "confirmed");
  const onchain = await fetchOnchainTokenMetadata(connection, mint);
  console.log("mint:", mint);
  console.log("onchain:", onchain);

  if (onchain?.uri) {
    const offchain = await fetchOffchainMetadata(onchain.uri);
    console.log("offchain:", offchain);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
