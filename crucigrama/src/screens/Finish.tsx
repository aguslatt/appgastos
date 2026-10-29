import { useEffect, useMemo, useState } from 'react';
import { Flame, Icon, Tile } from '../components';
import { GAMES, fmtTime } from '../lib/scoring';
import { online, shareText } from '../lib/sync';
import type { Result } from '../lib/store';

const CONFETTI = ['#ffc800', '#ff4b91', '#1cb0f6', '#3dc46b', '#ff9600', '#ffffff'];

interface Props {
  result: Result;
  words: number;
  streak: number;
  color: string;
  others: Result[];
  onClose: () => void;
}

export function Finish({ result, words, streak, color, others, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(0);
  const text = shareText(result, GAMES[result.game].label);

  const pieces = useMemo(
    () =>
      Array.from({ length: 40 }, (_, i) => ({
        left: Math.round((i * 37) % 100),
        delay: ((i * 53) % 60) / 100,
        dx: ((i * 29) % 100) - 50,
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
      const k = Math.min(1, (now - t0) / 1000);
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
      <div className="finish-body">
        <div className="jump"><Tile name={result.player} color={color} size={150} mood="cheer" /></div>
        <h1>¡Crucigrama completado!</h1>
        <div className="finish-stats">
          <div className="fs fs-sun"><small>Puntos</small><b>{shown}</b></div>
          <div className="fs fs-sky"><small>Tiempo</small><b>{fmtTime(result.seconds)}</b></div>
          <div className="fs fs-go"><small>Palabras</small><b>{words}</b></div>
        </div>
        {streak > 0 && (
          <p className="streak-line"><Flame size={22} /> Racha de {streak} {streak === 1 ? 'día' : 'días'}</p>
        )}
        {others.map((o) => {
          const diff = result.seconds - o.seconds;
          return (
            <p className="versus" key={o.player}>
              {o.player} tardó {fmtTime(o.seconds)} ·{' '}
              <b>{diff === 0 ? 'empate' : diff < 0 ? `¡le ganaste por ${fmtTime(-diff)}!` : `te ganó por ${fmtTime(diff)}`}</b>
            </p>
          );
        })}
      </div>
      <div className="finish-actions">
        {!online && (
          <button className="btn white" onClick={send}>
            <Icon name="check" size={18} /> {copied ? '¡Copiado!' : 'Mandar mi resultado'}
          </button>
        )}
        <button className="btn sun" onClick={onClose}>Continuar</button>
      </div>
    </div>
  );
}
