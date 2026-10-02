import { Search, X } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { Art } from '../components/Art';
import { ExpenseRow } from '../components/ExpenseRow';
import { IncomeRow } from '../components/IncomeRow';
import { MonthSwitcher } from '../components/MonthSwitcher';
import { useMonthNav } from '../components/useMonthNav';
import { useSwipe } from '../components/useSwipe';
import { cx } from '../components/cx';
import { normalize } from '../lib/classifier';
import { colorVar } from '../lib/categories';
import { formatDayHeading, monthName } from '../lib/dates';
import { sumIncomes } from '../lib/income';
import { incomeSource } from '../lib/incomeSources';
import { sumAmounts } from '../lib/stats';
import type { Expense, Income } from '../lib/types';
import { useCategoryMap, useFmt, useToday } from '../state/derived';
import { useData } from '../state/store';
import { useUi } from '../state/ui';

type Kind = 'all' | 'expense' | 'income';
type Movement = { type: 'expense'; item: Expense } | { type: 'income'; item: Income };

const KINDS: Array<{ id: Kind; label: string }> = [
  { id: 'all', label: 'Todo' },
  { id: 'expense', label: 'Gastos' },
  { id: 'income', label: 'Ingresos' },
];

export function HistoryScreen() {
  const ui = useUi();
  const { expenses, incomes, settings } = useData();
  const fmt = useFmt();
  const today = useToday();
  const categories = useCategoryMap();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [source, setSource] = useState<string | null>(null);
  const folder = ui.historyFolder;
  const locale = settings.locale;
  const nav = useMonthNav();
  const swipe = useSwipe({ left: nav.next, right: nav.prev });

  const spentOfMonth = useMemo(() => expenses.filter((e) => e.date.startsWith(ui.month)), [expenses, ui.month]);
  const incomeOfMonth = useMemo(() => incomes.filter((i) => i.date.startsWith(ui.month)), [incomes, ui.month]);

  // What can filter this list: the folders with spending, or (when looking at incomes) the sources with income.
  const folderChips = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of spentOfMonth) totals.set(e.categoryId, (totals.get(e.categoryId) ?? 0) + e.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => categories.get(id)).filter((c) => c !== undefined);
  }, [spentOfMonth, categories]);
  const sourceChips = useMemo(() => {
    const totals = new Map<string, number>();
    for (const i of incomeOfMonth) totals.set(i.sourceId, (totals.get(i.sourceId) ?? 0) + i.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => incomeSource(id));
  }, [incomeOfMonth]);
  const showSources = kind === 'income';

  const filtered = useMemo<Movement[]>(() => {
    const q = normalize(query);
    const digits = query.replace(/\D/g, '');
    const matches = (note: string, group: string, amount: number): boolean =>
      (!q && !digits) ||
      (q.length > 0 && (normalize(note).includes(q) || normalize(group).includes(q))) ||
      (digits.length > 0 && String(Math.round(amount / 100)).includes(digits));

    const out: Movement[] = [];
    // Choosing a folder means looking at spending in it, so incomes step aside.
    if (kind !== 'income') {
      for (const e of spentOfMonth) {
        if (folder && e.categoryId !== folder) continue;
        if (matches(e.note, categories.get(e.categoryId)?.name ?? '', e.amount)) out.push({ type: 'expense', item: e });
      }
    }
    if (kind !== 'expense' && !folder) {
      for (const i of incomeOfMonth) {
        if (source && i.sourceId !== source) continue;
        if (matches(i.note, incomeSource(i.sourceId).name, i.amount)) out.push({ type: 'income', item: i });
      }
    }
    return out;
  }, [spentOfMonth, incomeOfMonth, kind, folder, source, query, categories]);

  const groups = useMemo(() => {
    const byDate = new Map<string, Movement[]>();
    for (const m of filtered) byDate.set(m.item.date, [...(byDate.get(m.item.date) ?? []), m]);
    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, list]) => ({
        date,
        list: list.sort((a, b) => b.item.createdAt - a.item.createdAt),
        spent: sumAmounts(list.flatMap((m) => (m.type === 'expense' ? [m.item] : []))),
        earned: sumIncomes(list.flatMap((m) => (m.type === 'income' ? [m.item] : []))),
      }));
  }, [filtered]);

  const filtering = query.trim() !== '' || folder !== null || source !== null;
  const selected = folder ? categories.get(folder) : undefined;
  const totalSpent = sumAmounts(filtered.flatMap((m) => (m.type === 'expense' ? [m.item] : [])));
  const totalEarned = sumIncomes(filtered.flatMap((m) => (m.type === 'income' ? [m.item] : [])));
  const nothingAtAll = spentOfMonth.length === 0 && incomeOfMonth.length === 0;

  const pickKind = (next: Kind) => {
    setKind(next);
    setSource(null);
    if (next === 'income') ui.setHistoryFolder(null);
  };

  return (
    <div className="history" {...swipe}>
      <div className="history__top">
        <div className="screen__head">
          <MonthSwitcher />
        </div>
        <label className="search">
          <Search size={18} aria-hidden="true" />
          <input type="search" placeholder="Buscar por concepto, carpeta o monto" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Buscar movimientos" />
          {query && (
            <button type="button" aria-label="Borrar búsqueda" onClick={() => setQuery('')}>
              <X size={18} />
            </button>
          )}
        </label>

        {incomes.length > 0 && (
          <div className="segmented history__kinds" role="group" aria-label="Tipo de movimiento">
            {KINDS.map((k) => (
              <button key={k.id} type="button" className="segmented__item" aria-pressed={kind === k.id} onClick={() => pickKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
        )}

        {showSources
          ? sourceChips.length > 1 && (
              <div className="chips-row" role="group" aria-label="Filtrar por tipo de ingreso">
                <button type="button" className={cx('fchip', source === null && 'is-on')} aria-pressed={source === null} onClick={() => setSource(null)}>
                  Todos
                </button>
                {sourceChips.map((s) => (
                  <button key={s.id} type="button" className={cx('fchip', source === s.id && 'is-on')} style={{ '--dot': colorVar(s.color) } as CSSProperties} aria-pressed={source === s.id} onClick={() => setSource(source === s.id ? null : s.id)}>
                    <span aria-hidden="true">{s.emoji}</span>
                    {s.name}
                  </button>
                ))}
              </div>
            )
          : folderChips.length > 0 && (
              <div className="chips-row" role="group" aria-label="Filtrar por carpeta">
                <button type="button" className={cx('fchip', folder === null && 'is-on')} aria-pressed={folder === null} onClick={() => ui.setHistoryFolder(null)}>
                  Todas
                </button>
                {folderChips.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={cx('fchip', folder === c.id && 'is-on')}
                    style={{ '--dot': colorVar(c.color) } as CSSProperties}
                    aria-pressed={folder === c.id}
                    onClick={() => ui.setHistoryFolder(folder === c.id ? null : c.id)}
                  >
                    <span aria-hidden="true">{c.emoji}</span>
                    {c.name}
                  </button>
                ))}
              </div>
            )}

        {filtered.length > 0 && (
          <p className="history__summary">
            {filtered.length} {filtered.length === 1 ? 'movimiento' : 'movimientos'}
            {selected ? ` en ${selected.name}` : ''}
            {totalSpent > 0 && (
              <>
                {' · '}
                {totalEarned > 0 ? 'gastos ' : ''}
                <strong>{fmt.formatRounded(totalSpent)}</strong>
              </>
            )}
            {totalEarned > 0 && (
              <>
                {' · ingresos '}
                <strong className="history__in">+{fmt.formatRounded(totalEarned)}</strong>
              </>
            )}
          </p>
        )}
      </div>

      <div key={ui.month} className="history__list" data-dir={ui.monthDir}>
        {groups.length === 0 ? (
          <div className="empty">
            <Art name={filtering ? 'search' : nothingAtAll ? 'wallet' : 'sprout'} className="empty__art" />
            <div className="empty__title">{filtering ? 'Nada coincide' : `Sin movimientos en ${monthName(ui.month, locale)}`}</div>
            <p className="empty__text">{filtering ? 'Prueba con otra palabra o quita el filtro.' : 'Cuando anotes un gasto o un ingreso, aparece acá.'}</p>
            {filtering ? (
              <button
                className="btn btn--soft btn--small"
                onClick={() => {
                  setQuery('');
                  setSource(null);
                  ui.setHistoryFolder(null);
                }}
              >
                Quitar filtros
              </button>
            ) : (
              <button className="btn btn--small" onClick={() => ui.setTab('calc')}>
                Anotar un gasto
              </button>
            )}
          </div>
        ) : (
          groups.map((g, index) => (
            <section key={g.date} className="day reveal" style={{ '--i': Math.min(index, 6) } as CSSProperties}>
              <h2 className="day__head">
                <span>{formatDayHeading(g.date, today, locale)}</span>
                <span className="day__sums tnum">
                  {g.spent > 0 && <span>{fmt.formatRounded(g.spent)}</span>}
                  {g.earned > 0 && <span className="day__in">+{fmt.formatRounded(g.earned)}</span>}
                </span>
              </h2>
              <div className="list">
                {g.list.map((m) =>
                  m.type === 'expense' ? (
                    <ExpenseRow key={m.item.id} expense={m.item} category={categories.get(m.item.categoryId)} fmt={fmt} onOpen={(id) => ui.editExpense(id)} />
                  ) : (
                    <IncomeRow key={m.item.id} income={m.item} fmt={fmt} onOpen={(id) => ui.editIncome(id)} />
                  ),
                )}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
