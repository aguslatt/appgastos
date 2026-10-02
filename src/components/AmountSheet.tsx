import { useState, type ReactNode } from 'react';
import { parseAmountText } from '../lib/money';
import type { Cents } from '../lib/types';
import { useFmt } from '../state/derived';
import { Sheet } from './Sheet';

interface AmountSheetProps {
  title: string;
  label: string;
  hint: ReactNode;
  value: Cents | null;
  placeholder: Cents;
  saveLabel?: string;
  clearLabel?: string;
  onSave: (value: Cents) => void;
  /** When given, a "clear" button appears while a value is set. */
  onClear?: () => void;
  onClose: () => void;
}

/** A sheet with a single amount field: used for the monthly budget and income. */
export function AmountSheet({ title, label, hint, value, placeholder, saveLabel = 'Guardar', clearLabel = 'Quitar', onSave, onClear, onClose }: AmountSheetProps) {
  const fmt = useFmt();
  const [text, setText] = useState(value ? String(value / 100).replace('.', fmt.decimalSeparator) : '');
  const parsed = text.trim() === '' ? null : parseAmountText(text);
  const invalid = text.trim() !== '' && (parsed === null || parsed <= 0);
  const save = () => {
    if (parsed !== null && !invalid) onSave(parsed);
  };

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="stack">
        <label className="field">
          <span className="field__label">{label}</span>
          <input
            className="input"
            inputMode="decimal"
            autoFocus
            placeholder={`Ej: ${fmt.formatNumber(placeholder)}`}
            value={text}
            aria-invalid={invalid}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <span className="field__hint">{invalid ? 'Escribe un monto válido' : hint}</span>
        </label>
        <button className="btn btn--block" disabled={invalid || parsed === null} onClick={save}>
          {saveLabel}
        </button>
        {value !== null && onClear && (
          <button className="btn btn--ghost btn--block" onClick={onClear}>
            {clearLabel}
          </button>
        )}
      </div>
    </Sheet>
  );
}
