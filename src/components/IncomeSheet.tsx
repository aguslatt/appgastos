import { store, useData } from '../state/store';
import { useFmt } from '../state/derived';
import { useUi } from '../state/ui';
import { AmountSheet } from './AmountSheet';

/** Optional monthly income: only used to tell what a purchase costs in hours of work. */
export function IncomeSheet({ onClose }: { onClose: () => void }) {
  const { settings } = useData();
  const fmt = useFmt();
  const ui = useUi();
  return (
    <AmountSheet
      title="Ingreso mensual"
      label="¿Cuánto cobras al mes, más o menos?"
      hint="Es opcional y no sale del teléfono. Sirve para mostrar, al anotar, cuántas horas de trabajo cuesta cada gasto."
      value={settings.monthlyIncome}
      placeholder={1_200_000_00}
      onSave={(v) => {
        store.updateSettings({ monthlyIncome: v });
        ui.haptic('ok');
        ui.toast({ text: `Ingreso: ${fmt.formatRounded(v)} por mes` });
        onClose();
      }}
      onClear={() => {
        store.updateSettings({ monthlyIncome: null });
        ui.toast({ text: 'Ingreso quitado' });
        onClose();
      }}
      onClose={onClose}
    />
  );
}
