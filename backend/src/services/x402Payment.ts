import { randomUUID } from "node:crypto";
import { config } from "../config.js";

export interface PaymentReceipt {
  paid: boolean;
  receiptId: string;
  amountUsdc: number;
}

/**
 * MOCK x402 payment for the proving leg.
 *
 * x402 is the HTTP-402-native stablecoin payment protocol used to meter the
 * per-proof fee to the (Boundless) prover market — NOT for the Stellar payout
 * leg (plan.md §13). For the MVP we log the "payment" and return a receipt.
 *
 * STRETCH (real): attach an x402 payment header/tx to the proving HTTP request
 * per the x402 spec and verify the facilitator's settlement response.
 */
export async function payForProof(
  proofRequestId: string,
  amountUsdc = 0.05,
): Promise<PaymentReceipt> {
  if (config.x402Mode === "live") {
    // STRETCH: real x402 settlement here. Falls through to mock until implemented.
  }
  const receiptId = randomUUID();
  console.log(
    `[x402:mock] paid ${amountUsdc} USDC for proof ${proofRequestId} -> receipt ${receiptId}`,
  );
  return { paid: true, receiptId, amountUsdc };
}
