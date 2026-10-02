import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { useOverlayHistory } from '../state/overlay';
import { useUi } from '../state/ui';
import { cx } from './cx';
import { overlayRoot } from './Sheet';
import { useFocusTrap } from './useFocusTrap';

export function ConfirmDialog() {
  const { confirmState } = useUi();
  if (!confirmState) return null;
  return <Dialog key="confirm" {...confirmState} />;
}

function Dialog({ options, resolve }: NonNullable<ReturnType<typeof useUi>['confirmState']>) {
  const ref = useRef<HTMLDivElement>(null);
  const cancel = () => resolve(false);
  useOverlayHistory(true, cancel);
  useFocusTrap(ref, cancel);

  return createPortal(
    <div className="dialog" onClick={cancel}>
      <div ref={ref} className="dialog__box" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog__title" id="dlg-title">
          {options.title}
        </h2>
        {options.text && <p className="dialog__text">{options.text}</p>}
        <div className="dialog__actions">
          <button className="btn btn--soft" onClick={cancel}>
            {options.cancelLabel ?? 'Cancelar'}
          </button>
          <button className={cx('btn', options.danger && 'btn--danger')} onClick={() => resolve(true)}>
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    overlayRoot(),
  );
}
