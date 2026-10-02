import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { countryName, estimateTripPrices, type TripAnswer, type TripResult } from '../lib/ai';
import { getMoneyFormatter } from '../lib/money';
import type { TripStyle } from '../lib/trips';
import type { MonthKey } from '../lib/types';
import { aiConfig, useAiConfig } from '../state/ai';
import { useFmt, useToday } from '../state/derived';
import { useData } from '../state/store';
import { useUi } from '../state/ui';
import { AiPanel } from './AiPanel';
import { AiSources, ConfidenceChip, useAiTask } from './AiShared';

/** What the form takes from an answer: a flight, a transfer price and a daily price for each stop that got one. */
export interface TripPrices {
  flightUsd: number;
  hopUsd: number | null;
  prices: Array<{ place: string; dailyUsd: number }>;
}

interface Props {
  /** The stops that count: with a name and at least one day. */
  stops: ReadonlyArray<{ place: string; days: number }>;
  people: number;
  style: TripStyle;
  month: MonthKey;
  /** Units of the app currency per US dollar; null when it is not known yet. */
  fx: number | null;
  onApply: (prices: TripPrices) => void;
}

/** An answer together with the itinerary it was asked for: the form can change while the answer is on screen. */
interface Outcome {
  asked: Array<{ place: string; days: number }>;
  result: TripResult;
}

const toPrices = (answer: TripAnswer, asked: ReadonlyArray<{ place: string }>): TripPrices => ({
  flightUsd: answer.flightUsd,
  hopUsd: answer.hopUsd,
  prices: asked.flatMap((s, i) => {
    const dailyUsd = answer.daily[i];
    return dailyUsd === null || dailyUsd === undefined ? [] : [{ place: s.place, dailyUsd }];
  }),
});

/** Looks up today's flight and daily prices for the itinerary in the form, and offers to use them. */
export function TripAi({ stops, people, style, month, fx, onApply }: Props) {
  const { settings } = useData();
  const config = useAiConfig();
  const today = useToday();
  const fmt = useFmt();
  const ui = useUi();
  const task = useAiTask<Outcome>();
  const [origin, setOrigin] = useState(config?.origin ?? '');
  const [applied, setApplied] = useState(false);
  const usd = getMoneyFormatter(settings.locale, 'USD');
  const reason = stops.length === 0 ? 'Escribe al menos un destino arriba.' : fx === null ? 'Pon el valor del dólar arriba para convertir los precios.' : null;

  const search = () => {
    if (!config || reason !== null) return;
    setApplied(false);
    aiConfig.update({ origin: origin.trim() });
    const asked = stops.map((s) => ({ place: s.place, days: s.days }));
    void task.run(async ({ signal, onProgress }) => ({
      asked,
      result: await estimateTripPrices(
        { stops: asked, people, style, origin: origin.trim(), country: countryName(settings.locale), currency: settings.currency, month, today },
        { key: config.key, model: config.model, signal, onProgress },
      ),
    }));
  };

  return (
    <AiPanel
      title="Buscar precios con IA"
      task={task}
      onRetry={search}
      controls={
        <>
          <p className="ai__lead">Busco el pasaje y lo que cuesta un día en cada destino, con precios de ahora, y te los ofrezco para el presupuesto.</p>
          <label className="field">
            <span className="field__label">Sales desde (opcional)</span>
            <input className="input" placeholder="Ej: Buenos Aires" value={origin} maxLength={40} onChange={(e) => setOrigin(e.target.value)} />
            <span className="field__hint">Con la ciudad, el precio del pasaje es mucho más certero.</span>
          </label>
          <button type="button" className="btn btn--block" disabled={reason !== null} onClick={search}>
            <Sparkles size={18} aria-hidden="true" />
            Buscar precios del viaje
          </button>
          {reason && <span className="field__hint">{reason}</span>}
        </>
      }
      result={({ asked: places, result: r }) => {
        const prices = toPrices(r, places);
        const asLocal = (dollars: number) => (settings.currency === 'USD' || fx === null ? null : fmt.formatRounded(Math.round(dollars * fx * 100)));
        return (
          <div className="ai__result">
            <div className="ai__result-head">
              <ConfidenceChip confidence={r.confidence} />
              <span>{r.live ? 'Con búsqueda en internet' : 'Sin búsqueda en vivo'}</span>
            </div>
            <ul className="estimate--plain">
              <li>
                <span>Pasaje ida y vuelta, por persona</span>
                <b className="tnum">
                  {usd.formatRounded(r.flightUsd * 100)}
                  {asLocal(r.flightUsd) && <small className="ai__local"> ≈ {asLocal(r.flightUsd)}</small>}
                </b>
              </li>
              {places.length > 1 && r.hopUsd !== null && (
                <li>
                  <span>Traslado entre ciudades, por persona</span>
                  <b className="tnum">{usd.formatRounded(r.hopUsd * 100)}</b>
                </li>
              )}
              {places.map((s, i) => {
                const daily = r.daily[i];
                return (
                  <li key={`${s.place}-${i}`}>
                    <span>{s.place}, por persona y día</span>
                    {daily === null || daily === undefined ? <span className="muted">Valor de referencia</span> : <b className="tnum">{usd.formatRounded(daily * 100)}</b>}
                  </li>
                );
              })}
            </ul>
            {r.notes && <p className="ai__notes">{r.notes}</p>}
            <AiSources sources={r.sources} live={r.live} />
            <div className="ai__actions">
              <button
                type="button"
                className="btn btn--block"
                disabled={applied}
                onClick={() => {
                  onApply(prices);
                  setApplied(true);
                  ui.haptic('ok');
                  ui.toast({ text: 'Precios cargados', detail: 'Mira el presupuesto abajo; puedes ajustar el pasaje.' });
                }}
              >
                {applied ? 'Cargado en el presupuesto' : 'Usar estos precios'}
              </button>
              <button type="button" className="btn btn--ghost btn--block" onClick={applied ? search : task.reset}>
                {applied ? 'Volver a buscar' : 'Descartar'}
              </button>
            </div>
          </div>
        );
      }}
    />
  );
}
