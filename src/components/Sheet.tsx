import { X } from 'lucide-react';
import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
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
  /** Stays in view under a long form: the buttons that finish the job. */
  footer?: ReactNode;
}

/** How far (px) or how fast (px/ms) a downward drag has to go to close the sheet. */
const DISMISS_DISTANCE = 120;
const DISMISS_SPEED = 0.7;

/** A panel that rises from the bottom and can be dragged back down by its handle. Mount it to open it, unmount it to close it. */
export function Sheet({ title, onClose, children, full, action, flush, footer }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startY: number; lastY: number; lastT: number; speed: number } | null>(null);
  const timer = useRef<number | null>(null);
  useOverlayHistory(true, onClose);
  useFocusTrap(ref, onClose);
  // A drag that is still sliding the sheet away when something else closes it must not close it twice.
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);

  const follow = (dy: number) => {
    const sheet = ref.current;
    if (!sheet) return;
    sheet.style.transform = dy > 0 ? `translateY(${dy}px)` : '';
    if (backdrop.current) backdrop.current.style.opacity = String(Math.max(0.15, 1 - dy / (sheet.offsetHeight || 600)));
  };

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return; // the buttons in the header stay buttons
    drag.current = { startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, speed: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    ref.current?.classList.add('is-dragging');
  };

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.speed = (e.clientY - d.lastY) / dt;
    d.lastY = e.clientY;
    d.lastT = e.timeStamp;
    follow(Math.max(0, e.clientY - d.startY));
  };

  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    const sheet = ref.current;
    if (!d || !sheet) return;
    const dy = Math.max(0, e.clientY - d.startY);
    sheet.classList.remove('is-dragging');
    sheet.classList.add('is-settling');
    if (dy > DISMISS_DISTANCE || (dy > 24 && d.speed > DISMISS_SPEED)) {
      sheet.style.transform = `translateY(${sheet.offsetHeight}px)`;
      if (backdrop.current) backdrop.current.style.opacity = '0';
      timer.current = window.setTimeout(onClose, 220);
    } else {
      follow(0);
      timer.current = window.setTimeout(() => sheet.classList.remove('is-settling'), 320);
    }
  };

  return createPortal(
    <>
      <div ref={backdrop} className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={ref} className={cx('sheet', full && 'sheet--full')} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
        <div className="sheet__grab" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
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
        </div>
        <div className={cx('sheet__body', flush && 'sheet__body--flush')}>{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </>,
    overlayRoot(),
  );
}

/** Overlays live in a layer inside the app frame so they line up with it on wide screens. */
export function overlayRoot(): HTMLElement {
  return document.getElementById('overlay-root') ?? document.body;
}
