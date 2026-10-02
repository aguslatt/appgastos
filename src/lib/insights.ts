import { normalize } from './classifier';
import { addMonths, capitalize, formatLongDate, monthName, weekdayLong } from './dates';
import type { MoneyFormatter } from './money';
import {
  budgetStatus,
  categoryShifts,
  comparePace,
  completeMonthsBefore,
  computeMonthStats,
  groupByMonth,
  projectMonthEnd,
  sumAmounts,
  type BudgetStatus,
  type CategoryShift,
  type MonthStats,
  type PaceComparison,
  type Projection,
} from './stats';
import { upcomingRecurringTotal } from './recurring';
import type { Category, Cents, DateStr, Expense, MonthKey, Recurring } from './types';

// ---- analysis: the numbers, no wording -----------------------------------------

export interface FolderTotal {
  category: Category | undefined;
  categoryId: string;
  total: Cents;
  count: number;
  share: number;
}

export interface Habit {
  concept: string;
  count: number;
  total: Cents;
}

export interface WeekdayInsight {
  /** Monday = 0. */
  index: number;
  avg: Cents;
  overall: Cents;
  /** How much more than a typical day, e.g. 0.6 = 60% more. */
  extra: number;
}

export interface SavingTip {
  category: Category;
  monthly: Cents;
}

export interface MonthAnalysis {
  month: MonthKey;
  today: DateStr;
  stats: MonthStats;
  previousTotal: Cents;
  pace: PaceComparison | null;
  projection: Projection | null;
  budget: BudgetStatus | null;
  folders: FolderTotal[];
  up: (CategoryShift & { category: Category | undefined }) | null;
  down: (CategoryShift & { category: Category | undefined }) | null;
  biggest: { expense: Expense; category: Category | undefined } | null;
  habit: Habit | null;
  weekday: WeekdayInsight | null;
  tip: SavingTip | null;
}

export interface AnalysisInput {
  month: MonthKey;
  today: DateStr;
  expenses: readonly Expense[];
  categories: readonly Category[];
  recurring: readonly Recurring[];
  budget: Cents | null;
}

export function analyzeMonth(input: AnalysisInput): MonthAnalysis {
  const { month, today, categories } = input;
  const byMonth = groupByMonth(input.expenses);
  const current = byMonth.get(month) ?? [];
  const prevMonth = addMonths(month, -1);
  const previous = byMonth.get(prevMonth) ?? [];
  const stats = computeMonthStats(current, month, today);
  const find = (id: string) => categories.find((c) => c.id === id);

  const pace = comparePace(stats, previous);
  const priors = completeMonthsBefore(byMonth, month).map((m) => byMonth.get(m) ?? []);
  const projection = projectMonthEnd(stats, current, priors, upcomingRecurringTotal(input.recurring, today));

  const folders: FolderTotal[] = stats.byCategory.map((c) => ({ ...c, category: find(c.categoryId) }));

  // Biggest movers against the previous month, ignoring noise.
  const shifts = categoryShifts(stats, current, previous).filter((s) => s.previous > 0 && s.pct !== null);
  const meaningful = (s: CategoryShift) => Math.abs(s.delta) >= stats.total * 0.03 && Math.abs(s.pct ?? 0) >= 0.2;
  const ups = shifts.filter((s) => s.delta > 0 && meaningful(s)).sort((a, b) => b.delta - a.delta);
  const downs = shifts.filter((s) => s.delta < 0 && meaningful(s)).sort((a, b) => a.delta - b.delta);
  const decorate = (s: CategoryShift | undefined) => (s ? { ...s, category: find(s.categoryId) } : null);

  // The "habit": the same concept again and again.
  const groups = new Map<string, { label: string; count: number; total: Cents }>();
  for (const e of current) {
    const key = normalize(e.note);
    if (key.length < 2) continue;
    const g = groups.get(key) ?? { label: e.note, count: 0, total: 0 };
    groups.set(key, { label: g.label, count: g.count + 1, total: g.total + e.amount });
  }
  const habitCandidate = [...groups.values()]
    .filter((g) => g.count >= 4 && g.total >= stats.total * 0.02)
    .sort((a, b) => b.total - a.total)[0];

  // Weekday pattern, only with enough finished weeks.
  let weekday: WeekdayInsight | null = null;
  const finished = stats.weekdayDays.reduce((a, b) => a + b, 0);
  if (finished >= 14 && stats.weekdayDays.every((d) => d >= 2)) {
    const avgs = stats.weekdayTotals.map((t, i) => t / (stats.weekdayDays[i] ?? 1));
    const overall = stats.weekdayTotals.reduce((a, b) => a + b, 0) / finished;
    const top = avgs.reduce((best, v, i) => (v > (avgs[best] ?? 0) ? i : best), 0);
    const extra = overall > 0 ? (avgs[top] ?? 0) / overall - 1 : 0;
    if (extra >= 0.25) weekday = { index: top, avg: Math.round(avgs[top] ?? 0), overall: Math.round(overall), extra };
  }

  // Where a 10% trim would hurt least: the biggest flexible folder.
  let tip: SavingTip | null = null;
  const flexible = folders.find((f) => f.category?.flexible && f.share >= 0.12);
  if (flexible?.category && stats.total > 0) tip = { category: flexible.category, monthly: Math.round(flexible.total * 0.1) };

  const biggest = stats.biggest ? { expense: stats.biggest, category: find(stats.biggest.categoryId) } : null;

  return {
    month,
    today,
    stats,
    previousTotal: sumAmounts(previous),
    pace,
    projection,
    budget: budgetStatus(input.budget, stats),
    folders,
    up: decorate(ups[0]),
    down: decorate(downs[0]),
    biggest,
    habit: habitCandidate ? { concept: habitCandidate.label, count: habitCandidate.count, total: habitCandidate.total } : null,
    weekday,
    tip,
  };
}

