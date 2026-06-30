export type ApprovalMode = "manual" | "automatic";

export type ClaimStatus = "pending" | "approved" | "rejected" | "paid";

export interface Module {
  moduleId: string;
  repoId: string;
  rewardToken: string;
  approvalMode: ApprovalMode;
  balance: number;
  status: "Open" | "Closed";
  createdBy: string; // admin wallet
  createdAt: string;
}

/**
 * Privacy note: a Claim NEVER stores the contributor's GitHub identity or
 * email alongside the claimId/commitment. `commitment` and `nullifier` are
 * derived anonymously from the proof. (implementation.md §7 privacy rule.)
 */
export interface Claim {
  claimId: string;
  moduleId: string;
  commitment: string;
  nullifier: string;
  amount: number;
  status: ClaimStatus;
  createdAt: string;
  proofId?: string;
  payoutAddress?: string;
  txHash?: string;
  rejectReason?: string;
}

/** Public-facing view of a claim — strips fields useful only internally. */
export interface ClaimView {
  claimId: string;
  moduleId: string;
  amount: number;
  status: ClaimStatus;
  createdAt: string;
  txHash?: string;
}

export function toClaimView(c: Claim): ClaimView {
  return {
    claimId: c.claimId,
    moduleId: c.moduleId,
    amount: c.amount,
    status: c.status,
    createdAt: c.createdAt,
    txHash: c.txHash,
  };
}
