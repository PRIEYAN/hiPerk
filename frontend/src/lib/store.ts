import { create } from "zustand";
import { api, type ApiClaim, type ApiModule } from "./api";

export type Role = "developer" | "moderator";
export type ApprovalMode = "manual" | "automatic";
export type ClaimStatus = "Pending review" | "Approved" | "Paid" | "Rejected";

export interface Module {
  id: string;
  repo: string;
  rewardPool: number;
  approvalMode: ApprovalMode;
  status: "Open" | "Closed";
  createdBy: string; // wallet
}

export interface Claim {
  id: string;
  moduleId: string;
  moduleName: string;
  amount: number;
  status: ClaimStatus;
  txRef?: string;
  ownerWallet: string; // local only; never shown to mods
}

interface State {
  wallet: string | null;
  role: Role | null;
  modules: Module[];
  claims: Claim[];
  backendUp: boolean;
  setWallet: (w: string | null) => void;
  setRole: (r: Role | null) => void;
  addModule: (m: Omit<Module, "id" | "status">) => Module;
  addClaim: (c: Omit<Claim, "id" | "status">) => Claim;
  approveClaim: (id: string) => void;
  rejectClaim: (id: string) => void;
  reset: () => void;

  // Backend-backed actions. Each falls back to local state on failure so the
  // demo stays clickable when the backend isn't running.
  loadFromBackend: () => Promise<void>;
  createModuleApi: (m: Omit<Module, "id" | "status">) => Promise<Module>;
  submitClaimApi: (args: {
    moduleId: string;
    moduleName: string;
    evidenceText: string;
    amount: number;
    ownerWallet: string;
    payoutAddress?: string;
  }) => Promise<Claim>;
  approveClaimApi: (id: string, payoutAddress?: string) => Promise<void>;
  rejectClaimApi: (id: string, reason?: string) => Promise<void>;
}

const STATUS_FROM_API: Record<ApiClaim["status"], ClaimStatus> = {
  pending: "Pending review",
  approved: "Approved",
  paid: "Paid",
  rejected: "Rejected",
};

const moduleFromApi = (m: ApiModule): Module => ({
  id: m.moduleId,
  repo: m.repoId,
  rewardPool: m.balance,
  approvalMode: m.approvalMode,
  status: m.status,
  createdBy: "GSEED",
});

const seedModules: Module[] = [
  { id: "mod_001", repo: "stellar/soroban-examples", rewardPool: 2500, approvalMode: "manual", status: "Open", createdBy: "GSEED...AAAA" },
  { id: "mod_002", repo: "stellar/js-stellar-sdk", rewardPool: 1800, approvalMode: "automatic", status: "Open", createdBy: "GSEED...AAAA" },
  { id: "mod_003", repo: "stellar/rs-stellar-xdr", rewardPool: 3200, approvalMode: "manual", status: "Open", createdBy: "GSEED...BBBB" },
  { id: "mod_004", repo: "stellar/freighter", rewardPool: 950, approvalMode: "manual", status: "Open", createdBy: "GSEED...AAAA" },
];

const seedClaims: Claim[] = [
  { id: "clm_anon_8421", moduleId: "mod_001", moduleName: "stellar/soroban-examples", amount: 400, status: "Pending review", ownerWallet: "GANON...ZZZZ" },
  { id: "clm_anon_1093", moduleId: "mod_003", moduleName: "stellar/rs-stellar-xdr", amount: 600, status: "Pending review", ownerWallet: "GANON...YYYY" },
];

export const useApp = create<State>((set, get) => ({
  wallet: null,
  role: null,
  modules: seedModules,
  claims: seedClaims,
  backendUp: false,
  setWallet: (w) => set({ wallet: w }),
  setRole: (r) => set({ role: r }),
  addModule: (m) => {
    const mod: Module = { ...m, id: `mod_${Math.random().toString(36).slice(2, 7)}`, status: "Open" };
    set((s) => ({ modules: [mod, ...s.modules] }));
    return mod;
  },
  addClaim: (c) => {
    const cl: Claim = { ...c, id: `clm_anon_${Math.floor(Math.random() * 9000 + 1000)}`, status: "Pending review" };
    set((s) => ({ claims: [cl, ...s.claims] }));
    return cl;
  },
  approveClaim: (id) =>
    set((s) => ({
      claims: s.claims.map((c) =>
        c.id === id
          ? { ...c, status: "Paid", txRef: `STELLAR_TX_${Math.random().toString(36).slice(2, 10).toUpperCase()}` }
          : c,
      ),
    })),
  rejectClaim: (id) =>
    set((s) => ({ claims: s.claims.map((c) => (c.id === id ? { ...c, status: "Rejected" } : c)) })),
  reset: () => set({ wallet: null, role: null }),

  loadFromBackend: async () => {
    try {
      const [mods, claims] = await Promise.all([api.listModules(), api.listClaims()]);
      const modules = mods.map(moduleFromApi);
      const nameById = new Map(modules.map((m) => [m.id, m.repo]));
      const mapped: Claim[] = claims.map((c) => ({
        id: c.claimId,
        moduleId: c.moduleId,
        moduleName: nameById.get(c.moduleId) ?? c.moduleId,
        amount: c.amount,
        status: STATUS_FROM_API[c.status],
        txRef: c.txHash,
        ownerWallet: get().wallet ?? "anon",
      }));
      set({ modules, claims: mapped, backendUp: true });
    } catch {
      set({ backendUp: false }); // keep seed/local data
    }
  },

  createModuleApi: async (m) => {
    try {
      const res = await api.createModule({
        repoId: m.repo,
        approvalMode: m.approvalMode,
        createdBy: m.createdBy,
      });
      if (m.rewardPool > 0) {
        await api.fundModule(res.moduleId, m.rewardPool).catch(() => {});
      }
      const mod: Module = { ...m, id: res.moduleId, status: "Open" };
      set((s) => ({ modules: [mod, ...s.modules], backendUp: true }));
      return mod;
    } catch {
      return get().addModule(m); // local fallback
    }
  },

  submitClaimApi: async ({ moduleId, moduleName, evidenceText, amount, ownerWallet, payoutAddress }) => {
    try {
      const res = await api.submitClaim({ moduleId, evidenceText, payoutAddress });
      const cl: Claim = {
        id: res.claimId,
        moduleId,
        moduleName,
        amount,
        status: STATUS_FROM_API[(res.status as ApiClaim["status"]) ?? "pending"],
        ownerWallet,
      };
      set((s) => ({ claims: [cl, ...s.claims], backendUp: true }));
      return cl;
    } catch {
      return get().addClaim({ moduleId, moduleName, amount, ownerWallet });
    }
  },

  approveClaimApi: async (id, payoutAddress) => {
    try {
      const res = await api.approveClaim(id, payoutAddress ? { payoutAddress } : undefined);
      set((s) => ({
        claims: s.claims.map((c) =>
          c.id === id ? { ...c, status: STATUS_FROM_API[(res.status as ApiClaim["status"]) ?? "paid"], txRef: res.txHash } : c,
        ),
      }));
    } catch {
      get().approveClaim(id);
    }
  },

  rejectClaimApi: async (id, reason) => {
    try {
      await api.rejectClaim(id, reason);
      get().rejectClaim(id);
    } catch {
      get().rejectClaim(id);
    }
  },
}));

export const truncate = (addr: string) => (addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr);
