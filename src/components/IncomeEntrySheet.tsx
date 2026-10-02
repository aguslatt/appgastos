import { Repeat, Trash2 } from 'lucide-react';
import { incomeSource } from '../lib/incomeSources';
import { useFmt } from '../state/derived';
import { store, useData } from '../state/store';
import { useUi } from '../state/ui';
import { CalcEntry, type EntryResult } from './CalcEntry';
import { Sheet } from './Sheet';

/** Edit or delete an income that was already recorded, using the same calculator as for a new one. */
export function IncomeEntrySheet() {
  const ui = useUi();
  const { incomes } = useData();
  const fmt = useFmt();
  const income = incomes.find((i) => i.id === ui.incomeId);
  if (!income) return null;

  const close = () => ui.editIncome(null);

  const save = (r: EntryResult) => {
    store.updateIncome(income.id, { amount: r.amount, sourceId: r.categoryId, note: r.note, date: r.date });
    ui.toast({ text: 'Cambios guardados' });
    close();
  };

  const remove = () => {
    const removed = store.deleteIncome(income.id);
    close();
    if (!removed) return;
    const source = incomeSource(removed.sourceId);
    ui.toast({
      text: `Eliminado: +${fmt.format(removed.amount)} · ${source.emoji} ${source.name}`,
      actionLabel: 'Deshacer',
      onAction: () => store.restoreIncome(removed),
    });
  };

  return (
    <Sheet
      full
      flush
      title="Editar ingreso"
      onClose={close}
      action={
        <button className="icon-btn icon-btn--plain" aria-label="Eliminar ingreso" onClick={remove}>
          <Trash2 size={22} />
        </button>
      }
    >
      <CalcEntry
        mode="edit"
        kind="income"
        initial={{ amount: income.amount, categoryId: income.sourceId, note: income.note, date: income.date }}
        onSubmit={save}
        footer={
          income.ruleId ? (
            <p className="calc__footer muted">
              <Repeat size={13} aria-hidden="true" style={{ verticalAlign: '-2px' }} /> Este ingreso se anotó solo, por tu ingreso fijo. Cambiarlo acá no cambia los próximos meses.
            </p>
          ) : null
        }
      />
    </Sheet>
  );
}
