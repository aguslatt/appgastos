import type { Category } from './types';

/**
 * Category colors are palette keys (not hex) so each theme can supply its own
 * step. The first eight are the validated categorical palette; the last four
 * were added for more categories. Hex values live in `styles/tokens.css`.
 */
export const COLOR_KEYS = [
  'blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red', 'sky', 'orchid', 'lime', 'slate',
] as const;

export type ColorKey = (typeof COLOR_KEYS)[number];

export const COLOR_LABELS: Record<ColorKey, string> = {
  blue: 'Azul', orange: 'Naranja', aqua: 'Turquesa', yellow: 'Amarillo', magenta: 'Rosa', green: 'Verde',
  violet: 'Violeta', red: 'Rojo', sky: 'Celeste', orchid: 'Lila', lime: 'Oliva', slate: 'Gris',
};

export function isColorKey(value: unknown): value is ColorKey {
  return typeof value === 'string' && (COLOR_KEYS as readonly string[]).includes(value);
}

/** CSS color for a category; unknown keys fall back to neutral gray. */
export function colorVar(key: string): string {
  return `var(--c-${isColorKey(key) ? key : 'slate'})`;
}

export const FALLBACK_CATEGORY_ID = 'otros';

export function defaultCategories(): Category[] {
  // Default folders use their id as the semantic `kind` the folder-guessing AI understands.
  const c = (id: string, name: string, emoji: string, color: ColorKey, flexible: boolean): Category => ({
    id, name, emoji, color, kind: id, flexible, limit: null, archived: false,
  });
  return [
    c('super', 'Supermercado', '🛒', 'green', false),
    c('comida', 'Comida afuera', '🍽️', 'orange', true),
    c('transporte', 'Transporte', '🚌', 'blue', false),
    c('hogar', 'Hogar', '🏠', 'violet', false),
    c('servicios', 'Servicios', '💡', 'yellow', false),
    c('salud', 'Salud', '💊', 'red', false),
    c('ocio', 'Ocio', '🎬', 'magenta', true),
    c('compras', 'Compras', '🛍️', 'aqua', true),
    c('educacion', 'Educación', '📚', 'sky', false),
    c('suscripciones', 'Suscripciones', '🔁', 'orchid', true),
    c('mascotas', 'Mascotas', '🐾', 'lime', false),
    c(FALLBACK_CATEGORY_ID, 'Otros', '📦', 'slate', false),
  ];
}

/** Emojis offered when creating or editing a folder. */
export const EMOJI_CHOICES = [
  '📁', '🛒', '🍽️', '🍔', '☕', '🍕', '🍺', '🚌', '🚗', '⛽', '🚲', '✈️', '🏠', '🔧', '💡', '📱', '🌐', '💊', '🏥', '🦷',
  '🎬', '🎮', '🎵', '🎟️', '🛍️', '👕', '👟', '💄', '💇', '📚', '🎓', '🔁', '🐾', '🐶', '🐱', '🎁', '🎂', '👶', '🧸',
  '🏋️', '⚽', '🌴', '🏖️', '💼', '🧾', '🏦', '💳', '🧹', '🪴', '🛠️', '🚿', '📦', '❤️', '⭐',
];

export function pickNewCategoryColor(existing: readonly Category[]): ColorKey {
  const used = new Set(existing.map((c) => c.color));
  return COLOR_KEYS.find((k) => !used.has(k) && k !== 'slate') ?? 'blue';
}
