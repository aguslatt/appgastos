import React from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {COLORS, TEXTOS} from './config';
import {FONT} from './fonts';
import {clamp, ease, prog} from './util';

const fill = (bg: string): React.CSSProperties => ({
  backgroundColor: bg,
  fontFamily: FONT,
  alignItems: 'center',
  justifyContent: 'center',
});

// 1. DATO ─────────────────────────────────────────────────────
export const Dato: React.FC = () => {
  const f = useCurrentFrame();
  const n = Math.round(interpolate(f, [0, 30], [0, TEXTOS.dato.numero], {...clamp, easing: ease}));
  const t = prog(f, 36, 56);
  return (
    <AbsoluteFill style={fill(COLORS.crema)}>
      <div style={{textAlign: 'center', marginTop: -40}}>
        <div
          style={{
            fontWeight: 800,
            fontSize: 300,
            lineHeight: 1,
            color: COLORS.rojo,
            fontVariantNumeric: 'tabular-nums',
            transform: `scale(${interpolate(f, [0, 6, 30, 36, 46], [0.88, 1, 1, 1.07, 1], clamp)})`,
          }}
        >
          {n}
          {TEXTOS.dato.simbolo}
        </div>
        <div
          style={{
            fontWeight: 600,
            fontSize: 56,
            lineHeight: 1.2,
            color: COLORS.texto,
            maxWidth: 1250,
            margin: '24px auto 0',
            opacity: t,
            transform: `translateY(${(1 - t) * 24}px)`,
          }}
        >
          {TEXTOS.dato.texto}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          bottom: 56,
          left: 0,
          right: 0,
          textAlign: 'center',
          fontWeight: 400,
          fontSize: 24,
          color: COLORS.texto,
          opacity: 0.6 * prog(f, 60, 80),
        }}
      >
        {TEXTOS.dato.fuente}
      </div>
    </AbsoluteFill>
  );
};

// 2. ROMANCE PRESENTA ─────────────────────────────────────────
export const RomancePresenta: React.FC = () => {
  const f = useCurrentFrame();
  const a = prog(f, 4, 26);
  const p = prog(f, 28, 46);
  return (
    <AbsoluteFill style={fill(COLORS.crema)}>
      <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 36}}>
        <Img
          src={staticFile('assets/logo_romance_rojo.png')}
          style={{width: 520, opacity: a, transform: `scale(${0.96 + 0.04 * a})`}}
        />
        <div
          style={{
            fontWeight: 400,
            fontSize: 40,
            letterSpacing: '0.3em',
            paddingLeft: '0.3em',
            color: COLORS.texto,
            opacity: p,
          }}
        >
          {TEXTOS.presenta}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// 3. CONCEPTO ─────────────────────────────────────────────────
export const Concepto: React.FC = () => {
  const f = useCurrentFrame();
  const {fps} = useVideoConfig();
  let idx = 0;
  return (
    <AbsoluteFill style={fill(COLORS.rojo)}>
      <div style={{textAlign: 'center', color: COLORS.crema, fontWeight: 800, fontSize: 150, lineHeight: 1.08}}>
        {TEXTOS.concepto.map((line, li) => (
          <div key={li}>
            {line.split(' ').map((w, wi) => {
              const start = 6 + idx * 4;
              idx++;
              const s = spring({frame: f - start, fps, config: {damping: 200}, durationInFrames: 14});
              return (
                <span
                  key={wi}
                  style={{
                    display: 'inline-block',
                    marginRight: '0.28em',
                    opacity: Math.min(1, s * 2),
                    transform: `translateY(${(1 - s) * 40}px) scale(${1.22 - 0.22 * s})`,
                  }}
                >
                  {w}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

// 12. CIERRE ──────────────────────────────────────────────────
export const Cierre: React.FC = () => {
  const f = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  const out = interpolate(f, [durationInFrames - 10, durationInFrames - 1], [1, 0], clamp);
  const a = prog(f, 0, 18);
  const b = prog(f, 14, 36);
  const c = prog(f, 40, 62);
  return (
    <AbsoluteFill style={{backgroundColor: '#000'}}>
      <AbsoluteFill style={{...fill(COLORS.crema), opacity: out, justifyContent: 'space-between', padding: '110px 0 90px'}}>
        <div style={{fontWeight: 600, fontSize: 48, color: COLORS.texto, opacity: a, transform: `translateY(${(1 - a) * 16}px)`}}>
          {TEXTOS.cierre.arriba}
        </div>
        <div
          style={{
            fontWeight: 800,
            fontSize: 140,
            lineHeight: 1,
            color: COLORS.rojo,
            opacity: b,
            transform: `translateY(${(1 - b) * 24}px)`,
          }}
        >
          {TEXTOS.cierre.centro}
        </div>
        <div style={{display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 34, opacity: c}}>
          <div style={{fontWeight: 400, fontSize: 36, color: COLORS.texto}}>{TEXTOS.cierre.abajo}</div>
          <Img src={staticFile('assets/logo_romance_rojo.png')} style={{width: 300}} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
