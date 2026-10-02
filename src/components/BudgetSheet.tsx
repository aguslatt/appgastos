import { store, useData } from '../state/store';
import { useFmt } from '../state/derived';
import { useUi } from '../state/ui';
import { AmountSheet } from './AmountSheet';

/** Set (or clear) the monthly budget. */
export function BudgetSheet({ onClose }: { onClose: () => void }) {
  const { settings } = useData();
  const fmt = useFmt();
  const ui = useUi();
  return (
    <AmountSheet
      title="Presupuesto del mes"
      label="¿Cuánto es el tope de gasto mensual?"
      hint="Con esto, al anotar cada gasto se ve cuánto queda por día."
      value={settings.monthlyBudget}
      placeholder={800_000_00}
      onSave={(v) => {
        store.updateSettings({ monthlyBudget: v });
        ui.haptic('ok');
        ui.toast({ text: `Presupuesto: ${fmt.formatRounded(v)} por mes` });
        onClose();
      }}
      onClear={() => {
        store.updateSettings({ monthlyBudget: null });
        ui.toast({ text: 'Presupuesto quitado' });
        onClose();
      }}
      onClose={onClose}
    />
  );
}
