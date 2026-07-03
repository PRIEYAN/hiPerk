import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { PageShell } from "@/components/PageShell";
import { useApp } from "@/lib/store";
import { api } from "@/lib/api";

const search = z.object({
  moduleId: z.string().optional(),
  // The router's default search parser JSON-parses raw query values, so a
  // numeric-looking value like `?prNumber=1` arrives as a number, not a
  // string — coerce so it validates regardless of which shape it lands as.
  prNumber: z.coerce.string().optional(),
  ghState: z.string().optional(),
  ghError: z.string().optional(),
});

export const Route = createFileRoute("/submit-proof")({
  validateSearch: search,
  head: () => ({ meta: [{ title: "Submit proof — StellarPerks" }] }),
  component: SubmitProof,
});

function SubmitProof() {
  const { moduleId, prNumber: prNumberFromSearch, ghState: ghStateFromSearch, ghError } = Route.useSearch();
  const { modules, wallet, role, submitClaimApi } = useApp();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(moduleId ?? modules[0]?.id ?? "");
  const [prNumber, setPrNumber] = useState(prNumberFromSearch ?? "");
  const [evidence, setEvidence] = useState("");
  const [amount, setAmount] = useState(200);
  const [generating, setGenerating] = useState(false);

  const [ghState, setGhState] = useState<string | null>(ghStateFromSearch ?? null);
  const [ghVerified, setGhVerified] = useState(false);
  const [ghReason, setGhReason] = useState<string | null>(ghError ? "GitHub sign-in was cancelled or expired." : null);
  const [ghChecking, setGhChecking] = useState(false);
  const [ghConnecting, setGhConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Landed back here after the GitHub OAuth redirect — resolve the result once,
  // then strip the OAuth params from the URL so a refresh doesn't recheck it.
  // Hooks must run unconditionally (before the wallet/role early return below),
  // otherwise a render where the persisted session hasn't rehydrated yet skips
  // them and React throws a "rendered fewer hooks than expected" error.
  useEffect(() => {
    if (!ghStateFromSearch) return;
    setGhChecking(true);
    api
      .getGithubVerifyStatus(ghStateFromSearch)
      .then((res) => {
        setGhVerified(res.verified);
        setGhReason(res.verified ? null : res.reason ?? "GitHub verification failed.");
      })
      .catch((e) => setGhReason((e as Error).message || "Could not check GitHub verification status."))
      .finally(() => setGhChecking(false));
    navigate({ to: "/submit-proof", search: { moduleId: moduleId ?? undefined }, replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghStateFromSearch]);

  if (!wallet || !role) return <Navigate to="/onboarding" />;

  const mod = modules.find((m) => m.id === selected);

  const resetGithubVerification = () => {
    setGhState(null);
    setGhVerified(false);
    setGhReason(null);
  };

  const onConnectGithub = async () => {
    if (!mod || !prNumber) return;
    setGhConnecting(true);
    setGhReason(null);
    try {
      const { url } = await api.getGithubOAuthUrl(mod.id, Number(prNumber));
      window.location.href = url; // full navigation to GitHub — leaves the SPA
    } catch (e) {
      setGhReason((e as Error).message || "Could not start GitHub verification.");
      setGhConnecting(false);
    }
  };

  const onGenerate = async () => {
    if (!mod || !ghState) return;
    setGenerating(true);
    setError(null);
    try {
      // Backend runs GitHub PR-authorship verification + RISC Zero proof +
      // x402 payment gate + on-chain register_member. On failure we surface
      // the real error, no fake claim.
      const claim = await submitClaimApi({
        moduleId: mod.id,
        moduleName: mod.repo,
        evidenceText: evidence,
        amount,
        ownerWallet: wallet,
        payoutAddress: wallet,
        githubVerificationState: ghState,
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
              onChange={(e) => {
                setSelected(e.target.value);
                resetGithubVerification();
              }}
              className="mt-1 w-full rounded-xl bg-white/60 border border-white/80 px-3 py-2.5 text-sm font-mono"
            >
              {modules.map((m) => (
                <option key={m.id} value={m.id}>{m.repo} — pool {m.rewardPool} XLM</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[10px] uppercase tracking-widest text-foreground/60">Pull request number</span>
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                min={1}
                step={1}
                value={prNumber}
                onChange={(e) => {
                  setPrNumber(e.target.value);
                  resetGithubVerification();
                }}
                placeholder="e.g. 42"
                className="w-28 rounded-xl bg-white/60 border border-white/80 px-3 py-2.5 text-sm font-mono"
              />
              {ghVerified ? (
                <div className="flex-1 flex items-center gap-2 rounded-xl bg-green-50 border border-green-300 px-3 py-2.5 text-xs text-green-700">
                  <span className="inline-block size-2 rounded-full bg-green-500" />
                  Verified: merged PR authored by your connected GitHub account
                </div>
              ) : (
                <button
                  onClick={onConnectGithub}
                  disabled={!mod || !prNumber || ghConnecting || ghChecking}
                  className="flex-1 rounded-xl bg-black text-white text-sm font-medium disabled:opacity-50"
                >
                  {ghConnecting ? "Redirecting to GitHub…" : ghChecking ? "Checking…" : "Connect & verify GitHub →"}
                </button>
              )}
            </div>
            {ghReason && !ghVerified && (
              <p className="mt-2 text-xs text-red-600">{ghReason}</p>
            )}
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
            disabled={generating || !evidence.trim() || !mod || !ghVerified}
            className="w-full glass-pill px-5 py-4 text-sm font-medium disabled:opacity-50"
          >
            {generating ? "Generating zero-knowledge proof…" : "Generate proof →"}
          </button>
          {!ghVerified && (
            <p className="text-xs text-foreground/50 text-center">
              Verify your merged PR on GitHub above to unlock proof generation.
            </p>
          )}
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

      {ghChecking && (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-md flex items-center justify-center p-6">
          <div className="glass-dark rounded-3xl p-10 max-w-md text-center">
            <div className="mx-auto size-12 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            <h3 className="mt-6 text-2xl font-bold tracking-tight">Checking GitHub verification…</h3>
            <p className="mt-2 text-sm text-white/70">Confirming your merged PR against the connected GitHub account</p>
          </div>
        </div>
      )}

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
