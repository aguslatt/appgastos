import { addMonths, dateInMonth, isValidMonthKey, monthKeyOf } from './dates';
import type { Cents, DateStr, MonthKey, Recurring } from './types';

/** What a rule needs to come due month after month: shared by fixed expenses and fixed incomes. */
export interface Schedule {
  id: string;
  amount: Cents;
  note: string;
  /** Day of the month, 1-31 (clamped to the month's length). */
  day: number;
  /** First month the rule applies to. */
  startMonth: MonthKey;
  /** Last month already handled (or deliberately skipped). */
  lastGenerated: MonthKey | null;
  active: boolean;
}

export interface RecurringDraft {
  ruleId: string;
  date: DateStr;
  amount: Cents;
  categoryId: string;
  note: string;
}

const MAX_CATCH_UP_MONTHS = 36;

/**
 * Works out which rules have come due as of `today` and haven't been handled yet. Each rule
 * remembers the last month it handled, so deleting what was generated never brings it back,
 * and running this twice is a no-op. Rules that change come back as new objects; the rest are
 * returned as they were.
 */
export function planSchedule<R extends Schedule>(rules: readonly R[], today: DateStr): { due: Array<{ rule: R; date: DateStr }>; rules: R[] } {
  const currentMonth = monthKeyOf(today);
  const due: Array<{ rule: R; date: DateStr }> = [];

  const next = rules.map((rule) => {
    if (!rule.active) return rule;
    // Already handled through this month (or, for odd data, beyond it): comparing month keys as text
    // would misorder a five-digit year, so don't even try to step forward from it.
    if (rule.lastGenerated !== null && rule.lastGenerated >= currentMonth) return rule;
    let month = rule.lastGenerated ? addMonths(rule.lastGenerated, 1) : rule.startMonth;
    if (month < rule.startMonth) month = rule.startMonth;
    let last = rule.lastGenerated;
    let guard = 0;
    while (month <= currentMonth && guard++ < MAX_CATCH_UP_MONTHS) {
      const date = dateInMonth(month, rule.day);
      if (date > today) break;
      due.push({ rule, date });
      last = month;
      month = addMonths(month, 1);
    }
    return last === rule.lastGenerated ? rule : { ...rule, lastGenerated: last };
  });

  return { due, rules: next };
}

/** The fixed expenses that came due, as drafts ready to become expenses. */
export function planRecurring(rules: readonly Recurring[], today: DateStr): { drafts: RecurringDraft[]; rules: Recurring[] } {
  const plan = planSchedule(rules, today);
  return {
    drafts: plan.due.map(({ rule, date }) => ({ ruleId: rule.id, date, amount: rule.amount, categoryId: rule.categoryId, note: rule.note })),
    rules: plan.rules,
  };
}

/** What the rules still have to bring this month (not yet generated, due after today). */
export function upcomingTotal(rules: readonly Schedule[], today: DateStr): Cents {
  const month = monthKeyOf(today);
  let total = 0;
  for (const rule of rules) {
    if (!rule.active || rule.startMonth > month) continue;
    if (rule.lastGenerated !== null && rule.lastGenerated >= month) continue;
    if (dateInMonth(month, rule.day) > today) total += rule.amount;
  }
  return total;
}

/** Fixed expenses still to come this month (not yet generated, due after today). */
export const upcomingRecurringTotal = (rules: readonly Recurring[], today: DateStr): Cents => upcomingTotal(rules, today);

/** The first month a rule created today should apply to: this month if its day hasn't passed, else next month. */
export function firstMonthFor(day: number, today: DateStr): string {
  const month = monthKeyOf(today);
  return dateInMonth(month, day) >= today ? month : addMonths(month, 1);
}

export interface UpcomingPayment<R extends Schedule = Recurring> {
  rule: R;
  date: DateStr;
}

/** The next date each active rule will be recorded, soonest first. */
export function nextDates<R extends Schedule>(rules: readonly R[], today: DateStr): Array<UpcomingPayment<R>> {
  const out: Array<UpcomingPayment<R>> = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    let month = monthKeyOf(today);
    if (month < rule.startMonth) month = rule.startMonth;
    if (rule.lastGenerated !== null && rule.lastGenerated >= month) month = addMonths(rule.lastGenerated, 1);
    // Past the last month the calendar can name (9999-12) there is no next date, and no reason to crash a screen over it.
    if (!isValidMonthKey(month)) continue;
    let date = dateInMonth(month, rule.day);
    if (date < today) {
      const later = addMonths(month, 1);
      if (!isValidMonthKey(later)) continue;
      date = dateInMonth(later, rule.day);
    }
    out.push({ rule, date });
  }
  return out.sort((a, b) => (a.date === b.date ? a.rule.note.localeCompare(b.rule.note) : a.date < b.date ? -1 : 1));
}

/** The next date each active fixed expense will be recorded, soonest first. */
export const nextPayments = (rules: readonly Recurring[], today: DateStr): UpcomingPayment[] => nextDates(rules, today);
