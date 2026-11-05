import React, {useMemo} from 'react';
import {AbsoluteFill, Easing, Img, spring, staticFile, useCurrentFrame} from 'remotion';
import {COLORS, FPS, TEXTOS} from './config';
import {FONT} from './fonts';
import data from './mapdata.json';
import {prog} from './util';

// Datos reales de CABA (radios censales INDEC/GCBA, ver scripts/build_map.py).
// Los 150 puntos son posiciones SIMULADAS (ponderadas por población), no locales reales.
const MAP_W = data.w;
const MAP_H = data.h;
const OX = 1390 - MAP_W / 2;
const OY = (1080 - MAP_H) / 2;
const CENTER: [number, number] = [OX + MAP_W / 2, 540];
const dotsAbs: [number, number][] = data.dots.map(([x, y]) => [OX + x, OY + y]);

// orden de aparición (determinístico, repartido por toda la ciudad)
const order = (() => {
  let seed = 5;
  const r = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const a = dotsAbs.map((_, i) => i);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a; // order[k] = índice del punto que aparece k-ésimo
})();
const rank = (() => {
  const r: number[] = [];
  order.forEach((idx, k) => (r[idx] = k));
  return r;
})();

const SNAP = Easing.bezier(0.75, 0, 0.15, 1);
const SHOTS = [
  {inn: [100, 116], out: [152, 160], zoom: 6.5, site: 0},
  {inn: [162, 176], out: [208, 214], zoom: 7, site: 1},
  {inn: [216, 232], out: [999, 1000], zoom: 7.5, site: 2},
] as const;

const SCREEN_C: [number, number] = [830, 770]; // dónde queda el súper elegido al hacer zoom

