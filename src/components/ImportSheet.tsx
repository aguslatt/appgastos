import type { AppData } from '../lib/types';
import { store } from '../state/store';
import { useUi } from '../state/ui';
import { Sheet } from './Sheet';

/** After picking a backup file: add it to what's here, or replace everything with it. */
export function ImportSheet({ incoming, onClose }: { incoming: AppData; onClose: () => void }) {
  const ui = useUi();
  const merge = () => {
    const r = store.mergeIn(incoming);
    ui.toast({ text: r.addedExpenses === 0 ? 'No había nada nuevo para agregar' : `Se agregaron ${r.addedExpenses} gastos` });
    onClose();
  };
  const replace = async () => {
    const ok = await ui.confirm({
      title: '¿Reemplazar todo?',
      text: 'Se borra lo que hay ahora en este teléfono y queda solo lo de la copia.',
      confirmLabel: 'Reemplazar',
      danger: true,
    });
    if (!ok) return;
    store.replaceAll(incoming);
    ui.toast({ text: 'Copia restaurada' });
    onClose();
  };

  return (
    <Sheet title="Importar copia" onClose={onClose}>
      <div className="stack">
        <p>
          La copia tiene <strong>{incoming.expenses.length}</strong> gastos, <strong>{incoming.categories.length}</strong> carpetas y <strong>{incoming.recurring.length}</strong> pagos fijos.
        </p>
        <button className="btn btn--block" onClick={merge}>
          Combinar con lo que ya tengo
        </button>
        <p className="field__hint" style={{ marginTop: -6 }}>
          Agrega lo que falta y no toca nada de lo actual. Es lo más seguro.
        </p>
        <button className="btn btn--ghost btn--block" onClick={replace}>
          Reemplazar todo
        </button>
      </div>
    </Sheet>
  );
}
