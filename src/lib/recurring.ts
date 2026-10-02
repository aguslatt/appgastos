import { addMonths, dateInMonth, monthKeyOf } from './dates';
import type { Cents, DateStr, Recurring } from './types';

export interface RecurringDraft {
  ruleId: string;
  date: DateStr;
  amount: Cents;
  categoryId: string;
  note: string;
}

const MAX_CATCH_UP_MONTHS = 36;

/**
 * Works out which fixed expenses have come due as of `today` and haven't been
 * generated yet. Each rule remembers the last month it handled, so deleting a
 * generated expense never brings it back, and running this twice is a no-op.
 */
export function planRecurring(rules: readonly Recurring[], today: DateStr): { drafts: RecurringDraft[]; rules: Recurring[] } {
  const currentMonth = monthKeyOf(today);
  const drafts: RecurringDraft[] = [];

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
      drafts.push({ ruleId: rule.id, date, amount: rule.amount, categoryId: rule.categoryId, note: rule.note });
      last = month;
      month = addMonths(month, 1);
    }
    return last === rule.lastGenerated ? rule : { ...rule, lastGenerated: last };
  });

  return { drafts, rules: next };
}

/** Fixed expenses still to come this month (not yet generated, due after today). */
export function upcomingRecurringTotal(rules: readonly Recurring[], today: DateStr): Cents {
  const month = monthKeyOf(today);
  let total = 0;
  for (const rule of rules) {
    if (!rule.active || rule.startMonth > month) continue;
    if (rule.lastGenerated !== null && rule.lastGenerated >= month) continue;
    if (dateInMonth(month, rule.day) > today) total += rule.amount;
  }
  return total;
}

/** The first month a rule created today should apply to: this month if its day hasn't passed, else next month. */
export function firstMonthFor(day: number, today: DateStr): string {
  const month = monthKeyOf(today);
  return dateInMonth(month, day) >= today ? month : addMonths(month, 1);
}

export interface UpcomingPayment {
  rule: Recurring;
  date: DateStr;
}

/** The next date each active fixed expense will be recorded, soonest first. */
export function nextPayments(rules: readonly Recurring[], today: DateStr): UpcomingPayment[] {
  const out: UpcomingPayment[] = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    let month = monthKeyOf(today);
    if (month < rule.startMonth) month = rule.startMonth;
    if (rule.lastGenerated !== null && rule.lastGenerated >= month) month = addMonths(rule.lastGenerated, 1);
    let date = dateInMonth(month, rule.day);
    if (date < today) date = dateInMonth(addMonths(month, 1), rule.day);
    out.push({ rule, date });
  }
  return out.sort((a, b) => (a.date === b.date ? a.rule.note.localeCompare(b.rule.note) : a.date < b.date ? -1 : 1));
}
