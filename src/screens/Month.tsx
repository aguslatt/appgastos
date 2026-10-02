import { AlertTriangle, CheckCircle2, Play, TrendingDown, TrendingUp, XCircle } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { BudgetSheet } from '../components/BudgetSheet';
import { DaySheet } from '../components/DaySheet';
import { FolderBreakdown } from '../components/charts/FolderBreakdown';
import { HeatCalendar } from '../components/charts/HeatCalendar';
import { Meter } from '../components/charts/Meter';
import { MonthSwitcher } from '../components/MonthSwitcher';
import { useCountUp } from '../components/useCountUp';
import { addMonths, monthName } from '../lib/dates';
import { GoalChip } from '../components/GoalChip';
import { monthSignal, totalRequired } from '../lib/goals';
import { analyzeMonth, buildFacts } from '../lib/insights';
import type { DateStr } from '../lib/types';
import { useFmt, useToday } from '../state/derived';
import { useData } from '../state/store';
import { useUi } from '../state/ui';

const pct = (v: number): string => `${Math.round(Math.abs(v) * 100)}%`;

export function MonthScreen() {
  const ui = useUi();
  const data = useData();
  const today = useToday();
  const fmt = useFmt();
  const locale = data.settings.locale;
  const { month } = ui;

  const analysis = useMemo(
    () =>
      analyzeMonth({
        month,
        today,
        expenses: data.expenses,
        categories: data.categories,
        recurring: data.recurring,
        budget: data.settings.monthlyBudget,
      }),
    [month, today, data.expenses, data.categories, data.recurring, data.settings.monthlyBudget],
  );
  const facts = useMemo(() => buildFacts({ analysis, fmt, locale }), [analysis, fmt, locale]);
  const { stats, pace, projection, budget } = analysis;

  const signal = useMemo(
    () => (stats.status === 'current' ? monthSignal(data.settings.monthlyIncome, data.goals, projection?.total ?? null, today) : null),
    [stats.status, data.settings.monthlyIncome, data.goals, projection, today],
  );
  const [dayOpen, setDayOpen] = useState<DateStr | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);

  const animated = useCountUp(stats.total);
  const heroText = fmt.formatNumber(Math.round(animated));
  const current = stats.status === 'current';
  const name = monthName(month, locale);
  const prevName = monthName(addMonths(month, -1), locale);
  const empty = stats.count === 0;

  const BudgetIcon = budget?.level === 'over' ? XCircle : budget?.level === 'close' ? AlertTriangle : CheckCircle2;
  const budgetLabel = budget?.level === 'over' ? 'Te pasaste' : budget?.level === 'close' ? 'Queda poco' : budget?.paceAhead ? 'Vas algo rápido' : 'Vas bien';

  const openFolder = (id: string) => {
    ui.setHistoryFolder(id);
    ui.setTab('history');
  };

  return (
    <div className="screen--pad month">
      <div className="screen__head">
        <MonthSwitcher />
      </div>

      <div className="tiles">
        <section className="tile tile--wide tile--hero" aria-label="Total del mes">
          <p className="kicker">{current ? `Gastado en ${name}` : `Total de ${name}`}</p>
          <p className="hero__amount" aria-label={`${fmt.format(stats.total)}`}>
            <span className="hero__cur">{fmt.symbol}</span>
            <span className="hero__num" style={{ '--n': heroText.length } as CSSProperties}>
              {heroText}
            </span>
          </p>

          {!empty && pace?.pct != null && Math.abs(pace.pct) >= 0.005 && (
            <p className="hero__delta" data-tone={pace.pct > 0 ? 'up' : 'down'}>
              {pace.pct > 0 ? <TrendingUp size={16} aria-hidden="true" /> : <TrendingDown size={16} aria-hidden="true" />}
              {pct(pace.pct)} {pace.pct > 0 ? 'más' : 'menos'} que {pace.toDate ? `a esta altura de ${prevName}` : prevName}
            </p>
          )}

          {empty ? (
            <div className="hero__empty">
              <p>Sin gastos en este mes.</p>
              {current && (
                <button className="btn btn--dark btn--small" onClick={() => ui.setTab('calc')}>
                  Anotar el primero
                </button>
              )}
            </div>
          ) : (
            <dl className="hero__stats">
              {current && (
                <div>
                  <dt>Hoy</dt>
                  <dd>{fmt.formatRounded(stats.todayTotal)}</dd>
                </div>
              )}
              <div>
                <dt>Por día</dt>
                <dd>{fmt.formatRounded(stats.dailyAverage)}</dd>
              </div>
              <div>
                <dt>Movimientos</dt>
                <dd>{stats.count}</dd>
              </div>
            </dl>
          )}
        </section>

        {!empty && (
          <button type="button" className="tile tile--wide tile--story" onClick={() => ui.openStory(month)}>
            <span className="story-cta__text">
              <span className="kicker">{current ? 'Resumen parcial' : 'Tu resumen'}</span>
              <span className="story-cta__title">{current ? `Así viene ${name}` : `Mira cómo cerró ${name}`}</span>
            </span>
            <span className="story-cta__play" aria-hidden="true">
              <Play size={22} fill="currentColor" />
            </span>
          </button>
        )}

        {budget ? (
          <section className="tile tile--wide" aria-label="Presupuesto">
            <div className="card__title">
              <span>Presupuesto</span>
              <span className="chip" data-level={budget.level}>
                <BudgetIcon size={15} aria-hidden="true" />
                {budgetLabel}
              </span>
            </div>
            <Meter pct={budget.pct} level={budget.level} timeShare={current ? stats.elapsedDays / stats.daysInMonth : undefined} label="Presupuesto usado" />
            <div className="budget__line">
              <span>
                {budget.remaining >= 0 ? (
                  <>
                    Quedan <strong>{fmt.formatRounded(budget.remaining)}</strong>
                  </>
                ) : (
                  <>
                    Te pasaste por <strong>{fmt.formatRounded(-budget.remaining)}</strong>
                  </>
                )}
              </span>
              <strong>{pct(budget.pct)}</strong>
            </div>
            <div className="budget__sub">
              <span>{budget.perDay !== null ? `${fmt.formatRounded(budget.perDay)} por día para llegar a fin de mes` : `Tope de ${fmt.formatRounded(budget.budget)}`}</span>
              <button type="button" className="link-btn" onClick={() => setBudgetOpen(true)}>
                Cambiar
              </button>
            </div>
          </section>
        ) : (
          <section className="tile tile--wide tile--cta" aria-label="Presupuesto">
            <div>
              <p className="card__title" style={{ marginBottom: 4 }}>
                ¿Un tope para el mes?
              </p>
              <p className="muted">Con un presupuesto, al anotar cada gasto se ve cuánto queda por día.</p>
            </div>
            <button className="btn btn--small" onClick={() => setBudgetOpen(true)}>
              Definir
            </button>
          </section>
        )}

        {projection && current && (
          <section className="tile" aria-label="Cierre estimado">
            <p className="tile__label">Cierre estimado</p>
            <p className="tile__value" style={{ '--n': fmt.formatRounded(projection.total).length } as CSSProperties}>
              {fmt.formatRounded(projection.total)}
            </p>
            <p className="tile__note">{projection.method === 'history' ? 'Según cómo siguieron tus meses anteriores' : 'Según el ritmo de este mes'}</p>
          </section>
        )}

        {current && data.goals.length > 0 && signal && (
          <button type="button" className="tile tile--wide tile--goals" onClick={() => ui.setTab('goals')}>
            <span className="card__title" style={{ marginBottom: 8 }}>
              <span>Tus metas</span>
              <GoalChip
                tone={signal.level === 'over' ? 'off' : signal.level}
                label={signal.level === 'ok' ? 'Vas bien' : signal.level === 'tight' ? 'Justo' : signal.level === 'over' ? 'Te pasas' : data.settings.monthlyIncome === null ? 'Falta tu ingreso' : 'Pronto para estimar'}
              />
            </span>
            {signal.allowed !== null && signal.expected !== null ? (
              <span className="tile__note" style={{ fontSize: 14, marginTop: 0 }}>
                Tus metas piden guardar <b>{fmt.formatRounded(totalRequired(data.goals, today))}</b> por mes: quedan <b>{fmt.formatRounded(Math.max(0, signal.allowed))}</b> para gastar. Este mes vas camino a <b>{fmt.formatRounded(signal.expected)}</b>
                {signal.level === 'over' && signal.diff !== null ? `, ${fmt.formatRounded(signal.diff)} de más: cuida lo recortable.` : '.'}
              </span>
            ) : (
              <span className="tile__note" style={{ fontSize: 14, marginTop: 0 }}>
                {data.settings.monthlyIncome === null ? 'Suma tu ingreso mensual y te digo si tus metas entran con tu ritmo de gasto.' : 'Cuando haya unos días de gastos, te digo si tu ritmo alcanza para tus metas.'}
              </span>
            )}
          </button>
        )}

        {!empty && (
          <section className="tile" aria-label="Días sin gastos">
            <p className="tile__label">Días sin gastar</p>
            <p className="tile__value">{stats.noSpendDays}</p>
            <p className="tile__note">{stats.longestNoSpendStreak >= 2 ? `Racha más larga: ${stats.longestNoSpendStreak} días` : 'de los días ya terminados'}</p>
          </section>
        )}

        {!empty && (
          <section className="tile tile--wide" aria-label="Calendario del mes">
            <div className="card__title">
              <span>Día por día</span>
              <span className="muted tile__small">Toca un día</span>
            </div>
            <HeatCalendar month={month} byDay={stats.byDay} today={today} locale={locale} fmt={fmt} onPick={setDayOpen} />
          </section>
        )}

        {!empty && (
          <section className="tile tile--wide" aria-label="Gasto por carpeta">
            <div className="card__title">
              <span>En qué se fue</span>
            </div>
            <FolderBreakdown items={analysis.folders} fmt={fmt} onOpen={openFolder} />
          </section>
        )}

        {facts.length > 0 && (
          <section className="tile tile--wide tile--facts" aria-label="Datos curiosos">
            <div className="card__title">
              <span>Datos del mes</span>
            </div>
            <ul className="facts">
              {facts.map((f, i) => (
                <li key={f.id} className="fact" data-tone={f.tone} style={{ '--tilt': `${[-2.2, 1.6, -1.2, 2.4, -1.8][i % 5]}deg` } as CSSProperties}>
                  <span aria-hidden="true">{f.emoji}</span>
                  {f.text}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {!empty && (
        <button className="btn btn--soft btn--block month__more" onClick={() => ui.setTab('history')}>
          Ver todos los movimientos
        </button>
      )}

      {dayOpen && <DaySheet date={dayOpen} onClose={() => setDayOpen(null)} />}
      {budgetOpen && <BudgetSheet onClose={() => setBudgetOpen(false)} />}
    </div>
  );
}
