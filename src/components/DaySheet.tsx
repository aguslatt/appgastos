import { useMemo } from 'react';
import { capitalize, formatLongDate } from '../lib/dates';
import { sumAmounts } from '../lib/stats';
import type { DateStr } from '../lib/types';
import { useCategoryMap, useFmt } from '../state/derived';
import { useData } from '../state/store';
import { useUi } from '../state/ui';
import { ExpenseRow } from './ExpenseRow';
import { Sheet } from './Sheet';

/** What was spent on one day. */
export function DaySheet({ date, onClose }: { date: DateStr; onClose: () => void }) {
  const { expenses, settings } = useData();
  const fmt = useFmt();
  const categories = useCategoryMap();
  const ui = useUi();
  const list = useMemo(() => expenses.filter((e) => e.date === date).sort((a, b) => b.createdAt - a.createdAt), [expenses, date]);

  return (
    <Sheet title={capitalize(formatLongDate(date, settings.locale))} onClose={onClose}>
      {list.length === 0 ? (
        <div className="empty">
          <span style={{ fontSize: 40 }} aria-hidden="true">
            🌿
          </span>
          <div className="empty__title">Sin gastos este día</div>
          <p className="empty__text">Nada anotado. Un día en verde.</p>
        </div>
      ) : (
        <div className="stack">
          <p className="day-total">
            <span className="muted">Total del día</span> <strong>{fmt.format(sumAmounts(list))}</strong>
          </p>
          <div className="list">
            {list.map((e) => (
              <ExpenseRow key={e.id} expense={e} category={categories.get(e.categoryId)} fmt={fmt} onOpen={(id) => ui.editExpense(id)} />
            ))}
          </div>
        </div>
      )}
    </Sheet>
  );
}
