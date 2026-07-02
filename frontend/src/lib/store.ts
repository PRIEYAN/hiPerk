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
  onChain: boolean; // balance/state came live from the Perk contract
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

/** Connection state so the UI can show real vs. unavailable, never fake. */
export type ConnState = "idle" | "loading" | "online" | "offline";

interface State {
  wallet: string | null;
  role: Role | null;
  modules: Module[];
  claims: Claim[];
  conn: ConnState;
  lastError: string | null;
  lastSyncedAt: number | null;

  setWallet: (w: string | null) => void;
  setRole: (r: Role | null) => void;
  reset: () => void;

  // Backend/chain-backed actions. These no longer silently fall back to fake
  // local state — on failure they set lastError and rethrow so the UI can react.
  loadFromBackend: () => Promise<void>;
  startPolling: (ms?: number) => () => void;
  createModuleApi: (m: {
    repo: string;
    rewardPool: number;
    approvalMode: ApprovalMode;
    createdBy: string;
  }) => Promise<Module>;
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
  createdBy: "chain",
  onChain: Boolean(m.onChain),
});

export const useApp = create<State>((set, get) => ({
  wallet: null,
  role: null,
  modules: [],
  claims: [],
  conn: "idle",
  lastError: null,
  lastSyncedAt: null,

  setWallet: (w) => set({ wallet: w }),
  setRole: (r) => set({ role: r }),
  reset: () => set({ wallet: null, role: null }),

  loadFromBackend: async () => {
    if (get().conn === "idle") set({ conn: "loading" });
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
      set({ modules, claims: mapped, conn: "online", lastError: null, lastSyncedAt: Date.now() });
    } catch (e) {
      // No fake fallback — surface that live data is unavailable.
      set({ conn: "offline", lastError: (e as Error).message });
    }
  },

  startPolling: (ms = 8000) => {
    void get().loadFromBackend();
    const timer = setInterval(() => void get().loadFromBackend(), ms);
    return () => clearInterval(timer);
  },

  createModuleApi: async (m) => {
    const res = await api.createModule({
      repoId: m.repo,
      approvalMode: m.approvalMode,
      createdBy: m.createdBy,
    });
    if (m.rewardPool > 0) {
      await api.fundModule(res.moduleId, m.rewardPool);
    }
    // Re-read live so the new module shows real on-chain state immediately.
    await get().loadFromBackend();
    const created = get().modules.find((x) => x.id === res.moduleId);
    return (
      created ?? {
        id: res.moduleId,
        repo: m.repo,
        rewardPool: m.rewardPool,
        approvalMode: m.approvalMode,
        status: "Open",
        createdBy: m.createdBy,
        onChain: false,
      }
    );
  },

  submitClaimApi: async ({ moduleId, moduleName, amount, ownerWallet, payoutAddress, evidenceText }) => {
    const res = await api.submitClaim({ moduleId, evidenceText, payoutAddress });
    const cl: Claim = {
      id: res.claimId,
      moduleId,
      moduleName,
      amount,
      status: STATUS_FROM_API[(res.status as ApiClaim["status"]) ?? "pending"],
      ownerWallet,
    };
    set((s) => ({ claims: [cl, ...s.claims.filter((c) => c.id !== cl.id)] }));
    return cl;
  },

  approveClaimApi: async (id, payoutAddress) => {
    const res = await api.approveClaim(id, payoutAddress ? { payoutAddress } : undefined);
    set((s) => ({
      claims: s.claims.map((c) =>
        c.id === id
          ? { ...c, status: STATUS_FROM_API[(res.status as ApiClaim["status"]) ?? "paid"], txRef: res.txHash }
          : c,
      ),
    }));
    await get().loadFromBackend(); // refresh pool balances after payout
  },

  rejectClaimApi: async (id, reason) => {
    await api.rejectClaim(id, reason);
    set((s) => ({ claims: s.claims.map((c) => (c.id === id ? { ...c, status: "Rejected" } : c)) }));
  },
}));

export const truncate = (addr: string) => (addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr);
