// Sonidos cortos hechos con WebAudio, sin archivos. Se silencian con el botón del juego.
let ctx: AudioContext | null = null;

export const isMuted = (): boolean => {
  try { return localStorage.getItem('cg:mute') === '1'; } catch { return false; }
};
export const setMuted = (m: boolean) => {
  try { localStorage.setItem('cg:mute', m ? '1' : '0'); } catch { /* sin almacenamiento */ }
};

function tone(freq: number, start: number, dur: number, vol = 0.12) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, ctx.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + start);
  o.stop(ctx.currentTime + start + dur + 0.05);
}

export function play(kind: 'ok' | 'win') {
  if (isMuted()) return;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    if (kind === 'ok') {
      tone(659, 0, 0.14);
      tone(988, 0.1, 0.22);
    } else {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.3));
    }
  } catch { /* el navegador no permite audio */ }
}
