import { CalcEntry, type EntryResult } from '../components/CalcEntry';
import { useFmt } from '../state/derived';
import { store, useData } from '../state/store';
import { useUi } from '../state/ui';

/** The home screen: a calculator that files what you type. */
export function CalculatorScreen() {
  const { categories } = useData();
  const fmt = useFmt();
  const ui = useUi();

  const onSubmit = (r: EntryResult) => {
    const expense = store.addExpense({ amount: r.amount, categoryId: r.categoryId, note: r.note, date: r.date });
    const folder = categories.find((c) => c.id === r.categoryId);
    const corrected = r.note !== '' && r.suggestedId !== null && r.suggestedId !== r.categoryId;
    ui.toast({
      text: `${fmt.format(r.amount)} → ${folder ? `${folder.emoji} ${folder.name}` : 'guardado'}`,
      detail: corrected ? `Aprendí que «${r.note}» va en ${folder?.name}` : undefined,
      actionLabel: 'Deshacer',
      onAction: () => store.deleteExpense(expense.id),
    });
  };

  return <CalcEntry mode="new" onSubmit={onSubmit} />;
}
