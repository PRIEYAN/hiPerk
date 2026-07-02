import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { PageShell } from "@/components/PageShell";
import { useApp } from "@/lib/store";

const search = z.object({ moduleId: z.string().optional() });

export const Route = createFileRoute("/submit-proof")({
  validateSearch: search,
  head: () => ({ meta: [{ title: "Submit proof — StellarPerks" }] }),
  component: SubmitProof,
});

function SubmitProof() {
  const { moduleId } = Route.useSearch();
  const { modules, wallet, role, submitClaimApi } = useApp();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(moduleId ?? modules[0]?.id ?? "");
  const [evidence, setEvidence] = useState("");
  const [amount, setAmount] = useState(200);
  const [generating, setGenerating] = useState(false);

  if (!wallet || !role) return <Navigate to="/onboarding" />;

  const mod = modules.find((m) => m.id === selected);

  const [error, setError] = useState<string | null>(null);

  const onGenerate = async () => {
    if (!mod) return;
    setGenerating(true);
    setError(null);
    try {
      // Backend runs the RISC Zero proof + x402 payment gate + on-chain
      // register_member. On failure we surface the real error, no fake claim.
      const claim = await submitClaimApi({
        moduleId: mod.id,
        moduleName: mod.repo,
        evidenceText: evidence,
        amount,
        ownerWallet: wallet,
        payoutAddress: wallet,
      });
      navigate({ to: "/claim/$id", params: { id: claim.id } });
    } catch (e) {
      setError((e as Error).message || "proof submission failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <PageShell>
      <p className="text-xs uppercase tracking-[0.3em] text-foreground/60">/anonymous claim</p>
      <h1 className="text-display text-5xl md:text-7xl mt-2 mb-10">Submit proof</h1>

      <div className="grid md:grid-cols-5 gap-5">
        <div className="md:col-span-3 glass-card rounded-3xl p-7 space-y-5">
          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-foreground/60">Module</span>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="mt-1 w-full rounded-xl bg-white/60 border border-white/80 px-3 py-2.5 text-sm font-mono"
            >
              {modules.map((m) => (
                <option key={m.id} value={m.id}>{m.repo} — pool {m.rewardPool} XLM</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-foreground/60">Merge evidence</span>
            <textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              rows={6}
              placeholder="Paste PR link, commit hash, signed merge note…"
              className="mt-1 w-full rounded-xl bg-white/60 border border-white/80 px-3 py-2.5 text-sm font-mono"
            />
            <input type="file" className="mt-2 text-xs" />
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-foreground/60">Requested amount (XLM)</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              className="mt-1 w-full rounded-xl bg-white/60 border border-white/80 px-3 py-2.5 text-sm"
            />
          </label>

          <button
            onClick={onGenerate}
            disabled={generating || !evidence.trim() || !mod}
            className="w-full glass-pill px-5 py-4 text-sm font-medium disabled:opacity-50"
          >
            {generating ? "Generating zero-knowledge proof…" : "Generate proof →"}
          </button>
          {error && (
            <div className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 break-words">
              {error}
            </div>
          )}
        </div>

        <aside className="md:col-span-2 glass-card rounded-3xl p-7">
          <h3 className="text-lg font-bold tracking-tight">What stays private</h3>
          <ul className="mt-4 space-y-3 text-sm text-foreground/70">
            <li>· Your wallet address is never sent to moderators</li>
            <li>· Your GitHub identity is never on-chain</li>
            <li>· Only a zk-proof of merge is published to Soroban</li>
            <li>· Reward gets paid to a fresh stealth address</li>
          </ul>
          {mod && (
            <div className="mt-6 rounded-2xl bg-black text-white p-5">
              <div className="text-[10px] uppercase tracking-widest opacity-70">Claiming against</div>
              <div className="mt-1 font-mono text-sm">{mod.repo}</div>
              <div className="mt-3 text-3xl font-black">{amount} XLM</div>
            </div>
          )}
        </aside>
      </div>

      {generating && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-md flex items-center justify-center p-6">
          <div className="glass-dark rounded-3xl p-10 max-w-md text-center">
            <div className="mx-auto size-12 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            <h3 className="mt-6 text-2xl font-bold tracking-tight">Generating zero-knowledge proof…</h3>
            <p className="mt-2 text-sm text-white/70">Building Groth16 witness · committing nullifier · finalizing claim</p>
          </div>
        </div>
      )}
    </PageShell>
  );
}
