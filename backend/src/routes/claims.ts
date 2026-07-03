import { Router, type NextFunction, type Request, type Response } from "express";
import { nanoid } from "nanoid";
import { store } from "../models/store.js";
import { Claim, toClaimView } from "../models/types.js";
import { config } from "../config.js";
import { generateProof } from "../services/riscZeroProver.js";
import { claimsPaymentGate } from "../services/x402Payment.js";
import * as stellar from "../services/stellarClient.js";
import * as githubVerification from "../services/githubVerification.js";
import { scoreToReward } from "../services/groqAnalysis.js";

export const claimsRouter = Router();

/** Carries the anonymous Groq complexity score from the verification gate to
 * the claim handler on the request object (never persisted with the claim). */
interface ClaimRequest extends Request {
  prComplexity?: number;
}

/**
 * Requires a completed, unexpired GitHub PR-authorship verification (see
 * routes/github.ts) before a claim can be submitted. Runs before the x402
 * payment gate so a developer is never charged for a claim that fails this
 * check. Single-use: consumes the verification result either way.
 */
function requireGithubVerification(req: ClaimRequest, res: Response, next: NextFunction) {
  const { moduleId, githubVerificationState } = req.body ?? {};
  if (!moduleId || typeof moduleId !== "string") {
    return res.status(400).json({ error: "moduleId required" });
  }
  if (!githubVerificationState || typeof githubVerificationState !== "string") {
    return res
      .status(400)
      .json({ error: "GitHub verification required — connect GitHub and verify your merged PR first" });
  }
  const result = githubVerification.consumeVerifiedResult(githubVerificationState, moduleId);
  if (!result) {
    return res
      .status(403)
      .json({ error: "GitHub verification missing, expired, or failed — please reconnect GitHub" });
  }
  // Carry the anonymous Groq complexity forward for automated reward sizing.
  req.prComplexity = result.complexity;
  next();
}

/**
 * POST /claims — developer submits PR-merge evidence.
 *
 * Gated by GitHub PR-authorship verification (off-chain, see routes/github.ts)
 * and by x402: the request must carry a settled USDC micropayment (Stellar
 * testnet) before it reaches this handler — see services/x402Payment.ts.
 * Pipeline: generateProof → registerMember (Gatekeeper). Stores a `pending`
 * claim. If the module is `automatic`, payout is triggered immediately
 * (stretch behavior, implementation.md §9.3).
 *
 * Privacy: only commitment/nullifier are stored — never GitHub identity/email.
 */
claimsRouter.post("/", requireGithubVerification, claimsPaymentGate(), async (req: ClaimRequest, res) => {
  const { moduleId, evidenceText, payoutAddress, rawEmail, repoUrl, contributorSecret } =
    req.body ?? {};
  const m = store.getModule(moduleId);
  if (!m) return res.status(404).json({ error: "module not found" });
  if (m.status === "Closed") {
    return res.status(409).json({ error: "module is closed — its reward pool is exhausted" });
  }
  if (!evidenceText || typeof evidenceText !== "string") {
    return res.status(400).json({ error: "evidenceText required" });
  }
  if (!payoutAddress || typeof payoutAddress !== "string") {
    return res.status(400).json({ error: "payoutAddress required for automated reward" });
  }

  // 1. Prove. In PROVER_MODE=boundless, rawEmail/repoUrl/contributorSecret
  // are sent to the real prover service (prover/); otherwise they're ignored
  // and evidenceText drives the mock proof.
  let proof;
  try {
    proof = await generateProof({
      evidenceText,
      repoId: m.repoId,
      rawEmail: typeof rawEmail === "string" ? rawEmail : undefined,
      repoUrl: typeof repoUrl === "string" ? repoUrl : undefined,
      contributorSecret: typeof contributorSecret === "string" ? contributorSecret : undefined,
    });
  } catch (e) {
    return res.status(502).json({ error: `proof generation failed: ${(e as Error).message}` });
  }

  // 2. Double-claim guard (also enforced on-chain via nullifier).
  if (store.nullifierUsed(moduleId, proof.nullifier)) {
    return res.status(409).json({ error: "this evidence has already been claimed" });
  }

  // 3. Register the anonymous membership commitment on-chain (fee-bumped).
  try {
    await stellar.registerMember(m.repoId, proof.commitment);
  } catch (e) {
    return res.status(502).json({ error: `register_member failed: ${(e as Error).message}` });
  }

  // 4. Size the reward automatically from the Groq PR-complexity score against
  // the CURRENT pool balance (minimal % of pool). Falls back to a heuristic
  // score of 1 if verification produced none (e.g. Groq + heuristic both
  // unavailable at OAuth time).
  const complexity = typeof req.prComplexity === "number" ? req.prComplexity : 1;
  const amount = scoreToReward(complexity, m.balance);
  if (amount <= 0) {
    return res.status(409).json({ error: "reward pool is exhausted" });
  }

  const claim: Claim = {
    claimId: `clm_anon_${nanoid(6)}`,
    moduleId,
    commitment: proof.commitment,
    nullifier: proof.nullifier,
    amount,
    status: "pending",
    createdAt: new Date().toISOString(),
    proofId: proof.proofId,
    payoutAddress,
  };
  store.putClaim(claim);

  // 5. Fully automated payout — every verified claim is paid immediately with
  // the AI-sized amount; no manual moderator approval. Auto-closes the module
  // when the pool hits zero (see payoutClaim).
  try {
    await payoutClaim(claim, payoutAddress, amount);
  } catch (e) {
    return res
      .status(502)
      .json({ error: `automated payout failed: ${(e as Error).message}`, claimId: claim.claimId });
  }

  res.status(201).json({
    claimId: claim.claimId,
    status: claim.status,
    amount: claim.amount,
    txHash: claim.txHash,
    complexity,
  });
});

