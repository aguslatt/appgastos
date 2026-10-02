import { ChevronDown } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { colorVar } from '../../lib/categories';
import type { MoneyFormatter } from '../../lib/money';
import type { Category, Cents } from '../../lib/types';
import { cx } from '../cx';
import { Donut } from './Donut';

export interface BreakdownItem {
  categoryId: string;
  category: Category | undefined;
  total: Cents;
  share: number;
}

interface FolderBreakdownProps {
  items: readonly BreakdownItem[];
  fmt: MoneyFormatter;
  onOpen: (categoryId: string) => void;
}

const SHOWN = 5;

/** Part-to-whole: a ring for the top folders, then a row per folder (the rows are the readable version of the ring). */
export function FolderBreakdown({ items, fmt, onOpen }: FolderBreakdownProps) {
  const [all, setAll] = useState(false);
  const top = items.slice(0, SHOWN);
  const restShare = items.slice(SHOWN).reduce((a, i) => a + i.share, 0);
  const slices = [
    ...top.map((i) => ({ key: i.categoryId, share: i.share, color: colorVar(i.category?.color ?? 'slate') })),
    ...(restShare > 0 ? [{ key: 'rest', share: restShare, color: 'var(--rest)' }] : []),
  ];
  const total = items.reduce((a, i) => a + i.total, 0);
  const lead = items[0];
  const biggest = lead?.share ?? 1;
  const rows = all ? items : items.slice(0, SHOWN + 1);

  return (
    <div className="breakdown">
      <div className="breakdown__top">
        <Donut slices={slices} centre={{ value: fmt.formatCompact(total), caption: 'gastado' }} />
        {lead && (
          <div className="breakdown__lead">
            <span className="kicker">Lo que más pesa</span>
            <strong>
              <span aria-hidden="true">{lead.category?.emoji ?? '📦'}</span> {lead.category?.name ?? 'Sin carpeta'}
            </strong>
            <span className="breakdown__share">{Math.round(lead.share * 100)}% del mes</span>
          </div>
        )}
      </div>
      <ul className="breakdown__list">
        {rows.map((it) => (
          <li key={it.categoryId}>
            <button type="button" className="brow" onClick={() => onOpen(it.categoryId)}>
              <span className="badge" style={{ '--badge-color': colorVar(it.category?.color ?? 'slate') } as CSSProperties}>
                {it.category?.emoji ?? '📦'}
              </span>
              <span className="brow__main">
                <span className="brow__top">
                  <span className="brow__name">{it.category?.name ?? 'Sin carpeta'}</span>
                  <span className="brow__amount tnum">{fmt.formatRounded(it.total)}</span>
                </span>
                <span className="brow__bar">
                  <i style={{ width: `${Math.max(2, (it.share / biggest) * 100)}%`, background: colorVar(it.category?.color ?? 'slate') }} />
                </span>
                <span className="brow__pct">{Math.round(it.share * 100)}% del mes</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > SHOWN + 1 && (
        <button type="button" className={cx('btn btn--soft btn--small', 'breakdown__more')} onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? 'Ver menos' : `Ver las ${items.length} carpetas`}
          <ChevronDown size={16} style={{ transform: all ? 'rotate(180deg)' : undefined }} />
        </button>
      )}
    </div>
  );
}
