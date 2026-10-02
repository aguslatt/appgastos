import { Minus, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { dateInMonth, monthKeyOf } from '../lib/dates';
import { incomeSourceFolders } from '../lib/incomeSources';
import { parseAmountText } from '../lib/money';
import { firstMonthFor } from '../lib/recurring';
import { useFmt, useToday } from '../state/derived';
import { store, useData } from '../state/store';
import { useUi } from '../state/ui';
import { FolderPill } from './FolderPill';
import { Sheet } from './Sheet';

/**
 * Add or edit a fixed income, like a salary: set it once and it is recorded by itself on its day,
 * every month, so the month always shows what came in without lifting a finger.
 */
export function IncomeRuleSheet({ id, onClose }: { id: string | 'new'; onClose: () => void }) {
  const { incomeRules } = useData();
  const today = useToday();
  const fmt = useFmt();
  const ui = useUi();
  const sources = useMemo(() => incomeSourceFolders(), []);
  const existing = id === 'new' ? undefined : incomeRules.find((r) => r.id === id);

  const [amountText, setAmountText] = useState(existing ? String(existing.amount / 100).replace('.', fmt.decimalSeparator) : '');
  const [note, setNote] = useState(existing?.note ?? (id === 'new' ? 'Sueldo' : ''));
  const [day, setDay] = useState(existing?.day ?? 1);
  const [sourceId, setSourceId] = useState(existing?.sourceId ?? 'sueldo');
  const [active, setActive] = useState(existing?.active ?? true);
  const [alreadyPaid, setAlreadyPaid] = useState(true);

  const amount = amountText.trim() === '' ? null : parseAmountText(amountText);
  const amountInvalid = amountText.trim() !== '' && (amount === null || amount <= 0);
  const valid = amount !== null && amount > 0;
  // Only a payday that already went by this month needs the question: was it already paid?
  const askAlreadyPaid = !existing && dateInMonth(monthKeyOf(today), day) < today;

  const save = () => {
    if (!valid || amount === null) return;
    if (existing) {
      store.updateIncomeRule(existing.id, { amount, sourceId, note, day, active }, today);
      ui.toast({ text: 'Ingreso fijo actualizado' });
    } else {
      const startMonth = askAlreadyPaid && alreadyPaid ? monthKeyOf(today) : firstMonthFor(day, today);
      store.addIncomeRule({ amount, sourceId, note, day, startMonth });
      const recorded = store.runIncomeRules(today);
      ui.toast({ text: recorded > 0 ? `Listo: ya sumé ${fmt.formatRounded(amount)} a este mes y se anota solo cada mes` : `Listo: se anota solo el día ${day} de cada mes` });
    }
    ui.haptic('ok');
    onClose();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await ui.confirm({
      title: '¿Eliminar este ingreso fijo?',
      text: 'Deja de anotarse solo. Lo que ya se anotó se queda como está.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    store.deleteIncomeRule(existing.id);
    ui.toast({ text: 'Ingreso fijo eliminado' });
    onClose();
  };

  return (
    <Sheet
      title={existing ? 'Editar ingreso fijo' : 'Sueldo o ingreso fijo'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--block" disabled={!valid} onClick={save}>
            {existing ? 'Guardar cambios' : 'Crear ingreso fijo'}
          </button>
          {existing && (
            <button className="btn btn--ghost btn--block" onClick={remove}>
              <Trash2 size={18} />
              Eliminar
            </button>
          )}
        </>
      }
    >
      <div className="stack">
        {!existing && <p className="muted">Lo cargas una vez y la app lo anota sola cada mes, el día que te pagan.</p>}

        <label className="field">
          <span className="field__label">¿Cuánto cobras por mes?</span>
          <input className="input" inputMode="decimal" autoFocus={!existing} placeholder={`Ej: ${fmt.formatNumber(1_200_000_00)}`} value={amountText} aria-invalid={amountInvalid} onChange={(e) => setAmountText(e.target.value)} />
          <span className="field__hint">{amountInvalid ? 'Escribe un monto válido' : 'Lo que te llega a la mano, ya con descuentos.'}</span>
        </label>

        <label className="field">
          <span className="field__label">¿De qué es?</span>
          <input className="input" maxLength={80} placeholder="Ej: Sueldo, Cliente fijo, Alquiler" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="field">
          <span className="field__label">Tipo</span>
          <div className="pill-wrap">
            {sources.map((c) => (
              <FolderPill key={c.id} category={c} selected={sourceId === c.id} onClick={() => setSourceId(c.id)} />
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Te pagan el día</span>
          <div className="stepper">
            <button type="button" className="icon-btn" aria-label="Un día antes" onClick={() => setDay((d) => Math.max(1, d - 1))}>
              <Minus size={20} />
            </button>
            <output className="stepper__value" aria-live="polite">
              {day}
            </output>
            <button type="button" className="icon-btn" aria-label="Un día después" onClick={() => setDay((d) => Math.min(31, d + 1))}>
              <Plus size={20} />
            </button>
          </div>
          <span className="field__hint">De cada mes. Si el mes no tiene ese día, se anota el último.</span>
        </div>

        {askAlreadyPaid && (
          <div className="row row--plain">
            <div className="row__main">
              <div className="row__title">Ya me llegó este mes</div>
              <div className="row__sub">{alreadyPaid ? 'Lo sumo a este mes ahora mismo.' : 'Empiezo a anotarlo el mes que viene.'}</div>
            </div>
            <button type="button" role="switch" aria-checked={alreadyPaid} aria-label="Ya me llegó este mes" className="switch" onClick={() => setAlreadyPaid((v) => !v)} />
          </div>
        )}

        {existing && (
          <div className="row row--plain">
            <div className="row__main">
              <div className="row__title">Activo</div>
              <div className="row__sub">Pausa si dejas de cobrarlo por un tiempo.</div>
            </div>
            <button type="button" role="switch" aria-checked={active} aria-label="Activo" className="switch" onClick={() => setActive((v) => !v)} />
          </div>
        )}

      </div>
    </Sheet>
  );
}
