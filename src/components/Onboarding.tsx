import { ChevronRight, Minus, Plus } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { monthKeyOf, todayStr } from '../lib/dates';
import { generateDemo, generateDemoIncomes } from '../lib/demo';
import { CURRENCIES, parseAmountText } from '../lib/money';
import { useInstall } from '../state/install';
import { store, useData } from '../state/store';
import { cx } from './cx';

type Theme = 'green' | 'deep' | 'lime' | 'cream' | 'blue';
type Pay = 'fixed' | 'work' | 'later';

interface Slide {
  theme: Theme;
  kicker: string;
  title: string;
  caption: string;
  chips: Array<{ text: string; tilt: number }>;
}

const SLIDES: Slide[] = [
  {
    theme: 'green',
    kicker: 'HOLA',
    title: 'Anota un gasto en *2 toques*',
    caption: 'Un monto, una carpeta y listo. Sin planillas ni vueltas.',
    chips: [
      { text: '$ 3.500', tilt: -4 },
      { text: '☕ Café', tilt: 3 },
      { text: '🍽️ Comida afuera', tilt: -2 },
    ],
  },
  {
    theme: 'deep',
    kicker: 'IA EN EL TELÉFONO',
    title: 'Escribe o di *«propina»*',
    caption: 'La app entiende y elige la carpeta. Aprende cuando la corriges y no necesita internet.',
    chips: [
      { text: 'propina → 🍽️', tilt: -3 },
      { text: 'uber → 🚌', tilt: 2.5 },
      { text: 'farmacia → 💊', tilt: -1.5 },
    ],
  },
  {
    theme: 'blue',
    kicker: 'LO QUE ENTRA',
    title: 'Anota también *lo que cobras*',
    caption: 'Un sueldo fijo se carga una vez y se anota solo. Si cobras por trabajo, lo anotas cuando te entra. Siempre sabes cuánto te queda.',
    chips: [
      { text: '💼 Sueldo', tilt: -3 },
      { text: '💻 Cliente nuevo', tilt: 2.5 },
      { text: '💰 Te quedan $ 380.000', tilt: -1.5 },
    ],
  },
  {
    theme: 'lime',
    kicker: 'A FIN DE MES',
    title: 'Tu resumen en *historias*',
    caption: '¿Ahorrando o sabotándote? Calendario de calor, datos curiosos y cuánto vas a gastar a este ritmo.',
    chips: [
      { text: '🌿 6 días sin gastar', tilt: 3 },
      { text: '📅 Los viernes, tu día más caro', tilt: -2.5 },
    ],
  },
];

function Headline({ text }: { text: string }) {
  return (
    <h1 className="story__title">
      {text.split('*').map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>))}
    </h1>
  );
}

