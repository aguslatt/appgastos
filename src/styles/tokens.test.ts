import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

/** Body of the first `{ ... }` block that follows `selector`. */
function block(selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error('unbalanced braces');
}

function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1] as string] = (m[2] as string).trim();
  return out;
}

const light = declarations(block(':root {'));
const darkViaMedia = declarations(block(":root:not([data-theme='light'])"));
const darkViaAttribute = declarations(block(":root[data-theme='dark']"));

describe('theme tokens', () => {
  it('declares the same dark values for the OS setting and the manual toggle', () => {
    expect(Object.keys(darkViaMedia).length).toBeGreaterThan(30);
    expect(darkViaMedia).toEqual(darkViaAttribute);
  });

  it('only overrides tokens that exist in the light theme', () => {
    for (const name of Object.keys(darkViaAttribute)) expect(light, name).toHaveProperty(name);
  });

  it('defines every category color in both themes', () => {
    const colors = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red', 'sky', 'orchid', 'lime', 'slate'];
    for (const c of colors) {
      expect(light).toHaveProperty(`--c-${c}`);
      expect(darkViaAttribute).toHaveProperty(`--c-${c}`);
    }
  });
});

// ---- contrast (WCAG 2.x) ---------------------------------------------------------
const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel(((n >> 16) & 255) / 255) + 0.7152 * channel(((n >> 8) & 255) / 255) + 0.0722 * channel((n & 255) / 255);
}
const ratio = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** A translucent `rgba(r, g, b, a)` token laid over a solid hex color, as the hex it ends up looking like. */
function over(translucent: string, solid: string): string {
  const m = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/.exec(translucent);
  if (!m) throw new Error(`not an rgba color: ${translucent}`);
  const alpha = Number(m[4]);
  const base = parseInt(solid.slice(1), 16);
  const mix = (top: number, bottom: number) => Math.round(top * alpha + bottom * (1 - alpha));
  const r = mix(Number(m[1]), (base >> 16) & 255);
  const g = mix(Number(m[2]), (base >> 8) & 255);
  const b = mix(Number(m[3]), base & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// [foreground, background, minimum ratio]
const TEXT_PAIRS: Array<[string, string, number]> = [
  ['--ink', '--bg', 4.5],
  ['--ink', '--card', 4.5],
  ['--ink', '--card-2', 4.5],
  ['--ink-2', '--card', 4.5],
  ['--ink-2', '--bg', 4.5],
  ['--muted', '--card', 4.5],
  ['--muted', '--bg', 4.5],
  ['--muted', '--card-2', 4.5],
  ['--accent-ink', '--accent', 4.5],
  ['--accent-ink', '--accent-2', 4.5],
  ['--panel-ink', '--panel-bg', 4.5],
  ['--panel-ink', '--panel-bg-2', 4.5],
  ['--panel-ink-2', '--panel-bg', 4.5],
  ['--panel-ink-2', '--panel-bg-2', 4.5],
  ['--panel-in-ink-2', '--panel-in-bg', 4.5],
  ['--panel-in-ink-2', '--panel-in-bg-2', 4.5],
  ['--panel-in-bg', '--panel-in-ink', 4.5],
  ['--panel-in-ink', '--panel-in-bg', 4.5],
  ['--panel-in-ink', '--panel-in-bg-2', 4.5],
  ['--in-soft-ink', '--in-soft', 4.5],
  ['--in-text', '--card', 4.5],
  ['--in-text', '--bg', 4.5],
  ['--slide-blue-ink', '--slide-blue-bg', 4.5],
  ['--key-ink', '--key-bg', 4.5],
  ['--key-op-ink', '--key-op-bg', 4.5],
  ['--key-ink', '--key-fn-bg', 4.5],
  ['--key-go-ink', '--key-go-bg', 4.5],
  ['--slide-green-ink', '--slide-green-bg', 4.5],
  ['--slide-deep-ink', '--slide-deep-bg', 4.5],
  ['--slide-lime-ink', '--slide-lime-bg', 4.5],
  ['--slide-cream-ink', '--slide-cream-bg', 4.5],
  ['--slide-coral-ink', '--slide-coral-bg', 4.5],
  ...[0, 1, 2, 3, 4, 5].map((i): [string, string, number] => [`--heat-ink-${i}`, `--heat-${i}`, 4.5]),
  // marks (shapes) need 3:1
  ['--mark', '--card', 3],
  ['--mark', '--bg', 3],
  ['--out', '--card', 3],
  ['--in', '--card', 3],
  ['--bad', '--card', 3],
  ['--warn', '--card', 3],
];

describe.each([
  ['light', light],
  ['dark', { ...light, ...darkViaAttribute }],
])('contrast (%s)', (_name, tokens) => {
  it.each(TEXT_PAIRS)('%s on %s >= %f:1', (fg, bg, min) => {
    expect(ratio(tokens[fg] as string, tokens[bg] as string), `${fg} on ${bg}`).toBeGreaterThanOrEqual(min);
  });
});

// Text on the calculator panels sits on translucent "wells" (the amount field, the month chip, the stat boxes)
// laid over the panel gradient, so check it against what those wells really look like at both ends of the gradient.
describe.each([
  ['light', light],
  ['dark', { ...light, ...darkViaAttribute }],
])('text on the panel wells (%s)', (_name, tokens) => {
  const t = tokens as Record<string, string>;
  it.each([
    ['--panel-ink', '--panel-field', ['--panel-bg', '--panel-bg-2']],
    ['--panel-ink-2', '--panel-field', ['--panel-bg', '--panel-bg-2']],
    ['--panel-in-ink', '--panel-in-field', ['--panel-in-bg', '--panel-in-bg-2']],
    ['--panel-in-ink-2', '--panel-in-field', ['--panel-in-bg', '--panel-in-bg-2']],
  ] as const)('%s on %s over each end of the panel is at least 4.5:1', (fg, field, panels) => {
    for (const panel of panels) {
      const well = over(t[field] as string, t[panel] as string);
      expect(ratio(t[fg] as string, well), `${fg} on ${field} over ${panel}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
