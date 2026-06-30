import type { ReactNode } from "react";
import { TopNav } from "./TopNav";

export function PageShell({ children, contained = true }: { children: ReactNode; contained?: boolean }) {
  return (
    <div className="bg-paper min-h-screen relative overflow-hidden">
      <TopNav />
      <main className={`relative z-10 pt-28 pb-20 ${contained ? "mx-auto max-w-6xl px-6" : ""}`}>
        {children}
      </main>
      <footer className="relative z-10 mx-auto max-w-6xl px-6 pb-8 flex items-center justify-between text-xs uppercase tracking-widest text-foreground/70">
        <span className="font-bold">©2026 StellarPerks</span>
        <span>/ANONYMOUS REWARDS SINCE 2024</span>
      </footer>
    </div>
  );
}
