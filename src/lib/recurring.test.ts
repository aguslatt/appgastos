import { describe, expect, it } from 'vitest';
import { addDays, addMonths, isValidDateStr, makeMonthKey, monthKeyOf } from './dates';
import { firstMonthFor, nextPayments, planRecurring, upcomingRecurringTotal, type RecurringDraft } from './recurring';
import type { Recurring } from './types';

const rule = (overrides: Partial<Recurring> = {}): Recurring => ({
  id: 'r1',
  amount: 10_000,
  categoryId: 'servicios',
  note: 'Luz',
  day: 10,
  startMonth: '2026-01',
  lastGenerated: null,
  active: true,
  ...overrides,
});

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const monthLength = (year: number, month: number): number => (month === 2 ? (isLeapYear(year) ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31);

/** The date a rule with this day is due in a month, clamped to the month's length (written without Date). */
const due = (month: string, day: number): string =>
  `${month}-${String(Math.min(day, monthLength(Number(month.slice(0, 4)), Number(month.slice(5, 7))))).padStart(2, '0')}`;
const dates = (drafts: readonly RecurringDraft[]): string[] => drafts.map((d) => d.date);

/** Months from `from` to `to` inclusive, counted without any date library. */
function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let key = from;
  while (key <= to) {
    out.push(key);
    key = addMonths(key, 1);
  }
  return out;
}

/** Runs the planner once per calendar day, the way the app does when the date changes. */
function simulate(rules: Recurring[], from: string, days: number): { rules: Recurring[]; drafts: Array<RecurringDraft & { on: string }> } {
  let current = rules;
  const drafts: Array<RecurringDraft & { on: string }> = [];
  for (let i = 0; i <= days; i++) {
    const today = addDays(from, i);
    const plan = planRecurring(current, today);
    for (const d of plan.drafts) drafts.push({ ...d, on: today });
    current = plan.rules;
  }
  return { rules: current, drafts };
}

// ---- planRecurring: the basics ---------------------------------------------

