import React from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {COLORS} from './config';
import {FONT} from './fonts';
import {prog} from './util';

export type SuperProps = {hora: string; texto: string};

// Super de horario: abajo a la izquierda, crema sobre caja roja.
export const Super: React.FC<SuperProps> = ({hora, texto}) => {
  const f = useCurrentFrame();
  const p = prog(f, 4, 16);
  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          left: 64,
          bottom: 64,
          background: COLORS.rojo,
          color: COLORS.crema,
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 20,
          fontFamily: FONT,
          opacity: p,
          transform: `translateY(${(1 - p) * 20}px)`,
        }}
      >
        <span style={{fontWeight: 800, fontSize: 48, lineHeight: 1}}>{hora}</span>
        <span style={{fontWeight: 600, fontSize: 32, lineHeight: 1}}>{texto}</span>
      </div>
    </AbsoluteFill>
  );
};
