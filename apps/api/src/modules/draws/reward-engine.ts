import { randomUUID } from "node:crypto";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, Connection, sendAndConfirmTransaction } from "@solana/web3.js";
import { selectWeightedWinner } from "@bags/shared";
import bs58 from "bs58";
import { env } from "../../config/env";
import { refreshHolderStatsForToken } from "../holders/refresh";
import {
  createDraw,
  createPayout,
  getTokenRuntimeByMint,
  getNextDrawNumber,
  incrementHolderWin,
  listHoldersByMint,
  saveHolderScore,
  updateTokenTreasury
} from "../../services/repositories";

export function getRewardPercent(random: number): number {
  const range = env.REWARD_PERCENT_MAX - env.REWARD_PERCENT_MIN;
  return env.REWARD_PERCENT_MIN + range * random;
}

export async function runRewardDraw(tokenMint: string, treasuryBalance: number, random = Math.random()) {
  await refreshHolderStatsForToken(tokenMint, new Date());
  const tokenRuntime = await getTokenRuntimeByMint(tokenMint);
  const effectiveTreasuryBalance = Number(tokenRuntime?.treasury_balance ?? treasuryBalance ?? 0);
  const drawNumber = await getNextDrawNumber(tokenMint);
  const holders = await listHoldersByMint(tokenMint);

  for (const holder of holders) {
    await saveHolderScore({
      tokenMint,
      wallet: holder.wallet,
      drawNumber,
      score: Number(holder.hold_score),
      computedAt: new Date()
    });
  }

  const winner = selectWeightedWinner({
    drawNumber,
    random,
    candidates: holders.map((holder) => ({
      wallet: holder.wallet,
      score: Number(holder.hold_score),
      cooldownUntilDraw: holder.cooldown_until_draw === null ? null : Number(holder.cooldown_until_draw)
    }))
  });

  const rewardPercent = getRewardPercent(random);
  const rewardAmount = winner ? Number(((effectiveTreasuryBalance * rewardPercent) / 100).toFixed(9)) : 0;
  const drawId = randomUUID();
  const createdAt = new Date();
  let payoutTxSignature: string | null = null;

  if (winner && !env.REWARD_DRY_RUN) {
    payoutTxSignature = await executePayoutTransfer(winner.wallet, rewardAmount);
  }

  await createDraw({
    id: drawId,
    tokenMint,
    drawNumber,
    winnerWallet: winner?.wallet ?? null,
    score: winner?.score ?? null,
    rewardAmount: rewardAmount.toString(),
    txSignature: payoutTxSignature,
    dryRun: env.REWARD_DRY_RUN,
    createdAt
  });

  if (winner) {
    await createPayout({
      id: randomUUID(),
      drawId,
      tokenMint,
      winnerWallet: winner.wallet,
      amount: rewardAmount.toString(),
      txSignature: payoutTxSignature,
      dryRun: env.REWARD_DRY_RUN,
      createdAt
    });
    await incrementHolderWin(tokenMint, winner.wallet, drawNumber + env.WINNER_COOLDOWN_DRAWS);
    await updateTokenTreasury({
      tokenMint,
      distributedFeesDelta: rewardAmount.toString(),
      treasuryBalanceDelta: (-rewardAmount).toString(),
      latestWinnerWallet: winner.wallet,
      nextDrawAt: new Date(Date.now() + env.DRAW_INTERVAL_MINUTES * 60_000)
    });
  }

  return {
    drawId,
    drawNumber,
    rewardAmount,
    rewardPercent,
    treasuryBalance: effectiveTreasuryBalance,
    winnerWallet: winner?.wallet ?? null,
    txSignature: payoutTxSignature
  };
}

async function executePayoutTransfer(recipientWallet: string, rewardAmountSol: number): Promise<string | null> {
  if (!env.REWARD_PAYER_SECRET_KEY) {
    throw new Error("REWARD_PAYER_SECRET_KEY is required when REWARD_DRY_RUN=false");
  }

  const payer = parsePayerKeypair(env.REWARD_PAYER_SECRET_KEY);
  const connection = new Connection(env.RPC_URL, "confirmed");
  const recipient = new PublicKey(recipientWallet);
  const lamports = Math.floor(rewardAmountSol * LAMPORTS_PER_SOL);
  if (lamports <= 0) {
    return null;
  }

  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports
    })
  );

  const signature = await sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: "confirmed"
  });
  return signature;
}

function parsePayerKeypair(secret: string): Keypair {
  const trimmed = secret.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(parsed));
  }
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}