// ---- verdict ------------------------------------------------------------------------

export type VerdictId = 'saver' | 'balanced' | 'over';

export interface Verdict {
  id: VerdictId;
  emoji: string;
  label: string;
  /** Why, in a sentence. */
  reason: string;
}

const pct = (v: number): string => `${Math.round(Math.abs(v) * 100)}%`;

/** "Saving or sabotaging?": judged against the budget when there is one, otherwise against last month. */
export function verdictFor(a: MonthAnalysis, f: MoneyFormatter, locale: string): Verdict | null {
  const { stats, budget, pace, projection } = a;
  if (stats.status === 'future' || stats.count === 0) return null;
  const prevName = monthName(addMonths(a.month, -1), locale);

  if (budget) {
    const basis = stats.status === 'current' ? (projection ? projection.total / budget.budget : null) : budget.pct;
    if (basis === null) return null;
    const closing = stats.status === 'past';
    if (basis <= 0.9) {
      return {
        id: 'saver',
        emoji: '🌱',
        label: 'Mes de ahorro',
        reason: closing
          ? `Cerró en el ${pct(budget.pct)} del presupuesto: sobraron ${f.formatRounded(budget.remaining)}.`
          : `Va camino a cerrar en el ${pct(basis)} del presupuesto.`,
      };
    }
    if (basis <= 1) {
      return {
        id: 'balanced',
        emoji: '⚖️',
        label: 'Justo en el límite',
        reason: closing ? `Usó el ${pct(budget.pct)} del presupuesto: ajustado, pero adentro.` : `Va camino a usar casi todo el presupuesto (${pct(basis)}).`,
      };
    }
    return {
      id: 'over',
      emoji: '🔥',
      label: 'Se fue la mano',
      reason: closing
        ? `Se pasó del presupuesto por ${f.formatRounded(-budget.remaining)} (${pct(budget.pct)}).`
        : `A este ritmo se pasaría del presupuesto (${pct(basis)}).`,
    };
  }

  if (pace && pace.pct !== null) {
    const when = pace.toDate ? `a esta altura de ${prevName}` : `que ${prevName}`;
    if (pace.pct <= -0.08) return { id: 'saver', emoji: '🌱', label: 'Mes de ahorro', reason: `${pct(pace.pct)} menos ${when}.` };
    if (pace.pct >= 0.08) return { id: 'over', emoji: '🔥', label: 'Se fue la mano', reason: `${pct(pace.pct)} más ${when}.` };
    return { id: 'balanced', emoji: '⚖️', label: 'Mes parejo', reason: `Casi igual ${when}.` };
  }
  return null;
}

// ---- story slides -------------------------------------------------------------------

export type SlideTheme = 'green' | 'deep' | 'lime' | 'cream' | 'coral' | 'blue';

