import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { PageShell } from "@/components/PageShell";
import { useApp } from "@/lib/store";

export const Route = createFileRoute("/my-claims")({
  head: () => ({ meta: [{ title: "My claims — StellarPerks" }] }),
  component: MyClaims,
});

function MyClaims() {
  const { wallet, role, claims } = useApp();
  if (!wallet || !role) return <Navigate to="/onboarding" />;
  const mine = claims.filter((c) => c.ownerWallet === wallet);
  return (
    <PageShell>
      <p className="text-xs uppercase tracking-[0.3em] text-foreground/60">/developer</p>
      <h1 className="text-display text-5xl md:text-7xl mt-2 mb-10">My claims</h1>

      {mine.length === 0 ? (
        <div className="glass-card rounded-3xl p-10 text-center">
          <p className="text-foreground/70">No claims yet. Submit a proof to get started.</p>
          <Link to="/dashboard" className="mt-5 inline-block glass-pill px-5 py-3 text-xs">Browse modules →</Link>
        </div>
      ) : (
        <div className="glass-card rounded-3xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="text-left text-[10px] uppercase tracking-widest text-foreground/60 bg-white/40">
              <tr>
                <th className="p-4">Claim ID</th>
                <th className="p-4">Module</th>
                <th className="p-4">Amount</th>
                <th className="p-4">Status</th>
                <th className="p-4"></th>
              </tr>
            </thead>
            <tbody>
              {mine.map((c) => (
                <tr key={c.id} className="border-t border-black/5">
                  <td className="p-4 font-mono text-xs">{c.id}</td>
                  <td className="p-4 font-mono text-xs">{c.moduleName}</td>
                  <td className="p-4">{c.amount} XLM</td>
                  <td className="p-4">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-widest ${
                      c.status === "Paid" ? "bg-green-600 text-white" :
                      c.status === "Approved" ? "bg-black text-white" :
                      c.status === "Rejected" ? "bg-red-600 text-white" :
                      "bg-amber-300 text-black"
                    }`}>{c.status}</span>
                  </td>
                  <td className="p-4 text-right">
                    <Link to="/claim/$id" params={{ id: c.id }} className="text-xs underline">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageShell>
  );
}
