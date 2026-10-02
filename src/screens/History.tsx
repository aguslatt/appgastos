import { Search, X } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { ExpenseRow } from '../components/ExpenseRow';
import { MonthSwitcher } from '../components/MonthSwitcher';
import { cx } from '../components/cx';
import { normalize } from '../lib/classifier';
import { colorVar } from '../lib/categories';
import { formatDayHeading, monthName } from '../lib/dates';
import { sumAmounts } from '../lib/stats';
import type { Expense } from '../lib/types';
import { useCategoryMap, useFmt, useToday } from '../state/derived';
import { useData } from '../state/store';
import { useUi } from '../state/ui';

export function HistoryScreen() {
  const ui = useUi();
  const { expenses, settings } = useData();
  const fmt = useFmt();
  const today = useToday();
  const categories = useCategoryMap();
  const [query, setQuery] = useState('');
  const folder = ui.historyFolder;
  const locale = settings.locale;

  const ofMonth = useMemo(() => expenses.filter((e) => e.date.startsWith(ui.month)), [expenses, ui.month]);

  // Folders that have something this month, biggest first, as filter chips.
  const folderChips = useMemo(() => {
    const totals = new Map<string, number>();
    for (const e of ofMonth) totals.set(e.categoryId, (totals.get(e.categoryId) ?? 0) + e.amount);
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => categories.get(id)).filter((c) => c !== undefined);
  }, [ofMonth, categories]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    const digits = query.replace(/\D/g, '');
    return ofMonth.filter((e) => {
      if (folder && e.categoryId !== folder) return false;
      if (!q && !digits) return true;
      const folderName = categories.get(e.categoryId)?.name ?? '';
      return (
        (q.length > 0 && (normalize(e.note).includes(q) || normalize(folderName).includes(q))) ||
        (digits.length > 0 && String(Math.round(e.amount / 100)).includes(digits))
      );
    });
  }, [ofMonth, folder, query, categories]);

  const groups = useMemo(() => {
    const byDate = new Map<string, Expense[]>();
    for (const e of filtered) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
    return [...byDate.entries()]
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([date, list]) => ({ date, list: list.sort((a, b) => b.createdAt - a.createdAt), total: sumAmounts(list) }));
  }, [filtered]);

  const filtering = query.trim() !== '' || folder !== null;
  const selected = folder ? categories.get(folder) : undefined;

  return (
    <div className="history">
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
        {folderChips.length > 0 && (
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
            {selected ? ` en ${selected.name}` : ''} · <strong>{fmt.formatRounded(sumAmounts(filtered))}</strong>
          </p>
        )}
      </div>

      <div className="history__list">
        {groups.length === 0 ? (
          <div className="empty">
            <span style={{ fontSize: 44 }} aria-hidden="true">
              {filtering ? '🔎' : '🌱'}
            </span>
            <div className="empty__title">{filtering ? 'Nada coincide' : `Sin movimientos en ${monthName(ui.month, locale)}`}</div>
            <p className="empty__text">
              {filtering ? 'Prueba con otra palabra o quita el filtro.' : 'Cuando anotes un gasto, aparece acá.'}
            </p>
            {filtering ? (
              <button
                className="btn btn--soft btn--small"
                onClick={() => {
                  setQuery('');
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
          groups.map((g) => (
            <section key={g.date} className="day">
              <h2 className="day__head">
                <span>{formatDayHeading(g.date, today, locale)}</span>
                <span className="tnum">{fmt.formatRounded(g.total)}</span>
              </h2>
              <div className="list">
                {g.list.map((e) => (
                  <ExpenseRow key={e.id} expense={e} category={categories.get(e.categoryId)} fmt={fmt} onOpen={(id) => ui.editExpense(id)} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
