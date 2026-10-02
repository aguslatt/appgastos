import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { HOME_LABELS, countryName, estimateMove, type HomeSize, type MoveAnswer, type MoveResult } from '../lib/ai';
import { useFmt, useToday } from '../state/derived';
import { useAiConfig } from '../state/ai';
import { useData } from '../state/store';
import { useUi } from '../state/ui';
import { AiPanel } from './AiPanel';
import { AiSources, ConfidenceChip, useAiTask } from './AiShared';
import { cx } from './cx';

const HOMES = Object.keys(HOME_LABELS) as HomeSize[];
const months = (n: number) => `${n} ${n === 1 ? 'mes' : 'meses'}`;

/** An answer together with what it was asked for: the zone can change in the form while the answer is on screen. */
interface Outcome {
  place: string;
  home: HomeSize;
  result: MoveResult;
}

/** Looks up typical rent, fees and move-in costs for the zone typed in the form, and offers to fill them in. */
export function MoveAi({ zone, onApply }: { zone: string; onApply: (answer: MoveAnswer) => void }) {
  const { settings } = useData();
  const config = useAiConfig();
  const today = useToday();
  const fmt = useFmt();
  const ui = useUi();
  const task = useAiTask<Outcome>();
  const [home, setHome] = useState<HomeSize>('1br');
  const [applied, setApplied] = useState(false);
  const place = zone.trim();

  const search = () => {
    if (!config || !place) return;
    setApplied(false);
    void task.run(async ({ signal, onProgress }) => ({
      place,
      home,
      result: await estimateMove({ zone: place, home, currency: settings.currency, country: countryName(settings.locale), today }, { key: config.key, model: config.model, signal, onProgress }),
    }));
  };

  const apply = (answer: MoveAnswer) => {
    onApply(answer);
    setApplied(true);
    ui.haptic('ok');
    ui.toast({ text: 'Valores cargados', detail: 'Ajústalos si ves otros precios.' });
  };

  return (
    <AiPanel
      title="Buscar precios con IA"
      task={task}
      onRetry={search}
      controls={
        <>
          <p className="ai__lead">Busco avisos reales de esa zona y completo alquiler, expensas y costos de entrada. Después los puedes ajustar.</p>
          <div className="field">
            <span className="field__label">Tipo de lugar</span>
            <div className="ai__choices" role="radiogroup" aria-label="Tipo de lugar">
              {HOMES.map((h) => (
                <button key={h} type="button" role="radio" aria-checked={home === h} className={cx('ai__choice', home === h && 'is-on')} onClick={() => setHome(h)}>
                  {HOME_LABELS[h]}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="btn btn--block" disabled={!place} onClick={search}>
            <Sparkles size={18} aria-hidden="true" />
            Buscar precios de la zona
          </button>
          {!place && <span className="field__hint">Escribe la zona o el barrio arriba.</span>}
        </>
      }
      result={({ place: asked, home: size, result: r }) => (
        <div className="ai__result">
          <p className="ai__for">
            {asked} · {HOME_LABELS[size]}
          </p>
          <div className="ai__result-head">
            <ConfidenceChip confidence={r.confidence} />
            <span>{r.live ? 'Con búsqueda en internet' : 'Sin búsqueda en vivo'}</span>
          </div>
          <ul className="estimate--plain">
            <li>
              <span>Alquiler típico</span>
              <b className="tnum">{fmt.formatRounded(r.rent)}</b>
            </li>
            {r.rentHigh > r.rentLow && (
              <li>
                <span>Rango de avisos</span>
                <span className="tnum">
                  {fmt.formatRounded(r.rentLow)} – {fmt.formatRounded(r.rentHigh)}
                </span>
              </li>
            )}
            <li>
              <span>Expensas y servicios</span>
              <b className="tnum">{r.monthlyExtras > 0 ? fmt.formatRounded(r.monthlyExtras) : 'Sin dato'}</b>
            </li>
            <li className="ai__entry">
              <span>Para entrar</span>
              <span>
                Depósito {months(r.depositMonths)} · Comisión {months(r.commissionMonths)} · Adelanto {months(r.advanceMonths)}
              </span>
            </li>
          </ul>
          {r.notes && <p className="ai__notes">{r.notes}</p>}
          <AiSources sources={r.sources} live={r.live} />
          <div className="ai__actions">
            <button type="button" className="btn btn--block" disabled={applied} onClick={() => apply(r)}>
              {applied ? 'Cargado en el formulario' : 'Usar estos valores'}
            </button>
            <button type="button" className="btn btn--ghost btn--block" onClick={applied ? search : task.reset}>
              {applied ? 'Volver a buscar' : 'Descartar'}
            </button>
          </div>
        </div>
      )}
    />
  );
}
