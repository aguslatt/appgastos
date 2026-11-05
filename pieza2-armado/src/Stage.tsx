import React from 'react';
import {AbsoluteFill, Img, interpolate, spring, staticFile} from 'remotion';
import {FPS} from './config';
import {clamp, ease, easeIO, prog} from './util';

// Buzón: capas @2x (556x974) apiladas en el mismo lienzo.
export const BZ_H = 760;
export const BZ_W = (556 * BZ_H) / 974; // ≈ 433.8
export const BZ_CX = 1250;
export const BZ_FLOOR = 1010;
export const BZ_LEFT = BZ_CX - BZ_W / 2;
export const BZ_TOP = BZ_FLOOR - BZ_H;
const K = BZ_H / 974;
// ranura dorada (coords en el lienzo @2x): x 110–400, y 418–488
export const SLOT = {x: BZ_LEFT + 255 * K, y: BZ_TOP + 453 * K, w: 290 * K, bottomInner: BZ_TOP + 466 * K};

const layer = (name: string) => staticFile(`assets/buzon_${name}@2x.png`);
const layerStyle: React.CSSProperties = {position: 'absolute', left: 0, top: 0, width: BZ_W, height: BZ_H};

// Brillo del fondo (escena 4): 0.35 → 1 en dos escalones con parpadeo de tubo.
const lightLevel = (t: number) => {
  if (t < 22) return 0.35;
  if (t < 28) return [0.35, 0.62, 0.35, 0.62, 0.4, 0.62][t - 22];
  if (t < 52) return 0.62;
  if (t < 62) return [0.62, 1, 0.7, 1, 0.8, 0.62, 1, 0.9, 1, 1][t - 52];
  return 1;
};

