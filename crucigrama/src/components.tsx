import { hash } from './lib/rng';

const PATHS: Record<string, string> = {
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 5l-7 7 7 7',
  zoom: 'M11 4a7 7 0 105 12l4 4M8 11h6M11 8v6',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z',
  swap: 'M7 4v14m0 0l-3-3m3 3l3-3M17 20V6m0 0l-3 3m3-3l3 3',
  delete: 'M21 5H9l-6 7 6 7h12V5zM12 9l5 6M17 9l-5 6',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  trophy: 'M8 4h8v5a4 4 0 01-8 0V4zM8 6H4v1a3 3 0 003 3M16 6h4v1a3 3 0 01-3 3M12 13v4M8 20h8',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  clock: 'M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z',
  sound: 'M4 9v6h4l5 4V5L8 9H4zM17 8.5a5 5 0 010 7M19.5 6a8.5 8.5 0 010 12',
  mute: 'M4 9v6h4l5 4V5L8 9H4zM17 9l4 6M21 9l-4 6',
  puzzle: 'M5 9h3a2 2 0 114 0h3v3a2 2 0 110 4v3H5V9z',
};

export function Icon({ name, size = 22 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Flame({ size = 22, lit = true }: { size?: number; lit?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M12 2c.6 3.2 5.5 5.6 5.5 11a5.5 5.5 0 01-11 0c0-2.4 1.2-3.8 2.4-5 .2 1.8 1 2.8 2.1 3C10.6 8.6 10.4 5.4 12 2z" fill={lit ? '#ff9600' : '#c8c3d8'} />
      <path d="M12 12c.4 1.6 2.4 2.6 2.4 4.6a2.4 2.4 0 01-4.8 0c0-1.2.7-1.9 1.3-2.6.3.8.7 1.2 1.1 1.2z" fill={lit ? '#ffd23f' : '#e4e0f0'} />
    </svg>
  );
}

type Mood = 'happy' | 'cheer' | 'sleep';

/**
 * Cada persona es una ficha de crucigrama con cara. Los ojos, la boca y el
 * accesorio salen del nombre, así que siempre es la misma ficha.
 */
export function Tile({ name, color, size = 48, mood = 'happy' }: { name: string; color: string; size?: number; mood?: Mood }) {
  const h = hash(name || '?');
  const eyes = h % 3; // 0 redondos, 1 grandes, 2 guiño
  const mouth = (h >> 3) % 2; // 0 sonrisa, 1 abierta
  const acc = (h >> 5) % 4; // 0 nada, 1 hoja, 2 moño, 3 lápiz
  const dark = '#2e2a40';
  return (
    <svg className="tile" width={size} height={size} viewBox="0 0 120 120" style={{ ['--c' as string]: color }} aria-hidden>
      <rect x="10" y="20" width="100" height="94" rx="30" fill="color-mix(in srgb, var(--c) 72%, #000)" />
      <rect x="10" y="14" width="100" height="94" rx="30" fill="var(--c)" />
      <rect x="22" y="22" width="40" height="10" rx="5" fill="#fff" opacity="0.28" />
      {acc === 1 && <path d="M60 14c-2-12 8-14 16-10-2 8-8 12-16 10z" fill="#3dc46b" />}
      {acc === 2 && <path d="M44 14l-14-6v14zM76 14l14-6v14z" fill="#ff4b91" />}
      {acc === 3 && <path d="M78 10l16-10 4 7-16 10z" fill="#ffc800" />}
      {mood === 'sleep' ? (
        <>
          <path d="M34 56q10 8 20 0M66 56q10 8 20 0" stroke={dark} strokeWidth="5" strokeLinecap="round" fill="none" />
          <path d="M50 78q10 4 20 0" stroke={dark} strokeWidth="5" strokeLinecap="round" fill="none" />
        </>
      ) : (
        <>
          {eyes === 2 ? (
            <>
              <ellipse cx="44" cy="54" rx="11" ry="14" fill="#fff" /><circle cx="46" cy="57" r="6.5" fill={dark} />
              <path d="M66 55q10-8 20 0" stroke={dark} strokeWidth="5" strokeLinecap="round" fill="none" />
            </>
          ) : (
            <>
              <ellipse cx="44" cy="54" rx={eyes ? 13 : 11} ry={eyes ? 16 : 14} fill="#fff" />
              <ellipse cx="76" cy="54" rx={eyes ? 13 : 11} ry={eyes ? 16 : 14} fill="#fff" />
              <circle cx="46" cy="57" r="6.5" fill={dark} /><circle cx="78" cy="57" r="6.5" fill={dark} />
              <circle cx="48" cy="54" r="2" fill="#fff" /><circle cx="80" cy="54" r="2" fill="#fff" />
            </>
          )}
          <circle cx="30" cy="76" r="7" fill="#ff8fb3" opacity="0.65" /><circle cx="90" cy="76" r="7" fill="#ff8fb3" opacity="0.65" />
          {mood === 'cheer' || mouth === 1 ? (
            <path d="M46 74q14 22 28 0z" fill={dark} />
          ) : (
            <path d="M48 76q12 12 24 0" stroke={dark} strokeWidth="5" strokeLinecap="round" fill="none" />
          )}
          {mood === 'cheer' && <path d="M52 84q8 6 16 0q-4 5-8 5t-8-5z" fill="#ff6b8b" />}
        </>
      )}
    </svg>
  );
}
