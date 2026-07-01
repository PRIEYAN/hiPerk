import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactStellarScheme } from "@x402/stellar/exact/server";
import { config, x402Live } from "../config.js";

/**
 * x402 payment gate for the claims endpoint.
 *
 * Real (live): each `POST /claims` request must carry a settled x402 payment
 * (a tiny USDC micropayment on Stellar) before it reaches the route handler.
 * Verification/settlement is delegated to a Built-on-Stellar-compatible x402
 * facilitator via `@x402/core`'s `HTTPFacilitatorClient` — this backend never
 * holds contributor funds, it only declares the price and receiving address.
 *
 * Mock (no facilitator/payTo configured): passes every request through
 * untouched, so the flow still runs end-to-end offline for demos.
 */
export function claimsPaymentGate() {
  if (!x402Live) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const facilitator = new HTTPFacilitatorClient({ url: config.x402FacilitatorUrl });
  const server = new x402ResourceServer(facilitator).register(
    config.x402Network as any,
    new ExactStellarScheme(),
  );

  return paymentMiddleware(
    {
      "/": {
        accepts: {
          scheme: "exact",
          network: config.x402Network as any,
          payTo: config.x402PayTo,
          price: config.x402PriceUsd,
        },
        description: "Pay to submit an anonymous contribution proof",
      },
    },
    server,
  );
}

export interface PaymentReceipt {
  paid: boolean;
  receiptId: string;
  amountUsdc: number;
}

/**
 * Legacy mock receipt helper, kept for the smoke script / places that still
 * want a synthetic receipt id rather than reading settlement off the request.
 */
export async function payForProof(
  proofRequestId: string,
  amountUsdc = Number(config.x402PriceUsd),
): Promise<PaymentReceipt> {
  const receiptId = randomUUID();
  if (!x402Live) {
    console.log(
      `[x402:mock] paid ${amountUsdc} USDC for proof ${proofRequestId} -> receipt ${receiptId}`,
    );
  }
  return { paid: true, receiptId, amountUsdc };
}
