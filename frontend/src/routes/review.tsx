import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { PageShell } from "@/components/PageShell";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/review")({
  head: () => ({ meta: [{ title: "Review claims — StellarPerks" }] }),
  component: Review,
});

function Review() {
  const { wallet, role, claims, modules, approveClaimApi, rejectClaimApi, startPolling, conn } = useApp();
  const navigate = useNavigate();
  useEffect(() => startPolling(), [startPolling]);
  if (!wallet || !role) return <Navigate to="/onboarding" />;

  // Claims across all on-chain modules (no per-creator identity in this MVP).
  const moduleIds = new Set(modules.map((m) => m.id));
  const visible = claims.filter((c) => moduleIds.has(c.moduleId));

  const handleApprove = async (id: string) => {
    try {
      await approveClaimApi(id, wallet ?? undefined);
      navigate({ to: "/claim/$id", params: { id } });
    } catch (e) {
      alert(`Payout failed: ${(e as Error).message}`);
    }
  };

  return (
    <PageShell>
      <p className="text-xs uppercase tracking-[0.3em] text-foreground/60">/moderator</p>
      <h1 className="text-display text-5xl md:text-7xl mt-2 mb-2">Review claims</h1>
      <p className="text-foreground/60 mb-10 max-w-xl text-sm">
        Anonymous claims across your modules. By design, no contributor identity is shown — only zk-verified proof of merge.
      </p>

      {conn === "offline" ? (
        <div className="glass-card rounded-3xl p-10 text-center text-red-700">
          Backend unreachable — cannot load live claims.
        </div>
      ) : visible.length === 0 ? (
        <div className="glass-card rounded-3xl p-10 text-center text-foreground/70">No claims yet.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {visible.map((c) => (
            <div key={c.id} className="glass-card rounded-3xl p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-foreground/50">Claim</div>
                  <div className="font-mono text-sm">{c.id}</div>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-widest ${
                  c.status === "Paid" ? "bg-green-600 text-white" :
                  c.status === "Approved" ? "bg-black text-white" :
                  c.status === "Rejected" ? "bg-red-600 text-white" :
                  "bg-amber-300 text-black"
                }`}>{c.status}</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/50 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-foreground/50">Module</div>
                  <div className="font-mono text-xs">{c.moduleName}</div>
                </div>
                <div className="rounded-2xl bg-white/50 p-3">
                  <div className="text-[10px] uppercase tracking-widest text-foreground/50">Requested</div>
                  <div className="text-xl font-bold">{c.amount} XLM</div>
                </div>
              </div>
              <div className="mt-4 rounded-2xl bg-black/5 px-4 py-3 text-xs text-foreground/60">
                Contributor identity: <span className="font-mono">hidden by zk-proof</span>
              </div>
              {c.status === "Pending review" && (
                <div className="mt-5 flex gap-2">
                  <button
                    onClick={() => rejectClaimApi(c.id).catch((e) => alert(`Reject failed: ${(e as Error).message}`))}
                    className="flex-1 rounded-full bg-white/60 border border-black/10 px-4 py-3 text-sm hover:bg-white/80"
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => handleApprove(c.id)}
                    className="flex-1 rounded-full bg-black text-white px-4 py-3 text-sm hover:bg-black/80"
                  >
                    Approve & pay
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PageShell>
  );
}
