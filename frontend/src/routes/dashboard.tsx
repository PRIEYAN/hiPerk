import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { useApp, type ApprovalMode } from "@/lib/store";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — hiPerks" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { role, wallet, startPolling } = useApp();
  useEffect(() => startPolling(), [startPolling]);
  if (!wallet || !role) return <Navigate to="/onboarding" />;
  return (
    <PageShell>
      <ConnBanner />
      {role === "moderator" ? <ModeratorView /> : <DeveloperView />}
    </PageShell>
  );
}

/** Live connection state — makes it explicit whether data is real chain data. */
function ConnBanner() {
  const { conn, lastError, lastSyncedAt } = useApp();
  if (conn === "online") {
    return (
      <div className="mb-6 flex items-center gap-2 text-[11px] font-mono text-foreground/50">
        <span className="inline-block size-2 rounded-full bg-green-500" />
        Live from chain{lastSyncedAt ? ` · synced ${new Date(lastSyncedAt).toLocaleTimeString()}` : ""}
      </div>
    );
  }
  if (conn === "loading" || conn === "idle") {
    return <div className="mb-6 text-[11px] font-mono text-foreground/50">Connecting to backend…</div>;
  }
  return (
    <div className="mb-6 rounded-2xl border border-red-300 bg-red-50 px-4 py-3 text-xs text-red-700">
      Backend unreachable — showing no live data. Start the backend (npm run dev) to see on-chain modules.
      {lastError ? <div className="mt-1 font-mono opacity-70">{lastError}</div> : null}
    </div>
  );
}

function SectionHeader({ kicker, title, action }: { kicker: string; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-foreground/60">{kicker}</p>
        <h1 className="text-display text-5xl md:text-7xl mt-2">{title}</h1>
      </div>
      {action}
    </div>
  );
}

function ModuleCard({
  repo, pool, mode, status, action,
}: { repo: string; pool: number; mode: ApprovalMode; status: string; action: React.ReactNode }) {
  return (
    <div className="glass-card rounded-3xl p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-foreground/50">repository</div>
          <div className="font-mono text-sm font-medium break-all">{repo}</div>
        </div>
        <span className="rounded-full bg-black text-white px-2.5 py-1 text-[10px] uppercase tracking-widest">
          {status}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/50 p-3">
          <div className="text-[10px] uppercase tracking-widest text-foreground/50">Pool</div>
          <div className="text-xl font-bold">{pool.toLocaleString()} XLM</div>
        </div>
        <div className="rounded-2xl bg-white/50 p-3">
          <div className="text-[10px] uppercase tracking-widest text-foreground/50">Approval</div>
          <div className="text-xl font-bold capitalize">{mode}</div>
        </div>
      </div>
      {action}
    </div>
  );
}

function EmptyModules({ who }: { who: "developer" | "moderator" }) {
  const { conn } = useApp();
  if (conn === "offline" || conn === "loading" || conn === "idle") return null;
  return (
    <div className="glass-card rounded-3xl p-10 text-center text-foreground/70">
      {who === "moderator"
        ? "No modules yet. Create one to fund a reward pool on-chain."
        : "No open modules yet. Check back once a maintainer funds one."}
    </div>
  );
}

function DeveloperView() {
  const { modules } = useApp();
  const open = modules.filter((m) => m.status === "Open");
  return (
    <>
      <SectionHeader
        kicker="/developer"
        title="Open modules"
        action={
          <Link to="/my-claims" className="glass-pill px-5 py-3 text-xs">
            My claims →
          </Link>
        }
      />
      {open.length === 0 && <EmptyModules who="developer" />}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {open.map((m) => (
          <ModuleCard
            key={m.id}
            repo={m.repo}
            pool={m.rewardPool}
            mode={m.approvalMode}
            status={m.status}
            action={
              <Link
                to="/submit-proof"
                search={{ moduleId: m.id }}
                className="mt-1 rounded-2xl bg-black text-white px-4 py-3 text-sm font-medium text-center hover:bg-black/80"
              >
                Submit proof for this module
              </Link>
            }
          />
        ))}
      </div>
    </>
  );
}