/** GET /claims/:claimId — developer polls status (no identity info). */
claimsRouter.get("/:claimId", (req, res) => {
  const c = store.getClaim(req.params.claimId);
  if (!c) return res.status(404).json({ error: "claim not found" });
  res.json(toClaimView(c));
});

/** GET /claims?moduleId=&status= — moderator review queue (anonymous). */
claimsRouter.get("/", (req, res) => {
  const moduleId = req.query.moduleId as string | undefined;
  const status = req.query.status as string | undefined;
  res.json(store.listClaims({ moduleId, status }).map(toClaimView));
});

/** POST /claims/:claimId/approve — moderator approves → on-chain payout. */
claimsRouter.post("/:claimId/approve", async (req, res) => {
  const c = store.getClaim(req.params.claimId);
  if (!c) return res.status(404).json({ error: "claim not found" });
  if (c.status === "paid") return res.json(toClaimView(c));
  if (c.status === "rejected") return res.status(409).json({ error: "claim was rejected" });

  const payoutAddress = (req.body?.payoutAddress as string) || c.payoutAddress;
  const amount = Number(req.body?.amount ?? c.amount);
  if (!payoutAddress) return res.status(400).json({ error: "payoutAddress required" });

  try {
    await payoutClaim(c, payoutAddress, amount);
  } catch (e) {
    return res.status(502).json({ error: `payout failed: ${(e as Error).message}` });
  }
  res.json({ status: c.status, txHash: c.txHash });
});

/** POST /claims/:claimId/reject — moderator rejects. */
claimsRouter.post("/:claimId/reject", (req, res) => {
  const c = store.getClaim(req.params.claimId);
  if (!c) return res.status(404).json({ error: "claim not found" });
  if (c.status === "paid") return res.status(409).json({ error: "already paid" });
  c.status = "rejected";
  c.rejectReason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
  store.putClaim(c);
  res.json({ status: c.status });
});

/** Shared payout: on-chain claim() via fee-bump, then mirror balance + status. */
async function payoutClaim(c: Claim, payoutAddress: string, amount: number): Promise<void> {
  const m = store.getModule(c.moduleId);
  if (!m) throw new Error("module not found");
  if (m.balance < amount) throw new Error("insufficient pool balance");

  const { txHash } = await stellar.claimReward({
    moduleId: c.moduleId,
    commitment: c.commitment,
    nullifier: c.nullifier,
    payoutAddress,
    amount,
  });

  c.status = "paid";
  c.amount = amount;
  c.payoutAddress = payoutAddress;
  c.txHash = txHash;
  store.putClaim(c);

  m.balance -= amount;
  // Auto-close once the escrowed pool is exhausted so it drops off the
  // developer's list of open modules.
  if (m.balance <= 0) {
    m.balance = 0;
    m.status = "Closed";
  }
  store.putModule(m);
}
