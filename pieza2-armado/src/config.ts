// ─────────────────────────────────────────────────────────────
// TODOS los textos de la pieza viven acá. Cambialos sin tocar
// las animaciones.
// ─────────────────────────────────────────────────────────────

export const COLORS = {
  rojo: '#B3141B',
  crema: '#F3EBDD',
  texto: '#2B1A17',
  tinta: '#1F3A93',
};

export const TEXTOS = {
  dato: {
    numero: 37,
    simbolo: '%',
    texto: 'de los argentinos perdió contacto con amigos desde la pandemia.',
    fuente: 'Fuente: encuesta de Bumble a más de 1.000 adultos en Argentina (2023).',
  },
  presenta: 'presenta',
  mapa: {
    cantidad: 150,
    texto: 'supermercados en Capital Federal.',
    etiqueta: 'Buzón Romance',
    credito: 'Mapa: radios censales de la Ciudad de Buenos Aires (INDEC / GCBA, datos abiertos). Ubicaciones ilustrativas.',
  },
  // cada ítem es una línea; las palabras aparecen de a una
  concepto: ['el mate', 'que te debo'],
  // supers de horario, en orden de aparición (ver SUPER_RANGOS)
  supers: [
    {hora: '06:40', texto: 'El súper todavía está cerrado.'},
    {hora: '06:52', texto: 'Llega el buzón.'},
    {hora: '07:05', texto: 'Se arma.'},
    {hora: '07:31', texto: 'La primera carta.'},
  ],
  postal: {
    titulo: 'el mate que te debo',
    campos: [
      {label: 'Para:', respuesta: 'Mili'},
      {label: 'Te debo un mate desde:', respuesta: 'que nos recibimos'},
      {label: '¿Cuándo lo pagamos?:', respuesta: 'este viernes, en la plaza'},
      {label: 'De:', respuesta: 'Juli'},
    ],
  },
  cierre: {
    arriba: 'Buzones Romance en supermercados.',
    centro: 'el mate que te debo',
    abajo: 'Dejá tu carta. Romance se la lleva.',
  },
};

// ── Línea de tiempo (frames) ─────────────────────────────────
export const FPS = 30;
export const W = 1920;
export const H = 1080;
export const FADE = 6;
import timeline from './timeline.json';

export const MAPA_DUR = timeline.mapaDur;

// ── Videos de Gemini (public/videos, ya en 1920x1080 / 30 fps) ──
// `desde` = frame del clip donde arranca; `frames` = cuánto dura en la pieza.
export const CLIPS = {
  luces: {src: 'videos/01_luces.mp4', ...timeline.luces},
  llegada: {src: 'videos/02_llega_y_se_arma.mp4', ...timeline.llegada}, // corteEn: frame del clip donde cambia el plano
};

const D = MAPA_DUR;
const V1 = 345 + D; // arranca el primer clip
const V2 = V1 + CLIPS.luces.frames;
const V2END = V2 + CLIPS.llegada.frames;
export const T = {
  dato: [0, 150],
  presenta: [150, 240],
  concepto: [240, 345],
  mapa: [345, 345 + D],
  luces: [V1, V2],
  llegada: [V2, V2END],
  postal: [V2END, V2END + 180],
  cierre: [V2END + 180, V2END + 360],
} as const;
export const TOTAL = V2END + 360;

// Supers de horario: [inicio, fin] en frames absolutos, en el orden de TEXTOS.supers
export const SUPER_RANGOS: [number, number][] = [
  [T.luces[0], T.luces[1]],
  [T.llegada[0], T.llegada[0] + CLIPS.llegada.corteEn],
  [T.llegada[0] + CLIPS.llegada.corteEn, T.llegada[1]],
  [T.postal[0], T.postal[1]],
];
