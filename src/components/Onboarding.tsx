import { ChevronRight } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { todayStr } from '../lib/dates';
import { generateDemo } from '../lib/demo';
import { CURRENCIES, parseAmountText } from '../lib/money';
import { useInstall } from '../state/install';
import { store, useData } from '../state/store';
import { cx } from './cx';

type Theme = 'green' | 'deep' | 'lime' | 'cream';

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
  const setup = step === SLIDES.length;
  const slide = SLIDES[step];
  const budget = budgetText.trim() === '' ? null : parseAmountText(budgetText);
  const budgetInvalid = budgetText.trim() !== '' && (budget === null || budget <= 0);

  const finish = (withDemo = false) => {
    store.updateSettings({ currency, monthlyBudget: budgetInvalid ? null : budget, onboarded: true });
    if (withDemo) {
      store.addDemoExpenses(generateDemo({ today: todayStr(), currency, categories }));
    }
    // Ask the browser not to clear our data when space is tight (best effort).
    void navigator.storage?.persist?.();
  };

  return (
    <div className="story ob" data-theme={setup ? 'cream' : slide?.theme}>
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
            <button className="btn btn--dark btn--block" disabled={budgetInvalid} onClick={() => finish()}>
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
    </div>
  );
}
