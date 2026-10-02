import { monthKeyOf, monthName } from './dates';
import type { MoneyFormatter } from './money';
import type { MonthStats } from './stats';
import type { Cents, DateStr } from './types';

/** Hours in a working month, used to turn money into time. */
export const WORK_HOURS_PER_MONTH = 160;

export interface LiveInput {
  /** What is being entered right now (cents, > 0). */
  amount: Cents;
  date: DateStr;
  today: DateStr;
  /** Stats of the month that contains `today`. */
  stats: MonthStats;
  budget: Cents | null;
  income: Cents | null;
  /** The folder the amount would go into, with what it already has this month. */
  folder: { name: string; limit: Cents | null; spent: Cents } | null;
  fmt: MoneyFormatter;
  locale: string;
}

export type LiveTone = 'neutral' | 'warn' | 'over';

export interface LiveContext {
  text: string;
  tone: LiveTone;
}

const percent = (v: number): string => `${Math.round(v * 100)}%`;

export function formatHours(hours: number, locale: string): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min de trabajo`;
  const n = new Intl.NumberFormat(locale, { maximumFractionDigits: hours < 10 ? 1 : 0 }).format(hours);
  return `${n} h de trabajo`;
}

/**
 * One short line shown while typing an amount: what it means for the month.
 * At most two facts, most important first: folder limit, budget (or pace), time of work.
 */
export function describeLive(i: LiveInput): LiveContext | null {
  const { amount, fmt } = i;
  if (amount <= 0) return null;

  const month = monthKeyOf(i.date);
  if (month !== monthKeyOf(i.today)) return { text: `Se suma a ${monthName(month, i.locale)}`, tone: 'neutral' };

  const parts: LiveContext[] = [];

  if (i.folder?.limit) {
    const after = i.folder.spent + amount;
    const share = after / i.folder.limit;
    if (share > 1) parts.push({ text: `Pasa el tope de ${i.folder.name} por ${fmt.formatRounded(after - i.folder.limit)}`, tone: 'over' });
    else if (share >= 0.8) parts.push({ text: `${i.folder.name}: ${percent(share)} de su tope`, tone: 'warn' });
  }

  if (i.budget) {
    const remaining = i.budget - i.stats.total - amount;
    if (remaining < 0) {
      parts.push({ text: `Pasa el presupuesto por ${fmt.formatRounded(-remaining)}`, tone: 'over' });
    } else {
      // Whole units, rounded down: better to understate what's left than to overstate it.
      const perDay = Math.floor(remaining / Math.max(1, i.stats.daysLeft) / 100) * 100;
      const share = amount / i.budget;
      parts.push({
        text: `${share >= 0.01 ? `${percent(share)} del presupuesto · ` : ''}quedan ${fmt.formatRounded(perDay)} por día`,
        tone: remaining / i.budget < 0.15 ? 'warn' : 'neutral',
      });
    }
  } else if (i.date === i.today) {
    const ratio = i.stats.dailyAverage > 0 ? amount / i.stats.dailyAverage : 0;
    if (ratio >= 1.5) {
      const n = new Intl.NumberFormat(i.locale, { maximumFractionDigits: 1 }).format(ratio);
      parts.push({ text: `≈ ${n} veces tu gasto diario`, tone: 'neutral' });
    } else {
      parts.push({ text: `Hoy llevas ${fmt.formatRounded(i.stats.todayTotal + amount)}`, tone: 'neutral' });
    }
  } else {
    parts.push({ text: 'Se suma a este mes', tone: 'neutral' });
  }

  if (i.income && i.income > 0) {
    const hours = amount / (i.income / WORK_HOURS_PER_MONTH);
    if (hours >= 0.25) parts.push({ text: formatHours(hours, i.locale), tone: 'neutral' });
  }

  const shown = parts.slice(0, 2);
  const tone: LiveTone = shown.some((p) => p.tone === 'over') ? 'over' : shown.some((p) => p.tone === 'warn') ? 'warn' : 'neutral';
  return { text: shown.map((p) => p.text).join(' · '), tone };
}
