import { create } from "zustand";

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
  setWallet: (w: string | null) => void;
  setRole: (r: Role | null) => void;
  addModule: (m: Omit<Module, "id" | "status">) => Module;
  addClaim: (c: Omit<Claim, "id" | "status">) => Claim;
  approveClaim: (id: string) => void;
  rejectClaim: (id: string) => void;
  reset: () => void;
}

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

export const useApp = create<State>((set) => ({
  wallet: null,
  role: null,
  modules: seedModules,
  claims: seedClaims,
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
}));

export const truncate = (addr: string) => (addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr);
