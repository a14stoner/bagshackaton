import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export type ReceiverType = "wallet" | "token_account" | "pda" | "unknown";

export type ResolvedFeeReceiver = {
  wallet: string;
  resolvedWallet: string;
  receiverType: ReceiverType;
};

export async function resolveFeeReceiver(
  connection: Connection,
  wallet: string
): Promise<ResolvedFeeReceiver> {
  try {
    const key = new PublicKey(wallet);
    const accountInfo = await connection.getAccountInfo(key, "confirmed");
    if (!accountInfo) {
      return { wallet, resolvedWallet: wallet, receiverType: "unknown" };
    }

    const owner = accountInfo.owner.toBase58();
    if (owner === SystemProgram.programId.toBase58() && !accountInfo.executable) {
      return { wallet, resolvedWallet: wallet, receiverType: "wallet" };
    }

    if (owner === TOKEN_PROGRAM || owner === TOKEN_2022_PROGRAM) {
      const parsed = await connection.getParsedAccountInfo(key, "confirmed");
      const data = (parsed.value?.data ?? null) as any;
      const parsedOwner = data?.parsed?.info?.owner;
      if (typeof parsedOwner === "string" && parsedOwner.length > 0) {
        return { wallet, resolvedWallet: parsedOwner, receiverType: "token_account" };
      }

      if (accountInfo.data.length >= 64) {
        const tokenOwner = new PublicKey(accountInfo.data.subarray(32, 64)).toBase58();
        return { wallet, resolvedWallet: tokenOwner, receiverType: "token_account" };
      }
      return { wallet, resolvedWallet: wallet, receiverType: "token_account" };
    }

    if (accountInfo.executable || owner !== SystemProgram.programId.toBase58()) {
      return { wallet, resolvedWallet: wallet, receiverType: "pda" };
    }

    return { wallet, resolvedWallet: wallet, receiverType: "wallet" };
  } catch {
    return { wallet, resolvedWallet: wallet, receiverType: "unknown" };
  }
}