export interface SlideItem {
  label: string;
  value: string;
  emoji?: string;
  /** Category palette key for the colored marker. */
  color?: string;
  /** 0..1, drawn as a thin bar. */
  share?: number;
}

export interface StorySlide {
  id: string;
  theme: SlideTheme;
  kicker: string;
  emoji?: string;
  title: string;
  big?: string;
  /** Show the big figure above the title ("5 / días sin gastar"). */
  bigFirst?: boolean;
  caption?: string;
  items?: SlideItem[];
  /** Seven values (Monday first) to draw as small bars, with the highlighted index. */
  weekdayBars?: { values: number[]; highlight: number };
}

/** What came in during the month, when the person records income. */
export interface IncomeSummary {
  total: Cents;
  bySource: Array<{ name: string; emoji: string; color: string; total: Cents; share: number }>;
}

export interface StoryContext {
  analysis: MonthAnalysis;
  fmt: MoneyFormatter;
  locale: string;
  income?: IncomeSummary | null;
}

const upper = (s: string): string => s.toLocaleUpperCase();
/** Wraps the last word in *asterisks*: the slide renders it bold and the rest light (two-weight headline). */
const emphasizeLast = (text: string): string => text.replace(/(\S+)$/, '*$1*');
/** Removes the *emphasis* markers. */
export const plainTitle = (text: string): string => text.replace(/\*/g, '');
const pluralDay = (name: string): string => (name.endsWith('s') ? name : `${name}s`);

