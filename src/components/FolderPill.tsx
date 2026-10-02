import { Sparkles } from 'lucide-react';
import type { CSSProperties } from 'react';
import { colorVar } from '../lib/categories';
import type { Category } from '../lib/types';
import { cx } from './cx';

interface FolderPillProps {
  category: Category;
  suggested?: boolean;
  selected?: boolean;
  /** Why the AI picked it, shown as a tooltip. */
  reason?: string;
  onClick: () => void;
}

export function FolderPill({ category, suggested, selected, reason, onClick }: FolderPillProps) {
  return (
    <button
      type="button"
      className={cx('pill', suggested && 'pill--suggested', selected && 'pill--selected')}
      style={{ '--pill-color': colorVar(category.color) } as CSSProperties}
      onClick={onClick}
      title={reason}
      aria-pressed={selected}
      aria-label={suggested ? `${category.name} (sugerida)` : category.name}
    >
      <span className="pill__emoji" aria-hidden="true">
        {category.emoji}
      </span>
      {category.name}
      {suggested && (
        <span className="pill__spark" aria-hidden="true">
          <Sparkles size={12} />
        </span>
      )}
    </button>
  );
}
