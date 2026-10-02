import type { MoneyFormatter } from './money';
import type { Cents } from './types';

/**
 * The expression typed on the calculator, kept in a canonical text form:
 * digits, "." as the decimal mark, the operators + - * / and a postfix %.
 * e.g. "12500/4" or "25000+10%". It is never passed to eval().
 */
export type CalcKey =
  | '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9'
  | '.' | '+' | '-' | '*' | '/' | '%' | 'back' | 'clear';

export const MAX_EXPR_LENGTH = 40;
const MAX_INT_DIGITS = 9;
const MAX_DECIMALS = 2;

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= '0' && c <= '9';
export const isOperator = (c: string | undefined): boolean => c === '+' || c === '-' || c === '*' || c === '/';

/** The number currently being typed (trailing run of digits and the dot). */
function currentNumber(expr: string): string {
  let i = expr.length;
  while (i > 0 && (isDigit(expr[i - 1]) || expr[i - 1] === '.')) i--;
  return expr.slice(i);
}

export function pressKey(expr: string, key: CalcKey): string {
  const last = expr.at(-1);

  switch (key) {
    case 'clear':
      return '';
    case 'back':
      return expr.slice(0, -1);
    case '%':
      return isDigit(last) ? expr + '%' : expr;
    case '+':
    case '-':
    case '*':
    case '/': {
      if (expr === '') return expr;
      if (isOperator(last)) return expr.slice(0, -1) + key;
      if (last === '.') return expr.slice(0, -1) + key;
      return expr + key;
    }
    case '.': {
      if (last === '%' || expr.length >= MAX_EXPR_LENGTH) return expr;
      const num = currentNumber(expr);
      if (num.includes('.')) return expr;
      return num === '' ? expr + '0.' : expr + '.';
    }
    default: {
      // digit
      if (last === '%' || expr.length >= MAX_EXPR_LENGTH) return expr;
      const num = currentNumber(expr);
      if (num === '0') return expr.slice(0, -1) + key; // no leading zeros ("05")
      const dot = num.indexOf('.');
      if (dot >= 0 ? num.length - dot - 1 >= MAX_DECIMALS : num.length >= MAX_INT_DIGITS) return expr;
      return expr + key;
    }
  }
}

type Part = { kind: 'num'; value: number; pct: boolean } | { kind: 'op'; op: string };
type Term = { value: number; percentOnly: boolean; raw: number };

function parse(expr: string): Part[] | null {
  const parts: Part[] = [];
  let buf = '';
  const flush = (pct: boolean): boolean => {
    if (buf === '') return !pct; // a "%" must follow a number
    const value = Number(buf);
    if (!Number.isFinite(value)) return false;
    parts.push({ kind: 'num', value, pct });
    buf = '';
    return true;
  };
  for (const ch of expr) {
    if (isDigit(ch) || ch === '.') buf += ch;
    else if (ch === '%') {
      if (!flush(true)) return null;
    } else if (isOperator(ch)) {
      if (!flush(false)) return null;
      parts.push({ kind: 'op', op: ch });
    } else return null;
  }
  if (!flush(false)) return null;
  while (parts.at(-1)?.kind === 'op') parts.pop(); // ignore a dangling operator
  return parts.length > 0 ? parts : null;
}

/**
 * Evaluates with the usual precedence (* and / before + and -). A trailing
 * operator is ignored. % follows pocket-calculator rules: "200+10%" adds 10% of
 * 200, "200*10%" is 200 x 0.10. Returns null for empty or impossible input
 * (such as division by zero).
 */
export function evaluate(expr: string): number | null {
  const parts = parse(expr);
  const first = parts?.[0];
  if (!parts || first?.kind !== 'num') return null;

  // Pass 1: collapse * and / into terms that are separated by + and -.
  const terms: Term[] = [];
  const signs: string[] = [];
  let acc: Term = { value: first.pct ? first.value / 100 : first.value, percentOnly: first.pct, raw: first.value };
  for (let i = 1; i < parts.length; i += 2) {
    const op = parts[i];
    const operand = parts[i + 1];
    if (op?.kind !== 'op' || operand?.kind !== 'num') return null;
    const n = operand.pct ? operand.value / 100 : operand.value;
    if (op.op === '*') {
      acc = { value: acc.value * n, percentOnly: false, raw: acc.raw };
    } else if (op.op === '/') {
      if (n === 0) return null;
      acc = { value: acc.value / n, percentOnly: false, raw: acc.raw };
    } else {
      terms.push(acc);
      signs.push(op.op);
      acc = { value: n, percentOnly: operand.pct, raw: operand.value };
    }
  }
  terms.push(acc);

  // Pass 2: fold + and -, where a lone "n%" means n percent of the running total.
  let total = terms[0]?.value ?? 0;
  for (let t = 1; t < terms.length; t++) {
    const term = terms[t];
    if (!term) return null;
    const delta = term.percentOnly ? total * (term.raw / 100) : term.value;
    total = signs[t - 1] === '+' ? total + delta : total - delta;
  }
  return Number.isFinite(total) ? total : null;
}

/** Result in cents, rounded; null when the expression has no valid value. */
export function exprToCents(expr: string): Cents | null {
  const value = evaluate(expr);
  if (value === null) return null;
  const cents = Math.round(value * 100);
  return Number.isSafeInteger(cents) ? cents : null;
}

export function hasOperator(expr: string): boolean {
  return /[+\-*/%]/.test(expr);
}

export function centsToExpr(cents: Cents): string {
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}`;
}

// ---- display ---------------------------------------------------------------

function groupNumber(token: string, f: MoneyFormatter): string {
  const [intPart = '', decPart] = token.split('.');
  const grouped = new Intl.NumberFormat(f.locale, { maximumFractionDigits: 0 }).format(Number(intPart || '0'));
  return decPart === undefined && !token.includes('.') ? grouped : `${grouped}${f.decimalSeparator}${decPart ?? ''}`;
}

const OPERATOR_GLYPH: Record<string, string> = { '+': '+', '-': '−', '*': '×', '/': '÷', '%': '%' };

/** The expression as typed, localized: "12.500 ÷ 4". */
export function formatExpression(expr: string, f: MoneyFormatter): string {
  return expr
    .replace(/\d*\.?\d+|\d+\./g, (m) => groupNumber(m, f))
    .replace(/[+\-*/%]/g, (m) => (m === '%' ? '%' : ` ${OPERATOR_GLYPH[m]} `))
    .trim();
}

/**
 * What the big display shows: the number as typed while there's no operator
 * (so "12," and "12,50" look right mid-typing), otherwise the live result.
 */
export function formatDisplay(expr: string, f: MoneyFormatter): string {
  if (!hasOperator(expr)) return groupNumber(expr === '' ? '0' : expr, f);
  const cents = exprToCents(expr);
  if (cents === null) return '0';
  const sign = cents < 0 ? '−' : '';
  const abs = Math.abs(cents);
  return sign + (abs % 100 === 0 ? f.formatNumber(abs) : groupNumber(centsToExpr(abs), f));
}
