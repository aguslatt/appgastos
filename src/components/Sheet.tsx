import { X } from 'lucide-react';
import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayHistory } from '../state/overlay';
import { cx } from './cx';
import { useFocusTrap } from './useFocusTrap';

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Covers the whole app instead of rising from the bottom. */
  full?: boolean;
  /** Extra control next to the close button. */
  action?: ReactNode;
  /** No padding around the content (for content that lays itself out). */
  flush?: boolean;
}

/** A panel that rises from the bottom. Mount it to open it, unmount it to close it. */
export function Sheet({ title, onClose, children, full, action, flush }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  useOverlayHistory(true, onClose);
  useFocusTrap(ref, onClose);

  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className={cx('sheet', full && 'sheet--full')} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="sheet__handle" aria-hidden="true" />
        <div className="sheet__header">
          <h2 className="sheet__title">{title}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {action}
            <button className="icon-btn icon-btn--plain" aria-label="Cerrar" onClick={onClose}>
              <X size={22} />
            </button>
          </div>
        </div>
        <div className={cx('sheet__body', flush && 'sheet__body--flush')}>{children}</div>
      </div>
    </>,
    overlayRoot(),
  );
}

/** Overlays live in a layer inside the app frame so they line up with it on wide screens. */
export function overlayRoot(): HTMLElement {
  return document.getElementById('overlay-root') ?? document.body;
}
