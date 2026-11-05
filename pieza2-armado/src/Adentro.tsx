import React from 'react';
import {AbsoluteFill, Img, staticFile, useCurrentFrame} from 'remotion';
import {COLORS} from './config';
import {SLOT, Stage} from './Stage';
import {easeIO, prog} from './util';

// Escena 10: zoom 1 → 2.6 hacia la ranura; postal chica entra y desaparece (enmascarada).
export const Adentro: React.FC = () => {
  const f = useCurrentFrame();
  const z = prog(f, 0, 62, easeIO);
  const ins = prog(f, 40, 80, easeIO); // 0..1 recorrido de la postal
  const PW = 170;
  const PH = 112;
  // La postal baja delante del buzón y la máscara corta en el borde inferior de la ranura.
  const startY = SLOT.y - 250;
  const endY = SLOT.bottomInner + 40; // totalmente oculta
  const y = startY + (endY - startY) * ins;
  const clipBottom = SLOT.bottomInner;
  return (
    <Stage t={705} slotFocus={z}>
      <div
        style={{
          position: 'absolute',
          left: SLOT.x - 140,
          width: 280,
          top: SLOT.y - 300,
          height: clipBottom - (SLOT.y - 300),
          overflow: 'hidden',
          opacity: ins > 0 ? 1 : 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 140 - PW / 2,
            top: y - (SLOT.y - 300),
            width: PW,
            height: PH,
            boxSizing: 'border-box',
            padding: 6,
            background: `repeating-linear-gradient(135deg, ${COLORS.rojo} 0 9px, ${COLORS.crema} 9px 18px)`,
            boxShadow: '0 4px 10px rgba(0,0,0,0.35)',
            transform: 'rotate(-3deg)',
          }}
        >
          <div style={{width: '100%', height: '100%', background: COLORS.crema}} />
        </div>
      </div>
    </Stage>
  );
};

// Escena 11: buzón en el súper, push-in lento.
export const BuzonEnSuper: React.FC = () => {
  const f = useCurrentFrame();
  const p = prog(f, 0, 149, (x) => x);
  return (
    <AbsoluteFill style={{background: '#000', overflow: 'hidden'}}>
      <Img
        src={staticFile('assets/buzon_en_super_1920x1080.jpg')}
        style={{
          width: 1920,
          height: 1080,
          transform: `scale(${1 + 0.08 * p})`,
          filter: `brightness(${0.94 + 0.06 * p})`,
        }}
      />
    </AbsoluteFill>
  );
};
