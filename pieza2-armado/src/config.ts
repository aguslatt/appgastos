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
  // cada ítem es una línea; las palabras aparecen de a una
  concepto: ['el mate', 'que te debo'],
  // supers de horario (escenas 4 a 11, en orden)
  supers: [
    {hora: '06:40', texto: 'El súper todavía está cerrado.'},
    {hora: '06:52', texto: 'Llega el buzón.'},
    {hora: '07:05', texto: 'Se arma.'},
    {hora: '07:12', texto: 'Va la marca.'},
    {hora: '07:20', texto: 'Cartel, postales y lapiceras.'},
    {hora: '07:31', texto: 'La primera carta.'},
    {hora: '07:33', texto: 'Adentro.'},
    {hora: '08:00', texto: 'Abre el súper.'},
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
export const TOTAL = 1380;
export const FADE = 6;

export const T = {
  dato: [0, 150],
  presenta: [150, 240],
  concepto: [240, 345],
  stage: [345, 780], // escenas 4 a 8 (buzón continuo)
  postal: [780, 960], // escena 9
  adentro: [960, 1050], // escena 10
  super: [1050, 1200], // escena 11
  cierre: [1200, 1380],
} as const;

// Rango de cada super de horario
export const SUPER_RANGOS: [number, number][] = [
  [345, 435],
  [435, 525],
  [525, 615],
  [615, 690],
  [690, 780],
  [780, 960],
  [960, 1050],
  [1050, 1200],
];
