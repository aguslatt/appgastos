import { formatMonthLabel } from './dates';
import type { Capacity, Goal, GoalLevel, GoalStatus } from './goals';
import type { MoneyFormatter } from './money';

export type GoalTone = GoalLevel | 'late';

export interface GoalMessage {
  tone: GoalTone;
  /** Short status for a chip. */
  label: string;
  headline: string;
  detail: string;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** What to tell the user about a goal, given where they stand. Third-person-free, so it reads the same in any Spanish. */
export function describeGoal(goal: Goal, status: GoalStatus, capacity: Capacity, committedElsewhere: number, fmt: MoneyFormatter, locale: string): GoalMessage {
  const when = formatMonthLabel(goal.deadline, locale);
  const perMonth = fmt.formatRounded(status.requiredPerMonth);
  const behind = status.behindBy > 0 && status.level !== 'done' ? ` Va atrasada por ${fmt.formatRounded(status.behindBy)} respecto del plan.` : '';

  if (status.level === 'done') {
    return { tone: 'done', label: 'Cumplida', headline: '¡Meta cumplida! 🎉', detail: `Ya están los ${fmt.formatRounded(goal.target)}.` };
  }
  if (status.monthsLeft === 0) {
    return {
      tone: 'late',
      label: 'Vencida',
      headline: 'La fecha ya llegó',
      detail: `Faltan ${fmt.formatRounded(status.remaining)}. Elige una fecha nueva para recalcular.`,
    };
  }
  const room = capacity.free === null ? null : Math.max(0, capacity.free - committedElsewhere);
  switch (status.level) {
    case 'ok':
      return {
        tone: 'ok',
        label: 'Vas bien',
        headline: `Con ${perMonth} por mes llegas a ${when}.`,
        detail: `Hoy te sobran ≈ ${fmt.formatRounded(room ?? 0)} por mes, así que entra con aire.${behind}`,
      };
    case 'tight':
      return {
        tone: 'tight',
        label: 'Justo',
        headline: `Con ${perMonth} por mes llegas a ${when}, pero justo.`,
        detail: `Es casi todo lo que te sobra (${fmt.formatRounded(room ?? 0)}). Un gasto extra la atrasa.${behind}`,
      };
    case 'off':
      return {
        tone: 'off',
        label: 'No alcanza',
        headline: `Necesitas ${perMonth} por mes y hoy te sobran ${fmt.formatRounded(room ?? 0)}.`,
        detail: `Faltan ${fmt.formatRounded(status.shortfall)} por mes: recortando algo o corriendo la fecha se logra.${behind}`,
      };
    default:
      return {
        tone: 'unknown',
        label: capacity.avgSpend === null ? 'Sin datos' : 'Falta tu ingreso',
        headline: `Necesitas guardar ${perMonth} por mes hasta ${when}.`,
        detail:
          capacity.avgSpend !== null && capacity.avgSpend > 0
            ? `Es el ${pct(status.requiredPerMonth / capacity.avgSpend)} de lo que gastas por mes. Con tu ingreso en Ajustes te digo si llegas.${behind}`
            : `Con tu ingreso en Ajustes y unos meses de gastos te digo si llegas.${behind}`,
      };
  }
}
