import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addDays,
  addMonths,
  capitalize,
  dateInMonth,
  dayOf,
  daysInMonth,
  daysInMonthOf,
  diffDays,
  formatDayHeading,
  formatLongDate,
  formatMonthLabel,
  formatShortDate,
  isValidDateStr,
  isValidMonthKey,
  makeMonthKey,
  monthKeyOf,
  monthName,
  monthShort,
  parseDateStr,
  parseMonthKey,
  todayStr,
  toDateStr,
  weekdayInitial,
  weekdayLong,
  weekdayMon0,
  weekdayOccurrences,
  weekdayShort,
} from './dates';

// ---- independent oracle -----------------------------------------------------
// A proleptic-Gregorian calendar written from scratch (Howard Hinnant's civil-date
// algorithms), so these tests never lean on `Date` -- which is exactly what the
// implementation uses, and which has a quirk for the years 0-99.

const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const monthLength = (y: number, m: number): number => (m === 2 && isLeapYear(y) ? 29 : (MONTH_LENGTHS[m - 1] ?? 0));

/** Days since 1970-01-01. */
function epochDay(y: number, m: number, d: number): number {
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * ((m + 9) % 12) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

function civil(epoch: number): { y: number; m: number; d: number } {
  const z = epoch + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

const ymd = (y: number, m: number, d: number): string =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

const split = (s: string): [number, number, number] => {
  const [y, m, d] = s.split('-').map(Number);
  return [y ?? 0, m ?? 0, d ?? 0];
};

const oracleAddDays = (s: string, n: number): string => {
  const [y, m, d] = split(s);
  const c = civil(epochDay(y, m, d) + n);
  return ymd(c.y, c.m, c.d);
};

/** Monday = 0 ... Sunday = 6; 1970-01-01 was a Thursday. */
const oracleWeekday = (s: string): number => {
  const [y, m, d] = split(s);
  return (((epochDay(y, m, d) + 3) % 7) + 7) % 7;
};

/** Month arithmetic done by stepping one month at a time (no division involved). */
function oracleAddMonths(key: string, n: number): string {
  const [y0, m0] = split(`${key}-01`);
  let y = y0;
  let m = m0;
  for (let i = 0; i < Math.abs(n); i++) {
    m += Math.sign(n);
    if (m > 12) {
      m = 1;
      y++;
    } else if (m < 1) {
      m = 12;
      y--;
    }
  }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
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

/** Normalizes the no-break / narrow no-break spaces Intl likes to emit. */
const flat = (s: string): string => s.replace(/[  ]/g, ' ');

describe('the test oracle itself', () => {
  it('knows a few fixed epoch days', () => {
    expect(epochDay(1970, 1, 1)).toBe(0);
    expect(epochDay(1969, 12, 31)).toBe(-1);
    expect(epochDay(2000, 1, 1)).toBe(10_957);
    expect(epochDay(0, 3, 1)).toBe(-719_468);
  });

  it('agrees with Date.UTC for every day from 1970 to 2110', () => {
    const wrong: string[] = [];
    for (let y = 1970; y <= 2110; y++) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 1; d <= monthLength(y, m); d++) {
          if (epochDay(y, m, d) !== Date.UTC(y, m - 1, d) / 86_400_000) wrong.push(ymd(y, m, d));
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('round-trips epoch days, including years before 100', () => {
    for (const e of [-800_000, -719_468, -100_000, -1, 0, 1, 10_957, 20_728, 100_000, 800_000]) {
      const c = civil(e);
      expect(epochDay(c.y, c.m, c.d)).toBe(e);
    }
  });
});

// ---- toDateStr / todayStr ---------------------------------------------------

describe('toDateStr / todayStr', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['mid-day', new Date(2026, 9, 2, 12, 0, 0), '2026-10-02'],
    ['zero-pads month and day', new Date(2026, 0, 5, 12), '2026-01-05'],
    ['last millisecond of the year', new Date(2026, 11, 31, 23, 59, 59, 999), '2026-12-31'],
    ['first second of the next year', new Date(2027, 0, 1, 0, 0, 1), '2027-01-01'],
    ['leap day', new Date(2024, 1, 29, 12), '2024-02-29'],
    ['last second of a short February', new Date(2026, 1, 28, 23, 59, 59), '2026-02-28'],
    ['first second of March', new Date(2026, 2, 1, 0, 0, 1), '2026-03-01'],
  ])('reads the local calendar fields: %s', (_label, date, expected) => {
    expect(toDateStr(date)).toBe(expected);
    expect(todayStr(date)).toBe(expected);
  });

  it('defaults to the current clock (frozen here)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 2, 23, 59, 59));
    expect(todayStr()).toBe('2026-10-02');
    vi.setSystemTime(new Date(2026, 9, 3, 0, 0, 1));
    expect(todayStr()).toBe('2026-10-03');
  });

  it('always produces something isValidDateStr accepts', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const date = new Date(1990 + Math.floor(rng() * 120), Math.floor(rng() * 12), 1 + Math.floor(rng() * 28), 12);
      expect(isValidDateStr(toDateStr(date))).toBe(true);
    }
  });
});

