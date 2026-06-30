import { createFileRoute, Link, useNavigate, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { PageShell } from "@/components/PageShell";
import { useApp, type ApprovalMode } from "@/lib/store";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — StellarPerks" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { role, wallet } = useApp();
  if (!wallet || !role) return <Navigate to="/onboarding" />;
  return <PageShell>{role === "moderator" ? <ModeratorView /> : <DeveloperView />}</PageShell>;
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
  const { modules, wallet, addModule } = useApp();
  const [creating, setCreating] = useState(false);
  const mine = modules.filter((m) => m.createdBy === wallet || m.createdBy.startsWith("GSEED"));
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
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        {mine.map((m) => (
          <ModuleCard
            key={m.id}
            repo={m.repo}
            pool={m.rewardPool}
            mode={m.approvalMode}
            status={m.status}
            action={
              <div className="text-[11px] font-mono text-foreground/50 truncate">id: {m.id}</div>
            }
          />
        ))}
      </div>
      {creating && <CreateModuleModal onClose={() => setCreating(false)} onCreate={(d) => { addModule({ ...d, createdBy: wallet! }); setCreating(false); }} />}
    </>
  );
}

function CreateModuleModal({
  onClose, onCreate,
}: { onClose: () => void; onCreate: (d: { repo: string; rewardPool: number; approvalMode: ApprovalMode }) => void }) {
  const [repo, setRepo] = useState("stellar/");
  const [pool, setPool] = useState(1000);
  const [mode, setMode] = useState<ApprovalMode>("manual");
  const navigate = useNavigate(); void navigate;
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
        <div className="mt-6 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-full bg-white/60 px-4 py-3 text-sm">Cancel</button>
          <button
            onClick={() => onCreate({ repo, rewardPool: pool, approvalMode: mode })}
            disabled={!repo || pool <= 0}
            className="flex-1 rounded-full bg-black text-white px-4 py-3 text-sm disabled:opacity-50"
          >
            Create module
          </button>
        </div>
      </div>
    </div>
  );
}
