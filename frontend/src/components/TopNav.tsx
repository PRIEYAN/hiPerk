import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import { useApp, truncate } from "@/lib/store";

export function TopNav() {
  const { wallet, role, reset } = useApp();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  if (!wallet || !role) return null;

  const links =
    role === "moderator"
      ? [
          { to: "/dashboard", label: "Dashboard" },
          { to: "/review", label: "Review claims" },
        ]
      : [
          { to: "/dashboard", label: "Dashboard" },
          { to: "/my-claims", label: "My claims" },
        ];

  return (
    <header className="fixed top-5 left-1/2 z-50 -translate-x-1/2 px-4 w-full max-w-[min(1100px,95vw)]">
      <nav className="glass-pill flex items-center justify-between gap-2 pl-5 pr-2 py-2">
        <Link to="/dashboard" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="inline-block size-2 rounded-full bg-white/90" />
          hiPerks
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {links.map((l) => {
            const active = pathname === l.to;
            return (
              <Link
                key={l.to}
                to={l.to}
                className={`px-3 py-1.5 text-xs rounded-full transition ${
                  active ? "bg-white/15 text-white" : "text-white/70 hover:text-white"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-block text-[10px] uppercase tracking-widest text-white/60">
            {role}
          </span>
          <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-mono text-white/90">
            {truncate(wallet)}
          </span>
          <button
            onClick={() => {
              reset();
              navigate({ to: "/" });
            }}
            className="rounded-full bg-white text-black px-3 py-1.5 text-xs font-medium hover:bg-white/90"
          >
            Disconnect
          </button>
        </div>
      </nav>
    </header>
  );
}
