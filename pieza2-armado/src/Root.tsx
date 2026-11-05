import React from 'react';
import {AbsoluteFill, Composition, Sequence, useCurrentFrame} from 'remotion';
import {FADE, FPS, H, SUPER_RANGOS, T, TEXTOS, TOTAL, W} from './config';
import './fonts';
import {Adentro, BuzonEnSuper} from './Adentro';
import {MapaBA} from './MapaBA';
import {Postal} from './Postal';
import {Cierre, Concepto, Dato, RomancePresenta} from './scenes-basic';
import {Stage} from './Stage';
import {Super} from './Super';
import {prog} from './util';

const FadeIn: React.FC<{children: React.ReactNode}> = ({children}) => {
  const f = useCurrentFrame();
  return <AbsoluteFill style={{opacity: prog(f, 0, FADE, (x) => x)}}>{children}</AbsoluteFill>;
};

// Escena con fundido corto de entrada; la anterior se extiende FADE frames por debajo.
const Scene: React.FC<{range: readonly [number, number]; fade?: boolean; last?: boolean; children: React.ReactNode}> = ({
  range,
  fade = true,
  last = false,
  children,
}) => (
  <Sequence from={range[0]} durationInFrames={range[1] - range[0] + (last ? 0 : FADE)}>
    {fade ? <FadeIn>{children}</FadeIn> : children}
  </Sequence>
);

const StageScene: React.FC = () => {
  const f = useCurrentFrame();
  return <Stage t={f} />;
};

export const ArmadoBTL: React.FC = () => (
  <AbsoluteFill style={{background: '#000'}}>
    <Scene range={T.dato} fade={false}><Dato /></Scene>
    <Scene range={T.presenta}><RomancePresenta /></Scene>
    <Scene range={T.concepto}><Concepto /></Scene>
    <Scene range={T.mapa}><MapaBA /></Scene>
    <Scene range={T.stage}><StageScene /></Scene>
    <Scene range={T.postal}><Postal /></Scene>
    <Scene range={T.adentro}><Adentro /></Scene>
    <Scene range={T.super}><BuzonEnSuper /></Scene>
    <Scene range={T.cierre} last><Cierre /></Scene>
    {SUPER_RANGOS.map((r, i) => (
      <Sequence key={i} from={r[0]} durationInFrames={r[1] - r[0]}>
        <Super {...TEXTOS.supers[i]} />
      </Sequence>
    ))}
  </AbsoluteFill>
);

const dur = (r: readonly [number, number]) => r[1] - r[0];

export const RemotionRoot: React.FC = () => {
  const common = {fps: FPS, width: W, height: H};
  return (
    <>
      <Composition id="ArmadoBTL" component={ArmadoBTL} durationInFrames={TOTAL} {...common} />
      <Composition id="Placa01Dato" component={Dato} durationInFrames={dur(T.dato)} {...common} />
      <Composition id="Placa02RomancePresenta" component={RomancePresenta} durationInFrames={dur(T.presenta)} {...common} />
      <Composition id="Placa03Concepto" component={Concepto} durationInFrames={dur(T.concepto)} {...common} />
      <Composition id="Placa04Mapa" component={MapaBA} durationInFrames={dur(T.mapa)} {...common} />
      <Composition id="Placa12Cierre" component={Cierre} durationInFrames={dur(T.cierre)} {...common} />
      <Composition
        id="Super"
        component={Super as React.FC<any>}
        durationInFrames={30}
        {...common}
        defaultProps={{hora: TEXTOS.supers[0].hora, texto: TEXTOS.supers[0].texto}}
      />
    </>
  );
};
