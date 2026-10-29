import { useState } from 'react';
import { GAMES, fmtTime } from '../lib/scoring';
import { online, shareText } from '../lib/sync';
import type { Result } from '../lib/store';

export function Finish({ result, onClose }: { result: Result; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = shareText(result, GAMES[result.game].label);
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
    <div className="finish">
      <div className="finish-card">
        <div className="confetti">🎉</div>
        <h2>¡Listo!</h2>
        <p className="big">{result.points} pts</p>
        <p>Tiempo: {fmtTime(result.seconds)}</p>
        {online ? (
          <p className="muted">Ya quedó anotado en el ranking.</p>
        ) : (
          <button className="btn" onClick={send}>
            {copied ? '¡Copiado!' : 'Mandar mi resultado'}
          </button>
        )}
        <button className="btn primary" onClick={onClose}>Ver ranking</button>
      </div>
    </div>
  );
}