const Film: React.FC<{t: number}> = ({t}) => {
  const T0 = 150; // corte
  const cut = prog(t, T0, T0 + 6, easeIO);
  const fall = prog(t, T0 + 6, T0 + 24, easeIO);
  const sheenX = interpolate(t, [100, 150], [-60, 160], clamp);
  const base: React.CSSProperties = {
    position: 'absolute',
    left: -16,
    right: -16,
    top: -12,
    bottom: -8,
    background: 'rgba(255,255,255,0.35)',
    border: '1px solid rgba(255,255,255,0.55)',
    borderRadius: 4,
    overflow: 'hidden',
  };
  const sheen = (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(115deg, transparent ${sheenX - 18}%, rgba(255,255,255,0.55) ${sheenX}%, transparent ${sheenX + 10}%)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(115deg, transparent ${sheenX - 62}%, rgba(255,255,255,0.3) ${sheenX - 54}%, transparent ${sheenX - 46}%)`,
        }}
      />
    </>
  );
  if (t < T0 + 6) {
    return (
      <>
        <div style={base}>{sheen}</div>
        {cut > 0 && (
          <div
            style={{
              position: 'absolute',
              left: '50%',
              top: -12,
              width: 3,
              marginLeft: -1.5,
              height: (BZ_H + 20) * cut,
              background: 'rgba(255,255,255,0.95)',
              boxShadow: '0 0 12px rgba(255,255,255,0.9)',
            }}
          />
        )}
      </>
    );
  }
  if (fall >= 1) return null;
  const half = (side: 1 | -1): React.CSSProperties => ({
    ...base,
    clipPath: side === -1 ? 'inset(0 50% 0 0)' : 'inset(0 0 0 50%)',
    opacity: 1 - fall,
    transform: `translate(${side * 14 * fall}px, ${90 * fall * fall}px) rotate(${side * 4 * fall}deg)`,
    transformOrigin: side === -1 ? '0% 0%' : '100% 0%',
  });
  return (
    <>
      <div style={half(-1)}>{sheen}</div>
      <div style={half(1)}>{sheen}</div>
    </>
  );
};

type Props = {t: number; blur?: number; dim?: number; slotFocus?: number; children?: React.ReactNode};

// t = frames desde el inicio de la escena 4 (comp frame 345).
export const Stage: React.FC<Props> = ({t, blur = 0, dim = 0, slotFocus = 0, children}) => {
  const light = lightLevel(t) * 0.88; // "un poco oscurecido"

  // escena 5: base entra desde la derecha (queda 12 px arriba)
  const slide = 1 - prog(t, 92, 142, easeIO);
  const baseX = slide * (1920 - BZ_LEFT + 40);
  const baseVisible = t >= 90;
  // escena 6: baja 12 px con mini rebote
  const drop = spring({frame: t - 184, fps: FPS, config: {damping: 9, stiffness: 160, mass: 0.7}});
  const baseY = t < 184 ? -12 : -12 * (1 - drop);
  const shadow = prog(t, 184, 206);
  // escena 7: logo (vinilo, máscara de izq. a der.)
  const logoP = prog(t, 274, 306, easeIO);
  const sheenLogo = prog(t, 304, 330, easeIO);
  // escena 8: accesorios caen desde 40 px arriba
  const accP = spring({frame: t - 349, fps: FPS, config: {damping: 16, stiffness: 140, mass: 0.8}});
  const accO = prog(t, 349, 361);
  const accY = -40 * (1 - Math.min(accP, 1.0));

  // zoom a la ranura (escena 10)
  const z = slotFocus; // 0..1 ya con easing
  const scale = 1 + 1.6 * z;
  const cx = SLOT.x + (960 - SLOT.x) * z;
  const cy = SLOT.y + (540 - SLOT.y) * z;

  return (
    <AbsoluteFill style={{background: '#222', overflow: 'hidden'}}>
      <AbsoluteFill
        style={{
          transformOrigin: '0 0',
          transform: `translate(${cx}px, ${cy}px) scale(${scale}) translate(${-SLOT.x}px, ${-SLOT.y}px)`,
          filter: blur ? `blur(${blur}px)` : undefined,
        }}
      >
        <Img
          src={staticFile('assets/fondo_super_gondola.jpg')}
          style={{
            position: 'absolute',
            left: -20,
            top: -20,
            width: 1960,
            height: 1120,
            objectFit: 'cover',
            filter: `brightness(${light})`,
          }}
        />
        {/* sombra elíptica en el piso */}
        <div
          style={{
            position: 'absolute',
            left: BZ_CX - 260,
            top: BZ_FLOOR - 30,
            width: 520,
            height: 60,
            borderRadius: '50%',
            background: 'radial-gradient(ellipse at center, rgba(30,10,5,0.55) 0%, rgba(30,10,5,0.28) 45%, rgba(30,10,5,0) 72%)',
            opacity: shadow,
          }}
        />
        <div style={{position: 'absolute', left: BZ_LEFT, top: BZ_TOP, width: BZ_W, height: BZ_H}}>
          {baseVisible && (
            <div style={{...layerStyle, transform: `translate(${baseX}px, ${baseY}px)`}}>
              <Img src={layer('capa1_base')} style={layerStyle} />
              {t < 150 + 24 && <Film t={t} />}
            </div>
          )}
          {t >= 274 && (
            <div style={{...layerStyle, clipPath: `inset(0 ${(1 - logoP) * 100}% 0 0)`}}>
              <Img src={layer('capa2_logo')} style={layerStyle} />
            </div>
          )}
          {t >= 274 && sheenLogo > 0 && sheenLogo < 1 && (
            <div
              style={{
                ...layerStyle,
                WebkitMaskImage: `url(${layer('capa2_logo')})`,
                WebkitMaskSize: '100% 100%',
                maskImage: `url(${layer('capa2_logo')})`,
                maskSize: '100% 100%',
                background: `linear-gradient(110deg, transparent ${sheenLogo * 140 - 40}%, rgba(255,255,255,0.95) ${sheenLogo * 140 - 25}%, transparent ${sheenLogo * 140 - 8}%)`,
              }}
            />
          )}
          {t >= 349 && (
            <div style={{...layerStyle, opacity: accO, transform: `translateY(${accY}px)`}}>
              <Img src={layer('capa3_accesorios')} style={layerStyle} />
            </div>
          )}
        </div>
        {children}
      </AbsoluteFill>
      {dim > 0 && <AbsoluteFill style={{background: `rgba(20,8,4,${dim})`}} />}
    </AbsoluteFill>
  );
};
