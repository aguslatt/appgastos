import React from 'react';
import {AbsoluteFill, interpolate, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import {clamp} from './util';

// Corrección de color común + grano + viñeta para que el material de IA
// y el resto de la pieza se lean como una sola imagen.
export const Grade: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <>
      <AbsoluteFill style={{background: 'rgba(255, 214, 170, 0.07)', mixBlendMode: 'soft-light'}} />
      <AbsoluteFill style={{background: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 58%, rgba(20,8,4,0.32) 100%)'}} />
      <svg width={1920} height={1080} style={{position: 'absolute', inset: 0, opacity: 0.09, mixBlendMode: 'overlay'}}>
        <filter id="grano">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={f % 24} />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grano)" />
      </svg>
    </>
  );
};

type Props = {src: string; desde?: number; volume?: number};

export const Clip: React.FC<Props> = ({src, desde = 0, volume = 1}) => {
  const f = useCurrentFrame();
  const {durationInFrames} = useVideoConfig();
  // fundido de audio de entrada y salida
  const vol = volume * interpolate(f, [0, 10, durationInFrames - 10, durationInFrames], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{background: '#000'}}>
      <OffthreadVideo
        src={staticFile(src)}
        startFrom={desde}
        volume={vol}
        style={{width: 1920, height: 1080, objectFit: 'cover', filter: 'contrast(1.05) saturate(1.06)'}}
      />
      <Grade />
    </AbsoluteFill>
  );
};
