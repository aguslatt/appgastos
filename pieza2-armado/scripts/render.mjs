// Uso: node scripts/render.mjs <stills|video|placas|supers|all>
// Si el Chromium de Remotion no puede bajar las fuentes (proxy con CA propio),
// exportá BROWSER_EXECUTABLE=/usr/bin/google-chrome
import path from 'node:path';
import fs from 'node:fs';
import {bundle} from '@remotion/bundler';
import {getCompositions, renderMedia, renderStill} from '@remotion/renderer';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'out');
const mode = process.argv[2] ?? 'all';
const browserExecutable = process.env.BROWSER_EXECUTABLE || undefined;
const base = {browserExecutable, chromiumOptions: {}};

// stills a la mitad de cada escena (frames absolutos de ArmadoBTL)
const STILLS = [
  ['01_dato', 75], ['02_romance_presenta', 195], ['03_concepto', 295],
  ['04_mapa_150_supers', 345 + 94], ['04b_mapa_zoom_super', 345 + 135],
  ['05_super_cerrado', 390 + 240], ['06_llega_buzon', 480 + 240], ['07_se_arma', 570 + 240],
  ['08_va_la_marca', 652 + 240], ['09_accesorios', 735 + 240], ['10_primera_carta', 870 + 240],
  ['11_adentro', 1005 + 240], ['12_abre_el_super', 1125 + 240], ['13_cierre', 1290 + 240],
];
const PLACAS = [
  ['Placa01Dato', '01_dato'], ['Placa02RomancePresenta', '02_romance_presenta'],
  ['Placa03Concepto', '03_el_mate_que_te_debo'], ['Placa04Mapa', '04_mapa_150_supermercados'], ['Placa12Cierre', '12_cierre'],
];
const SUPERS = [
  ['01_0640', '06:40', 'El súper todavía está cerrado.'], ['02_0652', '06:52', 'Llega el buzón.'],
  ['03_0705', '07:05', 'Se arma.'], ['04_0712', '07:12', 'Va la marca.'],
  ['05_0720', '07:20', 'Cartel, postales y lapiceras.'], ['06_0731', '07:31', 'La primera carta.'],
  ['07_0733', '07:33', 'Adentro.'], ['08_0800', '08:00', 'Abre el súper.'],
];

const serveUrl = await bundle({entryPoint: path.join(root, 'src/index.ts'), publicDir: path.join(root, 'public')});
const comps = await getCompositions(serveUrl, base);
const get = (id) => comps.find((c) => c.id === id);
const mk = (d) => fs.mkdirSync(path.join(out, d), {recursive: true});

if (mode === 'stills' || mode === 'all') {
  mk('check');
  for (const [name, frame] of STILLS) {
    await renderStill({...base, composition: get('ArmadoBTL'), serveUrl, frame, imageFormat: 'png', output: path.join(out, 'check', `${name}.png`)});
    console.log('still', name);
  }
}
if (mode === 'supers' || mode === 'all') {
  mk('supers');
  const sup = get('Super');
  for (const [name, hora, texto] of SUPERS) {
    const props = {hora, texto};
    await renderStill({
      ...base, composition: {...sup, props}, inputProps: props, serveUrl, frame: 24, imageFormat: 'png',
      output: path.join(out, 'supers', `super_${name}.png`),
    });
    console.log('super', name);
  }
}
if (mode === 'placas' || mode === 'all') {
  mk('placas');
  for (const [id, file] of PLACAS) {
    await renderMedia({...base, composition: get(id), serveUrl, codec: 'h264', outputLocation: path.join(out, 'placas', `${file}.mp4`)});
    console.log('placa', file);
  }
}
if (mode === 'video' || mode === 'all') {
  await renderMedia({
    ...base, composition: get('ArmadoBTL'), serveUrl, codec: 'h264',
    outputLocation: path.join(out, 'pieza2_armado_btl.mp4'),
    onProgress: ({progress}) => process.stdout.write(`\rvideo ${(progress * 100).toFixed(0)}%`),
  });
  console.log('\nvideo ok');
}