function ModeratorView() {
  const { modules, wallet, createModuleApi } = useApp();
  const [creating, setCreating] = useState(false);
  // On-chain modules have no per-creator identity in this MVP, so a moderator
  // sees every module. (Ownership scoping would need an on-chain creator field.)
  const mine = modules;
  return (
    <>
      <SectionHeader
        kicker="/moderator"
        title="Your modules"
        action={
          <div className="flex gap-2">
            <Link to="/review" className="glass-pill px-5 py-3 text-xs">
              Review claims →
            </Link>
            <button onClick={() => setCreating(true)} className="rounded-full bg-black text-white px-5 py-3 text-xs">
              + Create module
            </button>
          </div>
        }
      />
      {mine.length === 0 && <EmptyModules who="moderator" />}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {mine.map((m) => (
          <ModuleCard
            key={m.id}
            repo={m.repo}
            pool={m.rewardPool}
            mode={m.approvalMode}
            status={m.status}
            action={
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-foreground/50">
                <span className="truncate">id: {m.id}</span>
                {m.onChain && (
                  <span className="shrink-0 rounded-full bg-green-100 text-green-700 px-2 py-0.5">on-chain</span>
                )}
              </div>
            }
          />
        ))}
      </div>
      {creating && (
        <CreateModuleModal
          onClose={() => setCreating(false)}
          onCreate={async (d) => {
            await createModuleApi({ ...d, createdBy: wallet! });
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

function CreateModuleModal({
  onClose, onCreate,
}: { onClose: () => void; onCreate: (d: { repo: string; rewardPool: number; approvalMode: ApprovalMode }) => Promise<void> }) {
  const [repo, setRepo] = useState("stellar/");
  const [pool, setPool] = useState(1000);
  const [mode, setMode] = useState<ApprovalMode>("manual");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onCreate({ repo, rewardPool: pool, approvalMode: mode });
    } catch (e) {
      setErr((e as Error).message || "on-chain create failed");
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="glass-card rounded-3xl p-7 w-full max-w-md">
        <h3 className="text-2xl font-bold tracking-tight">Create module</h3>
        <p className="text-sm text-foreground/60 mt-1">Fund a reward pool tied to a Stellar repo.</p>
        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-foreground/60">Repository URL</span>
            <input
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              className="mt-1 w-full rounded-xl bg-white/60 border border-white/80 px-3 py-2.5 text-sm font-mono"
              placeholder="stellar/repo-name"
            />
          </label>
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-foreground/60">Reward pool (XLM)</span>
            <input
              type="number"
              value={pool}
              onChange={(e) => setPool(Number(e.target.value))}
              className="mt-1 w-full rounded-xl bg-white/60 border border-white/80 px-3 py-2.5 text-sm"
            />
          </label>
          <div>
            <span className="text-[10px] uppercase tracking-widest text-foreground/60">Approval mode</span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              {(["manual", "automatic"] as ApprovalMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-xl px-3 py-2.5 text-sm capitalize border ${mode === m ? "bg-black text-white border-black" : "bg-white/40 border-white/70"}`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
        {err && (
          <div className="mt-4 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 break-words">
            {err}
          </div>
        )}
        <div className="mt-6 flex gap-2">
          <button onClick={onClose} disabled={busy} className="flex-1 rounded-full bg-white/60 px-4 py-3 text-sm disabled:opacity-50">Cancel</button>
          <button
            onClick={submit}
            disabled={!repo || pool <= 0 || busy}
            className="flex-1 rounded-full bg-black text-white px-4 py-3 text-sm disabled:opacity-50"
          >
            {busy ? "Creating on-chain…" : "Create module"}
          </button>
        </div>
      </div>
    </div>
  );
}
