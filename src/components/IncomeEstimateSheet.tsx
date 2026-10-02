import { store, useData } from '../state/store';
import { useFmt } from '../state/derived';
import { useUi } from '../state/ui';
import { AmountSheet } from './AmountSheet';

/**
 * A rough monthly income, for people who don't want to record theirs. It lets the goals and the "hours of
 * work" line do their sums; real incomes and fixed incomes take over as soon as there are any.
 */
export function IncomeEstimateSheet({ onClose }: { onClose: () => void }) {
  const { settings } = useData();
  const fmt = useFmt();
  const ui = useUi();
  return (
    <AmountSheet
      title="Ingreso mensual estimado"
      label="¿Cuánto cobras al mes, más o menos?"
      hint="Es un número aproximado y no sale del teléfono. Sirve para las metas y para mostrar cuántas horas de trabajo cuesta cada gasto. Si anotas tus ingresos o cargas un sueldo fijo, la app usa esos datos."
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