describe('planRecurring', () => {
  describe('when a payment comes due', () => {
    it('does nothing before the rule\'s day', () => {
      const r = rule({ day: 10, startMonth: '2026-01', lastGenerated: '2025-12' });
      const plan = planRecurring([r], '2026-01-09');
      expect(plan.drafts).toEqual([]);
      expect(plan.rules).toEqual([r]);
      expect(plan.rules[0]).toBe(r);
    });

    it('generates it on the day itself, dated that day', () => {
      const plan = planRecurring([rule({ startMonth: '2026-01', lastGenerated: '2025-12' })], '2026-01-10');
      expect(dates(plan.drafts)).toEqual(['2026-01-10']);
      expect(plan.rules[0]!.lastGenerated).toBe('2026-01');
    });

    it('dates a late draft on the due day, not on today', () => {
      const plan = planRecurring([rule({ startMonth: '2026-01', lastGenerated: '2025-12' })], '2026-01-25');
      expect(dates(plan.drafts)).toEqual(['2026-01-10']);
    });

    it('copies the rule\'s data into the draft and nothing else', () => {
      const r = rule({ id: 'rent', amount: 450_000_00, categoryId: 'hogar', note: 'Alquiler', day: 5 });
      const [draft] = planRecurring([r], '2026-01-06').drafts;
      expect(draft).toStrictEqual({ ruleId: 'rent', date: '2026-01-05', amount: 450_000_00, categoryId: 'hogar', note: 'Alquiler' });
    });

    it('moves lastGenerated to the last month it handled and leaves the other fields alone', () => {
      const r = rule({ startMonth: '2026-01', lastGenerated: '2025-12' });
      const [next] = planRecurring([r], '2026-01-10').rules;
      expect(next).toStrictEqual({ ...r, lastGenerated: '2026-01' });
    });

    it('starts at startMonth when the rule has never run', () => {
      const plan = planRecurring([rule({ startMonth: '2026-03', lastGenerated: null })], '2026-03-15');
      expect(dates(plan.drafts)).toEqual(['2026-03-10']);
      expect(plan.rules[0]!.lastGenerated).toBe('2026-03');
    });

    it('generates one expense per month when run once a day through a whole year', () => {
      const { drafts, rules } = simulate([rule({ startMonth: '2026-01' })], '2026-01-01', 364);
      expect(dates(drafts)).toEqual(Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-10`));
      expect(drafts.every((d) => d.on === d.date)).toBe(true);
      expect(rules[0]!.lastGenerated).toBe('2026-12');
    });
  });

  describe('day 31 and short months', () => {
    it('gives every month of 2026 its own last day (the 31st never "sticks" at 28)', () => {
      const { drafts } = simulate([rule({ day: 31, startMonth: '2026-01' })], '2026-01-01', 364);
      expect(dates(drafts)).toEqual([
        '2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30',
        '2026-07-31', '2026-08-31', '2026-09-30', '2026-10-31', '2026-11-30', '2026-12-31',
      ]);
    });

    it('uses February 29 in a leap year and the 28th otherwise', () => {
      const leap = simulate([rule({ day: 31, startMonth: '2028-01' })], '2028-01-01', 365);
      expect(dates(leap.drafts)[1]).toBe('2028-02-29');
      const common = simulate([rule({ day: 31, startMonth: '2027-01' })], '2027-01-01', 364);
      expect(dates(common.drafts)[1]).toBe('2027-02-28');
    });

    it.each([
      [29, 2026, '2026-02-28'],
      [29, 2028, '2028-02-29'],
      [30, 2026, '2026-02-28'],
      [30, 2028, '2028-02-29'],
      [31, 2026, '2026-02-28'],
      [31, 2100, '2100-02-28'],
      [31, 2000, '2000-02-29'],
    ])('day %i in February %i is recorded on %s', (day, year, expected) => {
      const plan = planRecurring([rule({ day, startMonth: `${year}-02` })], `${year}-03-01`);
      expect(dates(plan.drafts)).toEqual([expected]);
    });

    it('does not generate a clamped payment a day early', () => {
      const r = rule({ day: 31, startMonth: '2026-02', lastGenerated: null });
      expect(planRecurring([r], '2026-02-27').drafts).toEqual([]);
      expect(dates(planRecurring([r], '2026-02-28').drafts)).toEqual(['2026-02-28']);
    });

    it('is recorded in a 30-day month on the 30th, not the 31st', () => {
      const r = rule({ day: 31, startMonth: '2026-04', lastGenerated: null });
      expect(planRecurring([r], '2026-04-29').drafts).toEqual([]);
      expect(dates(planRecurring([r], '2026-04-30').drafts)).toEqual(['2026-04-30']);
    });

    it('agrees with an independent month-length table for every day from 1 to 31 in every month of 2026 and 2028', () => {
      const wrong: string[] = [];
      for (const year of [2026, 2028]) {
        for (let month = 1; month <= 12; month++) {
          for (let day = 1; day <= 31; day++) {
            const key = makeMonthKey(year, month);
            const plan = planRecurring([rule({ day, startMonth: key, lastGenerated: null })], `${key}-31`);
            if (dates(plan.drafts).join() !== due(key, day)) wrong.push(`${key} day ${day}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });
  });

  describe('year boundaries', () => {
    it('continues from December into January', () => {
      const plan = planRecurring([rule({ day: 20, startMonth: '2026-11', lastGenerated: '2026-12' })], '2027-01-25');
      expect(dates(plan.drafts)).toEqual(['2027-01-20']);
      expect(plan.rules[0]!.lastGenerated).toBe('2027-01');
    });

    it('catches up across the year end without skipping or repeating a month', () => {
      const plan = planRecurring([rule({ day: 20, startMonth: '2026-11' })], '2027-02-15');
      expect(dates(plan.drafts)).toEqual(['2026-11-20', '2026-12-20', '2027-01-20']);
      expect(plan.rules[0]!.lastGenerated).toBe('2027-01');
    });

    it('records December 31 on the last day of the year', () => {
      const r = rule({ day: 31, startMonth: '2026-12', lastGenerated: null });
      expect(planRecurring([r], '2026-12-30').drafts).toEqual([]);
      expect(dates(planRecurring([r], '2026-12-31').drafts)).toEqual(['2026-12-31']);
    });
  });

  describe('startMonth and lastGenerated', () => {
    it('waits for a startMonth in the future', () => {
      const r = rule({ startMonth: '2026-12', lastGenerated: null });
      const plan = planRecurring([r], '2026-10-31');
      expect(plan.drafts).toEqual([]);
      expect(plan.rules[0]).toBe(r);
    });

    it('never goes back before startMonth, even if lastGenerated is older', () => {
      const plan = planRecurring([rule({ startMonth: '2026-03', lastGenerated: '2025-01', day: 1 })], '2026-04-15');
      expect(dates(plan.drafts)).toEqual(['2026-03-01', '2026-04-01']);
    });

    it('does nothing when the current month was already handled (or skipped on purpose)', () => {
      const r = rule({ lastGenerated: '2026-10', day: 1, startMonth: '2026-01' });
      const plan = planRecurring([r], '2026-10-31');
      expect(plan.drafts).toEqual([]);
      expect(plan.rules[0]).toBe(r);
    });

    it('does nothing when lastGenerated is already in the future', () => {
      const r = rule({ lastGenerated: '2027-03', day: 1, startMonth: '2026-01' });
      const plan = planRecurring([r], '2026-10-31');
      expect(plan.drafts).toEqual([]);
      expect(plan.rules[0]).toBe(r);
    });

    it('a rule whose startMonth is this month but whose day already passed is recorded late, in the past (that is what firstMonthFor avoids)', () => {
      const plan = planRecurring([rule({ day: 1, startMonth: '2026-10', lastGenerated: null })], '2026-10-15');
      expect(dates(plan.drafts)).toEqual(['2026-10-01']);
    });

    it('does not go back in time when the clock moves backwards', () => {
      const first = planRecurring([rule({ day: 5, startMonth: '2026-01' })], '2026-10-20');
      expect(first.rules[0]!.lastGenerated).toBe('2026-10');
      const back = planRecurring(first.rules, '2026-08-15');
      expect(back.drafts).toEqual([]);
      expect(back.rules[0]).toBe(first.rules[0]);
    });
  });

  describe('inactive rules', () => {
    it('are left exactly as they are', () => {
      const r = rule({ active: false, startMonth: '2026-01', lastGenerated: null });
      const plan = planRecurring([r], '2026-10-31');
      expect(plan.drafts).toEqual([]);
      expect(plan.rules[0]).toBe(r);
      expect(plan.rules[0]!.lastGenerated).toBeNull();
    });

    it('do not hold up the active ones', () => {
      const plan = planRecurring(
        [rule({ id: 'off', active: false }), rule({ id: 'on', startMonth: '2026-10', lastGenerated: null, day: 1 })],
        '2026-10-05',
      );
      expect(plan.drafts.map((d) => d.ruleId)).toEqual(['on']);
    });
  });

  describe('several rules', () => {
    it('keeps rule order, then month order, and updates each rule on its own', () => {
      const a = rule({ id: 'a', day: 5, startMonth: '2026-08', amount: 100 });
      const b = rule({ id: 'b', day: 20, startMonth: '2026-09', amount: 200 });
      const c = rule({ id: 'c', day: 1, startMonth: '2027-01', amount: 300 });
      const plan = planRecurring([a, b, c], '2026-10-10');
      expect(plan.drafts.map((d) => `${d.ruleId}:${d.date}`)).toEqual([
        'a:2026-08-05', 'a:2026-09-05', 'a:2026-10-05',
        'b:2026-09-20',
      ]);
      expect(plan.rules.map((r) => r.lastGenerated)).toEqual(['2026-10', '2026-09', null]);
      expect(plan.rules[2]).toBe(c);
    });

    it('returns an empty plan for no rules', () => {
      expect(planRecurring([], '2026-10-10')).toEqual({ drafts: [], rules: [] });
    });
  });

  describe('catching up after a long absence', () => {
    it('generates every missed month, in order, in one run', () => {
      const plan = planRecurring([rule({ day: 15, startMonth: '2025-10' })], '2026-10-20');
      expect(dates(plan.drafts)).toEqual(monthsBetween('2025-10', '2026-10').map((m) => `${m}-15`));
      expect(plan.rules[0]!.lastGenerated).toBe('2026-10');
    });

    it('stops at today\'s month and does not generate one that has not come yet', () => {
      const plan = planRecurring([rule({ day: 25, startMonth: '2026-05' })], '2026-10-10');
      expect(dates(plan.drafts)).toEqual(['2026-05-25', '2026-06-25', '2026-07-25', '2026-08-25', '2026-09-25']);
      expect(plan.rules[0]!.lastGenerated).toBe('2026-09');
    });

    it('handles exactly 36 months due in a single run', () => {
      // 2023-11 .. 2026-10 is 36 months.
      const plan = planRecurring([rule({ day: 1, startMonth: '2023-11' })], '2026-10-02');
      expect(plan.drafts).toHaveLength(36);
      expect(plan.rules[0]!.lastGenerated).toBe('2026-10');
    });

    it('caps a single run at 36 months, then finishes the job on the next run (documents the current cap)', () => {
      // 2023-06 .. 2026-10 is 41 months.
      const first = planRecurring([rule({ day: 1, startMonth: '2023-06' })], '2026-10-02');
      expect(first.drafts).toHaveLength(36);
      expect(first.rules[0]!.lastGenerated).toBe('2026-05');
      const second = planRecurring(first.rules, '2026-10-02');
      expect(second.drafts).toHaveLength(5);
      expect(second.rules[0]!.lastGenerated).toBe('2026-10');
      expect(planRecurring(second.rules, '2026-10-02').drafts).toEqual([]);
    });

    it('whatever the cap, repeated runs produce every month exactly once, with no gaps or repeats', () => {
      let rules = [rule({ day: 12, startMonth: '1999-03' })];
      const all: string[] = [];
      for (let run = 0; run < 30; run++) {
        const plan = planRecurring(rules, '2026-10-20');
        if (plan.drafts.length === 0) break;
        all.push(...dates(plan.drafts));
        rules = plan.rules;
      }
      expect(all).toEqual(monthsBetween('1999-03', '2026-10').map((m) => `${m}-12`));
    });

    it('applies the cap to each rule separately', () => {
      const plan = planRecurring([rule({ id: 'a', startMonth: '2010-01', day: 1 }), rule({ id: 'b', startMonth: '2026-09', day: 1 })], '2026-10-02');
      expect(plan.drafts.filter((d) => d.ruleId === 'b').map((d) => d.date)).toEqual(['2026-09-01', '2026-10-01']);
      expect(plan.drafts.filter((d) => d.ruleId === 'a').length).toBeGreaterThan(12);
    });
  });

  describe('purity and idempotency', () => {
    it('never mutates its input (which may be frozen) and returns new containers', () => {
      const rules = deepFreeze([rule({ id: 'a', startMonth: '2026-05' }), rule({ id: 'b', active: false })]);
      const copy = JSON.parse(JSON.stringify(rules)) as Recurring[];
      const plan = planRecurring(rules, '2026-10-20');
      expect(rules).toEqual(copy);
      expect(plan.rules).not.toBe(rules);
      expect(plan.rules[0]).not.toBe(rules[0]);
      expect(plan.rules[1]).toBe(rules[1]);
    });

    it('running it twice for the same day is a no-op', () => {
      const first = planRecurring([rule({ startMonth: '2026-05', day: 31 }), rule({ id: 'x', startMonth: '2026-09', day: 3 })], '2026-10-20');
      const second = planRecurring(first.rules, '2026-10-20');
      expect(second.drafts).toEqual([]);
      second.rules.forEach((r, i) => expect(r).toBe(first.rules[i]));
    });

    it('is idempotent for random rules and dates, and never produces a duplicate month or a future date', () => {
      const rng = mulberry32(17);
      const bad: string[] = [];
      for (let i = 0; i < 400; i++) {
        const today = addDays('2024-01-01', Math.floor(rng() * 1500));
        const month = monthKeyOf(today);
        const startMonth = addMonths(month, Math.floor(rng() * 40) - 30);
        const lastGenerated = rng() < 0.4 ? null : addMonths(startMonth, Math.floor(rng() * 30) - 5);
        const r = rule({ day: 1 + Math.floor(rng() * 31), startMonth, lastGenerated, active: rng() < 0.9 });
        const once = planRecurring([r], today);
        const twice = planRecurring(once.rules, today);
        const months = once.drafts.map((d) => monthKeyOf(d.date));
        const label = JSON.stringify({ today, r });
        if (twice.drafts.length !== 0) bad.push(`second run produced drafts ${label}`);
        if (new Set(months).size !== months.length) bad.push(`duplicate month ${label}`);
        if (once.drafts.some((d) => d.date > today || !isValidDateStr(d.date))) bad.push(`bad date ${label}`);
        if (once.drafts.some((d) => monthKeyOf(d.date) < r.startMonth)) bad.push(`before startMonth ${label}`);
      }
      expect(bad).toEqual([]);
    });
  });
});

// ---- upcomingRecurringTotal ------------------------------------------------

describe('upcomingRecurringTotal', () => {
  const TODAY = '2026-10-02';

  it('is zero without rules', () => {
    expect(upcomingRecurringTotal([], TODAY)).toBe(0);
  });

  it('adds up what is still to come this month', () => {
    const rules = [
      rule({ id: 'a', day: 15, amount: 100, startMonth: '2026-01', lastGenerated: '2026-09' }),
      rule({ id: 'b', day: 28, amount: 20, startMonth: '2026-10', lastGenerated: null }),
      rule({ id: 'c', day: 3, amount: 3, startMonth: '2026-01', lastGenerated: '2026-09' }),
    ];
    expect(upcomingRecurringTotal(rules, TODAY)).toBe(123);
  });

  it('does not count a payment due today or earlier (it is generated, not upcoming)', () => {
    expect(upcomingRecurringTotal([rule({ day: 2, lastGenerated: '2026-09', startMonth: '2026-01' })], TODAY)).toBe(0);
    expect(upcomingRecurringTotal([rule({ day: 1, lastGenerated: '2026-09', startMonth: '2026-01' })], TODAY)).toBe(0);
    expect(upcomingRecurringTotal([rule({ day: 3, lastGenerated: '2026-09', startMonth: '2026-01' })], TODAY)).toBe(10_000);
  });

  it('skips inactive rules', () => {
    expect(upcomingRecurringTotal([rule({ day: 20, active: false, lastGenerated: '2026-09' })], TODAY)).toBe(0);
  });

  it('skips rules that only start in a later month', () => {
    expect(upcomingRecurringTotal([rule({ day: 20, startMonth: '2026-11', lastGenerated: null })], TODAY)).toBe(0);
    expect(upcomingRecurringTotal([rule({ day: 20, startMonth: '2026-10', lastGenerated: null })], TODAY)).toBe(10_000);
  });

  it('skips a month that was already handled or deliberately skipped', () => {
    expect(upcomingRecurringTotal([rule({ day: 20, lastGenerated: '2026-10' })], TODAY)).toBe(0);
    expect(upcomingRecurringTotal([rule({ day: 20, lastGenerated: '2026-11' })], TODAY)).toBe(0);
    expect(upcomingRecurringTotal([rule({ day: 20, lastGenerated: '2026-09' })], TODAY)).toBe(10_000);
  });

  it('compares the clamped due date, so the 31st counts on the 28th of February only until that day', () => {
    const r = rule({ day: 31, startMonth: '2026-01', lastGenerated: '2026-01' });
    expect(upcomingRecurringTotal([r], '2026-02-27')).toBe(10_000);
    expect(upcomingRecurringTotal([r], '2026-02-28')).toBe(0);
    expect(upcomingRecurringTotal([r], '2026-02-01')).toBe(10_000);
    const leap = rule({ day: 31, startMonth: '2028-01', lastGenerated: '2028-01' });
    expect(upcomingRecurringTotal([leap], '2028-02-28')).toBe(10_000);
    expect(upcomingRecurringTotal([leap], '2028-02-29')).toBe(0);
  });

  it('counts a payment due on the last day of the year until that day', () => {
    const r = rule({ day: 31, startMonth: '2026-01', lastGenerated: '2026-11' });
    expect(upcomingRecurringTotal([r], '2026-12-30')).toBe(10_000);
    expect(upcomingRecurringTotal([r], '2026-12-31')).toBe(0);
  });

  it('does not mutate its input', () => {
    const rules = deepFreeze([rule({ day: 20, lastGenerated: '2026-09' })]);
    expect(() => upcomingRecurringTotal(rules, TODAY)).not.toThrow();
  });

  it('is complementary to planRecurring: each due amount is either generated now or counted as upcoming, never both and never neither', () => {
    const wrong: string[] = [];
    for (const month of ['2026-02', '2026-04', '2026-10', '2026-12', '2028-02']) {
      const previous = addMonths(month, -1);
      const length = monthLength(Number(month.slice(0, 4)), Number(month.slice(5, 7)));
      for (let day = 1; day <= 31; day++) {
        for (const lastGenerated of [previous, null] as const) {
          for (let todayDay = 1; todayDay <= length; todayDay++) {
            const today = `${month}-${String(todayDay).padStart(2, '0')}`;
            const r = rule({ day, startMonth: lastGenerated === null ? month : '2026-01', lastGenerated });
            const generatedNow = planRecurring([r], today).drafts.some((d) => monthKeyOf(d.date) === month);
            const upcoming = upcomingRecurringTotal([r], today) > 0;
            if (generatedNow === upcoming) wrong.push(`${today} day ${day} last ${lastGenerated}: generated=${generatedNow} upcoming=${upcoming}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('counts nothing once the month was generated', () => {
    const wrong: string[] = [];
    for (let day = 1; day <= 31; day++) {
      for (let todayDay = 1; todayDay <= 31; todayDay++) {
        const today = `2026-10-${String(todayDay).padStart(2, '0')}`;
        const generated = planRecurring([rule({ day, startMonth: '2026-10', lastGenerated: null })], '2026-10-31').rules;
        if (upcomingRecurringTotal(generated, today) !== 0) wrong.push(`${today} day ${day}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

// ---- firstMonthFor ----------------------------------------------------------

describe('firstMonthFor', () => {
  it.each([
    [10, '2026-10-15', '2026-11', 'the day already passed'],
    [15, '2026-10-15', '2026-10', 'the day is today'],
    [20, '2026-10-15', '2026-10', 'the day is still to come'],
    [1, '2026-10-01', '2026-10', 'the 1st on the 1st'],
    [1, '2026-10-02', '2026-11', 'the 1st on the 2nd'],
    [31, '2026-10-31', '2026-10', 'the last day of a long month'],
    [30, '2026-10-31', '2026-11', 'the 30th on the 31st'],
    [5, '2026-12-20', '2027-01', 'December rolls into January'],
    [31, '2026-12-31', '2026-12', 'New Year\'s Eve'],
    [1, '2026-12-31', '2027-01', 'January 1st on New Year\'s Eve'],
    [31, '2026-04-30', '2026-04', 'the 31st in a 30-day month, on its last day'],
    [31, '2026-04-29', '2026-04', 'the 31st in a 30-day month, a day early'],
    [31, '2026-02-28', '2026-02', 'the 31st on February 28 (clamped to the 28th)'],
    [29, '2026-02-28', '2026-02', 'the 29th on February 28 (clamped to the 28th)'],
    [29, '2024-02-28', '2024-02', 'the 29th before a leap day'],
    [28, '2024-02-29', '2024-03', 'the 28th on a leap day'],
    [31, '2024-02-29', '2024-02', 'the 31st on a leap day'],
    [30, '2026-01-31', '2026-02', 'the 30th on January 31'],
  ])('day %i created on %s starts in %s (%s)', (day, today, expected) => {
    expect(firstMonthFor(day, today)).toBe(expected);
  });

  it('never starts in the past, is always this month or next, and picks the earliest such month', () => {
    const wrong: string[] = [];
    for (let offset = 0; offset < 366; offset++) {
      for (const base of ['2026-01-01', '2028-01-01']) {
        const today = addDays(base, offset);
        const current = monthKeyOf(today);
        for (let day = 1; day <= 31; day++) {
          const month = firstMonthFor(day, today);
          const fits = due(month, day) >= today;
          const earliest = month === current || due(current, day) < today;
          if (!fits || !earliest || (month !== current && month !== addMonths(current, 1))) wrong.push(`${today} day ${day} -> ${month}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('keeps a brand-new rule from recording anything in the past', () => {
    const wrong: string[] = [];
    for (let offset = 0; offset < 366; offset += 3) {
      const today = addDays('2026-01-01', offset);
      for (let day = 1; day <= 31; day++) {
        const r = rule({ day, startMonth: firstMonthFor(day, today), lastGenerated: null });
        const { drafts } = planRecurring([r], today);
        if (drafts.some((d) => d.date !== today)) wrong.push(`${today} day ${day}: ${dates(drafts).join()}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('a rule created mid-month with a day that has passed first fires next month', () => {
    const today = '2026-10-15';
    const r = rule({ day: 10, startMonth: firstMonthFor(10, today) });
    expect(planRecurring([r], today).drafts).toEqual([]);
    expect(planRecurring([r], '2026-10-31').drafts).toEqual([]);
    expect(dates(planRecurring([r], '2026-11-10').drafts)).toEqual(['2026-11-10']);
  });

  it('a rule created mid-month with a day still ahead fires this month', () => {
    const today = '2026-10-15';
    const r = rule({ day: 20, startMonth: firstMonthFor(20, today) });
    expect(planRecurring([r], '2026-10-19').drafts).toEqual([]);
    expect(dates(planRecurring([r], '2026-10-20').drafts)).toEqual(['2026-10-20']);
  });

  it('a rule created on its own day is recorded right away, dated today', () => {
    const today = '2026-10-15';
    const r = rule({ day: 15, startMonth: firstMonthFor(15, today) });
    expect(dates(planRecurring([r], today).drafts)).toEqual([today]);
  });
});

// ---- nextPayments -----------------------------------------------------------

describe('nextPayments', () => {
  const TODAY = '2026-10-02';
  const pairs = (rules: Recurring[], today = TODAY): string[] => nextPayments(rules, today).map((p) => `${p.rule.id}:${p.date}`);

  it('is empty without rules, or when every rule is inactive', () => {
    expect(nextPayments([], TODAY)).toEqual([]);
    expect(nextPayments([rule({ active: false })], TODAY)).toEqual([]);
  });

  it('gives this month\'s date while it is still ahead', () => {
    expect(pairs([rule({ id: 'a', day: 15, lastGenerated: '2026-09' })])).toEqual(['a:2026-10-15']);
  });

  it('gives today when the payment is due today and has not been recorded yet', () => {
    expect(pairs([rule({ id: 'a', day: 2, lastGenerated: '2026-09' })])).toEqual(['a:2026-10-02']);
  });

  it('moves on to next month once this month was recorded', () => {
    expect(pairs([rule({ id: 'a', day: 2, lastGenerated: '2026-10' })])).toEqual(['a:2026-11-02']);
    expect(pairs([rule({ id: 'a', day: 25, lastGenerated: '2026-10' })])).toEqual(['a:2026-11-25']);
  });

  it('moves on to next month when this month\'s date has already passed', () => {
    expect(pairs([rule({ id: 'a', day: 1, lastGenerated: '2026-09' })])).toEqual(['a:2026-11-01']);
  });

  it('waits for a startMonth in the future', () => {
    expect(pairs([rule({ id: 'a', day: 7, startMonth: '2027-01', lastGenerated: null })])).toEqual(['a:2027-01-07']);
    expect(pairs([rule({ id: 'a', day: 7, startMonth: '2026-10', lastGenerated: null })])).toEqual(['a:2026-10-07']);
  });

  it('follows lastGenerated when it is ahead of the calendar', () => {
    expect(pairs([rule({ id: 'a', day: 7, lastGenerated: '2027-03' })])).toEqual(['a:2027-04-07']);
  });

  it('clamps day 31 to the length of the month it lands in', () => {
    const r = rule({ id: 'a', day: 31, startMonth: '2026-01', lastGenerated: '2026-01' });
    expect(pairs([r], '2026-02-10')).toEqual(['a:2026-02-28']);
    expect(pairs([{ ...r, lastGenerated: '2026-02' }], '2026-02-28')).toEqual(['a:2026-03-31']);
    expect(pairs([{ ...r, lastGenerated: '2026-03' }], '2026-04-01')).toEqual(['a:2026-04-30']);
    expect(pairs([{ ...r, startMonth: '2028-01', lastGenerated: '2028-01' }], '2028-02-10')).toEqual(['a:2028-02-29']);
  });

  it('crosses the year end', () => {
    expect(pairs([rule({ id: 'a', day: 5, lastGenerated: '2026-12' })], '2026-12-20')).toEqual(['a:2027-01-05']);
    expect(pairs([rule({ id: 'a', day: 5, lastGenerated: '2026-11' })], '2026-12-20')).toEqual(['a:2027-01-05']);
    expect(pairs([rule({ id: 'a', day: 28, lastGenerated: '2026-11' })], '2026-12-20')).toEqual(['a:2026-12-28']);
  });

  it('lists the soonest first, and breaks ties by note', () => {
    const rules = [
      rule({ id: 'late', day: 30, note: 'Zeta', lastGenerated: '2026-09' }),
      rule({ id: 'tie-b', day: 15, note: 'Bravo', lastGenerated: '2026-09' }),
      rule({ id: 'soon', day: 5, note: 'Alfa', lastGenerated: '2026-09' }),
      rule({ id: 'tie-a', day: 15, note: 'Alfa', lastGenerated: '2026-09' }),
      rule({ id: 'next-month', day: 1, note: 'Aaa', lastGenerated: '2026-10' }),
    ];
    expect(pairs(rules)).toEqual(['soon:2026-10-05', 'tie-a:2026-10-15', 'tie-b:2026-10-15', 'late:2026-10-30', 'next-month:2026-11-01']);
  });

  it('keeps input order for payments with the same date and note', () => {
    const rules = [rule({ id: 'one', day: 15, lastGenerated: '2026-09' }), rule({ id: 'two', day: 15, lastGenerated: '2026-09' })];
    expect(pairs(rules)).toEqual(['one:2026-10-15', 'two:2026-10-15']);
  });

  it('returns the very rule objects it was given, without touching them', () => {
    const rules = deepFreeze([rule({ id: 'a', day: 15, lastGenerated: '2026-09' })]);
    const [first] = nextPayments(rules, TODAY);
    expect(first!.rule).toBe(rules[0]);
  });

  it('always returns valid dates that are not in the past', () => {
    const rng = mulberry32(4);
    const bad: string[] = [];
    for (let i = 0; i < 400; i++) {
      const today = addDays('2024-01-01', Math.floor(rng() * 1500));
      const month = monthKeyOf(today);
      const startMonth = addMonths(month, Math.floor(rng() * 30) - 25);
      const lastGenerated = rng() < 0.3 ? null : addMonths(month, Math.floor(rng() * 10) - 8);
      const r = rule({ day: 1 + Math.floor(rng() * 31), startMonth, lastGenerated });
      for (const p of nextPayments(planRecurring([r], today).rules, today)) {
        if (!isValidDateStr(p.date) || p.date < today) bad.push(`${today}: ${JSON.stringify(r)} -> ${p.date}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('predicts the day planRecurring really records the next payment (once the rules are up to date)', () => {
    const rng = mulberry32(8);
    const bad: string[] = [];
    for (let i = 0; i < 300; i++) {
      const today = addDays('2025-06-01', Math.floor(rng() * 800));
      const month = monthKeyOf(today);
      const startMonth = addMonths(month, Math.floor(rng() * 8) - 6);
      // lastGenerated anywhere from before startMonth to two months in the future
      const lastGenerated = rng() < 0.3 ? null : addMonths(month, Math.floor(rng() * 9) - 6);
      const r = rule({ day: 1 + Math.floor(rng() * 31), startMonth, lastGenerated });

      // Bring the rule up to date first: anything due today or earlier is recorded by this run.
      const upToDate = planRecurring([r], today).rules;
      const predicted = nextPayments(upToDate, today)[0]?.date;
      // Then let the days go by and see when it is really recorded.
      const recorded = simulate(upToDate, addDays(today, 1), 130).drafts[0]?.date;
      if (predicted !== recorded || (predicted !== undefined && predicted <= today)) {
        bad.push(`${today} ${JSON.stringify(r)}: predicted ${predicted}, recorded ${recorded}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---- regressions: bugs found in review, since fixed --------------------------

describe('regressions', () => {
  // `addMonths('9999-12', 1)` is '10000-01', which sorts before every four-digit month as text; a
  // valid-looking lastGenerated in the far future used to make planRecurring start over from
  // startMonth and re-create old expenses.
  it('a rule whose lastGenerated is far in the future does not regenerate old months', () => {
    const plan = planRecurring([rule({ lastGenerated: '9999-12', startMonth: '2020-01', day: 1 })], '2026-10-02');
    expect(dates(plan.drafts)).toEqual([]);
  });
});