export function buildStory({ analysis: a, fmt: f, locale, income }: StoryContext): StorySlide[] {
  const { stats } = a;
  const month = monthName(a.month, locale);
  const prevMonth = monthName(addMonths(a.month, -1), locale);
  const isCurrent = stats.status === 'current';
  const slides: StorySlide[] = [];

  if (stats.count === 0) {
    return [
      {
        id: 'empty',
        theme: 'green',
        kicker: upper(month),
        emoji: '🌤️',
        title: stats.status === 'future' ? 'Este mes todavía no empezó' : 'Sin gastos registrados en este mes',
        caption: 'Cuando haya movimientos, acá aparece el resumen.',
      },
    ];
  }

  slides.push({
    id: 'intro',
    theme: 'green',
    kicker: isCurrent ? `${upper(month)} HASTA HOY` : `${upper(month)} EN NÚMEROS`,
    title: isCurrent ? 'Así viene *tu mes*' : 'Así cerró *tu mes*',
    big: f.formatRounded(stats.total),
    caption: `${stats.count} ${stats.count === 1 ? 'movimiento' : 'movimientos'} · ${f.formatRounded(stats.dailyAverage)} por día en promedio`,
  });

  const verdict = verdictFor(a, f, locale);
  if (verdict) {
    slides.push({
      id: 'verdict',
      theme: verdict.id === 'saver' ? 'lime' : verdict.id === 'over' ? 'coral' : 'cream',
      kicker: '¿AHORRANDO O SABOTÁNDOSE?',
      emoji: verdict.emoji,
      title: emphasizeLast(verdict.label),
      caption: verdict.reason,
    });
  }

  if (income && income.total > 0) {
    const kept = income.total - stats.total;
    const keptShare = kept / income.total;
    slides.push({
      id: 'income',
      theme: 'blue',
      kicker: isCurrent ? 'LO QUE ENTRÓ HASTA HOY' : 'LO QUE ENTRÓ',
      emoji: kept >= 0 ? '💰' : '🫠',
      title: kept >= 0 ? (isCurrent ? 'Hasta ahora *te queda*' : 'Te *quedó*') : isCurrent ? 'Hasta ahora *vas pasado*' : 'Te *pasaste*',
      big: `${kept >= 0 ? '+' : '−'}${f.formatRounded(Math.abs(kept))}`,
      caption:
        kept >= 0
          ? `Entraron ${f.formatRounded(income.total)} y gastaste ${f.formatRounded(stats.total)}: guardaste el ${pct(keptShare)}.`
          : `Entraron ${f.formatRounded(income.total)} y gastaste ${f.formatRounded(stats.total)}.`,
      items: income.bySource.slice(0, 3).map((s) => ({ label: s.name, value: f.formatRounded(s.total), emoji: s.emoji, color: s.color, share: s.share })),
    });
  }

  const top = a.folders.slice(0, 3);
  const first = top[0];
  if (first && first.category) {
    slides.push({
      id: 'top-folder',
      theme: 'deep',
      kicker: 'TU CARPETA ESTRELLA',
      emoji: first.category.emoji,
      title: first.category.name,
      big: pct(first.share),
      caption: `de todo lo gastado fue a ${first.category.name}: ${f.formatRounded(first.total)}.`,
      items: top.map((t) => ({
        label: t.category?.name ?? 'Sin carpeta',
        value: f.formatRounded(t.total),
        emoji: t.category?.emoji,
        color: t.category?.color,
        share: t.share,
      })),
    });
  }

  const mover = a.up && (!a.down || a.up.delta >= -a.down.delta) ? a.up : (a.down ?? a.up);
  if (mover?.category && mover.pct !== null) {
    const rose = mover.delta > 0;
    const sameSpan = isCurrent ? `a esta altura de ${prevMonth}` : `en ${prevMonth}`;
    slides.push({
      id: 'shift',
      theme: rose ? 'coral' : 'lime',
      kicker: rose ? 'LO QUE MÁS SUBIÓ' : 'LO QUE MÁS BAJÓ',
      emoji: mover.category.emoji,
      title: mover.category.name,
      big: `${rose ? '+' : '−'}${pct(mover.pct)}`,
      caption: `Pasó de ${f.formatRounded(mover.previous)} ${sameSpan} a ${f.formatRounded(mover.current)}.`,
    });
  }

  if (a.biggest) {
    const { expense, category } = a.biggest;
    slides.push({
      id: 'biggest',
      theme: 'deep',
      kicker: 'EL GOLPE DEL MES',
      emoji: category?.emoji ?? '💥',
      title: expense.note || category?.name || 'Gasto más grande',
      big: f.formatRounded(expense.amount),
      caption: `${capitalize(formatLongDate(expense.date, locale))} · ${pct(expense.amount / stats.total)} de todo el mes.`,
    });
  }

  if (a.habit) {
    slides.push({
      id: 'habit',
      theme: 'lime',
      kicker: 'TU HÁBITO DEL MES',
      emoji: '🔁',
      title: `${capitalize(a.habit.concept)} ×${a.habit.count}`,
      big: f.formatRounded(a.habit.total),
      caption: `${f.formatRounded(Math.round(a.habit.total / a.habit.count))} cada vez. Lo chico, repetido, también pesa.`,
    });
  }

  if (a.weekday) {
    const name = weekdayLong(a.weekday.index, locale);
    slides.push({
      id: 'weekday',
      theme: 'green',
      kicker: 'TU DÍA MÁS CARO',
      title: `Los *${pluralDay(name)}*`,
      big: `+${pct(a.weekday.extra)}`,
      caption: `Se gastaron en promedio ${f.formatRounded(a.weekday.avg)} cada ${name}, contra ${f.formatRounded(a.weekday.overall)} un día cualquiera.`,
      weekdayBars: { values: stats.weekdayTotals.map((t, i) => t / (stats.weekdayDays[i] || 1)), highlight: a.weekday.index },
    });
  }

  if (stats.noSpendDays >= 3) {
    slides.push({
      id: 'no-spend',
      theme: 'lime',
      kicker: 'DÍAS EN VERDE',
      emoji: '🌿',
      title: 'días sin *gastar*',
      big: String(stats.noSpendDays),
      bigFirst: true,
      caption:
        stats.longestNoSpendStreak >= 2
          ? `La racha más larga fue de ${stats.longestNoSpendStreak} días seguidos.`
          : 'Cada día en cero ayuda a que el mes cierre mejor.',
    });
  }

  if (isCurrent && a.projection) {
    const budgetLine = a.budget
      ? a.projection.total <= a.budget.budget
        ? `Entraría en el presupuesto de ${f.formatRounded(a.budget.budget)}.`
        : `Superaría el presupuesto de ${f.formatRounded(a.budget.budget)} por ${f.formatRounded(a.projection.total - a.budget.budget)}.`
      : a.previousTotal > 0
        ? `${capitalize(prevMonth)} cerró en ${f.formatRounded(a.previousTotal)}.`
        : undefined;
    slides.push({
      id: 'projection',
      theme: 'cream',
      kicker: 'LO QUE VIENE',
      emoji: '🔮',
      title: 'A este ritmo, el mes *cerraría en*',
      big: `≈ ${f.formatRounded(a.projection.total)}`,
      caption: budgetLine,
    });
  } else if (!isCurrent && a.tip) {
    slides.push({
      id: 'tip',
      theme: 'cream',
      kicker: 'UN EMPUJONCITO',
      emoji: a.tip.category.emoji,
      title: `Si ${a.tip.category.name} bajara un *10%*`,
      big: f.formatRounded(a.tip.monthly),
      caption: `menos por mes. En un año serían ${f.formatRounded(a.tip.monthly * 12)}.`,
    });
  }

  slides.push({
    id: 'end',
    theme: 'green',
    kicker: 'FIN DEL RESUMEN',
    emoji: '✨',
    title: isCurrent ? 'Hasta acá, *por ahora*' : `Eso fue *${month}*`,
    caption: 'Cada gasto anotado cuenta. Nos vemos en el próximo resumen.',
  });

  return slides;
}

