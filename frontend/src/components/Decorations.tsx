export function StarShape({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`chromatic-shape ${className}`} aria-hidden>
      <defs>
        <linearGradient id="starG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a1a1a" />
          <stop offset="100%" stopColor="#000" />
        </linearGradient>
      </defs>
      <path
        d="M50 2 C 54 38 62 46 98 50 C 62 54 54 62 50 98 C 46 62 38 54 2 50 C 38 46 46 38 50 2 Z"
        fill="url(#starG)"
      />
    </svg>
  );
}

export function BoltShape({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 60 100" className={`chromatic-shape ${className}`} aria-hidden>
      <defs>
        <linearGradient id="boltG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a1a1a" />
          <stop offset="100%" stopColor="#000" />
        </linearGradient>
      </defs>
      <path d="M34 2 L4 56 H26 L18 98 L56 38 H32 Z" fill="url(#boltG)" />
    </svg>
  );
}

export function OrbitShape({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={`chromatic-shape ${className}`} aria-hidden>
      <defs>
        <linearGradient id="orbG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a1a1a" />
          <stop offset="100%" stopColor="#000" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="18" fill="url(#orbG)" />
      <ellipse cx="50" cy="50" rx="46" ry="14" fill="none" stroke="url(#orbG)" strokeWidth="4" transform="rotate(-20 50 50)" />
    </svg>
  );
}
