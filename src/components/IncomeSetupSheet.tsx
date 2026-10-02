import { Banknote, ChevronRight, Gauge, Laptop } from 'lucide-react';
import { useState } from 'react';
import { useUi } from '../state/ui';
import { IncomeEstimateSheet } from './IncomeEstimateSheet';
import { IncomeRuleSheet } from './IncomeRuleSheet';
import { Sheet } from './Sheet';

/** "How do you get paid?": the three ways to tell the app about income, depending on how yours arrives. */
export function IncomeSetupSheet({ onClose }: { onClose: () => void }) {
  const ui = useUi();
  const [step, setStep] = useState<'choose' | 'fixed' | 'estimate'>('choose');

  if (step === 'fixed') return <IncomeRuleSheet id="new" onClose={onClose} />;
  if (step === 'estimate') return <IncomeEstimateSheet onClose={onClose} />;

  return (
    <Sheet title="¿Cómo cobras?" onClose={onClose}>
      <div className="stack">
        <p className="muted">Con tus ingresos te digo cuánto te queda cada mes y si tus metas entran. Elige lo que se parezca más a ti.</p>

        <button type="button" className="kind-card" onClick={() => setStep('fixed')}>
          <span className="kind-card__icon kind-card__icon--in" aria-hidden="true">
            <Banknote size={26} />
          </span>
          <span className="kind-card__text">
            <strong>Tengo un sueldo fijo</strong>
            <span>Lo cargas una vez y se anota solo todos los meses.</span>
          </span>
          <ChevronRight size={20} className="row__chev" aria-hidden="true" />
        </button>

        <button
          type="button"
          className="kind-card"
          onClick={() => {
            ui.setEntryKind('income');
            ui.setTab('calc');
            onClose();
          }}
        >
          <span className="kind-card__icon kind-card__icon--in" aria-hidden="true">
            <Laptop size={26} />
          </span>
          <span className="kind-card__text">
            <strong>Cobro por trabajo</strong>
            <span>Freelance, changas o ventas: anotas cada ingreso cuando te entra.</span>
          </span>
          <ChevronRight size={20} className="row__chev" aria-hidden="true" />
        </button>

        <button type="button" className="kind-card" onClick={() => setStep('estimate')}>
          <span className="kind-card__icon" aria-hidden="true">
            <Gauge size={26} />
          </span>
          <span className="kind-card__text">
            <strong>Prefiero un número aproximado</strong>
            <span>Sin anotar nada: me dices más o menos cuánto cobras al mes.</span>
          </span>
          <ChevronRight size={20} className="row__chev" aria-hidden="true" />
        </button>
      </div>
    </Sheet>
  );
}
