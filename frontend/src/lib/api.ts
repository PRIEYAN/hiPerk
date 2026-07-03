// Thin client for the hiPerk backend. Base URL comes from VITE_API_URL,
// defaulting to the local backend. All calls are best-effort: callers fall
// back to local state if the backend is unreachable, so the demo stays
// clickable even with no server running.

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

export interface ApiModule {
  moduleId: string;
  repoId: string;
  balance: number;
  approvalMode: "manual" | "automatic";
  rewardToken: string;
  status: "Open" | "Closed";
  /** True when balance/state was read live from the Perk contract (vs the mirror). */
  onChain?: boolean;
}

export interface ApiClaim {
  claimId: string;
  moduleId: string;
  amount: number;
  status: "pending" | "approved" | "rejected" | "paid";
  createdAt: string;
  txHash?: string;
}

export interface GithubOAuthUrl {
  url: string;
}

export interface GithubVerifyStatus {
  verified: boolean;
  pending?: boolean;
  reason?: string;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${method} ${path} -> ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => req<{ ok: boolean; chainLive: boolean }>("GET", "/health"),

  listModules: () => req<ApiModule[]>("GET", "/modules"),
  createModule: (b: {
    repoId: string;
    rewardPool: number;
    rewardToken?: string;
    approvalMode?: string;
    createdBy?: string;
  }) => req<{ moduleId: string; module: any }>("POST", "/modules", b),
  fundModule: (moduleId: string, amount: number) =>
    req<{ txHash: string; balance: number }>("POST", `/modules/${moduleId}/fund`, { amount }),

  listClaims: (q?: { moduleId?: string; status?: string }) => {
    const params = new URLSearchParams(q as Record<string, string>).toString();
    return req<ApiClaim[]>("GET", `/claims${params ? `?${params}` : ""}`);
  },
  submitClaim: (b: {
    moduleId: string;
    evidenceText: string;
    payoutAddress?: string;
    githubVerificationState: string;
  }) => req<{ claimId: string; status: string }>("POST", "/claims", b),
  getClaim: (claimId: string) => req<ApiClaim>("GET", `/claims/${claimId}`),
  approveClaim: (claimId: string, b?: { payoutAddress?: string; amount?: number }) =>
    req<{ status: string; txHash?: string }>("POST", `/claims/${claimId}/approve`, b ?? {}),
  rejectClaim: (claimId: string, reason?: string) =>
    req<{ status: string }>("POST", `/claims/${claimId}/reject`, { reason }),

  getGithubOAuthUrl: (moduleId: string, prNumber: number) =>
    req<GithubOAuthUrl>(
      "GET",
      `/github/oauth-url?moduleId=${encodeURIComponent(moduleId)}&prNumber=${prNumber}`,
    ),
  getGithubVerifyStatus: (state: string) =>
    req<GithubVerifyStatus>("GET", `/github/verify-status?state=${encodeURIComponent(state)}`),
};

export { BASE as API_BASE };
