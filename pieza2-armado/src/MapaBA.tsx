import React, {useMemo} from 'react';
import {AbsoluteFill, Easing, Img, spring, staticFile, useCurrentFrame} from 'remotion';
import {COLORS, FPS, TEXTOS} from './config';
import {FONT} from './fonts';
import {prog} from './util';

// Silueta ESTILIZADA de Capital Federal (lon, lat). No es cartográficamente exacta.
const POLY: [number, number][] = [
  [-58.465, -34.528], [-58.443, -34.539], [-58.416, -34.559], [-58.39, -34.578], [-58.37, -34.594],
  [-58.352, -34.612], [-58.346, -34.619], [-58.353, -34.63], [-58.36, -34.633], [-58.379, -34.648],
  [-58.401, -34.656], [-58.418, -34.669], [-58.445, -34.677], [-58.47, -34.693], [-58.499, -34.699],
  [-58.515, -34.672], [-58.531, -34.652], [-58.532, -34.625], [-58.53, -34.605], [-58.513, -34.59],
  [-58.505, -34.576], [-58.49, -34.556],
];

const MAP_H = 940;
const LAT_TOP = -34.5265;
const LAT_BOT = -34.7;
const LON_W = -58.5325;
const COS = Math.cos((34.61 * Math.PI) / 180);
const K = MAP_H / (LAT_TOP - LAT_BOT);
const MAP_W = (-58.345 - LON_W) * COS * K;
const OX = 1390 - MAP_W / 2;
const OY = (1080 - MAP_H) / 2;
const proj = ([lon, lat]: [number, number]): [number, number] => [
  OX + (lon - LON_W) * COS * K,
  OY + (LAT_TOP - lat) * K,
];
const PTS = POLY.map(proj);
const CENTER: [number, number] = [OX + MAP_W / 2, 540];

const outlinePath = () => {
  const n = PTS.length;
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(PTS[n - 1], PTS[0]);
  let d = `M${m0[0]},${m0[1]}`;
  for (let i = 0; i < n; i++) {
    const m = mid(PTS[i], PTS[(i + 1) % n]);
    d += ` Q${PTS[i][0]},${PTS[i][1]} ${m[0]},${m[1]}`;
  }
  return d + 'Z';
};

const inside = (x: number, y: number) => {
  let c = false;
  for (let i = 0, j = PTS.length - 1; i < PTS.length; j = i++) {
    const [xi, yi] = PTS[i];
    const [xj, yj] = PTS[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const edgeDist = (x: number, y: number) => {
  let m = 1e9;
  for (let i = 0; i < PTS.length; i++) {
    const [ax, ay] = PTS[i];
    const [bx, by] = PTS[(i + 1) % PTS.length];
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    m = Math.min(m, Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay))));
  }
  return m;
};
const rng = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// 150 posiciones simuladas (determinísticas), separadas entre sí.
const makeDots = (n: number) => {
  const r = rng(11);
  const dots: [number, number][] = [];
  let guard = 0;
  while (dots.length < n && guard++ < 200000) {
    const x = OX + r() * MAP_W;
    const y = OY + r() * MAP_H;
    if (!inside(x, y) || edgeDist(x, y) < 18) continue;
    if (dots.some(([a, b]) => Math.hypot(a - x, b - y) < 40)) continue;
    dots.push([x, y]);
  }
  return dots;
};
const nearest = (dots: [number, number][], fx: number, fy: number) => {
  const tx = OX + fx * MAP_W;
  const ty = OY + fy * MAP_H;
  let best = 0;
  dots.forEach((d, i) => {
    if (edgeDist(d[0], d[1]) < 120) return;
    if (edgeDist(dots[best][0], dots[best][1]) < 120 || Math.hypot(d[0] - tx, d[1] - ty) < Math.hypot(dots[best][0] - tx, dots[best][1] - ty)) best = i;
  });
  return best;
};

const SNAP = Easing.bezier(0.75, 0, 0.15, 1);
// tomas: [entra a, entra b, sale a, sale b], zoom
const SHOTS = [
  {inn: [100, 116], out: [152, 160], zoom: 7, at: [0.68, 0.3]},
  {inn: [162, 176], out: [208, 214], zoom: 8, at: [0.3, 0.76]},
  {inn: [216, 232], out: [999, 1000], zoom: 9, at: [0.38, 0.46]},
] as const;

const SCREEN_C: [number, number] = [830, 770]; // dónde queda el súper elegido al hacer zoom

