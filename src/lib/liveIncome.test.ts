import { describe, expect, it } from 'vitest';
import { describeIncomeLive, type IncomeLiveInput } from './live';
import { getMoneyFormatter } from './money';

const fmt = getMoneyFormatter('es-AR', 'ARS');
const TODAY = '2026-10-20';
const plain = (s: string | undefined) => (s ?? '').replace(/[\u00a0\u202f]/g, ' ');

const input = (over: Partial<IncomeLiveInput> = {}): IncomeLiveInput => ({
  amount: 450_000_00,
  date: TODAY,
  today: TODAY,
  monthIncome: 0,
  monthSpent: 0,
  fmt,
  locale: 'es-AR',
  ...over,
});

describe('describeIncomeLive', () => {
  it('says nothing for an amount that is not positive', () => {
    expect(describeIncomeLive(input({ amount: 0 }))).toBeNull();
    expect(describeIncomeLive(input({ amount: -5 }))).toBeNull();
  });

  it('notes the first income of the month, in a neutral tone when nothing has been spent', () => {
    const live = describeIncomeLive(input());
    expect(live?.text).toBe('Es lo primero que entra este mes');
    expect(live?.tone).toBe('neutral');
  });

  it('adds up what had already come in this month', () => {
    const live = describeIncomeLive(input({ monthIncome: 1_500_000_00 }));
    expect(plain(live?.text)).toBe('Este mes ya suman $ 1.950.000');
  });

  it('says what is left after spending, in a good tone', () => {
    const live = describeIncomeLive(input({ monthIncome: 1_500_000_00, monthSpent: 1_738_600_00 }));
    expect(plain(live?.text)).toBe('Este mes ya suman $ 1.950.000 · te quedan $ 211.400');
    expect(live?.tone).toBe('good');
  });

  it('warns when even with this income the month is not covered', () => {
    const live = describeIncomeLive(input({ amount: 100_000_00, monthIncome: 0, monthSpent: 300_000_00 }));
    expect(plain(live?.text)).toBe('Es lo primero que entra este mes · faltan $ 200.000 para cubrir el mes');
    expect(live?.tone).toBe('warn');
  });

  it('is good, not a warning, when income exactly covers the spending', () => {
    const live = describeIncomeLive(input({ amount: 300_000_00, monthSpent: 300_000_00 }));
    expect(plain(live?.text)).toContain('te quedan $ 0');
    expect(live?.tone).toBe('good');
  });

  it('names the month when the income is for another one, and counts that month', () => {
    const live = describeIncomeLive(input({ date: '2026-09-28', monthIncome: 1_000_000_00, monthSpent: 2_000_000_00 }));
    expect(plain(live?.text)).toBe('Se suma a septiembre · faltan $ 550.000 para cubrir el mes');
    expect(live?.tone).toBe('warn');
  });

  it('never prints a negative zero or NaN', () => {
    const live = describeIncomeLive(input({ amount: 1, monthSpent: 1 }));
    expect(live?.text).not.toMatch(/NaN|-\s?\$\s?0/);
  });
});
