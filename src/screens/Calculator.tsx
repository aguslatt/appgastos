import { CalcEntry, type EntryResult } from '../components/CalcEntry';
import { incomeSource } from '../lib/incomeSources';
import { useFmt } from '../state/derived';
import { store, useData } from '../state/store';
import { useUi } from '../state/ui';

/** The home screen: a calculator that files what you type, as a spending or as an income. */
export function CalculatorScreen() {
  const { categories } = useData();
  const fmt = useFmt();
  const ui = useUi();

  const onSubmit = (r: EntryResult) => {
    const corrected = r.note !== '' && r.suggestedId !== null && r.suggestedId !== r.categoryId;

    if (ui.entryKind === 'income') {
      const income = store.addIncome({ amount: r.amount, sourceId: r.categoryId, note: r.note, date: r.date });
      const source = incomeSource(income.sourceId);
      ui.toast({
        text: `+${fmt.format(r.amount)} → ${source.emoji} ${source.name}`,
        detail: corrected ? `Aprendí que «${r.note}» va en ${source.name}` : undefined,
        actionLabel: 'Deshacer',
        onAction: () => store.deleteIncome(income.id),
      });
      return;
    }

    const expense = store.addExpense({ amount: r.amount, categoryId: r.categoryId, note: r.note, date: r.date });
    const folder = categories.find((c) => c.id === r.categoryId);
    ui.toast({
      text: `${fmt.format(r.amount)} → ${folder ? `${folder.emoji} ${folder.name}` : 'guardado'}`,
      detail: corrected ? `Aprendí que «${r.note}» va en ${folder?.name}` : undefined,
      actionLabel: 'Deshacer',
      onAction: () => store.deleteExpense(expense.id),
    });
  };

  return <CalcEntry mode="new" kind={ui.entryKind} onKindChange={ui.setEntryKind} onSubmit={onSubmit} />;
}