/** First launch: three short slides, then currency and an optional budget. */
export function Onboarding() {
  const { settings, categories } = useData();
  const install = useInstall();
  const [step, setStep] = useState(0);
  const [currency, setCurrency] = useState(settings.currency);
  const [budgetText, setBudgetText] = useState('');
  const [pay, setPay] = useState<Pay>('later');
  const [salaryText, setSalaryText] = useState('');
  const [payDay, setPayDay] = useState(1);
  const setup = step === SLIDES.length;
  const slide = SLIDES[step];
  const budget = budgetText.trim() === '' ? null : parseAmountText(budgetText);
  const budgetInvalid = budgetText.trim() !== '' && (budget === null || budget <= 0);
  const salary = salaryText.trim() === '' ? null : parseAmountText(salaryText);
  const salaryInvalid = pay === 'fixed' && salaryText.trim() !== '' && (salary === null || salary <= 0);

  const finish = (withDemo = false) => {
    store.updateSettings({ currency, monthlyBudget: budgetInvalid ? null : budget, onboarded: true });
    if (pay === 'fixed' && salary !== null && salary > 0 && !withDemo) {
      // Counted from this month: if payday already went by, this month's pay is recorded right away.
      store.addIncomeRule({ amount: salary, sourceId: 'sueldo', note: 'Sueldo', day: payDay, startMonth: monthKeyOf(todayStr()) });
      store.runIncomeRules(todayStr());
    }
    if (withDemo) {
      store.addDemoExpenses(generateDemo({ today: todayStr(), currency, categories }));
      store.addDemoIncomes(generateDemoIncomes({ today: todayStr(), currency }));
    }
    // Ask the browser not to clear our data when space is tight (best effort).
    void navigator.storage?.persist?.();
  };

  return (
    <main className="story ob" data-theme={setup ? 'cream' : slide?.theme}>
      <div className="story__bars" aria-hidden="true">
        {[...SLIDES, null].map((_, i) => (
          <i key={i} className={cx(i <= step && 'is-done')} />
        ))}
      </div>
      <div className="story__top">
        <span className="story__count">
          {step + 1}/{SLIDES.length + 1}
        </span>
        {!setup && (
          <button type="button" className="ob__skip" onClick={() => setStep(SLIDES.length)}>
            Saltar
          </button>
        )}
      </div>

      <div className="story__body ob__body">
        <div key={step} className="story__slide">
          {slide ? (
            <>
              <p className="kicker">{slide.kicker}</p>
              <Headline text={slide.title} />
              <p className="story__caption">{slide.caption}</p>
              <ul className="story__chips ob__chips">
                {slide.chips.map((c) => (
                  <li key={c.text} style={{ '--tilt': `${c.tilt}deg`, '--dot': 'var(--accent)' } as CSSProperties}>
                    {c.text}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="kicker">ÚLTIMO PASO</p>
              <Headline text="Elige tu *moneda*" />
              <div className="stack ob__form">
                <label className="field">
                  <span className="field__label">Moneda</span>
                  <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    {CURRENCIES.some((c) => c.code === currency) ? null : <option value={currency}>{currency}</option>}
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} · {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Tope de gasto mensual (opcional)</span>
                  <input className="input" inputMode="decimal" placeholder="Lo puedes definir después" value={budgetText} aria-invalid={budgetInvalid} onChange={(e) => setBudgetText(e.target.value)} />
                </label>
                <div className="field">
                  <span className="field__label">¿Cómo cobras?</span>
                  <div className="segmented" role="group" aria-label="Cómo cobras">
                    <button type="button" className="segmented__item" aria-pressed={pay === 'fixed'} onClick={() => setPay('fixed')}>
                      Sueldo fijo
                    </button>
                    <button type="button" className="segmented__item" aria-pressed={pay === 'work'} onClick={() => setPay('work')}>
                      Por trabajo
                    </button>
                    <button type="button" className="segmented__item" aria-pressed={pay === 'later'} onClick={() => setPay('later')}>
                      Después
                    </button>
                  </div>
                </div>
                {pay === 'fixed' && (
                  <>
                    <label className="field">
                      <span className="field__label">Sueldo por mes</span>
                      <input className="input" inputMode="decimal" placeholder="Lo que te llega a la mano" value={salaryText} aria-invalid={salaryInvalid} onChange={(e) => setSalaryText(e.target.value)} />
                    </label>
                    <div className="field">
                      <span className="field__label">Te pagan el día</span>
                      <div className="stepper">
                        <button type="button" className="icon-btn" aria-label="Un día antes" onClick={() => setPayDay((d) => Math.max(1, d - 1))}>
                          <Minus size={20} />
                        </button>
                        <output className="stepper__value" aria-live="polite">
                          {payDay}
                        </output>
                        <button type="button" className="icon-btn" aria-label="Un día después" onClick={() => setPayDay((d) => Math.min(31, d + 1))}>
                          <Plus size={20} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
                {pay === 'work' && <p className="field__hint">Perfecto: cuando te entre plata, cambia a «Ingreso» en la calculadora y anótalo. Así ves cuánto te queda cada mes.</p>}
                {!install.standalone && (install.canPrompt || install.ios) && (
                  <p className="field__hint">
                    {install.ios ? 'Tip: en Safari toca Compartir → «Agregar a pantalla de inicio» para usarla como app.' : 'Tip: instálala desde Ajustes para abrirla como una calculadora.'}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="story__foot ob__foot">
        {setup ? (
          <div className="ob__actions">
            <button className="btn btn--dark btn--block" disabled={budgetInvalid || salaryInvalid} onClick={() => finish()}>
              Empezar
            </button>
            <button className="link-btn" onClick={() => finish(true)}>
              Probar primero con datos de ejemplo
            </button>
          </div>
        ) : (
          <>
            <span />
            <button type="button" className="story__share" onClick={() => setStep((s) => s + 1)}>
              Siguiente
              <ChevronRight size={18} />
            </button>
          </>
        )}
      </div>
    </main>
  );
}
