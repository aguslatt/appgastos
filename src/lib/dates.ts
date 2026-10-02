import type { DateStr, MonthKey } from './types';

/*
 * All date math works on plain year/month/day numbers via UTC, so daylight-saving
 * changes and the device time zone can never move an expense to another day.
 * The only "local" read is `todayStr()`, which is exactly what we want.
 */

const pad2 = (n: number) => String(n).padStart(2, '0');

/** UTC midnight of a calendar date. `Date.UTC` maps years 0-99 to 1900-1999, so set the year explicitly. */
function utcMs(year: number, month: number, day: number): number {
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  return d.getTime();
}

export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayStr(now: Date = new Date()): DateStr {
  return toDateStr(now);
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function daysInMonthOf(year: number, month: number): number {
  return new Date(utcMs(year, month + 1, 0)).getUTCDate();
}

export function isValidDateStr(s: unknown): s is DateStr {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonthOf(y, mo);
}

export function isValidMonthKey(s: unknown): s is MonthKey {
  if (typeof s !== 'string') return false;
  const m = MONTH_RE.exec(s);
  if (!m) return false;
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12;
}

export function parseDateStr(s: DateStr): { year: number; month: number; day: number } {
  const m = DATE_RE.exec(s);
  if (!m) throw new Error(`Invalid date: ${s}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function parseMonthKey(k: MonthKey): { year: number; month: number } {
  const m = MONTH_RE.exec(k);
  if (!m) throw new Error(`Invalid month: ${k}`);
  return { year: Number(m[1]), month: Number(m[2]) };
}

export function makeMonthKey(year: number, month: number): MonthKey {
  return `${String(year).padStart(4, '0')}-${pad2(month)}`;
}

export function monthKeyOf(s: DateStr): MonthKey {
  return s.slice(0, 7);
}

export function dayOf(s: DateStr): number {
  return Number(s.slice(8, 10));
}

export function daysInMonth(k: MonthKey): number {
  const { year, month } = parseMonthKey(k);
  return daysInMonthOf(year, month);
}

export function addMonths(k: MonthKey, n: number): MonthKey {
  const { year, month } = parseMonthKey(k);
  const idx = year * 12 + (month - 1) + n;
  const y = Math.floor(idx / 12);
  return makeMonthKey(y, idx - y * 12 + 1);
}

/** Date inside a month; `day` is clamped to the month's length (the 31st in a 30-day month -> 30th). */
export function dateInMonth(k: MonthKey, day: number): DateStr {
  const clamped = Math.min(Math.max(1, Number.isNaN(day) ? 1 : Math.trunc(day)), daysInMonth(k));
  return `${k}-${pad2(clamped)}`;
}

export function addDays(s: DateStr, n: number): DateStr {
  const { year, month, day } = parseDateStr(s);
  const d = new Date(utcMs(year, month, day + n));
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: DateStr, b: DateStr): number {
  const pa = parseDateStr(a);
  const pb = parseDateStr(b);
  return Math.round((utcMs(pb.year, pb.month, pb.day) - utcMs(pa.year, pa.month, pa.day)) / 86_400_000);
}

/** Monday = 0 ... Sunday = 6. */
export function weekdayMon0(s: DateStr): number {
  const { year, month, day } = parseDateStr(s);
  return (new Date(utcMs(year, month, day)).getUTCDay() + 6) % 7;
}

/** How many times each weekday (Monday-first) occurs between `from` and `to`, inclusive. */
export function weekdayOccurrences(from: DateStr, to: DateStr): number[] {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const total = diffDays(from, to) + 1;
  for (let i = 0; i < total; i++) {
    const w = weekdayMon0(addDays(from, i));
    counts[w] = (counts[w] ?? 0) + 1;
  }
  return counts;
}

// ---- formatting (Spanish, via Intl) ----------------------------------------

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
    formatterCache.set(key, f);
  }
  return f;
}

const utc = (s: DateStr): Date => {
  const { year, month, day } = parseDateStr(s);
  return new Date(utcMs(year, month, day));
};

export const capitalize = (s: string): string => (s ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s);

/** "octubre" */
export function monthName(k: MonthKey, locale: string): string {
  return formatter(locale, { month: 'long' }).format(utc(`${k}-01`));
}

/** "Octubre 2026" */
export function formatMonthLabel(k: MonthKey, locale: string): string {
  return `${capitalize(monthName(k, locale))} ${parseMonthKey(k).year}`;
}

/** "oct" */
export function monthShort(k: MonthKey, locale: string): string {
  return formatter(locale, { month: 'short' }).format(utc(`${k}-01`)).replace('.', '');
}

/** "mié" */
export function weekdayShort(s: DateStr, locale: string): string {
  return formatter(locale, { weekday: 'short' }).format(utc(s)).replace('.', '');
}

export function weekdayLong(index: number, locale: string): string {
  // 2024-01-01 was a Monday, so index 0..6 -> Monday..Sunday.
  return formatter(locale, { weekday: 'long' }).format(new Date(Date.UTC(2024, 0, 1 + index)));
}

export function weekdayInitial(index: number, locale: string): string {
  return formatter(locale, { weekday: 'narrow' }).format(new Date(Date.UTC(2024, 0, 1 + index))).toLocaleUpperCase();
}

/** "30 sep" */
export function formatShortDate(s: DateStr, locale: string): string {
  const { month, day } = parseDateStr(s);
  return `${day} ${monthShort(makeMonthKey(parseDateStr(s).year, month), locale)}`;
}

/** "mié 30 sep" (with the year when it isn't the current one). */
export function formatDayHeading(s: DateStr, today: DateStr, locale: string): string {
  if (s === today) return 'Hoy';
  if (s === addDays(today, -1)) return 'Ayer';
  const { year } = parseDateStr(s);
  const base = `${weekdayShort(s, locale)} ${formatShortDate(s, locale)}`;
  return year === parseDateStr(today).year ? base : `${base} ${year}`;
}

/** "miércoles 30 de septiembre de 2026" */
export function formatLongDate(s: DateStr, locale: string): string {
  return formatter(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(utc(s));
}
