import type { Cents } from './types';

export interface MoneyFormatter {
  locale: string;
  currency: string;
  /** "$", "US$", "€"... */
  symbol: string;
  decimalSeparator: string;
  /** Exact amount; decimals only when the amount has them: "$ 12.500" / "$ 12.500,50". */
  format(cents: Cents): string;
  /** Rounded to whole units, for totals and averages: "$ 245.300". */
  formatRounded(cents: Cents): string;
  /** No currency symbol, rounded: "245.300". */
  formatNumber(cents: Cents): string;
  /** Short form for chart labels: "12,5 mil", "1,2 M". */
  formatCompact(cents: Cents): string;
}

const cache = new Map<string, MoneyFormatter>();

/** Whole units, never negative zero (a -30 cent amount must not print as "-$ 0"). */
const units = (cents: Cents): number => Math.round(cents / 100) || 0;

export function getMoneyFormatter(locale: string, currency: string): MoneyFormatter {
  const key = `${locale}|${currency}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const currencyFormat = (min: number, max: number) =>
    new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: min, maximumFractionDigits: max });
  const whole = currencyFormat(0, 0);
  const withDecimals = currencyFormat(2, 2);
  const plain = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const parts = new Intl.NumberFormat(locale).formatToParts(1234.5);

  const formatter: MoneyFormatter = {
    locale,
    currency,
    symbol: whole.formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency,
    decimalSeparator: parts.find((p) => p.type === 'decimal')?.value ?? ',',
    format: (cents) => (cents % 100 === 0 ? whole : withDecimals).format(cents / 100),
    formatRounded: (cents) => whole.format(units(cents)),
    formatNumber: (cents) => plain.format(units(cents)),
    formatCompact: (cents) => compact.format(cents / 100),
  };
  cache.set(key, formatter);
  return formatter;
}

export interface CurrencyOption {
  code: string;
  name: string;
}

export const CURRENCIES: CurrencyOption[] = [
  { code: 'ARS', name: 'Peso argentino' },
  { code: 'USD', name: 'Dólar estadounidense' },
  { code: 'EUR', name: 'Euro' },
  { code: 'MXN', name: 'Peso mexicano' },
  { code: 'CLP', name: 'Peso chileno' },
  { code: 'COP', name: 'Peso colombiano' },
  { code: 'UYU', name: 'Peso uruguayo' },
  { code: 'PEN', name: 'Sol peruano' },
  { code: 'BOB', name: 'Boliviano' },
  { code: 'PYG', name: 'Guaraní paraguayo' },
  { code: 'BRL', name: 'Real brasileño' },
  { code: 'CRC', name: 'Colón costarricense' },
  { code: 'GTQ', name: 'Quetzal guatemalteco' },
  { code: 'DOP', name: 'Peso dominicano' },
];

const REGION_CURRENCY: Record<string, string> = {
  AR: 'ARS', MX: 'MXN', CL: 'CLP', CO: 'COP', UY: 'UYU', PE: 'PEN', BO: 'BOB', PY: 'PYG', BR: 'BRL',
  ES: 'EUR', US: 'USD', EC: 'USD', PA: 'USD', SV: 'USD', PR: 'USD', CR: 'CRC', GT: 'GTQ', DO: 'DOP',
};

/** Best guess for first launch from the browser language; the user confirms it in onboarding. */
export function detectLocaleAndCurrency(language: string | undefined): { locale: string; currency: string } {
  const tag = (language ?? '').replace(/_/g, '-');
  const [lang, ...rest] = tag.split('-');
  // The region is the first two-letter subtag; a four-letter one is a script ("es-Latn-MX").
  const region = (rest.find((part) => /^[A-Za-z]{2}$/.test(part)) ?? '').toUpperCase();
  const currency = REGION_CURRENCY[region];
  const isSpanishRegion = lang?.toLowerCase() === 'es' && region.length === 2 && currency !== undefined;
  return {
    locale: isSpanishRegion ? `es-${region}` : 'es-AR',
    currency: currency ?? 'ARS',
  };
}

export function isSupportedCurrency(code: unknown): code is string {
  if (typeof code !== 'string' || !/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: code });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse text typed into a field ("12.500,50", "12500.5", "$ 1,200") into cents.
 * The last separator is a decimal mark only when 1-2 digits follow it; with exactly
 * 3 digits ("1.250") it is a thousands separator, as is usual for Spanish locales.
 * The number is the first run that starts at a digit (or at a decimal mark glued to one: ".5"),
 * so "Gs. 5000" or "S/. 50" read their label's dot as punctuation, and a full stop ending a
 * sentence is ignored.
 */
export function parseAmountText(text: string): Cents | null {
  const found = /(?:(?<![\p{L}\d])[.,](?=\d))?\d(?:[\d.,]|[ \u00a0\u202f](?=\d))*/u.exec(text);
  if (!found) return null;
  const s = found[0].replace(/[ \u00a0\u202f]/g, '').replace(/[.,]+$/, '');
  let intDigits = s;
  let decDigits = '';
  const sep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (sep >= 0) {
    const after = s.length - sep - 1;
    if (after === 1 || after === 2) {
      intDigits = s.slice(0, sep);
      decDigits = s.slice(sep + 1);
    } else if (after > 3) {
      return null;
    }
  }
  const whole = Number(intDigits.replace(/[.,]/g, '') || '0');
  const cents = whole * 100 + Number(decDigits.padEnd(2, '0') || '0');
  return Number.isSafeInteger(cents) ? cents : null;
}
