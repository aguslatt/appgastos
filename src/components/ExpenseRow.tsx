import { Repeat } from 'lucide-react';
import type { CSSProperties } from 'react';
import { colorVar } from '../lib/categories';
import type { MoneyFormatter } from '../lib/money';
import type { Category, Expense } from '../lib/types';

interface ExpenseRowProps {
  expense: Expense;
  category: Category | undefined;
  fmt: MoneyFormatter;
  onOpen: (id: string) => void;
}

export function ExpenseRow({ expense, category, fmt, onOpen }: ExpenseRowProps) {
  const name = category?.name ?? 'Sin carpeta';
  return (
    <button type="button" className="row" onClick={() => onOpen(expense.id)}>
      <span className="badge" style={{ '--badge-color': colorVar(category?.color ?? 'slate') } as CSSProperties}>
        {category?.emoji ?? '📦'}
      </span>
      <span className="row__main">
        <span className="row__title">{expense.note || name}</span>
        <span className="row__sub">
          {expense.note ? name : 'Sin concepto'}
          {expense.recurringId && (
            <>
              {' · '}
              <Repeat size={11} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> Fijo
            </>
          )}
        </span>
      </span>
      <span className="row__end tnum">{fmt.format(expense.amount)}</span>
    </button>
  );
}
