import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useApp, truncate, type Role } from "@/lib/store";
import { connectFreighter } from "@/lib/freighter";
import { StarShape, BoltShape } from "@/components/Decorations";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [{ title: "Onboarding — hiPerks" }] }),
  component: Onboarding,
});

function Onboarding() {
  const { wallet, setWallet, setRole } = useApp();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [role, setLocalRole] = useState<Role | null>(null);
  const navigate = useNavigate();

  const handleConnect = async () => {
    setConnecting(true);
    setConnectError(null);
    try {
      const addr = await connectFreighter();
      setWallet(addr);
    } catch (e) {
      setConnectError(e instanceof Error ? e.message : "Failed to connect wallet.");
    } finally {
      setConnecting(false);
    }
  };

  const handleContinue = () => {
    if (!role) return;
    setRole(role);
    navigate({ to: "/dashboard" });
  };

  return (
    <div className="bg-paper min-h-screen relative overflow-hidden flex items-center justify-center px-6">
      <StarShape className="absolute top-[12%] left-[10%] w-20" />
      <BoltShape className="absolute bottom-[14%] right-[10%] w-16" />

      <div className="relative z-10 w-full max-w-xl">
        <p className="text-xs uppercase tracking-[0.3em] text-foreground/60 mb-4 text-center">
          /step {wallet ? "02" : "01"} of 02
        </p>
        <h1 className="text-display text-5xl md:text-6xl text-center mb-10">
          {wallet ? "Pick your role" : "Connect wallet"}
        </h1>

        <div className="glass-card rounded-3xl p-7 md:p-9">
          {!wallet ? (
            <>
              <p className="text-sm text-foreground/70 mb-6">
                Connect your Freighter wallet to identify yourself on Stellar.
                Your address is the only thing the platform sees.
              </p>
              <button
                onClick={handleConnect}
                disabled={connecting}
                className="glass-pill w-full px-5 py-4 text-sm font-medium disabled:opacity-60"
              >
                {connecting ? "Connecting…" : "Connect Freighter Wallet"}
              </button>
              <p className="mt-4 text-xs text-foreground/50 text-center">
                Requires the Freighter browser extension, set to Stellar testnet.
              </p>
              {connectError && (
                <p className="mt-4 text-xs text-red-600 text-center">{connectError}</p>
              )}
            </>
          ) : (
            <>
              <div className="mb-6 flex items-center justify-between rounded-2xl bg-black/5 px-4 py-3">
                <span className="text-xs uppercase tracking-widest text-foreground/60">Connected</span>
                <span className="font-mono text-sm">{truncate(wallet)}</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(["developer", "moderator"] as Role[]).map((r) => (
                  <button
                    key={r}
                    onClick={() => setLocalRole(r)}
                    className={`rounded-2xl p-5 text-left transition border ${
                      role === r
                        ? "bg-black text-white border-black"
                        : "bg-white/40 border-white/70 hover:bg-white/60"
                    }`}
                  >
                    <div className="text-xs uppercase tracking-widest opacity-70">
                      {r === "developer" ? "I ship code" : "I maintain repos"}
                    </div>
                    <div className="mt-2 text-xl font-bold capitalize">{r}</div>
                    <div className="mt-2 text-xs opacity-70">
                      {r === "developer"
                        ? "Claim rewards for merged PRs"
                        : "Create reward modules & review claims"}
                    </div>
                  </button>
                ))}
              </div>

              <button
                onClick={handleContinue}
                disabled={!role}
                className="mt-6 w-full glass-pill px-5 py-4 text-sm font-medium disabled:opacity-50"
              >
                Continue to dashboard →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
