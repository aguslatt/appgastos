import { describe, expect, it } from 'vitest';
import { defaultCategories } from './categories';
import { rankFolders } from './suggest';
import type { Expense } from './types';

const cats = defaultCategories();
let n = 0;
const e = (date: string, categoryId: string): Expense => ({ id: `s${n++}`, amount: 100, categoryId, note: '', date, createdAt: 0, updatedAt: 0 });
const ids = (list: { id: string }[]) => list.map((c) => c.id);

describe('rankFolders', () => {
  it('keeps the default order when nothing has been used', () => {
    expect(ids(rankFolders(cats, [], '2026-10-15'))).toEqual(ids(cats));
  });

  it('puts the most used folders first', () => {
    const history = [e('2026-10-14', 'ocio'), e('2026-10-13', 'ocio'), e('2026-10-12', 'ocio'), e('2026-10-14', 'salud')];
    expect(ids(rankFolders(cats, history, '2026-10-15')).slice(0, 2)).toEqual(['ocio', 'salud']);
  });

  it('prefers recent use over old use', () => {
    const history = [e('2026-10-14', 'salud'), e('2026-07-01', 'ocio'), e('2026-07-02', 'ocio'), e('2026-07-03', 'ocio')];
    expect(ids(rankFolders(cats, history, '2026-10-15'))[0]).toBe('salud');
  });

  it('hides archived folders', () => {
    const archived = cats.map((c) => (c.id === 'super' ? { ...c, archived: true } : c));
    expect(ids(rankFolders(archived, [], '2026-10-15'))).not.toContain('super');
  });

  it('ignores expenses dated in the future without breaking', () => {
    expect(() => rankFolders(cats, [e('2026-12-01', 'ocio')], '2026-10-15')).not.toThrow();
  });
});
