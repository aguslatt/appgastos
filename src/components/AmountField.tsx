import type { ReactNode } from 'react';
import { parseAmountText } from '../lib/money';
import type { Cents } from '../lib/types';

/** Parses a field that may be left empty: `value` is null when empty, `invalid` when there's text we can't use. */
export function parseOptionalAmount(text: string): { value: Cents | null; invalid: boolean } {
  if (text.trim() === '') return { value: null, invalid: false };
  const value = parseAmountText(text);
  return value === null || value <= 0 ? { value: null, invalid: true } : { value, invalid: false };
}

interface AmountFieldProps {
  label: string;
  text: string;
  onText: (text: string) => void;
  placeholder?: string;
  hint?: ReactNode;
  invalid?: boolean;
}

export function AmountField({ label, text, onText, placeholder, hint, invalid }: AmountFieldProps) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input className="input" inputMode="decimal" placeholder={placeholder} value={text} aria-invalid={invalid} onChange={(e) => onText(e.target.value)} />
      {(invalid || hint) && <span className="field__hint">{invalid ? 'Escribe un monto válido' : hint}</span>}
    </label>
  );
}
