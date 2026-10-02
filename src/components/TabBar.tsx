import { Calculator, LayoutGrid, ReceiptText, Settings, Target, type LucideIcon } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useUi, type Tab } from '../state/ui';

export const TABS: Array<{ id: Tab; label: string; Icon: LucideIcon }> = [
  { id: 'calc', label: 'Anotar', Icon: Calculator },
  { id: 'month', label: 'Mes', Icon: LayoutGrid },
  { id: 'goals', label: 'Metas', Icon: Target },
  { id: 'history', label: 'Historial', Icon: ReceiptText },
  { id: 'settings', label: 'Ajustes', Icon: Settings },
];

/** A floating bar; the highlight behind the current tab slides over to the next one (`--i` is its index). */
export function TabBar() {
  const { tab, setTab, haptic } = useUi();
  const index = Math.max(0, TABS.findIndex((t) => t.id === tab));
  return (
    <nav className="tabbar" aria-label="Secciones" style={{ '--i': index } as CSSProperties}>
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className="tab"
          aria-current={tab === id ? 'page' : undefined}
          onClick={() => {
            if (tab !== id) haptic('tap');
            setTab(id);
          }}
        >
          <span className="tab__icon">
            <Icon size={22} strokeWidth={tab === id ? 2.6 : 2.1} aria-hidden="true" />
          </span>
          {label}
        </button>
      ))}
    </nav>
  );
}
