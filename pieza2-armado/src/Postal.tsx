import React from 'react';
import {AbsoluteFill, spring, useCurrentFrame, useVideoConfig} from 'remotion';
import {COLORS, TEXTOS} from './config';
import {FONT, HAND} from './fonts';
import {Stage} from './Stage';
import {typed} from './util';

// Escena 9: primer plano de la postal. Fondo = pasillo con el buzón armado, desenfocado.
export const Postal: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame: f - 2, fps, config: {damping: 200}, durationInFrames: 22});
  const {titulo, campos} = TEXTOS.postal;
  // tiempos de tipeo (frame local, frames por letra)
  const sched = [
    {start: 26, fpc: 3},
    {start: 44, fpc: 2},
    {start: 88, fpc: 2},
    {start: 150 - 12, fpc: 3},
  ];
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <Stage t={600} blur={10} dim={0.5} />
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div
          style={{
            width: 1300,
            height: 820,
            marginTop: -40,
            boxSizing: 'border-box',
            padding: 22,
            background: `repeating-linear-gradient(135deg, ${COLORS.rojo} 0 26px, ${COLORS.crema} 26px 52px)`,
            boxShadow: '0 30px 70px rgba(0,0,0,0.5), 0 6px 16px rgba(0,0,0,0.35)',
            transform: `rotate(-2deg) translateY(${(1 - enter) * 60}px) scale(${0.97 + 0.03 * enter})`,
            opacity: enter,
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              background: COLORS.crema,
              boxSizing: 'border-box',
              padding: '48px 64px',
              fontFamily: FONT,
              color: COLORS.texto,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{fontWeight: 800, fontSize: 60, color: COLORS.rojo, lineHeight: 1}}>{titulo}</div>
            <div style={{flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-evenly', paddingTop: 20}}>
              {campos.map((c, i) => (
                <div key={i} style={{display: 'flex', alignItems: 'flex-end', gap: 18}}>
                  <span style={{fontWeight: 600, fontSize: 36, lineHeight: 1.3, whiteSpace: 'nowrap'}}>{c.label}</span>
                  <div
                    style={{
                      flex: 1,
                      position: 'relative',
                      height: 62,
                      borderBottom: `4px dotted rgba(43,26,23,0.55)`,
                    }}
                  >
                    <span
                      style={{
                        position: 'absolute',
                        left: 14,
                        bottom: 2,
                        fontFamily: HAND,
                        fontWeight: 500,
                        fontSize: 64,
                        lineHeight: 1,
                        color: COLORS.tinta,
                        whiteSpace: 'pre',
                      }}
                    >
                      {typed(c.respuesta, f, sched[i].start, sched[i].fpc)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