export const MapaBA: React.FC = () => {
  const f = useCurrentFrame();
  const {cantidad, texto, etiqueta} = TEXTOS.mapa;
  const dots = useMemo(() => makeDots(cantidad), [cantidad]);
  const targets = useMemo(() => SHOTS.map((s) => nearest(dots, s.at[0], s.at[1])), [dots]);

  // aparición de puntos: acelerada
  const appear = (i: number) => 16 + 70 * Math.pow(i / cantidad, 0.85);
  const count = dots.reduce((n, _, i) => n + (f >= appear(i) ? 1 : 0), 0);

  // cámara
  let amount = 0;
  let shot = -1;
  SHOTS.forEach((s, i) => {
    if (f >= s.inn[0] && f < s.out[1]) {
      shot = i;
      amount = prog(f, s.inn[0], s.inn[1], SNAP) * (1 - prog(f, s.out[0], s.out[1], SNAP));
    }
  });
  const target = shot >= 0 ? dots[targets[shot]] : CENTER;
  const zoomMax = shot >= 0 ? SHOTS[shot].zoom : 1;
  const z = Math.exp(Math.log(zoomMax) * amount);
  const px = CENTER[0] + (target[0] - CENTER[0]) * amount;
  const py = CENTER[1] + (target[1] - CENTER[1]) * amount;
  const cx = CENTER[0] + (SCREEN_C[0] - CENTER[0]) * amount;
  const cy = CENTER[1] + (SCREEN_C[1] - CENTER[1]) * amount;

  const mapIn = prog(f, 0, 14);
  const titleOut = 1 - prog(f, 94, 102);
  const dotR = 9 / Math.pow(z, 0.55);

  // activación (en pantalla, sobre el súper elegido)
  const hold = shot >= 0 ? SHOTS[shot] : null;
  const act = hold
    ? spring({frame: f - (hold.inn[1] - 2), fps: FPS, config: {damping: 13, stiffness: 150, mass: 0.7}}) *
      (1 - prog(f, hold.out[0] - 2, hold.out[0] + 4))
    : 0;
  const pulse = hold ? ((f - hold.inn[1]) % 24) / 24 : 0;

  return (
    <AbsoluteFill style={{background: COLORS.crema, fontFamily: FONT, overflow: 'hidden'}}>
      {/* título */}
      <div style={{position: 'absolute', left: 110, top: 270, opacity: titleOut * mapIn, transform: `translateX(${(1 - mapIn) * -30}px)`}}>
        <div style={{fontWeight: 800, fontSize: 280, lineHeight: 1, color: COLORS.rojo, fontVariantNumeric: 'tabular-nums'}}>{count}</div>
        <div style={{fontWeight: 600, fontSize: 56, lineHeight: 1.2, color: COLORS.texto, maxWidth: 760, marginTop: 16, textWrap: 'balance'}}>{texto}</div>
      </div>

      {/* mapa */}
      <svg width={1920} height={1080} style={{position: 'absolute', inset: 0}}>
        <defs>
          <clipPath id="ba">
            <path d={outlinePath()} />
          </clipPath>
        </defs>
        <g
          transform={`translate(${cx} ${cy}) scale(${z}) translate(${-px} ${-py})`}
          opacity={mapIn}
        >
          <path d={outlinePath()} fill="#E8DCC6" />
          <g clipPath="url(#ba)" stroke={COLORS.rojo} strokeOpacity={0.12} strokeWidth={1.4} vectorEffect="non-scaling-stroke">
            <g transform={`rotate(-14 ${CENTER[0]} ${CENTER[1]})`}>
              {Array.from({length: 62}, (_, i) => (
                <line key={'h' + i} x1={OX - 300} x2={OX + MAP_W + 300} y1={OY - 100 + i * 20} y2={OY - 100 + i * 20} vectorEffect="non-scaling-stroke" />
              ))}
              {Array.from({length: 62}, (_, i) => (
                <line key={'v' + i} y1={OY - 300} y2={OY + MAP_H + 300} x1={OX - 100 + i * 20} x2={OX - 100 + i * 20} vectorEffect="non-scaling-stroke" />
              ))}
            </g>
          </g>
          <path d={outlinePath()} fill="none" stroke={COLORS.rojo} strokeWidth={4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {dots.map(([x, y], i) => {
            const s = spring({frame: f - appear(i), fps: FPS, config: {damping: 14, stiffness: 220, mass: 0.5}});
            const isTarget = shot >= 0 && targets[shot] === i;
            if (f < appear(i)) return null;
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={dotR * Math.max(0, s) * (isTarget ? 1.5 : 1)}
                fill={COLORS.rojo}
                stroke={COLORS.crema}
                strokeWidth={2.5}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
      </svg>

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
              top: SCREEN_C[1] - 250,
              background: COLORS.rojo,
              color: COLORS.crema,
              fontWeight: 800,
              fontSize: 48,
              padding: '16px 24px',
              opacity: Math.min(1, act),
              transform: `translateX(${(1 - Math.min(1, act)) * -30}px)`,
            }}
          >
            {etiqueta}
          </div>
        </>
      )}
    </AbsoluteFill>
  );
};

