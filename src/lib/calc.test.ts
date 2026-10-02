import { describe, expect, it } from 'vitest';
import {
  centsToExpr,
  evaluate,
  exprToCents,
  formatDisplay,
  formatExpression,
  hasOperator,
  pressKey,
  type CalcKey,
} from './calc';
import { getMoneyFormatter } from './money';

const type = (keys: CalcKey[], start = ''): string => keys.reduce((e, k) => pressKey(e, k), start);
const keys = (s: string): CalcKey[] => s.split(' ') as CalcKey[];

describe('pressKey', () => {
  it('builds numbers digit by digit', () => {
    expect(type(keys('1 2 5 0 0'))).toBe('12500');
  });

  it('never keeps leading zeros', () => {
    expect(type(keys('0 5'))).toBe('5');
    expect(type(keys('0 0 0'))).toBe('0');
    expect(type(keys('1 0 0'))).toBe('100');
  });

  it('handles the decimal mark', () => {
    expect(type(keys('.'))).toBe('0.');
    expect(type(keys('1 2 .'))).toBe('12.');
    expect(type(keys('1 2 . .'))).toBe('12.');
    expect(type(keys('1 2 . 5 0 7'))).toBe('12.50'); // at most 2 decimals
  });

  it('allows a decimal in the second operand too', () => {
    expect(type(keys('5 + .'))).toBe('5+0.');
    expect(type(keys('5 + 1 . 5 . 2'))).toBe('5+1.52');
  });

  it('caps the integer part at 9 digits per number', () => {
    expect(type(keys('1 2 3 4 5 6 7 8 9 0'))).toBe('123456789');
    expect(type(keys('1 2 3 4 5 6 7 8 9 + 1 2 3 4 5 6 7 8 9 0'))).toBe('123456789+123456789');
  });

  it('ignores operators on an empty expression and replaces consecutive ones', () => {
    expect(type(keys('+'))).toBe('');
    expect(type(keys('5 + *'))).toBe('5*');
    expect(type(keys('5 + * /'))).toBe('5/');
  });

  it('drops a dangling dot when an operator follows', () => {
    expect(type(keys('1 2 . +'))).toBe('12+');
  });

  it('accepts % only right after a digit, and requires an operator after it', () => {
    expect(type(keys('%'))).toBe('');
    expect(type(keys('5 + %'))).toBe('5+');
    expect(type(keys('1 0 %'))).toBe('10%');
    expect(type(keys('1 0 % %'))).toBe('10%');
    expect(type(keys('1 0 % 5'))).toBe('10%');
    expect(type(keys('1 0 % +'))).toBe('10%+');
  });

  it('deletes and clears', () => {
    expect(type(keys('1 2 3 back'))).toBe('12');
    expect(type(keys('1 2 + back'))).toBe('12');
    expect(type(keys('1 2 3 clear'))).toBe('');
    expect(type(keys('back'))).toBe('');
  });
});

describe('evaluate', () => {
  it('does basic arithmetic with precedence', () => {
    expect(evaluate('2+3*4')).toBe(14);
    expect(evaluate('10-4-3')).toBe(3);
    expect(evaluate('100/4/5')).toBe(5);
    expect(evaluate('12500/4')).toBe(3125);
  });

  it('applies percent like a pocket calculator', () => {
    expect(evaluate('25000+10%')).toBe(27500);
    expect(evaluate('100-10%')).toBe(90);
    expect(evaluate('200*10%')).toBeCloseTo(20);
    expect(evaluate('200/50%')).toBeCloseTo(400);
    expect(evaluate('100+50%+20%')).toBeCloseTo(180);
    expect(evaluate('50%')).toBeCloseTo(0.5);
  });

  it('ignores a dangling operator and tolerates a trailing dot', () => {
    expect(evaluate('12+')).toBe(12);
    expect(evaluate('12.')).toBe(12);
    expect(evaluate('5+3*')).toBe(8);
  });

  it('returns null for nothing or the impossible', () => {
    expect(evaluate('')).toBeNull();
    expect(evaluate('10/0')).toBeNull();
    expect(evaluate('10/0+5')).toBeNull();
    expect(evaluate('+')).toBeNull();
  });

  it('can go negative (the UI refuses to save it)', () => {
    expect(evaluate('5-10')).toBe(-5);
  });
});

describe('exprToCents', () => {
  it('rounds to cents without float drift', () => {
    expect(exprToCents('0.1+0.2')).toBe(30);
    expect(exprToCents('10/3')).toBe(333);
    expect(exprToCents('19.99*3')).toBe(5997);
    expect(exprToCents('12500')).toBe(1_250_000);
    expect(exprToCents('')).toBeNull();
  });
});

describe('centsToExpr', () => {
  it('writes cents back as an editable expression', () => {
    expect(centsToExpr(12500)).toBe('125');
    expect(centsToExpr(12550)).toBe('125.5');
    expect(centsToExpr(12505)).toBe('125.05');
    expect(centsToExpr(5)).toBe('0.05');
    expect(exprToCents(centsToExpr(98765))).toBe(98765);
  });
});

describe('hasOperator', () => {
  it('detects operators and percent', () => {
    expect(hasOperator('12')).toBe(false);
    expect(hasOperator('12+3')).toBe(true);
    expect(hasOperator('10%')).toBe(true);
  });
});

describe('display (es-AR)', () => {
  const f = getMoneyFormatter('es-AR', 'ARS');

  it('localizes the expression', () => {
    expect(formatExpression('12500/4', f)).toBe('12.500 ÷ 4');
    expect(formatExpression('1500.5*2', f)).toBe('1.500,5 × 2');
    expect(formatExpression('100-10%', f)).toBe('100 − 10%');
  });

  it('shows the typed number while there is no operator', () => {
    expect(formatDisplay('', f)).toBe('0');
    expect(formatDisplay('12', f)).toBe('12');
    expect(formatDisplay('12500', f)).toBe('12.500');
    expect(formatDisplay('12.', f)).toBe('12,');
    expect(formatDisplay('12.50', f)).toBe('12,50');
    expect(formatDisplay('0.', f)).toBe('0,');
  });

  it('shows the live result once there is an operator', () => {
    expect(formatDisplay('12500/4', f)).toBe('3.125');
    expect(formatDisplay('25000+10%', f)).toBe('27.500');
    expect(formatDisplay('10/3', f)).toBe('3,33');
    expect(formatDisplay('10/0', f)).toBe('0');
    expect(formatDisplay('5-10', f)).toBe('−5');
  });
});