// ---- calendar validity ------------------------------------------------------

describe('daysInMonthOf / daysInMonth', () => {
  it.each([
    [2026, 1, 31], [2026, 2, 28], [2026, 3, 31], [2026, 4, 30], [2026, 5, 31], [2026, 6, 30],
    [2026, 7, 31], [2026, 8, 31], [2026, 9, 30], [2026, 10, 31], [2026, 11, 30], [2026, 12, 31],
    [2024, 2, 29], [2028, 2, 29], [2000, 2, 29], [2400, 2, 29],
    [1900, 2, 28], [2100, 2, 28], [2200, 2, 28], [2023, 2, 28], [2025, 2, 28],
  ])('%i-%i has %i days', (year, month, expected) => {
    expect(daysInMonthOf(year, month)).toBe(expected);
    expect(daysInMonth(makeMonthKey(year, month))).toBe(expected);
  });

  it('agrees with an independent calendar for every month from 1583 to 2600', () => {
    const wrong: string[] = [];
    for (let y = 1583; y <= 2600; y++) {
      for (let m = 1; m <= 12; m++) {
        if (daysInMonthOf(y, m) !== monthLength(y, m)) wrong.push(`${y}-${m}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('isValidDateStr', () => {
  it.each([
    '2026-10-02', '2026-01-01', '2026-12-31', '2026-01-31', '2026-04-30',
    '2024-02-29', '2000-02-29', '2400-02-29', '2026-02-28', '1999-12-31', '9999-12-31', '0001-01-01',
  ])('accepts %s', (s) => {
    expect(isValidDateStr(s)).toBe(true);
  });

  it.each([
    ['Feb 30', '2026-02-30'],
    ['Feb 29 in a common year', '2026-02-29'],
    ['Feb 29 in 2100 (not a leap year)', '2100-02-29'],
    ['Feb 29 in 1900 (not a leap year)', '1900-02-29'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-10'],
    ['day 00', '2026-10-00'],
    ['day 32', '2026-01-32'],
    ['Apr 31', '2026-04-31'],
    ['Sep 31', '2026-09-31'],
    ['unpadded', '2026-1-1'],
    ['two-digit year', '26-01-01'],
    ['three-digit year', '026-01-01'],
    ['slashes', '2026/01/01'],
    ['US order', '01-31-2026'],
    ['compact', '20261002'],
    ['timestamp', '2026-01-01T00:00:00Z'],
    ['date and time', '2026-01-01 10:00'],
    ['leading space', ' 2026-01-01'],
    ['trailing space', '2026-01-01 '],
    ['trailing newline', '2026-01-01\n'],
    ['leading newline', '\n2026-01-01'],
    ['empty', ''],
    ['month key', '2026-01'],
    ['fullwidth digits', '２０２６-01-01'],
    ['Arabic-Indic digits', '٢٠٢٦-٠١-٠١'],
    ['explicit sign', '+2026-01-01'],
    ['negative year', '-2026-01-01'],
    ['text', 'garbage'],
  ])('rejects %s', (_label, s) => {
    expect(isValidDateStr(s)).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 20_261_002],
    ['NaN', Number.NaN],
    ['true', true],
    ['an object', {}],
    ['an array', []],
    ['a one-element array', ['2026-01-01']],
    ['a Date', new Date(2026, 0, 1)],
    ['a boxed String', new String('2026-01-01')],
    ['a function', () => '2026-01-01'],
  ])('rejects %s without throwing', (_label, value) => {
    expect(isValidDateStr(value)).toBe(false);
  });

  it('agrees with an independent calendar for day numbers 0-32 of every month in 1990-2110', () => {
    const wrong: string[] = [];
    for (let y = 1990; y <= 2110; y++) {
      for (let m = 1; m <= 12; m++) {
        for (let d = 0; d <= 32; d++) {
          const s = ymd(y, m, d);
          if (isValidDateStr(s) !== (d >= 1 && d <= monthLength(y, m))) wrong.push(s);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('isValidMonthKey', () => {
  it.each(['2026-01', '2026-12', '0001-06', '9999-12', '2000-02'])('accepts %s', (s) => {
    expect(isValidMonthKey(s)).toBe(true);
  });

  it.each(['2026-00', '2026-13', '2026-1', '26-01', '2026-001', '2026-01-01', '2026/01', ' 2026-01', '2026-01\n', '', 'garbage', '２０２６-０１'])(
    'rejects %j',
    (s) => {
      expect(isValidMonthKey(s)).toBe(false);
    },
  );

  it.each([undefined, null, 202_601, {}, [], ['2026-01'], new Date(2026, 0, 1)])('rejects the non-string %j', (value) => {
    expect(isValidMonthKey(value)).toBe(false);
  });
});

describe('parsing and slicing', () => {
  it('parseDateStr / parseMonthKey return plain numbers', () => {
    expect(parseDateStr('2026-10-02')).toEqual({ year: 2026, month: 10, day: 2 });
    expect(parseDateStr('0007-01-09')).toEqual({ year: 7, month: 1, day: 9 });
    expect(parseMonthKey('2026-10')).toEqual({ year: 2026, month: 10 });
  });

  it.each(['2026-1-1', '', 'garbage', '2026-01-01T00:00', '2026-01-01\n', ' 2026-01-01', '26-01-01', '2026-01'])(
    'parseDateStr throws on the malformed %j',
    (s) => {
      expect(() => parseDateStr(s)).toThrow(/Invalid date/);
    },
  );

  it.each(['2026-1', '', 'garbage', '2026-01-01', '2026-001', ' 2026-01'])('parseMonthKey throws on the malformed %j', (s) => {
    expect(() => parseMonthKey(s)).toThrow(/Invalid month/);
  });

  it('parseDateStr throws instead of returning garbage when given a non-string', () => {
    expect(() => parseDateStr(undefined as unknown as string)).toThrow(/Invalid date/);
    expect(() => parseDateStr(null as unknown as string)).toThrow(/Invalid date/);
  });

  it('only checks the SHAPE of a date, so callers must use isValidDateStr first (documented contract)', () => {
    // 'Feb 30' and 'month 13' parse fine, and the Date-based math then rolls them over silently.
    expect(parseDateStr('2026-02-30')).toEqual({ year: 2026, month: 2, day: 30 });
    expect(isValidDateStr('2026-02-30')).toBe(false);
    expect(addDays('2026-02-30', 0)).toBe('2026-03-02');
  });

  it('makeMonthKey zero-pads', () => {
    expect(makeMonthKey(2026, 1)).toBe('2026-01');
    expect(makeMonthKey(2026, 12)).toBe('2026-12');
    expect(makeMonthKey(7, 3)).toBe('0007-03');
  });

  it('monthKeyOf and dayOf slice a date', () => {
    expect(monthKeyOf('2026-10-02')).toBe('2026-10');
    expect(monthKeyOf('2024-02-29')).toBe('2024-02');
    expect(dayOf('2026-10-02')).toBe(2);
    expect(dayOf('2026-10-31')).toBe(31);
    expect(dayOf('2026-01-09')).toBe(9);
  });
});

// ---- month arithmetic ------------------------------------------------------

describe('addMonths', () => {
  it.each([
    ['2026-01', 1, '2026-02'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2026-01', -13, '2024-12'],
    ['2026-10', 0, '2026-10'],
    ['2026-10', 12, '2027-10'],
    ['2026-10', -12, '2025-10'],
    ['2026-03', 10, '2027-01'],
    ['2026-12', 12, '2027-12'],
    ['2026-01', 11, '2026-12'],
    ['2026-01', 12, '2027-01'],
    ['2026-06', -5, '2026-01'],
    ['2026-06', -6, '2025-12'],
    ['2026-06', -7, '2025-11'],
    ['1999-12', 1, '2000-01'],
    ['2000-01', -1, '1999-12'],
    ['2026-10', 1200, '2126-10'],
    ['2026-10', -1200, '1926-10'],
  ])('%s + %i months = %s', (key, n, expected) => {
    expect(addMonths(key, n)).toBe(expected);
  });

  it('agrees with month-by-month stepping for offsets of -40..40 from every month of 1999-2002', () => {
    const wrong: string[] = [];
    for (let y = 1999; y <= 2002; y++) {
      for (let m = 1; m <= 12; m++) {
        const key = makeMonthKey(y, m);
        for (let n = -40; n <= 40; n++) {
          if (addMonths(key, n) !== oracleAddMonths(key, n)) wrong.push(`${key}${n >= 0 ? '+' : ''}${n}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('is reversible and always yields a valid key', () => {
    for (const key of ['2026-01', '2026-12', '2024-02', '2000-06']) {
      for (const n of [1, 2, 11, 12, 13, 25, 100, -1, -12, -13, -37]) {
        const moved = addMonths(key, n);
        expect(isValidMonthKey(moved)).toBe(true);
        expect(addMonths(moved, -n)).toBe(key);
      }
    }
  });
});

describe('dateInMonth', () => {
  it.each([
    ['2026-02', 31, '2026-02-28'],
    ['2026-02', 30, '2026-02-28'],
    ['2026-02', 29, '2026-02-28'],
    ['2026-02', 28, '2026-02-28'],
    ['2024-02', 31, '2024-02-29'],
    ['2024-02', 30, '2024-02-29'],
    ['2024-02', 29, '2024-02-29'],
    ['2026-04', 31, '2026-04-30'],
    ['2026-04', 30, '2026-04-30'],
    ['2026-12', 31, '2026-12-31'],
    ['2026-01', 31, '2026-01-31'],
    ['2026-02', 15, '2026-02-15'],
    ['2026-02', 1, '2026-02-01'],
    ['2026-02', 0, '2026-02-01'],
    ['2026-02', -3, '2026-02-01'],
    ['2026-02', 1.9, '2026-02-01'],
    ['2026-02', 28.9, '2026-02-28'],
    ['2026-02', Number.POSITIVE_INFINITY, '2026-02-28'],
    ['2026-02', Number.NEGATIVE_INFINITY, '2026-02-01'],
    ['2026-10', 5, '2026-10-05'],
  ])('%s day %s -> %s', (key, day, expected) => {
    expect(dateInMonth(key, day)).toBe(expected);
  });

  it('clamps per month and never "sticks": day 31 gives each month its own last day', () => {
    for (const year of [2025, 2026, 2028]) {
      for (let m = 1; m <= 12; m++) {
        expect(dateInMonth(makeMonthKey(year, m), 31)).toBe(ymd(year, m, monthLength(year, m)));
      }
    }
  });

  it('always returns a valid date for any day number from -5 to 40', () => {
    const wrong: string[] = [];
    for (const year of [2023, 2024, 2026, 2028, 2100]) {
      for (let m = 1; m <= 12; m++) {
        for (let day = -5; day <= 40; day++) {
          const result = dateInMonth(makeMonthKey(year, m), day);
          const expected = ymd(year, m, Math.min(Math.max(day, 1), monthLength(year, m)));
          if (result !== expected || !isValidDateStr(result)) wrong.push(`${year}-${m} day ${day} -> ${result}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});

// ---- day arithmetic ---------------------------------------------------------

describe('addDays', () => {
  it.each([
    ['2026-01-31', 1, '2026-02-01'],
    ['2026-02-28', 1, '2026-03-01'],
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-29', 1, '2024-03-01'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2000-03-01', -1, '2000-02-29'],
    ['2100-03-01', -1, '2100-02-28'],
    ['1900-03-01', -1, '1900-02-28'],
    ['2026-10-02', 0, '2026-10-02'],
    ['2026-10-02', 365, '2027-10-02'],
    ['2024-02-29', 365, '2025-02-28'],
    ['2024-02-29', 366, '2025-03-01'],
    ['2024-02-29', -366, '2023-02-28'],
    ['2026-10-02', -274, '2026-01-01'],
    ['2026-10-02', -275, '2025-12-31'],
    ['2026-03-07', 1, '2026-03-08'], // US daylight-saving start
    ['2026-03-08', 1, '2026-03-09'],
    ['2026-10-25', 1, '2026-10-26'], // EU daylight-saving end (a 25-hour day)
    ['2026-10-24', 2, '2026-10-26'],
    ['2026-11-01', -1, '2026-10-31'], // US daylight-saving end
    ['2026-03-29', 1, '2026-03-30'], // EU daylight-saving start
    ['2026-09-06', 1, '2026-09-07'], // Chile skips local midnight that day
    ['2026-10-02', 100_000, '2300-07-18'],
    ['2026-10-02', -100_000, '1752-12-17'],
  ])('%s + %i days = %s', (start, n, expected) => {
    expect(addDays(start, n)).toBe(expected);
  });

  it('agrees with an independent calendar for every offset in a window around month, year and century ends', () => {
    const starts = ['1999-12-25', '1900-02-20', '2000-02-20', '2024-02-20', '2026-03-01', '2026-10-20', '2026-12-25', '2100-02-20'];
    const wrong: string[] = [];
    for (const start of starts) {
      for (let n = -800; n <= 800; n++) {
        if (addDays(start, n) !== oracleAddDays(start, n)) wrong.push(`${start}${n >= 0 ? '+' : ''}${n}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('is reversible and always yields a valid date', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 400; i++) {
      const start = oracleAddDays('2000-01-01', Math.floor(rng() * 36_000));
      const n = Math.floor(rng() * 4000) - 2000;
      const moved = addDays(start, n);
      expect(isValidDateStr(moved)).toBe(true);
      expect(addDays(moved, -n)).toBe(start);
    }
  });

  it('throws on a malformed start date instead of inventing one', () => {
    expect(() => addDays('2026-1-1', 1)).toThrow(/Invalid date/);
    expect(() => addDays('', 1)).toThrow(/Invalid date/);
  });
});

describe('diffDays', () => {
  it.each([
    ['2026-10-02', '2026-10-02', 0],
    ['2026-10-02', '2026-10-03', 1],
    ['2026-10-03', '2026-10-02', -1],
    ['2026-12-31', '2027-01-01', 1],
    ['2024-02-28', '2024-03-01', 2],
    ['2026-02-28', '2026-03-01', 1],
    ['2024-01-01', '2025-01-01', 366],
    ['2026-01-01', '2027-01-01', 365],
    ['2000-01-01', '2001-01-01', 366],
    ['1900-01-01', '2000-01-01', 36_524],
    ['2000-01-01', '2100-01-01', 36_525],
    ['1970-01-01', '2000-01-01', 10_957],
    ['2026-03-08', '2026-03-09', 1], // US daylight-saving start
    ['2026-03-01', '2026-04-01', 31],
    ['2026-10-24', '2026-10-26', 2], // EU daylight-saving end
    ['2026-10-25', '2026-10-26', 1],
    ['2026-09-05', '2026-09-07', 2],
  ])('from %s to %s is %i days', (a, b, expected) => {
    expect(diffDays(a, b)).toBe(expected);
  });

  it('agrees with an independent calendar and is antisymmetric', () => {
    const rng = mulberry32(5);
    const wrong: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const a = oracleAddDays('1990-01-01', Math.floor(rng() * 45_000));
      const b = oracleAddDays('1990-01-01', Math.floor(rng() * 45_000));
      const [ay, am, ad] = split(a);
      const [by, bm, bd] = split(b);
      const expected = epochDay(by, bm, bd) - epochDay(ay, am, ad);
      if (diffDays(a, b) !== expected || diffDays(b, a) !== -expected) wrong.push(`${a} ${b}`);
    }
    expect(wrong).toEqual([]);
  });

  it('is the inverse of addDays', () => {
    for (const start of ['2026-01-31', '2024-02-29', '2026-12-31', '2000-02-29']) {
      for (const n of [-1000, -366, -31, -1, 0, 1, 28, 29, 30, 31, 365, 366, 1000]) {
        expect(diffDays(start, addDays(start, n))).toBe(n);
      }
    }
  });

  it('never returns negative zero for equal dates', () => {
    expect(Object.is(diffDays('2026-10-02', '2026-10-02'), 0)).toBe(true);
  });
});

describe('weekdayMon0', () => {
  it.each([
    ['1900-01-01', 0, 'Monday'],
    ['1969-07-20', 6, 'Sunday (Moon landing)'],
    ['1970-01-01', 3, 'Thursday (epoch)'],
    ['1999-12-31', 4, 'Friday'],
    ['2000-01-01', 5, 'Saturday'],
    ['2000-02-29', 1, 'Tuesday (leap day)'],
    ['2001-09-11', 1, 'Tuesday'],
    ['2020-03-11', 2, 'Wednesday'],
    ['2024-01-01', 0, 'Monday'],
    ['2024-02-29', 3, 'Thursday (leap day)'],
    ['2026-01-01', 3, 'Thursday'],
    ['2026-09-30', 2, 'Wednesday'],
    ['2026-10-02', 4, 'Friday'],
    ['2026-10-04', 6, 'Sunday'],
    ['2026-10-05', 0, 'Monday'],
    ['2038-01-19', 1, 'Tuesday (Y2038)'],
  ])('%s is index %i (%s)', (date, expected) => {
    expect(weekdayMon0(date)).toBe(expected);
  });

  it('agrees with an independent calendar for every day from 1990 to 2060', () => {
    const wrong: string[] = [];
    for (let e = epochDay(1990, 1, 1); e <= epochDay(2060, 12, 31); e++) {
      const c = civil(e);
      const s = ymd(c.y, c.m, c.d);
      if (weekdayMon0(s) !== oracleWeekday(s)) wrong.push(s);
    }
    expect(wrong).toEqual([]);
  });

  it('advances by one (mod 7) with each calendar day, across year ends and leap days', () => {
    for (const start of ['2023-12-25', '2024-02-25', '2026-12-25', '2100-02-25']) {
      let previous = weekdayMon0(start);
      for (let n = 1; n <= 20; n++) {
        const current = weekdayMon0(addDays(start, n));
        expect(current).toBe((previous + 1) % 7);
        previous = current;
      }
    }
  });
});

describe('weekdayOccurrences', () => {
  it('counts each weekday (Monday first) in October 2026, which runs Thursday to Saturday', () => {
    expect(weekdayOccurrences('2026-10-01', '2026-10-31')).toEqual([4, 4, 4, 5, 5, 5, 4]);
  });

  it('gives every weekday the same count in a 28-day February', () => {
    expect(weekdayOccurrences('2026-02-01', '2026-02-28')).toEqual([4, 4, 4, 4, 4, 4, 4]);
  });

  it('gives the weekday of Jan 1 the extra day in a common year (2026 starts on Thursday)', () => {
    expect(weekdayOccurrences('2026-01-01', '2026-12-31')).toEqual([52, 52, 52, 53, 52, 52, 52]);
  });

  it('gives Monday and Tuesday the extra days in the leap year 2024', () => {
    expect(weekdayOccurrences('2024-01-01', '2024-12-31')).toEqual([53, 53, 52, 52, 52, 52, 52]);
  });

  it('handles a single day, in the right slot', () => {
    expect(weekdayOccurrences('2026-10-02', '2026-10-02')).toEqual([0, 0, 0, 0, 1, 0, 0]);
    expect(weekdayOccurrences('2026-10-04', '2026-10-04')).toEqual([0, 0, 0, 0, 0, 0, 1]);
    expect(weekdayOccurrences('2026-10-05', '2026-10-05')).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });

  it('returns all zeros for a reversed range', () => {
    expect(weekdayOccurrences('2026-10-31', '2026-10-01')).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('gives exactly one of each weekday for any 7 consecutive days, wherever they start', () => {
    for (let i = 0; i < 14; i++) {
      const from = addDays('2026-12-25', i);
      expect(weekdayOccurrences(from, addDays(from, 6))).toEqual([1, 1, 1, 1, 1, 1, 1]);
    }
  });

  it('counts add up to the number of days in the range', () => {
    const rng = mulberry32(21);
    for (let i = 0; i < 100; i++) {
      const from = oracleAddDays('2020-01-01', Math.floor(rng() * 2000));
      const to = addDays(from, Math.floor(rng() * 800));
      const counts = weekdayOccurrences(from, to);
      expect(counts).toHaveLength(7);
      expect(counts.reduce((a, b) => a + b, 0)).toBe(diffDays(from, to) + 1);
    }
  });
});

// ---- Spanish formatting (explicit locales; Intl output normalized) ------------

describe('month and weekday names (es-AR)', () => {
  it('monthName gives the full lowercase name for each month', () => {
    const names = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    names.forEach((name, i) => {
      expect(monthName(makeMonthKey(2026, i + 1), 'es-AR')).toBe(name);
    });
  });

  it('formatMonthLabel capitalizes the month and appends the year', () => {
    expect(formatMonthLabel('2026-10', 'es-AR')).toBe('Octubre 2026');
    expect(formatMonthLabel('2026-02', 'es-AR')).toBe('Febrero 2026');
    expect(formatMonthLabel('2027-01', 'es-AR')).toBe('Enero 2027');
  });

  it('monthShort drops the trailing dot and keeps the usual three letters', () => {
    const expected: Array<string | RegExp> = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', /^sept?$/, 'oct', 'nov', 'dic'];
    expected.forEach((want, i) => {
      const got = monthShort(makeMonthKey(2026, i + 1), 'es-AR');
      if (typeof want === 'string') expect(got).toBe(want);
      else expect(got).toMatch(want);
    });
  });

  it.each(['es-AR', 'es-ES', 'es-MX', 'es-CL', 'es-US', 'en-US', 'fr-FR'])('never leaves a dot in month or weekday abbreviations (%s)', (locale) => {
    for (let m = 1; m <= 12; m++) expect(monthShort(makeMonthKey(2026, m), locale)).not.toContain('.');
    for (let day = 5; day <= 11; day++) expect(weekdayShort(`2026-10-${String(day).padStart(2, '0')}`, locale)).not.toContain('.');
  });

  it('weekdayShort follows the date, Monday to Sunday', () => {
    const week = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'];
    expect(week.map((d) => weekdayShort(d, 'es-AR'))).toEqual(['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']);
  });

  it('weekdayLong maps index 0..6 to Monday..Sunday and wraps around', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => weekdayLong(i, 'es-AR'))).toEqual([
      'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo',
    ]);
    expect(weekdayLong(7, 'es-AR')).toBe('lunes');
    expect(weekdayLong(13, 'es-AR')).toBe('domingo');
    expect(weekdayLong(-1, 'es-AR')).toBe('domingo');
  });

  it('weekdayInitial gives one uppercase letter per weekday', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((i) => weekdayInitial(i, 'es-AR'))).toEqual(['L', 'M', 'M', 'J', 'V', 'S', 'D']);
    for (const locale of ['es-AR', 'es-ES', 'es-MX', 'en-US']) {
      for (let i = 0; i < 7; i++) {
        const initial = weekdayInitial(i, locale);
        expect(initial).toHaveLength(1);
        expect(initial).toBe(initial.toUpperCase());
      }
    }
  });

  it('keeps locales apart even when they are interleaved (formatter cache)', () => {
    for (let i = 0; i < 3; i++) {
      expect(monthName('2026-10', 'es-AR')).toBe('octubre');
      expect(monthName('2026-10', 'en-US')).toBe('October');
      expect(weekdayShort('2026-10-02', 'en-US')).toBe('Fri');
      expect(weekdayShort('2026-10-02', 'es-AR')).toBe('vie');
      expect(formatMonthLabel('2026-10', 'en-US')).toBe('October 2026');
    }
  });
});

describe('capitalize', () => {
  it.each([
    ['', ''],
    ['a', 'A'],
    ['octubre', 'Octubre'],
    ['ñandú', 'Ñandú'],
    ['éxito', 'Éxito'],
    ['Hola', 'Hola'],
    ['1abc', '1abc'],
    [' x', ' x'],
  ])('%j -> %j', (input, expected) => {
    expect(capitalize(input)).toBe(expected);
  });
});

describe('short, heading and long date formats (es-AR)', () => {
  it('formatShortDate is "day month" without padding', () => {
    expect(formatShortDate('2026-10-02', 'es-AR')).toBe('2 oct');
    expect(formatShortDate('2026-01-31', 'es-AR')).toBe('31 ene');
    expect(formatShortDate('2026-03-05', 'es-AR')).toBe('5 mar');
    expect(formatShortDate('2024-02-29', 'es-AR')).toBe('29 feb');
    expect(formatShortDate('2026-12-25', 'es-AR')).toBe('25 dic');
    expect(formatShortDate('2026-09-30', 'es-AR')).toMatch(/^30 sept?$/);
  });

  describe('formatDayHeading', () => {
    it('says Hoy and Ayer', () => {
      expect(formatDayHeading('2026-10-02', '2026-10-02', 'es-AR')).toBe('Hoy');
      expect(formatDayHeading('2026-10-01', '2026-10-02', 'es-AR')).toBe('Ayer');
    });

    it.each([
      ['month start', '2026-02-28', '2026-03-01'],
      ['year start', '2025-12-31', '2026-01-01'],
      ['leap day', '2024-02-29', '2024-03-01'],
    ])('says Ayer across a boundary: %s', (_label, day, today) => {
      expect(formatDayHeading(day, today, 'es-AR')).toBe('Ayer');
    });

    it('does not special-case tomorrow', () => {
      expect(formatDayHeading('2026-10-03', '2026-10-02', 'es-AR')).toBe('sáb 3 oct');
    });

    it('shows weekday and short date within the current year', () => {
      expect(formatDayHeading('2026-09-30', '2026-10-02', 'es-AR')).toMatch(/^mié 30 sept?$/);
      expect(formatDayHeading('2026-12-25', '2026-10-02', 'es-AR')).toBe('vie 25 dic');
      expect(formatDayHeading('2026-01-01', '2026-10-02', 'es-AR')).toBe('jue 1 ene');
    });

    it('adds the year when it is not the current one', () => {
      expect(formatDayHeading('2025-12-31', '2026-10-02', 'es-AR')).toBe('mié 31 dic 2025');
      expect(formatDayHeading('2027-01-02', '2026-12-31', 'es-AR')).toBe('sáb 2 ene 2027');
    });

    it('treats Hoy as Hoy even though yesterday may be in another year', () => {
      expect(formatDayHeading('2026-01-01', '2026-01-01', 'es-AR')).toBe('Hoy');
      expect(formatDayHeading('2025-12-31', '2026-01-01', 'es-AR')).toBe('Ayer');
    });

    it('throws on a malformed date rather than printing nonsense', () => {
      expect(() => formatDayHeading('garbage', '2026-10-02', 'es-AR')).toThrow(/Invalid date/);
    });
  });

  it('formatLongDate spells out weekday, day, month and year', () => {
    // Intl puts a comma after the weekday in es-AR ("miércoles, 30 de ..."), the doc comment omits it: accept both.
    expect(flat(formatLongDate('2026-09-30', 'es-AR'))).toMatch(/^miércoles,? 30 de septiembre de 2026$/);
    expect(flat(formatLongDate('2026-10-02', 'es-AR'))).toMatch(/^viernes,? 2 de octubre de 2026$/);
    expect(flat(formatLongDate('2024-02-29', 'es-AR'))).toMatch(/^jueves,? 29 de febrero de 2024$/);
    expect(flat(formatLongDate('2026-01-01', 'en-US'))).toBe('Thursday, January 1, 2026');
  });
});

// ---- time zones -------------------------------------------------------------
// `toDateStr` is the only function that reads local time. Everything else must give the same
// answer whatever the device's zone or daylight-saving rules; here the process zone is switched
// (and restored) to prove it. Skipped where the runtime cannot change zones.

const ZONES = [
  'UTC',
  'America/New_York',
  'America/Argentina/Buenos_Aires',
  'America/Santiago',
  'Europe/Madrid',
  'Asia/Kolkata',
  'Australia/Lord_Howe',
  'Pacific/Auckland',
  'Pacific/Pago_Pago',
  'Pacific/Kiritimati',
];

function restoreZone(original: string | undefined): void {
  if (original === undefined) delete process.env.TZ;
  else process.env.TZ = original;
}

const ZONE_SWITCHING_WORKS = ((): boolean => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Kiritimati';
    const kiritimati = new Date(2026, 0, 1).getTimezoneOffset() === -840;
    process.env.TZ = 'Pacific/Pago_Pago';
    return kiritimati && new Date(2026, 0, 1).getTimezoneOffset() === 660;
  } finally {
    restoreZone(original);
  }
})();

describe.skipIf(!ZONE_SWITCHING_WORKS).each(ZONES)('in the %s time zone', (zone) => {
  const original = process.env.TZ;

  afterEach(() => {
    restoreZone(original);
  });

  const enter = (): void => {
    process.env.TZ = zone;
  };

  it('toDateStr keeps the local calendar day at both ends of the day', () => {
    enter();
    expect(toDateStr(new Date(2026, 9, 2, 12))).toBe('2026-10-02');
    expect(toDateStr(new Date(2026, 9, 2, 23, 59, 59, 999))).toBe('2026-10-02');
    expect(toDateStr(new Date(2026, 11, 31, 23, 59, 59))).toBe('2026-12-31');
    expect(toDateStr(new Date(2027, 0, 1, 0, 0, 1))).toBe('2027-01-01');
  });

  it('every local noon of 2026 maps to the matching calendar day (daylight-saving days included)', () => {
    enter();
    const wrong: string[] = [];
    for (let i = 0; i < 365; i++) {
      const expected = oracleAddDays('2026-01-01', i);
      if (toDateStr(new Date(2026, 0, 1 + i, 12)) !== expected) wrong.push(expected);
    }
    expect(wrong).toEqual([]);
  });

  it('day math ignores daylight-saving changes', () => {
    enter();
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02');
    expect(diffDays('2026-03-01', '2026-04-01')).toBe(31);
    expect(diffDays('2026-10-01', '2026-11-01')).toBe(31);
    expect(diffDays('2026-01-01', '2027-01-01')).toBe(365);
    expect(weekdayOccurrences('2026-10-01', '2026-10-31')).toEqual([4, 4, 4, 5, 5, 5, 4]);
    expect(weekdayMon0('2026-10-02')).toBe(4);
  });

  it('formatting is pinned to the calendar date, not to the device zone', async () => {
    enter();
    // The module caches its Intl formatters, which resolve the zone when they are built: load a
    // fresh copy per zone so a formatter that forgot `timeZone: 'UTC'` cannot hide behind the cache.
    vi.resetModules();
    const fresh = await import('./dates');
    expect(fresh.weekdayShort('2026-10-02', 'es-AR')).toBe('vie');
    expect(fresh.formatShortDate('2026-01-01', 'es-AR')).toBe('1 ene');
    expect(fresh.formatShortDate('2026-12-31', 'es-AR')).toBe('31 dic');
    expect(fresh.monthName('2026-10', 'es-AR')).toBe('octubre');
    expect(fresh.monthShort('2026-01', 'es-AR')).toBe('ene');
    expect(flat(fresh.formatLongDate('2026-03-08', 'es-AR'))).toMatch(/^domingo,? 8 de marzo de 2026$/);
    expect(fresh.formatDayHeading('2026-10-02', '2026-10-03', 'es-AR')).toBe('Ayer');
  });
});

// ---- regressions: bugs found in review, since fixed --------------------------

describe('regressions', () => {
  // Years 0000-0099 pass isValidDateStr, but Date.UTC reads years 0-99 as 1900-1999, so the day
  // math used to answer about another century (typing "0026" into a date field is enough to get
  // such a date).
  describe('years 0000-0099 keep their own century in the day math', () => {
    it('addDays keeps the year', () => {
      expect(isValidDateStr('0050-01-01')).toBe(true);
      expect(addDays('0050-01-01', 1)).toBe('0050-01-02');
      expect(addDays('0000-03-01', -1)).toBe('0000-02-29');
    });

    it('diffDays across the 0099/0100 boundary is one day', () => {
      expect(diffDays('0099-12-31', '0100-01-01')).toBe(1);
    });

    it('weekdayMon0 follows the proleptic Gregorian calendar', () => {
      expect(weekdayMon0('0026-10-02')).toBe(oracleWeekday('0026-10-02'));
      expect(weekdayMon0('0001-01-01')).toBe(oracleWeekday('0001-01-01'));
    });

    it('year 0 is a leap year (divisible by 400)', () => {
      expect(daysInMonthOf(0, 2)).toBe(29);
      expect(isValidDateStr('0000-02-29')).toBe(true);
    });
  });

  // `dateInMonth` documents that it clamps the day, yet NaN used to slip through as the text "NaN"
  // (reachable through an unvalidated recurring day).
  it('dateInMonth never returns an invalid date, even for a NaN day', () => {
    expect(isValidDateStr(dateInMonth('2026-10', Number.NaN))).toBe(true);
  });
});
