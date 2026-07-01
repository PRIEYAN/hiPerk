import { createHash, randomUUID } from "node:crypto";
import { config } from "../config.js";

export interface ProofResult {
  proofId: string;
  /** 32-byte hex commitment registered on-chain (anonymous membership credential). */
  commitment: string;
  /** 32-byte hex nullifier — unique per (evidence) so the same PR can't pay twice. */
  nullifier: string;
  /** Public journal output of the zkVM run — must NOT leak raw evidence. */
  journal: { repoId: string; merged: true; provedAt: string };
}

/**
 * RISC Zero prover.
 *
 * `PROVER_MODE=risc0`: calls the Rust prover service in `prover/`, which runs
 * the real `prove-merge` zkVM guest program with a local RISC Zero prover
 * (no external marketplace/wallet — everything runs on your own machine) and
 * returns a verified journal (repo_id/commitment/nullifier).
 *
 * `PROVER_MODE=mock` (default): derives a deterministic commitment/nullifier
 * from the evidence + repo (so resubmitting the same evidence yields the same
 * nullifier — exactly the double-claim guard we want), simulates proving
 * latency, and returns a fake proofId. Runs fully offline for demos.
 */
export async function generateProof(input: {
  evidenceText: string;
  repoId: string;
  rawEmail?: string;
  repoUrl?: string;
  contributorSecret?: string;
}): Promise<ProofResult> {
  if (config.proverMode === "risc0") {
    return generateProofViaProverService({
      rawEmail: input.rawEmail ?? input.evidenceText,
      repoUrl: input.repoUrl ?? input.repoId,
      contributorSecret: input.contributorSecret ?? input.evidenceText,
    });
  }

  // Simulate proving time (2-3s) without blocking the event loop hard.
  await new Promise((r) => setTimeout(r, 1500));

  const commitment = sha256Hex(`commitment:${input.repoId}:${input.evidenceText}`);
  const nullifier = sha256Hex(`nullifier:${input.repoId}:${input.evidenceText}`);

  return {
    proofId: randomUUID(),
    commitment,
    nullifier,
    journal: {
      repoId: input.repoId,
      merged: true,
      provedAt: new Date().toISOString(),
    },
  };
}

async function generateProofViaProverService(input: {
  rawEmail: string;
  repoUrl: string;
  contributorSecret: string;
}): Promise<ProofResult> {
  const response = await fetch(`${config.proverServiceUrl}/prove`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      raw_email: input.rawEmail,
      repo_url: input.repoUrl,
      contributor_secret: input.contributorSecret,
    }),
  });

  const body = (await response.json()) as {
    error?: string;
    commitment: string;
    nullifier: string;
    repo_id: string;
  };
  if (!response.ok) {
    throw new Error(`prover service error: ${body.error ?? response.statusText}`);
  }

  return {
    proofId: randomUUID(),
    commitment: body.commitment,
    nullifier: body.nullifier,
    journal: {
      repoId: body.repo_id,
      merged: true,
      provedAt: new Date().toISOString(),
    },
  };
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex"); // 64 hex chars = 32 bytes
}