export const MapaBA: React.FC = () => {
  const f = useCurrentFrame();
  const {texto, etiqueta, credito} = TEXTOS.mapa;
  const n = dotsAbs.length;

  const appear = (i: number) => 16 + 70 * Math.pow(rank[i] / n, 0.85);
  const count = useMemo(() => dotsAbs.reduce((c, _, i) => c + (f >= appear(i) ? 1 : 0), 0), [f]);

  // cámara
  let amount = 0;
  let shot = -1;
  SHOTS.forEach((s, i) => {
    if (f >= s.inn[0] && f < s.out[1]) {
      shot = i;
      amount = prog(f, s.inn[0], s.inn[1], SNAP) * (1 - prog(f, s.out[0], s.out[1], SNAP));
    }
  });
  const siteIdx = shot >= 0 ? data.sites[SHOTS[shot].site].index : -1;
  const target = shot >= 0 ? dotsAbs[siteIdx] : CENTER;
  const zoomMax = shot >= 0 ? SHOTS[shot].zoom : 1;
  const z = Math.exp(Math.log(zoomMax) * amount);
  const px = CENTER[0] + (target[0] - CENTER[0]) * amount;
  const py = CENTER[1] + (target[1] - CENTER[1]) * amount;
  const cx = CENTER[0] + (SCREEN_C[0] - CENTER[0]) * amount;
  const cy = CENTER[1] + (SCREEN_C[1] - CENTER[1]) * amount;

  const mapIn = prog(f, 0, 16);
  const titleOut = 1 - prog(f, 94, 102);
  const dotR = 8 / Math.pow(z, 0.55);
  const labelA = prog(z, 2.2, 3.6, (x) => x);

  const hold = shot >= 0 ? SHOTS[shot] : null;
  const act = hold
    ? spring({frame: f - (hold.inn[1] - 2), fps: FPS, config: {damping: 13, stiffness: 150, mass: 0.7}}) *
      (1 - prog(f, hold.out[0] - 2, hold.out[0] + 4))
    : 0;
  const pulse = hold ? ((f - hold.inn[1]) % 24) / 24 : 0;
  const barrio = hold ? data.sites[hold.site].name : '';

  const stroke = {fill: 'none', vectorEffect: 'non-scaling-stroke'} as const;

  return (
    <AbsoluteFill style={{background: COLORS.crema, fontFamily: FONT, overflow: 'hidden'}}>
      {/* título */}
      <div style={{position: 'absolute', left: 110, top: 270, opacity: titleOut * mapIn, transform: `translateX(${(1 - mapIn) * -30}px)`}}>
        <div style={{fontWeight: 800, fontSize: 280, lineHeight: 1, color: COLORS.rojo, fontVariantNumeric: 'tabular-nums'}}>{count}</div>
        <div style={{fontWeight: 600, fontSize: 56, lineHeight: 1.2, color: COLORS.texto, maxWidth: 760, marginTop: 16, textWrap: 'balance'}}>
          {texto}
        </div>
      </div>

      {/* mapa vectorial */}
      <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
        <g
          transform={`translate(${cx} ${cy}) scale(${z}) translate(${-px} ${-py})`}
          opacity={mapIn}
        >
          <g transform={`translate(${OX} ${OY})`}>
            {/* sombra y base */}
            <path d={data.caba} fill="rgba(43,26,23,0.10)" transform="translate(5 8)" />
            <path d={data.caba} fill="#EBDFC8" />
            {/* manzanas (radios censales) */}
            <path d={data.radios} stroke={COLORS.rojo} strokeOpacity={0.16} strokeWidth={0.5} fill="none" vectorEffect="non-scaling-stroke" />
            {/* barrios */}
            <path d={data.barrios} stroke={COLORS.rojo} strokeOpacity={0.5} strokeWidth={1.1} strokeLinejoin="round" {...stroke} />
            {/* contorno CABA con halo */}
            <path d={data.caba} stroke={COLORS.rojo} strokeOpacity={0.14} strokeWidth={11} strokeLinejoin="round" {...stroke} />
            <path d={data.caba} stroke={COLORS.rojo} strokeWidth={3.2} strokeLinejoin="round" {...stroke} />
            {/* etiquetas de barrios (aparecen al acercar) */}
            {labelA > 0 &&
              data.labels.filter((l) => !(act > 0.05 && l.name === barrio)).map((l) => {
                const size = Math.max(9, Math.min(15, Math.sqrt(l.area) * 0.13)) / Math.pow(z, 0.62);
                return (
                  <text
                    key={l.name}
                    x={l.x}
                    y={l.y}
                    textAnchor="middle"
                    fontFamily={FONT}
                    fontWeight={600}
                    fontSize={size}
                    letterSpacing={size * 0.12}
                    fill={COLORS.texto}
                    fillOpacity={0.62 * labelA}
                    stroke="#EBDFC8"
                    strokeWidth={size * 0.28}
                    strokeOpacity={labelA}
                    paintOrder="stroke"
                  >
                    {l.name.toUpperCase()}
                  </text>
                );
              })}
          </g>
          {/* puntos */}
          {dotsAbs.map(([x, y], i) => {
            const t0 = appear(i);
            if (f < t0) return null;
            const s = spring({frame: f - t0, fps: FPS, config: {damping: 14, stiffness: 220, mass: 0.5}});
            const ping = prog(f, t0, t0 + 14);
            const isT = i === siteIdx;
            const r = dotR * Math.max(0, s) * (isT ? 1.5 : 1);
            return (
              <g key={i}>
                {ping < 1 && <circle cx={x} cy={y} r={dotR * (1 + ping * 4)} fill="none" stroke={COLORS.rojo} strokeOpacity={0.7 * (1 - ping)} strokeWidth={2} vectorEffect="non-scaling-stroke" />}
                <circle cx={x} cy={y} r={r * 2} fill={COLORS.rojo} fillOpacity={0.16} />
                <circle cx={x} cy={y} r={r} fill={COLORS.rojo} stroke={COLORS.crema} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
        </g>
        {/* referencias de agua */}
        <g opacity={mapIn * titleOut} fontFamily={FONT} fontWeight={400} fill={COLORS.rojo} fillOpacity={0.55} letterSpacing={7} fontSize={17}>
          <text transform={`translate(${OX + MAP_W * 0.9} ${OY + MAP_H * 0.2}) rotate(41)`} textAnchor="middle">
            RÍO DE LA PLATA
          </text>
        </g>
      </svg>

      <div
        style={{
          position: 'absolute',
          right: 48,
          bottom: 36,
          fontWeight: 400,
          fontSize: 16,
          color: COLORS.texto,
          opacity: 0.5 * titleOut * mapIn,
          textAlign: 'right',
        }}
      >
        {credito}
      </div>

      {/* activación sobre el súper elegido */}
      {hold && act > 0.001 && (
        <>
          {[0, 0.5].map((o, i) => {
            const ph = (pulse + o) % 1;
            return (
              <div
                key={i}
                style={{
                  position: 'absolute',
                  left: SCREEN_C[0] - (30 + 120 * ph),
                  top: SCREEN_C[1] - (30 + 120 * ph),
                  width: 2 * (30 + 120 * ph),
                  height: 2 * (30 + 120 * ph),
                  borderRadius: '50%',
                  border: `4px solid ${COLORS.rojo}`,
                  opacity: (1 - ph) * act,
                }}
              />
            );
          })}
          <Img
            src={staticFile('assets/buzon_completo@2x.png')}
            style={{
              position: 'absolute',
              left: SCREEN_C[0] - (556 * 430) / 974 / 2,
              top: SCREEN_C[1] - 430,
              height: 430,
              transformOrigin: '50% 100%',
              transform: `scale(${act})`,
              opacity: Math.min(1, act * 2),
              filter: 'drop-shadow(0 18px 14px rgba(43,26,23,0.35))',
            }}
          />
          <div
            style={{
              position: 'absolute',
              left: SCREEN_C[0] + 180,
              top: SCREEN_C[1] - 290,
              opacity: Math.min(1, act),
              transform: `translateX(${(1 - Math.min(1, act)) * -30}px)`,
            }}
          >
            <div style={{fontWeight: 600, fontSize: 28, letterSpacing: '0.2em', color: COLORS.texto, marginBottom: 10}}>
              {barrio.toUpperCase()}
            </div>
            <div style={{background: COLORS.rojo, color: COLORS.crema, fontWeight: 800, fontSize: 48, padding: '16px 24px', display: 'inline-block'}}>
              {etiqueta}
            </div>
          </div>
        </>
      )}
    </AbsoluteFill>
  );
};
