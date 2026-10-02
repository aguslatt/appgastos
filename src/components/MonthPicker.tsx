import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, formatMonthLabel } from '../lib/dates';
import type { MonthKey } from '../lib/types';

interface MonthPickerProps {
  value: MonthKey;
  min: MonthKey;
  max: MonthKey;
  locale: string;
  label: string;
  onChange: (month: MonthKey) => void;
}

export function MonthPicker({ value, min, max, locale, label, onChange }: MonthPickerProps) {
  return (
    <div className="mpicker" role="group" aria-label={label}>
      <button type="button" className="icon-btn" aria-label="Mes anterior" disabled={value <= min} onClick={() => onChange(addMonths(value, -1))}>
        <ChevronLeft size={20} />
      </button>
      <output aria-live="polite">{formatMonthLabel(value, locale)}</output>
      <button type="button" className="icon-btn" aria-label="Mes siguiente" disabled={value >= max} onClick={() => onChange(addMonths(value, 1))}>
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
