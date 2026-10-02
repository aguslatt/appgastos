import { normalizeData } from './data';
import type { MoneyFormatter } from './money';
import type { AppData } from './types';

export const BACKUP_APP_ID = 'appgastos';

export interface MergeResult {
  data: AppData;
  addedExpenses: number;
  addedCategories: number;
  addedRecurring: number;
  addedGoals: number;
}

/**
 * Adds whatever the backup has that we don't (matched by id) and leaves the
 * current settings alone, so importing never destroys anything.
 */
export function mergeData(current: AppData, incoming: AppData): MergeResult {
  const categoryIds = new Set(current.categories.map((c) => c.id));
  const expenseIds = new Set(current.expenses.map((e) => e.id));
  const recurringIds = new Set(current.recurring.map((r) => r.id));
  const goalIds = new Set(current.goals.map((g) => g.id));
  const categories = incoming.categories.filter((c) => !categoryIds.has(c.id));
  const expenses = incoming.expenses.filter((e) => !expenseIds.has(e.id));
  const recurring = incoming.recurring.filter((r) => !recurringIds.has(r.id));
  const goals = incoming.goals.filter((g) => !goalIds.has(g.id));
  return {
    data: {
      ...current,
      categories: [...current.categories, ...categories],
      expenses: [...current.expenses, ...expenses],
      recurring: [...current.recurring, ...recurring],
      goals: [...current.goals, ...goals],
      settings: { ...current.settings, onboarded: current.settings.onboarded || expenses.length > 0 },
    },
    addedExpenses: expenses.length,
    addedCategories: categories.length,
    addedRecurring: recurring.length,
    addedGoals: goals.length,
  };
}

export function serializeBackup(data: AppData, now: Date = new Date()): string {
  return JSON.stringify({ app: BACKUP_APP_ID, exportedAt: now.toISOString(), ...data }, null, 2);
}

/** Reads a backup file's text; returns null when it isn't one of ours. */
export function parseBackup(text: string, makeId: () => string): AppData | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!looksLikeOurBackup(raw)) return null;
  return normalizeData(raw, { makeId });
}

/**
 * Stricter than `normalizeData`, which also loads saved state and so forgives a lot: a file the
 * user picks must really look like one of ours, because the next step offers to replace everything.
 */
function looksLikeOurBackup(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  // A file that names a different app is somebody else's export, whatever else it contains.
  if ('app' in obj && obj.app !== BACKUP_APP_ID) return false;
  const settings = obj.settings;
  if (Array.isArray(obj.expenses) || (typeof settings === 'object' && settings !== null && !Array.isArray(settings))) return true;
  // Otherwise the only evidence can be folders, and at least one must look like ours.
  return Array.isArray(obj.categories) && obj.categories.some((c) => typeof c === 'object' && c !== null && typeof (c as { id?: unknown }).id === 'string' && (c as { id: string }).id.trim() !== '');
}

export function backupFileName(kind: 'json' | 'csv', today: string): string {
  return `cuanto-${today}.${kind}`;
}

const csvCell = (value: string): string => {
  // A leading = + - @ makes spreadsheets treat the cell as a formula; neutralize it.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Spreadsheet-friendly export (semicolon separated, decimal comma, UTF-8 with BOM) so Excel in Spanish opens it right. */
export function expensesToCsv(data: AppData, f: MoneyFormatter): string {
  const names = new Map(data.categories.map((c) => [c.id, c.name]));
  const amount = (cents: number): string => {
    const whole = Math.floor(cents / 100);
    const frac = cents % 100;
    return frac === 0 ? String(whole) : `${whole}${f.decimalSeparator}${String(frac).padStart(2, '0')}`;
  };
  const rows = [...data.expenses]
    .sort((a, b) => (a.date === b.date ? a.createdAt - b.createdAt : a.date < b.date ? -1 : 1))
    .map((e) =>
      [e.date, csvCell(names.get(e.categoryId) ?? ''), csvCell(e.note), amount(e.amount), f.currency].join(';'),
    );
  return '﻿' + ['Fecha;Carpeta;Concepto;Monto;Moneda', ...rows].join('\r\n') + '\r\n';
}
