import { Minus, Plus } from 'lucide-react';

interface StepperProps {
  value: number;
  min: number;
  max: number;
  label: string;
  suffix?: string;
  onChange: (value: number) => void;
}

export function Stepper({ value, min, max, label, suffix, onChange }: StepperProps) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="icon-btn" aria-label={`Menos ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
        <Minus size={20} />
      </button>
      <output className="stepper__value" aria-live="polite">
        {value}
        {suffix && <small>{suffix}</small>}
      </output>
      <button type="button" className="icon-btn" aria-label={`Más ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
        <Plus size={20} />
      </button>
    </div>
  );
}
