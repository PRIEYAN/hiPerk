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
 * MOCK RISC Zero prover.
 *
 * Today: derives a deterministic commitment/nullifier from the evidence + repo
 * (so resubmitting the same evidence yields the same nullifier — exactly the
 * double-claim guard we want), simulates proving latency, and returns a fake
 * proofId.
 *
 * STRETCH (real): replace the body with a RISC Zero guest-program run via the
 * Boundless SDK/API. Keep this signature identical so nothing downstream
 * changes when the real prover is swapped in.
 */
export async function generateProof(input: {
  evidenceText: string;
  repoId: string;
}): Promise<ProofResult> {
  if (config.proverMode === "boundless") {
    // STRETCH: call Boundless here. Falls through to mock until implemented.
    // throw new Error("boundless prover not yet implemented");
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

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex"); // 64 hex chars = 32 bytes
}
