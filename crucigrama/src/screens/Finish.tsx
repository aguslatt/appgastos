import { useEffect, useState } from 'react';
import { GAMES, fmtTime } from '../lib/scoring';
import { online, shareText } from '../lib/sync';
import type { Result } from '../lib/store';

export function Finish({ result, onClose }: { result: Result; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(0);
  const text = shareText(result, GAMES[result.game].label);

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
      <div className="finish-card">
        <div className="stamp">Completado</div>
        <p className="kicker">{GAMES[result.game].label}</p>
        <p className="score">{shown}<small> pts</small></p>
        <p className="time">en {fmtTime(result.seconds)}</p>
        {online ? (
          <p className="muted">Ya quedó anotado en el ranking.</p>
        ) : (
          <button className="btn" onClick={send}>{copied ? '¡Copiado!' : 'Mandar mi resultado'}</button>
        )}
        <button className="btn primary" onClick={onClose}>Ver el duelo</button>
      </div>
    </div>
  );
}
