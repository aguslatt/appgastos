/** Small illustrations for the empty states, drawn with the app's own colors so they follow the theme. */
export type ArtName = 'wallet' | 'coins' | 'target' | 'search' | 'sprout';

const SHADOW = <ellipse cx="66" cy="103" rx="42" ry="5.5" fill="currentColor" opacity="0.09" />;

export function Art({ name, className }: { name: ArtName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 132 112" fill="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="art-green" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--panel-bg)" />
          <stop offset="1" stopColor="var(--panel-bg-2)" />
        </linearGradient>
        <linearGradient id="art-blue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--panel-in-bg)" />
          <stop offset="1" stopColor="var(--panel-in-bg-2)" />
        </linearGradient>
      </defs>
      {SHADOW}
      {name === 'wallet' && (
        <>
          <rect x="16" y="32" width="100" height="66" rx="17" fill="url(#art-green)" />
          <path d="M16 50c0-10 8-18 18-18h60" stroke="#fff" strokeOpacity="0.35" strokeWidth="3" strokeLinecap="round" />
          <rect x="80" y="54" width="42" height="28" rx="14" fill="var(--accent-2)" />
          <circle cx="97" cy="68" r="5" fill="var(--accent-ink)" />
          <circle cx="38" cy="20" r="10" fill="var(--accent-2)" />
          <circle cx="38" cy="20" r="5.5" stroke="var(--accent-ink)" strokeOpacity="0.35" strokeWidth="2" />
          <circle cx="92" cy="14" r="6.5" fill="var(--c-orange)" />
          <circle cx="110" cy="30" r="4" fill="var(--in)" />
        </>
      )}
      {name === 'coins' && (
        <>
          <ellipse cx="66" cy="86" rx="34" ry="12" fill="url(#art-blue)" />
          <rect x="32" y="72" width="68" height="14" fill="url(#art-blue)" />
          <ellipse cx="66" cy="72" rx="34" ry="12" fill="var(--in)" />
          <ellipse cx="66" cy="72" rx="24" ry="7.5" stroke="#fff" strokeOpacity="0.45" strokeWidth="2" />
          <ellipse cx="66" cy="54" rx="34" ry="12" fill="var(--accent-2)" />
          <rect x="32" y="54" width="68" height="0" fill="var(--accent-2)" />
          <ellipse cx="66" cy="54" rx="24" ry="7.5" stroke="var(--accent-ink)" strokeOpacity="0.35" strokeWidth="2" />
          <circle cx="104" cy="26" r="7" fill="var(--accent-2)" />
          <circle cx="26" cy="38" r="5" fill="var(--in)" />
          <circle cx="88" cy="12" r="3.5" fill="var(--c-orange)" />
        </>
      )}
      {name === 'target' && (
        <>
          <circle cx="62" cy="58" r="40" fill="var(--accent-soft)" />
          <circle cx="62" cy="58" r="40" stroke="url(#art-green)" strokeWidth="5" />
          <circle cx="62" cy="58" r="26" stroke="var(--accent-2)" strokeWidth="5" />
          <circle cx="62" cy="58" r="12" fill="url(#art-green)" />
          <path d="M64 56l36-36" stroke="var(--ink)" strokeWidth="4" strokeLinecap="round" />
          <path d="M92 18l10-2-2 10-8-8z" fill="var(--ink)" />
          <circle cx="108" cy="52" r="5" fill="var(--c-orange)" />
          <circle cx="22" cy="24" r="4" fill="var(--in)" />
        </>
      )}
      {name === 'search' && (
        <>
          <circle cx="58" cy="54" r="30" fill="var(--card)" stroke="url(#art-green)" strokeWidth="8" />
          <path d="M44 48a16 16 0 0 1 14-10" stroke="var(--accent-2)" strokeWidth="5" strokeLinecap="round" />
          <path d="M80 77l24 22" stroke="var(--ink)" strokeWidth="9" strokeLinecap="round" />
          <circle cx="104" cy="22" r="6" fill="var(--accent-2)" />
          <circle cx="22" cy="30" r="4" fill="var(--c-orange)" />
        </>
      )}
      {name === 'sprout' && (
        <>
          <path d="M66 98V60" stroke="var(--panel-bg-2)" strokeWidth="6" strokeLinecap="round" />
          <path d="M66 66C66 46 50 36 30 36c0 20 14 30 36 30z" fill="url(#art-green)" />
          <path d="M66 58c0-18 14-28 34-28 0 18-12 28-34 28z" fill="var(--accent-2)" />
          <path d="M46 98h40" stroke="var(--ink-2)" strokeWidth="5" strokeLinecap="round" opacity="0.4" />
          <circle cx="104" cy="60" r="4" fill="var(--c-orange)" />
          <circle cx="24" cy="70" r="5" fill="var(--in)" />
        </>
      )}
    </svg>
  );
}
