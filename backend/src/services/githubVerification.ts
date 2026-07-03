import { customAlphabet } from "nanoid";

/**
 * Short-lived, in-memory-only state for the GitHub PR-authorship OAuth check.
 *
 * Deliberately NOT part of `models/store.ts` (never written to disk, never
 * joined with a Claim): the GitHub username/PR number must never end up
 * alongside a claimId/commitment (implementation.md §7 privacy rule). Only a
 * boolean `verified` result survives long enough to gate POST /claims, and
 * it's consumed (deleted) the moment a claim is submitted.
 */

const stateId = customAlphabet(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  32,
);

interface PendingVerification {
  moduleId: string;
  repoId: string;
  prNumber: number;
  createdAt: number;
}

interface VerificationResult {
  moduleId: string;
  verified: boolean;
  reason?: string;
  createdAt: number;
}

const TTL_MS = 10 * 60 * 1000; // 10 minutes — long enough for a real OAuth round trip

const pending = new Map<string, PendingVerification>();
const results = new Map<string, VerificationResult>();

function sweep(map: Map<string, { createdAt: number }>): void {
  const now = Date.now();
  for (const [key, value] of map) {
    if (now - value.createdAt > TTL_MS) map.delete(key);
  }
}

/** Begin a verification attempt; returns the opaque OAuth `state` to hand to GitHub. */
export function createPending(input: { moduleId: string; repoId: string; prNumber: number }): string {
  sweep(pending);
  const state = stateId();
  pending.set(state, { ...input, createdAt: Date.now() });
  return state;
}

/** Single-use: the OAuth callback consumes the pending record exactly once. */
export function consumePending(state: string): PendingVerification | undefined {
  const rec = pending.get(state);
  pending.delete(state);
  if (!rec || Date.now() - rec.createdAt > TTL_MS) return undefined;
  return rec;
}

/** Record the outcome of a verification attempt (success or failure). */
export function storeResult(
  state: string,
  result: { moduleId: string; verified: boolean; reason?: string },
): void {
  sweep(results);
  results.set(state, { ...result, createdAt: Date.now() });
}

/** Non-destructive read — the frontend polls this after the OAuth redirect back. */
export function peekResult(state: string): VerificationResult | undefined {
  const rec = results.get(state);
  if (!rec || Date.now() - rec.createdAt > TTL_MS) return undefined;
  return rec;
}

/**
 * Consume a verified result for use in a claim submission. Single-use: the
 * record is deleted regardless of outcome so a verification token can never
 * be replayed across multiple claims.
 */
export function consumeVerifiedResult(state: string, moduleId: string): boolean {
  const rec = results.get(state);
  results.delete(state);
  if (!rec || Date.now() - rec.createdAt > TTL_MS) return false;
  return rec.verified && rec.moduleId === moduleId;
}