// ---- quick facts (pills on the month screen) ---------------------------------------

export interface Fact {
  id: string;
  emoji: string;
  text: string;
  tone: 'good' | 'warn' | 'info';
}

export function buildFacts({ analysis: a, fmt: f, locale }: StoryContext): Fact[] {
  const facts: Fact[] = [];
  const { stats } = a;
  if (stats.count === 0) return facts;
  const prev = monthName(addMonths(a.month, -1), locale);

  if (a.pace && a.pace.pct !== null && Math.abs(a.pace.pct) >= 0.03) {
    const more = a.pace.pct > 0;
    facts.push({
      id: 'pace',
      emoji: more ? '📈' : '📉',
      text: `${pct(a.pace.pct)} ${more ? 'más' : 'menos'} que ${a.pace.toDate ? `a esta altura de ${prev}` : prev}`,
      tone: more ? 'warn' : 'good',
    });
  }
  if (a.projection && stats.status === 'current') {
    facts.push({ id: 'projection', emoji: '🔮', text: `Cerraría en ≈ ${f.formatRounded(a.projection.total)}`, tone: 'info' });
  }
  if (a.weekday) {
    facts.push({ id: 'weekday', emoji: '📅', text: `Los ${pluralDay(weekdayLong(a.weekday.index, locale))}, tu día más caro`, tone: 'info' });
  }
  if (a.habit) {
    facts.push({ id: 'habit', emoji: '🔁', text: `${capitalize(a.habit.concept)} ×${a.habit.count}: ${f.formatRounded(a.habit.total)}`, tone: 'info' });
  }
  if (stats.noSpendDays >= 2) {
    facts.push({ id: 'no-spend', emoji: '🌿', text: `${stats.noSpendDays} días sin gastar`, tone: 'good' });
  }
  if (a.biggest && stats.count >= 3) {
    facts.push({
      id: 'biggest',
      emoji: a.biggest.category?.emoji ?? '💥',
      text: `Lo más grande: ${f.formatRounded(a.biggest.expense.amount)}${a.biggest.expense.note ? ` (${a.biggest.expense.note})` : ''}`,
      tone: 'info',
    });
  }
  return facts;
}

/** Plain-text recap for the share sheet. */
export function shareText({ analysis: a, fmt: f, locale, income }: StoryContext, verdict: Verdict | null): string {
  const { stats } = a;
  const lines = [`Mi ${monthName(a.month, locale)}: ${f.formatRounded(stats.total)} en ${stats.count} movimientos.`];
  if (income && income.total > 0) {
    const kept = income.total - stats.total;
    lines.push(`💰 Entraron ${f.formatRounded(income.total)}: ${kept >= 0 ? `me quedaron ${f.formatRounded(kept)}` : `me pasé por ${f.formatRounded(-kept)}`}.`);
  }
  if (verdict) lines.push(`${verdict.emoji} ${verdict.label}. ${verdict.reason}`);
  const first = a.folders[0];
  if (first?.category) lines.push(`Carpeta estrella: ${first.category.emoji} ${first.category.name} (${pct(first.share)}).`);
  if (stats.noSpendDays >= 3) lines.push(`🌿 ${stats.noSpendDays} días sin gastar.`);
  return lines.join('\n');
}

