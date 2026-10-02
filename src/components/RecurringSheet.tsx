import { Minus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { parseAmountText } from '../lib/money';
import { firstMonthFor } from '../lib/recurring';
import { rankFolders } from '../lib/suggest';
import { useClassifier, useFmt, useToday } from '../state/derived';
import { store, useData } from '../state/store';
import { useUi } from '../state/ui';
import { FolderPill } from './FolderPill';
import { Sheet } from './Sheet';

/** Add or edit a fixed monthly expense (rent, subscriptions...): it gets recorded by itself on its day. */
export function RecurringSheet({ id, onClose }: { id: string | 'new'; onClose: () => void }) {
  const { recurring, categories, expenses } = useData();
  const today = useToday();
  const fmt = useFmt();
  const ui = useUi();
  const classifier = useClassifier();
  const existing = id === 'new' ? undefined : recurring.find((r) => r.id === id);

  const [amountText, setAmountText] = useState(existing ? String(existing.amount / 100).replace('.', fmt.decimalSeparator) : '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [day, setDay] = useState(existing?.day ?? Number(today.slice(8, 10)));
  const [picked, setPicked] = useState<string | null>(existing?.categoryId ?? null);
  const [active, setActive] = useState(existing?.active ?? true);

  const amount = amountText.trim() === '' ? null : parseAmountText(amountText);
  const amountInvalid = amountText.trim() !== '' && (amount === null || amount <= 0);
  const suggestion = note.trim() ? classifier.suggest(note) : null;
  const folderId = picked ?? suggestion?.categoryId ?? null;
  const valid = amount !== null && amount > 0 && folderId !== null;
  const folders = rankFolders(categories, expenses, today);

  const save = () => {
    if (!valid || amount === null || folderId === null) return;
    if (existing) {
      store.updateRecurring(existing.id, { amount, categoryId: folderId, note, day, active }, today);
      ui.toast({ text: 'Pago fijo actualizado' });
    } else {
      store.addRecurring({ amount, categoryId: folderId, note, day, startMonth: firstMonthFor(day, today) });
      store.runRecurring(today);
      ui.toast({ text: `Listo: se anota solo el día ${day} de cada mes` });
    }
    ui.haptic('ok');
    onClose();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await ui.confirm({
      title: '¿Eliminar este pago fijo?',
      text: 'Deja de anotarse solo. Lo ya anotado se queda como está.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    store.deleteRecurring(existing.id);
    ui.toast({ text: 'Pago fijo eliminado' });
    onClose();
  };

  return (
    <Sheet
      title={existing ? 'Editar pago fijo' : 'Nuevo pago fijo'}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--block" disabled={!valid} onClick={save}>
            {existing ? 'Guardar cambios' : 'Crear pago fijo'}
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
        <label className="field">
          <span className="field__label">Monto</span>
          <input className="input" inputMode="decimal" placeholder={`Ej: ${fmt.formatNumber(400_000_00)}`} value={amountText} aria-invalid={amountInvalid} onChange={(e) => setAmountText(e.target.value)} />
        </label>

        <label className="field">
          <span className="field__label">¿Qué es?</span>
          <input className="input" maxLength={80} placeholder="Ej: Alquiler, Netflix, Gimnasio" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>

        <div className="field">
          <span className="field__label">Carpeta</span>
          <div className="pill-wrap">
            {folders.map((c) => (
              <FolderPill key={c.id} category={c} suggested={picked === null && suggestion?.categoryId === c.id} selected={folderId === c.id && (picked !== null || suggestion?.categoryId !== c.id)} onClick={() => setPicked(c.id)} />
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Se anota el día</span>
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

        {existing && (
          <div className="row row--plain">
            <div className="row__main">
              <div className="row__title">Activo</div>
              <div className="row__sub">Pausa para que no se anote por un tiempo.</div>
            </div>
            <button type="button" role="switch" aria-checked={active} aria-label="Activo" className="switch" onClick={() => setActive((v) => !v)} />
          </div>
        )}

      </div>
    </Sheet>
  );
}
