import { Claim, Module } from "./types.js";

/**
 * In-memory store for the hackathon MVP. The authoritative balances live
 * on-chain in the Perk contract; this mirror powers the dashboard and claim
 * lifecycle without a database. Swap for a real DB post-MVP.
 */
class Store {
  private modules = new Map<string, Module>();
  private claims = new Map<string, Claim>();

  constructor() {
    this.seed();
  }

  // --- modules ---
  putModule(m: Module): Module {
    this.modules.set(m.moduleId, m);
    return m;
  }
  getModule(id: string): Module | undefined {
    return this.modules.get(id);
  }
  listModules(): Module[] {
    return [...this.modules.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  // --- claims ---
  putClaim(c: Claim): Claim {
    this.claims.set(c.claimId, c);
    return c;
  }
  getClaim(id: string): Claim | undefined {
    return this.claims.get(id);
  }
  listClaims(filter?: { moduleId?: string; status?: string }): Claim[] {
    let out = [...this.claims.values()];
    if (filter?.moduleId) out = out.filter((c) => c.moduleId === filter.moduleId);
    if (filter?.status) out = out.filter((c) => c.status === filter.status);
    return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  /** Has this nullifier already been used for this module? (double-claim guard) */
  nullifierUsed(moduleId: string, nullifier: string): boolean {
    return [...this.claims.values()].some(
      (c) => c.moduleId === moduleId && c.nullifier === nullifier && c.status !== "rejected",
    );
  }

  private seed() {
    const now = new Date("2026-06-01T00:00:00.000Z").toISOString();
    const seedMods: Module[] = [
      {
        moduleId: "mod_001",
        repoId: "stellar/soroban-examples",
        rewardToken: "USDC",
        approvalMode: "manual",
        balance: 2500,
        status: "Open",
        createdBy: "GSEEDAAAA",
        createdAt: now,
      },
      {
        moduleId: "mod_002",
        repoId: "stellar/js-stellar-sdk",
        rewardToken: "USDC",
        approvalMode: "automatic",
        balance: 1800,
        status: "Open",
        createdBy: "GSEEDAAAA",
        createdAt: now,
      },
      {
        moduleId: "mod_003",
        repoId: "stellar/rs-stellar-xdr",
        rewardToken: "USDC",
        approvalMode: "manual",
        balance: 3200,
        status: "Open",
        createdBy: "GSEEDBBBB",
        createdAt: now,
      },
    ];
    seedMods.forEach((m) => this.modules.set(m.moduleId, m));
  }
}

export const store = new Store();
