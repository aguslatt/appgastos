import { useEffect, useMemo, useState } from 'react';
import { GAMES, fmtTime } from '../lib/scoring';
import { online, shareText } from '../lib/sync';
import type { Result } from '../lib/store';

const CONFETTI = ['var(--p1)', 'var(--p2)', 'var(--p3)', 'var(--p4)', 'var(--accent)'];

export function Finish({ result, others, onClose }: { result: Result; others: Result[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(0);
  const text = shareText(result, GAMES[result.game].label);

  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        left: Math.round((i * 37) % 100),
        delay: ((i * 53) % 40) / 100,
        dx: ((i * 29) % 80) - 40,
        color: CONFETTI[i % CONFETTI.length]!,
        rot: (i * 47) % 360,
      })),
    [],
  );

  // Los puntos suben de a poco, como un marcador.
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 900);
      setShown(Math.round(result.points * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [result.points]);

  const send = async () => {
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      }
    } catch { /* cancelado */ }
  };

  return (
    <div className="finish" role="dialog" aria-label="Resultado">
      {pieces.map((p, i) => (
        <i
          key={i}
          className="confetti"
          style={{ left: `${p.left}%`, background: p.color, animationDelay: `${p.delay}s`, ['--dx' as string]: `${p.dx}px`, transform: `rotate(${p.rot}deg)` }}
        />
      ))}
      <div className="finish-card">
        <p className="kicker">¡Crucigrama completado!</p>
        <p className="score">{shown}<small> pts</small></p>
        <p className="time">en {fmtTime(result.seconds)}</p>
        {others.map((o) => {
          const diff = result.seconds - o.seconds;
          return (
            <p className="versus" key={o.player}>
              {o.player}: {fmtTime(o.seconds)} ·{' '}
              {diff === 0 ? 'empate' : diff < 0 ? `le ganaste por ${fmtTime(-diff)}` : `te ganó por ${fmtTime(diff)}`}
            </p>
          );
        })}
        {online ? (
          <p className="muted">Ya quedó anotado en los puntos del grupo.</p>
        ) : (
          <button className="btn" onClick={send}>{copied ? '¡Copiado!' : 'Mandar mi resultado'}</button>
        )}
        <button className="btn primary" onClick={onClose}>Ver los puntos</button>
      </div>
    </div>
  );
}
