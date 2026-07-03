import { createFileRoute, Link } from "@tanstack/react-router";
import { StarShape, BoltShape, OrbitShape } from "@/components/Decorations";
import stellarLogo from "@/stellar.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "StellarPerks — Anonymous rewards for Stellar contributors" },
      { name: "description", content: "Get paid for merged PRs on Stellar ecosystem repos. Zero-knowledge proofs keep your identity private." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="bg-paper min-h-screen relative overflow-hidden">
      {/* top pill */}
      <header className="fixed top-5 left-1/2 z-50 -translate-x-1/2">
        <div className="glass-pill flex items-center gap-3 pl-5 pr-2 py-2">
          <span className="inline-block size-2 rounded-full bg-white/90" />
          <span className="text-sm font-semibold">StellarPerks</span>
          <Link to="/onboarding" className="ml-2 rounded-full bg-white text-black px-3 py-1 text-xs font-medium hover:bg-white/90">
            Launch
          </Link>
        </div>
      </header>

      {/* decorative shapes */}
      <StarShape className="absolute top-[18%] left-[8%] w-20 md:w-28" />
      <BoltShape className="absolute top-[58%] right-[6%] w-16 md:w-24" />
      <OrbitShape className="absolute top-[26%] right-[14%] w-16 md:w-20 opacity-80" />

      {/* hero */}
      <section className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <p className="mb-6 text-xs uppercase tracking-[0.3em] text-foreground/60">
          /zk · stellar · open source
        </p>
        <h1 className="text-display text-[clamp(3.5rem,12vw,11rem)] max-w-[14ch]">
          Anonymous
          <br />
          Stellar Perks
        </h1>
        <p className="mt-8 max-w-xl text-base md:text-lg text-foreground/70">
          Get rewarded for merged PRs on Stellar ecosystem repos. Prove your
          contribution with zero-knowledge — claim your share without revealing
          who you are.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center gap-3">
          <Link
            to="/onboarding"
            className="glass-pill px-7 py-3.5 text-sm font-medium tracking-wide"
          >
            Get started →
          </Link>
          <a
            href="#how"
            className="rounded-full px-5 py-3.5 text-sm text-foreground/70 hover:text-foreground"
          >
            How it works
          </a>
        </div>

        {/* bottom row like reference */}
        <div className="absolute bottom-10 left-0 right-0 px-8 flex items-end justify-between text-xs uppercase tracking-widest text-foreground/70">
          <span className="text-2xl md:text-3xl font-black tracking-tight">©2026</span>
          <div className="hidden md:flex size-32 items-center justify-center">
            <img
              src={stellarLogo}
              alt="Stellar"
              className="animate-float w-28 drop-shadow-[0_20px_40px_rgba(0,0,0,0.35)]"
            />
          </div>
          <span>/PRIVATE BY DESIGN</span>
        </div>
      </section>

      {/* how it works */}
      <section id="how" className="relative z-10 mx-auto max-w-6xl px-6 py-24">
        <h2 className="text-display text-5xl md:text-7xl mb-12">How it works</h2>
        <div className="grid md:grid-cols-3 gap-5">
          {[
            { n: "01", t: "Moderators fund modules", d: "Maintainers create reward modules tied to a Stellar GitHub repo and seed a reward pool." },
            { n: "02", t: "Contributors prove a merge", d: "Developers generate a zk-proof for their merged PR — no identity leaks on-chain." },
            { n: "03", t: "Soroban pays them out", d: "Approved claims are paid in XLM on Stellar. Platform covers gas. Zero leaks." },
          ].map((s) => (
            <div key={s.n} className="glass-card rounded-3xl p-7">
              <div className="text-xs font-mono text-foreground/50">{s.n}</div>
              <h3 className="mt-2 text-2xl font-bold tracking-tight">{s.t}</h3>
              <p className="mt-3 text-sm text-foreground/70 leading-relaxed">{s.d}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
