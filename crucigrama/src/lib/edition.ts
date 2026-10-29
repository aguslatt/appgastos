import type { ClueType } from './bank';

/** Número de edición: días desde el 1 de enero de 2026. */
export function editionNumber(day: string): number {
  const ms = new Date(day + 'T12:00:00').getTime() - new Date('2026-01-01T12:00:00').getTime();
  return Math.round(ms / 86400000) + 1;
}

export function longDate(day: string): string {
  const s = new Date(day + 'T12:00:00').toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const CLUE_TYPES: Record<ClueType, { label: string; glyph: string; hint: string }> = {
  anag: { label: 'Anagrama', glyph: '⇄', hint: 'Las letras de la palabra entre « » están desordenadas.' },
  oculta: { label: 'Escondida', glyph: '◌', hint: 'La respuesta está escondida dentro de la frase entre « ».' },
  suma: { label: 'Suma', glyph: '+', hint: 'La respuesta se arma sumando dos o más palabras.' },
  doble: { label: 'Doble', glyph: '⫽', hint: 'Dos significados distintos de una misma palabra.' },
  def: { label: 'Definición', glyph: '≡', hint: 'Una definición directa.' },
};
