import { useMemo } from 'react';
import { capitalize, formatLongDate } from '../lib/dates';
import { sumIncomes } from '../lib/income';
import { sumAmounts } from '../lib/stats';
import type { DateStr } from '../lib/types';
import { useCategoryMap, useFmt } from '../state/derived';
import { useData } from '../state/store';
import { useUi } from '../state/ui';
import { Art } from './Art';
import { ExpenseRow } from './ExpenseRow';
import { IncomeRow } from './IncomeRow';
import { Sheet } from './Sheet';

/** What was spent, and what came in, on one day. */
export function DaySheet({ date, onClose }: { date: DateStr; onClose: () => void }) {
  const { expenses, incomes, settings } = useData();
  const fmt = useFmt();
  const categories = useCategoryMap();
  const ui = useUi();
  const spent = useMemo(() => expenses.filter((e) => e.date === date).sort((a, b) => b.createdAt - a.createdAt), [expenses, date]);
  const earned = useMemo(() => incomes.filter((i) => i.date === date).sort((a, b) => b.createdAt - a.createdAt), [incomes, date]);

  return (
    <Sheet title={capitalize(formatLongDate(date, settings.locale))} onClose={onClose}>
      {spent.length === 0 && earned.length === 0 ? (
        <div className="empty">
          <Art name="sprout" className="empty__art" />
          <div className="empty__title">Sin movimientos este día</div>
          <p className="empty__text">Nada anotado. Un día en verde.</p>
        </div>
      ) : (
        <div className="stack">
          {spent.length > 0 && (
            <>
              <p className="day-total">
                <span className="muted">Gastado en el día</span> <strong>{fmt.format(sumAmounts(spent))}</strong>
              </p>
              <div className="list">
                {spent.map((e) => (
                  <ExpenseRow key={e.id} expense={e} category={categories.get(e.categoryId)} fmt={fmt} onOpen={(id) => ui.editExpense(id)} />
                ))}
              </div>
            </>
          )}
          {earned.length > 0 && (
            <>
              <p className="day-total">
                <span className="muted">Entró en el día</span> <strong className="day-total__in">+{fmt.format(sumIncomes(earned))}</strong>
              </p>
              <div className="list">
                {earned.map((i) => (
                  <IncomeRow key={i.id} income={i} fmt={fmt} onOpen={(id) => ui.editIncome(id)} />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
