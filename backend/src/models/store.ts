import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Claim, Module } from "./types.js";

/**
 * Persistent JSON-file store for the hackathon MVP.
 *
 * This is the OFF-CHAIN mirror + index. The authoritative pool balances and
 * module state live on-chain in the Perk contract; this store keeps (a) the
 * set of module IDs we've created — because Soroban has no "list all modules"
 * query, we must remember which IDs to read back — and (b) human-readable
 * metadata (repo name, creator) that the on-chain Symbol encoding is lossy
 * about, plus the claim ledger. On-chain reads (stellarClient.getModule) are
 * merged over this mirror so the dashboard shows LIVE balances, not stale ones.
 *
 * No seed data: the dashboard reflects only real, created modules/claims.
 */

const DATA_FILE = resolve(process.env.STORE_FILE ?? "./data/store.json");

interface Persisted {
  modules: Module[];
  claims: Claim[];
}

class Store {
  private modules = new Map<string, Module>();
  private claims = new Map<string, Claim>();

  constructor() {
    this.load();
  }

  // --- modules ---
  putModule(m: Module): Module {
    this.modules.set(m.moduleId, m);
    this.persist();
    return m;
  }
  getModule(id: string): Module | undefined {
    return this.modules.get(id);
  }
  listModules(): Module[] {
    return [...this.modules.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }
  /** Module IDs we've created — the index used to read live state back from chain. */
  moduleIds(): string[] {
    return this.listModules().map((m) => m.moduleId);
  }

  // --- claims ---
  putClaim(c: Claim): Claim {
    this.claims.set(c.claimId, c);
    this.persist();
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

  private load(): void {
    try {
      if (!existsSync(DATA_FILE)) return;
      const raw = JSON.parse(readFileSync(DATA_FILE, "utf8")) as Persisted;
      raw.modules?.forEach((m) => this.modules.set(m.moduleId, m));
      raw.claims?.forEach((c) => this.claims.set(c.claimId, c));
    } catch (e) {
      console.warn(`[store] could not read ${DATA_FILE}, starting empty:`, (e as Error).message);
    }
  }

  private persist(): void {
    try {
      const dir = dirname(DATA_FILE);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const data: Persisted = { modules: [...this.modules.values()], claims: [...this.claims.values()] };
      writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
      console.warn(`[store] could not write ${DATA_FILE}:`, (e as Error).message);
    }
  }
}

export const store = new Store();
