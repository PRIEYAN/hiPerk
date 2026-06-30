import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { PageShell } from "@/components/PageShell";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/claim/$id")({
  head: () => ({ meta: [{ title: "Claim status — StellarPerks" }] }),
  component: ClaimStatus,
});

function ClaimStatus() {
  const { id } = Route.useParams();
  const { claims, wallet, role } = useApp();
  if (!wallet || !role) return <Navigate to="/onboarding" />;
  const claim = claims.find((c) => c.id === id);
  if (!claim) {
    return (
      <PageShell>
        <h1 className="text-display text-5xl">Claim not found</h1>
        <Link to="/dashboard" className="glass-pill inline-block mt-6 px-5 py-3 text-xs">Back to dashboard</Link>
      </PageShell>
    );
  }

  const paid = claim.status === "Paid";

  return (
    <PageShell>
      <p className="text-xs uppercase tracking-[0.3em] text-foreground/60">/claim</p>
      <h1 className="text-display text-5xl md:text-7xl mt-2 mb-10">
        {paid ? "Reward sent" : "Claim submitted"}
      </h1>

      <div className="grid md:grid-cols-2 gap-5">
        <div className="glass-card rounded-3xl p-7 space-y-4">
          <Row k="Claim ID" v={<span className="font-mono">{claim.id}</span>} />
          <Row k="Module" v={<span className="font-mono">{claim.moduleName}</span>} />
          <Row k="Amount" v={`${claim.amount} XLM`} />
          <Row
            k="Status"
            v={
              <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-widest ${
                paid ? "bg-green-600 text-white" :
                claim.status === "Approved" ? "bg-black text-white" :
                claim.status === "Rejected" ? "bg-red-600 text-white" :
                "bg-amber-300 text-black"
              }`}>
                {claim.status}
              </span>
            }
          />
          {claim.txRef && <Row k="Tx ref" v={<span className="font-mono text-xs break-all">{claim.txRef}</span>} />}
        </div>

        {paid ? (
          <div className="glass-dark rounded-3xl p-7">
            <div className="text-[10px] uppercase tracking-widest text-white/60">Stellar network</div>
            <h3 className="mt-2 text-3xl font-black">{claim.amount} XLM sent</h3>
            <p className="mt-3 text-sm text-white/70">
              Paid to a fresh stealth address derived from your zk-proof.
            </p>
            <div className="mt-6 rounded-2xl bg-white/10 p-4">
              <div className="text-[10px] uppercase tracking-widest text-white/60">Gas fee</div>
              <div className="mt-1 text-2xl font-bold">$0.00</div>
              <div className="text-xs text-white/60">Covered by the platform — you paid nothing.</div>
            </div>
          </div>
        ) : (
          <div className="glass-card rounded-3xl p-7">
            <h3 className="text-lg font-bold">What happens next</h3>
            <ol className="mt-4 space-y-3 text-sm text-foreground/70 list-decimal pl-5">
              <li>Moderator reviews the anonymous proof</li>
              <li>If approved, the Soroban contract releases the reward</li>
              <li>Funds land instantly — gas covered by StellarPerks</li>
            </ol>
            <Link to="/my-claims" className="mt-6 inline-block glass-pill px-5 py-3 text-xs">
              View all my claims →
            </Link>
          </div>
        )}
      </div>
    </PageShell>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-black/5 pb-3 last:border-0 last:pb-0">
      <span className="text-[10px] uppercase tracking-widest text-foreground/60">{k}</span>
      <span className="text-sm">{v}</span>
    </div>
  );
}
