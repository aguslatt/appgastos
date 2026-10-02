import { Pencil, Trash2 } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { colorVar } from '../lib/categories';
import { formatMonthLabel, monthName } from '../lib/dates';
import { describeGoal } from '../lib/goalText';
import { extendOptions, goalStatus, moveCosts, moveImpact, monthsLeft, progress, requiredPerMonth, suggestCuts, totalRequired } from '../lib/goals';
import { estimateTrip } from '../lib/trips';
import { useCategoryMap, useFmt, useToday } from '../state/derived';
import { useCapacity } from '../state/goals';
import { store, useData } from '../state/store';
import { useUi } from '../state/ui';
import { AmountField, parseOptionalAmount } from './AmountField';
import { GoalChip } from './GoalChip';
import { Sheet } from './Sheet';

export function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div className="pbar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <i style={{ width: `${Math.max(value > 0 ? 3 : 0, value * 100)}%` }} />
    </div>
  );
}

/** One goal in detail: progress, whether it's on track, how to get there, and what it's made of. */
export function GoalSheet({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (id: string) => void }) {
  const { goals, categories, settings } = useData();
  const goal = goals.find((g) => g.id === id);
  const today = useToday();
  const fmt = useFmt();
  const ui = useUi();
  const capacity = useCapacity();
  const catMap = useCategoryMap();
  const [amountText, setAmountText] = useState('');
  if (!goal) return null;

  const locale = settings.locale;
  const committed = totalRequired(goals.filter((g) => g.id !== id), today);
  const status = goalStatus(goal, capacity, committed, today);
  const message = describeGoal(goal, status, capacity, committed, fmt, locale);
  const cuts = status.shortfall > 0 ? suggestCuts(status.shortfall, capacity.perFolder, categories) : null;
  const extend = message.tone === 'off' || message.tone === 'late' ? extendOptions(goal, today) : [];
  const amount = parseOptionalAmount(amountText);
  const perMonth = requiredPerMonth(goal, today);
  const left = monthsLeft(goal.deadline, today);

  const tripLines = goal.kind === 'trip' && goal.trip?.fx ? estimateTrip({ stops: goal.trip.stops, people: goal.trip.people, style: goal.trip.style, fxRate: goal.trip.fx, flightEach: goal.trip.flightEach ?? null, extras: goal.trip.extras ?? 0 }).lines : null;
  const costs = goal.kind === 'move' && goal.move ? moveCosts(goal.move) : null;
  const impact = goal.kind === 'move' && goal.move ? moveImpact(goal.move, capacity, perMonth) : null;

  const add = (sign: 1 | -1) => {
    if (amount.value === null) return;
    store.addToGoal(id, sign * amount.value);
    ui.haptic('ok');
    ui.toast({ text: sign === 1 ? `Sumaste ${fmt.formatRounded(amount.value)} a la meta` : `Retiraste ${fmt.formatRounded(amount.value)}` });
    setAmountText('');
  };

  const remove = async () => {
    const ok = await ui.confirm({ title: `¿Eliminar «${goal.name}»?`, text: 'Se borra la meta y lo que llevabas anotado como ahorrado.', confirmLabel: 'Eliminar', danger: true });
    if (!ok) return;
    const removed = store.deleteGoal(id);
    onClose();
    if (removed) ui.toast({ text: 'Meta eliminada', actionLabel: 'Deshacer', onAction: () => store.restoreGoal(removed) });
  };

  return (
    <Sheet title={`${goal.emoji} ${goal.name}`} onClose={onClose}>
      <div className="stack">
        <section className="card">
          <div className="goal__amounts">
            <span>
              <b className="tnum">{fmt.formatRounded(goal.saved)}</b> <span className="muted">de {fmt.formatRounded(goal.target)}</span>
            </span>
            <b>{Math.round(progress(goal) * 100)}%</b>
          </div>
          <ProgressBar value={progress(goal)} label="Avance de la meta" />
          <p className="goal__when muted">
            Para {formatMonthLabel(goal.deadline, locale)}
            {left > 0 ? ` · faltan ${left} ${left === 1 ? 'mes' : 'meses'}` : ''}
          </p>
        </section>

        <section className="card goal__verdict" data-tone={message.tone}>
          <GoalChip tone={message.tone} label={message.label} />
          <p className="goal__headline">{message.headline}</p>
          <p className="muted">{message.detail}</p>
        </section>

        {status.level !== 'done' && (
          <section className="card stack" style={{ gap: 10 }}>
            <AmountField label="Sumar o retirar ahorro" text={amountText} onText={setAmountText} invalid={amount.invalid} placeholder={`Ej: ${fmt.formatNumber(100_000_00)}`} />
            <div className="goal__buttons">
              <button className="btn" disabled={amount.value === null} onClick={() => add(1)}>
                Sumar
              </button>
              <button className="btn btn--soft" disabled={amount.value === null || goal.saved === 0} onClick={() => add(-1)}>
                Retirar
              </button>
            </div>
          </section>
        )}

        {cuts && cuts.cuts.length > 0 && (
          <section className="card">
            <h3 className="card__title">Para llegar, podrías recortar</h3>
            <ul className="goal__list">
              {cuts.cuts.map((c) => {
                const cat = catMap.get(c.categoryId);
                return (
                  <li key={c.categoryId}>
                    <span className="badge" style={{ '--badge-color': colorVar(cat?.color ?? 'slate') } as CSSProperties}>
                      {cat?.emoji}
                    </span>
                    <span className="goal__list-main">
                      <b>{cat?.name}</b>
                      <span className="muted">un {Math.round(c.pct * 100)}% menos</span>
                    </span>
                    <b className="tnum">{fmt.formatRounded(c.monthly)}/mes</b>
                  </li>
                );
              })}
            </ul>
            {cuts.gap > 0 && <p className="goal__gap muted">Aun así faltarían ≈ {fmt.formatRounded(cuts.gap)} por mes: conviene mover la fecha o bajar el monto.</p>}
          </section>
        )}

        {extend.length > 0 && (
          <section className="card">
            <h3 className="card__title">O mover la fecha</h3>
            <div className="goal__chips">
              {extend.map((o) => (
                <button
                  key={o.extraMonths}
                  type="button"
                  className="pill"
                  onClick={() => {
                    store.updateGoal(id, { deadline: o.deadline });
                    ui.toast({ text: `Nueva fecha: ${formatMonthLabel(o.deadline, locale)}` });
                  }}
                >
                  <span>
                    +{o.extraMonths} meses · {monthName(o.deadline, locale)}
                  </span>
                  <b>{fmt.formatRounded(o.perMonth)}/mes</b>
                </button>
              ))}
            </div>
          </section>
        )}

        {tripLines && (
          <section className="card">
            <h3 className="card__title">De qué se compone</h3>
            <ul className="estimate estimate--plain">
              {tripLines.map((l) => (
                <li key={l.id}>
                  <span>{l.label}</span>
                  <b className="tnum">{fmt.formatRounded(l.amount)}</b>
                </li>
              ))}
            </ul>
            <p className="estimate__note">Referencia aproximada: ajústala con precios reales desde «Editar».</p>
          </section>
        )}

        {costs && (
          <section className="card">
            <h3 className="card__title">Cómo cambia tu mes</h3>
            <ul className="estimate estimate--plain">
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
                  ? `Para guardar ${fmt.formatRounded(perMonth)} por mes y pagar el nuevo lugar, tendrías que gastar ≈ ${fmt.formatRounded(impact.cutNeeded)} menos por mes en lo demás.`
                  : 'Con tu ritmo actual de gasto entra sin recortar.'}
              </p>
            )}
          </section>
        )}

        <div className="goal__buttons">
          <button className="btn btn--soft" onClick={() => onEdit(id)}>
            <Pencil size={18} />
            Editar
          </button>
          <button className="btn btn--ghost" onClick={remove}>
            <Trash2 size={18} />
            Eliminar
          </button>
        </div>
      </div>
    </Sheet>
  );
}
