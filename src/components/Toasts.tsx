import { cx } from './cx';
import { useUi } from '../state/ui';

export function Toasts() {
  const { toasts, dismissToast } = useUi();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx('toast', t.tone === 'bad' && 'toast--bad')}>
          <span className="toast__text">
            {t.text}
            {t.detail && <span className="toast__detail">{t.detail}</span>}
          </span>
          {t.actionLabel && (
            <button
              className="toast__action"
              onClick={() => {
                t.onAction?.();
                dismissToast(t.id);
              }}
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
