import { loadLocalResults, saveLocalResult, type Result } from './store';

// Para competir en tiempo real se usa Supabase (gratis). Si no está
// configurado, la app igual anda: guarda todo en el teléfono y se
// comparten los resultados con el botón "Mandar mi resultado".
const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const online = Boolean(URL_ && KEY);

const headers = (): Record<string, string> => ({
  apikey: KEY!,
  Authorization: `Bearer ${KEY!}`,
  'Content-Type': 'application/json',
});

export async function pushResult(r: Result): Promise<boolean> {
  saveLocalResult(r);
  if (!online) return false;
  try {
    const res = await fetch(`${URL_}/rest/v1/scores?on_conflict=room,player,day,game`, {
      method: 'POST',
      headers: { ...headers(), Prefer: 'resolution=ignore-duplicates' },
      body: JSON.stringify(r),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function pullResults(room: string): Promise<Result[]> {
  const local = loadLocalResults().filter((r) => r.room === room);
  if (!online) return local;
  try {
    const res = await fetch(`${URL_}/rest/v1/scores?room=eq.${encodeURIComponent(room)}&select=*`, {
      headers: headers(),
    });
    if (!res.ok) return local;
    const remote = (await res.json()) as Result[];
    const key = (r: Result) => `${r.player}|${r.day}|${r.game}`;
    const seen = new Set(remote.map(key));
    return [...remote, ...local.filter((r) => !seen.has(key(r)))];
  } catch {
    return local;
  }
}

/** Texto para pegar en WhatsApp cuando no hay servidor. */
export function shareText(r: Result, label: string): string {
  const m = Math.floor(r.seconds / 60);
  const s = String(r.seconds % 60).padStart(2, '0');
  return `${label} del ${r.day}: ${m}:${s} · ${r.points} pts 🧩 (${r.player})`;
}
