import { Trash2 } from 'lucide-react';
import { store, useData } from '../state/store';
import { useFmt } from '../state/derived';
import { useUi } from '../state/ui';
import { CalcEntry, type EntryResult } from './CalcEntry';
import { Sheet } from './Sheet';

/** Edit or delete an existing expense, using the same calculator as for a new one. */
export function ExpenseSheet() {
  const ui = useUi();
  const { expenses, categories } = useData();
  const fmt = useFmt();
  const expense = expenses.find((e) => e.id === ui.expenseId);
  if (!expense) return null;

  const close = () => ui.editExpense(null);

  const save = (r: EntryResult) => {
    store.updateExpense(expense.id, { amount: r.amount, categoryId: r.categoryId, note: r.note, date: r.date });
    ui.toast({ text: 'Cambios guardados' });
    close();
  };

  const remove = () => {
    const removed = store.deleteExpense(expense.id);
    close();
    if (!removed) return;
    const cat = categories.find((c) => c.id === removed.categoryId);
    ui.toast({
      text: `Eliminado: ${fmt.format(removed.amount)}${cat ? ` · ${cat.emoji} ${cat.name}` : ''}`,
      actionLabel: 'Deshacer',
      onAction: () => store.restoreExpense(removed),
    });
  };

  return (
    <Sheet
      full
      flush
      title="Editar gasto"
      onClose={close}
      action={
        <button className="icon-btn icon-btn--plain" aria-label="Eliminar gasto" onClick={remove}>
          <Trash2 size={22} />
        </button>
      }
    >
      <CalcEntry mode="edit" initial={{ amount: expense.amount, categoryId: expense.categoryId, note: expense.note, date: expense.date }} onSubmit={save} />
    </Sheet>
  );
}
