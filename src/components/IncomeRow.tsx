import { Repeat } from 'lucide-react';
import type { CSSProperties } from 'react';
import { colorVar } from '../lib/categories';
import { incomeSource } from '../lib/incomeSources';
import type { MoneyFormatter } from '../lib/money';
import type { Income } from '../lib/types';

interface IncomeRowProps {
  income: Income;
  fmt: MoneyFormatter;
  onOpen: (id: string) => void;
}

export function IncomeRow({ income, fmt, onOpen }: IncomeRowProps) {
  const source = incomeSource(income.sourceId);
  return (
    <button type="button" className="row row--in" onClick={() => onOpen(income.id)}>
      <span className="badge badge--in" style={{ '--badge-color': colorVar(source.color) } as CSSProperties}>
        {source.emoji}
      </span>
      <span className="row__main">
        <span className="row__title">{income.note || source.name}</span>
        <span className="row__sub">
          {income.note ? source.name : 'Ingreso'}
          {income.ruleId && (
            <>
              {' · '}
              <Repeat size={11} aria-hidden="true" style={{ verticalAlign: '-1px' }} /> Fijo
            </>
          )}
        </span>
      </span>
      <span className="row__end row__end--in tnum">+{fmt.format(income.amount)}</span>
    </button>
  );
}
