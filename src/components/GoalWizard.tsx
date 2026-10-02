import { Plane, Home, Target, Plus, X } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { addMonths, monthKeyOf } from '../lib/dates';
import { describeGoal } from '../lib/goalText';
import { goalStatus, moveCosts, moveImpact, requiredPerMonth, totalRequired, type Goal, type GoalKind } from '../lib/goals';
import { searchPlaces, estimateTrip, STYLE_LABELS, type TripStyle } from '../lib/trips';
import type { Cents } from '../lib/types';
import { useFmt, useToday } from '../state/derived';
import { useCapacity } from '../state/goals';
import { store, useData } from '../state/store';
import { useUi } from '../state/ui';
import { AmountField, parseOptionalAmount } from './AmountField';
import { GoalChip } from './GoalChip';
import { MonthPicker } from './MonthPicker';
import { Sheet } from './Sheet';
import { Stepper } from './Stepper';
import { cx } from './cx';

const SAVING_EMOJIS = ['🎯', '🏖️', '🚗', '💍', '🎓', '💻', '🎁', '🐶', '💰', '🛠️'];

interface Stop {
  place: string;
  days: number;
}

/** Create or edit a goal: a trip (with a cost estimate), a move, or any amount to save. */
export function GoalWizard({ goalId, onClose }: { goalId: string | 'new'; onClose: () => void }) {
  const { settings, goals } = useData();
  const existing = goalId === 'new' ? undefined : goals.find((g) => g.id === goalId);
  const today = useToday();
  const fmt = useFmt();
  const ui = useUi();
  const capacity = useCapacity();
  const locale = settings.locale;
  const currentMonth = monthKeyOf(today);
  const minMonth = addMonths(currentMonth, 1);
  const maxMonth = addMonths(currentMonth, 120);
  const dec = fmt.decimalSeparator;
  const toText = (cents: Cents | undefined | null) => (cents ? String(cents / 100).replace('.', dec) : '');

  const [kind, setKind] = useState<GoalKind | null>(existing?.kind ?? null);
  const [name, setName] = useState(existing?.name ?? '');
  const [emoji, setEmoji] = useState(existing?.emoji ?? '🎯');
  const [deadline, setDeadline] = useState(existing?.deadline ?? addMonths(currentMonth, 6));
  const [savedText, setSavedText] = useState(toText(existing?.saved));

  // trip
  const [stops, setStops] = useState<Stop[]>(existing?.trip?.stops.length ? existing.trip.stops : [{ place: '', days: 7 }]);
  const [people, setPeople] = useState(existing?.trip?.people ?? 1);
  const [style, setStyle] = useState<TripStyle>(existing?.trip?.style ?? 'mid');
  const [fxText, setFxText] = useState(toText(existing?.trip?.fx ? Math.round(existing.trip.fx * 100) : settings.fxRate ? Math.round(settings.fxRate * 100) : null));
  const [flightText, setFlightText] = useState(toText(existing?.trip?.flightEach));
  const [extrasText, setExtrasText] = useState(toText(existing?.trip?.extras));
  const [focusedStop, setFocusedStop] = useState<number | null>(null);

  // move
  const move = existing?.move;
  const [zone, setZone] = useState(move?.zone ?? '');
  const [rentText, setRentText] = useState(toText(move?.rent));
  const [feesText, setFeesText] = useState(toText(move?.monthlyExtras));
  const [currentText, setCurrentText] = useState(toText(move?.currentMonthly));
  const [depositM, setDepositM] = useState(move?.depositMonths ?? 1);
  const [commissionM, setCommissionM] = useState(move?.commissionMonths ?? 1);
  const [advanceM, setAdvanceM] = useState(move?.advanceMonths ?? 1);
  const [setupText, setSetupText] = useState(toText(move?.setup));

  // free saving
  const [targetText, setTargetText] = useState(kind === 'saving' ? toText(existing?.target) : '');

  const saved = parseOptionalAmount(savedText);
  const fxField = parseOptionalAmount(fxText);
  const flight = parseOptionalAmount(flightText);
  const extras = parseOptionalAmount(extrasText);
  const rent = parseOptionalAmount(rentText);
  const fees = parseOptionalAmount(feesText);
  const current = parseOptionalAmount(currentText);
  const setup = parseOptionalAmount(setupText);
  const target = parseOptionalAmount(targetText);
  const fx = settings.currency === 'USD' ? 1 : fxField.value !== null ? fxField.value / 100 : null;

  const usedStops = stops.filter((s) => s.place.trim() && s.days > 0);
  const tripEstimate = useMemo(
    () => (kind === 'trip' && fx !== null && usedStops.length > 0 ? estimateTrip({ stops: usedStops, people, style, fxRate: fx, flightEach: flight.value, extras: extras.value ?? 0 }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, fx, JSON.stringify(usedStops), people, style, flight.value, extras.value],
  );
  const movePlan = kind === 'move' && rent.value ? { zone: zone.trim(), rent: rent.value, monthlyExtras: fees.value ?? 0, depositMonths: depositM, commissionMonths: commissionM, advanceMonths: advanceM, setup: setup.value ?? 0, currentMonthly: current.value ?? 0 } : null;
  const costs = movePlan ? moveCosts(movePlan) : null;

  const goalTarget = kind === 'trip' ? (tripEstimate?.total ?? null) : kind === 'move' ? (costs?.upfront ?? null) : target.value;
  const displayName = name.trim() || (kind === 'trip' ? `Viaje a ${usedStops[0]?.place ?? ''}`.trim() : kind === 'move' ? `Mudanza${zone.trim() ? ` a ${zone.trim()}` : ''}` : '');
  const anyInvalid = saved.invalid || flight.invalid || extras.invalid || rent.invalid || fees.invalid || current.invalid || setup.invalid || target.invalid || (kind === 'trip' && settings.currency !== 'USD' && fxField.invalid);
  const valid = kind !== null && goalTarget !== null && goalTarget > 0 && displayName.length > 0 && !anyInvalid && deadline >= minMonth;

  const others = goals.filter((g) => g.id !== existing?.id);
  const committed = totalRequired(others, today);
  const draft: Goal | null = valid && kind && goalTarget !== null ? { id: 'draft', kind, name: displayName, emoji, target: goalTarget, deadline, saved: saved.value ?? 0, createdAt: existing?.createdAt ?? Date.now() } : null;
  const status = draft ? goalStatus(draft, capacity, committed, today) : null;
  const message = draft && status ? describeGoal(draft, status, capacity, committed, fmt, locale) : null;
  const impact = movePlan && status ? moveImpact(movePlan, capacity, requiredPerMonth(draft as Goal, today)) : null;

  const save = () => {
    if (!draft || !kind || goalTarget === null) return;
    const common = { name: displayName, emoji: kind === 'trip' ? '✈️' : kind === 'move' ? '🏠' : emoji, target: goalTarget, deadline, saved: saved.value ?? 0 };
    const trip = kind === 'trip' && fx !== null ? { stops: usedStops, people, style, fx, ...(flight.value && { flightEach: flight.value }), ...(extras.value && { extras: extras.value }) } : undefined;
    if (kind === 'trip' && fx !== null && settings.currency !== 'USD' && settings.fxRate !== fx) store.updateSettings({ fxRate: fx });
    if (existing) store.updateGoal(existing.id, { ...common, kind, trip, move: movePlan ?? undefined });
    else store.addGoal({ kind, ...common, ...(trip && { trip }), ...(movePlan && { move: movePlan }) });
    ui.haptic('ok');
    ui.toast({ text: existing ? 'Meta actualizada' : `Meta creada: guarda ${fmt.formatRounded(requiredPerMonth(draft, today))} por mes` });
    onClose();
  };

  const setStop = (i: number, patch: Partial<Stop>) => setStops((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const picker = (
    <div className="stack">
      <p className="muted">¿Qué quieres lograr?</p>
      {([
        ['trip', Plane, 'Un viaje', 'Destinos, días y estilo: te armo un presupuesto de referencia.'],
        ['move', Home, 'Una mudanza', 'Alquiler, depósito y gastos: cuánto juntar y cómo cambia tu mes.'],
        ['saving', Target, 'Otra meta', 'Un monto y una fecha: te digo cuánto guardar por mes.'],
      ] as const).map(([k, Icon, title, text]) => (
        <button key={k} type="button" className="kind-card" onClick={() => setKind(k)}>
          <span className="kind-card__icon">
            <Icon size={26} />
          </span>
          <span className="kind-card__text">
            <strong>{title}</strong>
            <span>{text}</span>
          </span>
        </button>
      ))}
    </div>
  );

  const when = (
    <div className="field">
      <span className="field__label">{kind === 'trip' ? '¿Cuándo viajas?' : kind === 'move' ? '¿Cuándo te mudas?' : '¿Para cuándo lo quieres?'}</span>
      <MonthPicker value={deadline} min={minMonth} max={maxMonth} locale={locale} label="Fecha" onChange={setDeadline} />
    </div>
  );

  const alreadySaved = <AmountField label="Ya tienes ahorrado (opcional)" text={savedText} onText={setSavedText} invalid={saved.invalid} placeholder="0" />;

  const tripForm = (
    <div className="stack">
      <div className="field">
        <span className="field__label">Destinos y días</span>
        <div className="stops">
          {stops.map((s, i) => {
            const suggestions = focusedStop === i ? searchPlaces(s.place, 4).filter((p) => p.name !== s.place) : [];
            return (
              <div key={i} className="stop">
                <div className="stop__row">
                  <input
                    className="input"
                    placeholder="Ej: Madrid, Roma, Río…"
                    value={s.place}
                    maxLength={40}
                    aria-label={`Destino ${i + 1}`}
                    onFocus={() => setFocusedStop(i)}
                    onBlur={() => window.setTimeout(() => setFocusedStop((f) => (f === i ? null : f)), 150)}
                    onChange={(e) => setStop(i, { place: e.target.value })}
                  />
                  {stops.length > 1 && (
                    <button type="button" className="icon-btn icon-btn--plain" aria-label="Quitar destino" onClick={() => setStops((l) => l.filter((_, j) => j !== i))}>
                      <X size={20} />
                    </button>
                  )}
                </div>
                {suggestions.length > 0 && (
                  <div className="suggest">
                    {suggestions.map((p) => (
                      <button key={p.id} type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => setStop(i, { place: p.name })}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
                <Stepper value={s.days} min={1} max={60} label={`días en destino ${i + 1}`} suffix={s.days === 1 ? ' día' : ' días'} onChange={(days) => setStop(i, { days })} />
              </div>
            );
          })}
        </div>
        {stops.length < 8 && (
          <button type="button" className="btn btn--soft btn--small" onClick={() => setStops((l) => [...l, { place: '', days: 4 }])}>
            <Plus size={16} /> Otro destino
          </button>
        )}
      </div>

      <div className="field">
        <span className="field__label">Personas</span>
        <Stepper value={people} min={1} max={10} label="personas" onChange={setPeople} />
      </div>

      <div className="field">
        <span className="field__label">Estilo de viaje</span>
        <div className="segmented" role="group" aria-label="Estilo de viaje">
          {(Object.keys(STYLE_LABELS) as TripStyle[]).map((s) => (
            <button key={s} type="button" className="segmented__item" aria-pressed={style === s} onClick={() => setStyle(s)}>
              {STYLE_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {settings.currency !== 'USD' && (
        <AmountField
          label={`Dólar: ¿cuántos ${fmt.symbol} vale 1 USD?`}
          text={fxText}
          onText={setFxText}
          invalid={fxField.invalid}
          placeholder="Ej: 1500"
          hint="Los costos de referencia están en dólares. Pon el valor que usas tú."
        />
      )}

      {when}

      <details className="fine">
        <summary>Ajustes finos (pasaje real, compras)</summary>
        <div className="stack" style={{ marginTop: 12 }}>
          <AmountField label="Pasaje ida y vuelta por persona" text={flightText} onText={setFlightText} invalid={flight.invalid} placeholder="Si ya lo viste, ponlo" hint="Si lo dejas vacío uso un valor de referencia." />
          <AmountField label="Compras y extras" text={extrasText} onText={setExtrasText} invalid={extras.invalid} placeholder="Souvenirs, regalos…" />
        </div>
      </details>

      {alreadySaved}
    </div>
  );

  const moveForm = (
    <div className="stack">
      <label className="field">
        <span className="field__label">Zona o barrio</span>
        <input className="input" placeholder="Ej: Palermo, Nueva Córdoba…" value={zone} maxLength={40} onChange={(e) => setZone(e.target.value)} />
      </label>
      <AmountField label="Alquiler por mes" text={rentText} onText={setRentText} invalid={rent.invalid} placeholder="Mira avisos de la zona" hint="Un valor típico de avisos de esa zona; luego lo ajustas." />
      <AmountField label="Expensas y servicios por mes" text={feesText} onText={setFeesText} invalid={fees.invalid} placeholder="0" />
      <AmountField label="Lo que pagas hoy por vivir (alquiler + gastos)" text={currentText} onText={setCurrentText} invalid={current.invalid} placeholder="0" hint="Sirve para ver cuánto cambia tu mes." />
      <div className="field">
        <span className="field__label">Para entrar, en meses de alquiler</span>
        <div className="months-grid">
          <div>
            <span className="field__hint">Depósito</span>
            <Stepper value={depositM} min={0} max={6} label="meses de depósito" onChange={setDepositM} />
          </div>
          <div>
            <span className="field__hint">Comisión</span>
            <Stepper value={commissionM} min={0} max={6} label="meses de comisión" onChange={setCommissionM} />
          </div>
          <div>
            <span className="field__hint">Adelanto</span>
            <Stepper value={advanceM} min={0} max={6} label="meses adelantados" onChange={setAdvanceM} />
          </div>
        </div>
      </div>
      <AmountField label="Mudanza y puesta a punto (opcional)" text={setupText} onText={setSetupText} invalid={setup.invalid} placeholder="Flete, muebles, arreglos" />
      {when}
      {alreadySaved}
    </div>
  );

  const savingForm = (
    <div className="stack">
      <label className="field">
        <span className="field__label">¿Qué meta es?</span>
        <input className="input" placeholder="Ej: Moto, casamiento, compu…" value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span className="field__label">Ícono</span>
        <div className="emoji-row" role="radiogroup" aria-label="Ícono">
          {SAVING_EMOJIS.map((e) => (
            <button key={e} type="button" role="radio" aria-checked={e === emoji} aria-label={e} className={cx('emoji-btn', e === emoji && 'is-on')} onClick={() => setEmoji(e)}>
              {e}
            </button>
          ))}
        </div>
      </div>
      <AmountField label="¿Cuánto necesitas juntar?" text={targetText} onText={setTargetText} invalid={target.invalid} placeholder={fmt.formatNumber(2_000_000_00)} />
      {when}
      {alreadySaved}
    </div>
  );

  const summary: ReactNode =
    kind === 'trip' && fx === null ? (
      <p className="muted">Pon el valor del dólar para calcular el presupuesto.</p>
    ) : kind === 'trip' && tripEstimate ? (
      <div className="estimate">
        <ul>
          {tripEstimate.lines.map((l) => (
            <li key={l.id}>
              <span>{l.label}</span>
              <b className="tnum">{fmt.formatRounded(l.amount)}</b>
            </li>
          ))}
        </ul>
        <p className="estimate__note">
          Estimación de referencia con precios aproximados de 2026 en dólares. Varía mucho según la fecha: ajusta el pasaje y los extras con valores reales.
          {tripEstimate.unknown.length > 0 && ` No tengo datos de ${tripEstimate.unknown.join(', ')}: usé un promedio.`}
        </p>
      </div>
    ) : kind === 'move' && costs ? (
      <div className="estimate">
        <ul>
          <li>
            <span>Para entrar</span>
            <b className="tnum">{fmt.formatRounded(costs.upfront)}</b>
          </li>
          <li>
            <span>Cada mes en el nuevo lugar</span>
            <b className="tnum">{fmt.formatRounded(costs.newMonthly)}</b>
          </li>
          <li>
            <span>Cambio frente a hoy</span>
            <b className="tnum">
              {costs.monthlyChange >= 0 ? '+' : '−'}
              {fmt.formatRounded(Math.abs(costs.monthlyChange))}
            </b>
          </li>
        </ul>
        {impact && (
          <p className="estimate__note">
            {impact.cutNeeded > 0
              ? `Para guardar lo que pide la meta y pagar el nuevo lugar, tendrías que gastar ≈ ${fmt.formatRounded(impact.cutNeeded)} menos por mes en lo demás.`
              : impact.housingShare !== null
                ? `Vivir ahí sería el ${Math.round(impact.housingShare * 100)}% de tu ingreso. Con tu ritmo actual entra.`
                : 'Con tu ritmo actual entra.'}
          </p>
        )}
      </div>
    ) : null;

  return (
    <Sheet title={existing ? 'Editar meta' : kind === 'trip' ? 'Nuevo viaje' : kind === 'move' ? 'Nueva mudanza' : kind === 'saving' ? 'Nueva meta' : 'Nueva meta'} onClose={onClose} full flush>
      <div className="wizard">
        <div className="wizard__scroll">
          {kind === null ? picker : (
            <>
              {kind === 'trip' ? tripForm : kind === 'move' ? moveForm : savingForm}
              {summary && <div style={{ marginTop: 20 }}>{summary}</div>}
              {kind !== 'saving' && (
                <label className="field" style={{ marginTop: 20 }}>
                  <span className="field__label">Nombre de la meta (opcional)</span>
                  <input className="input" placeholder={displayName || (kind === 'trip' ? 'Viaje a…' : 'Mudanza a…')} value={name} maxLength={30} onChange={(e) => setName(e.target.value)} />
                </label>
              )}
            </>
          )}
        </div>
        {kind !== null && (
          <div className="wizard__foot">
            {draft && status && message ? (
              <div className="wizard__result">
                <div>
                  <span className="muted">Meta</span> <b>{fmt.formatRounded(draft.target)}</b>
                </div>
                <div>
                  <GoalChip tone={message.tone} label={message.label} />
                </div>
              </div>
            ) : null}
            {draft && status ? (
              <p className="wizard__perMonth">
                Guardar <b>{fmt.formatRounded(requiredPerMonth(draft, today))}</b> por mes
              </p>
            ) : (
              <p className="wizard__perMonth muted">Completa los datos para ver cuánto guardar por mes.</p>
            )}
            <button className="btn btn--block" disabled={!valid} onClick={save}>
              {existing ? 'Guardar cambios' : 'Crear meta'}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
