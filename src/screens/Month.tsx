import { AlertTriangle, ArrowUpRight, CheckCircle2, Play, Plus, TrendingDown, TrendingUp, XCircle } from 'lucide-react';
import { useMemo, useState, type CSSProperties } from 'react';
import { BudgetSheet } from '../components/BudgetSheet';
import { DaySheet } from '../components/DaySheet';
import { FolderBreakdown } from '../components/charts/FolderBreakdown';
import { FlowBars } from '../components/charts/FlowBars';
import { HeatCalendar } from '../components/charts/HeatCalendar';
import { Meter } from '../components/charts/Meter';
import { Ring } from '../components/charts/Ring';
import { SpendArea } from '../components/charts/SpendArea';
import { GoalChip } from '../components/GoalChip';
import { IncomeSetupSheet } from '../components/IncomeSetupSheet';
import { MonthSwitcher } from '../components/MonthSwitcher';
import { useCountUp } from '../components/useCountUp';
import { useMonthNav } from '../components/useMonthNav';
import { useSwipe } from '../components/useSwipe';
import { addMonths, monthName } from '../lib/dates';
import { monthSignal, totalRequired } from '../lib/goals';
import { computeMonthIncome, flowSeries, monthBalance, upcomingFixedIncome } from '../lib/income';
import { incomeSource } from '../lib/incomeSources';
import { analyzeMonth, buildFacts } from '../lib/insights';
import type { DateStr } from '../lib/types';
import { useExpectedIncome, useExpensesByMonth, useFmt, useIncomesByMonth, useToday } from '../state/derived';
import { useData } from '../state/store';
import { useUi } from '../state/ui';

const pct = (v: number): string => `${Math.round(Math.abs(v) * 100)}%`;
const stagger = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties;

export function MonthScreen() {
  const ui = useUi();
  const data = useData();
  const today = useToday();
  const fmt = useFmt();
  const expected = useExpectedIncome();
  const byMonth = useExpensesByMonth();
  const incomesByMonth = useIncomesByMonth();
  const locale = data.settings.locale;
  const { month } = ui;
  const nav = useMonthNav();
  const swipe = useSwipe({ left: nav.next, right: nav.prev });

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

  const income = useMemo(() => computeMonthIncome(incomesByMonth.get(month) ?? [], month), [incomesByMonth, month]);
  const balance = monthBalance(income.total, stats.total);
  const flow = useMemo(() => flowSeries(incomesByMonth, byMonth, month, 6), [incomesByMonth, byMonth, month]);
  const showFlow = flow.some((p) => p.income > 0);
  const upcomingIncome = stats.status === 'current' ? upcomingFixedIncome(data.incomeRules, today) : 0;
  const neverGaveIncome = expected.amount === null && data.incomes.length === 0 && data.incomeRules.length === 0;

  const signal = useMemo(
    () => (stats.status === 'current' ? monthSignal(expected.amount, data.goals, projection?.total ?? null, today) : null),
    [stats.status, expected.amount, data.goals, projection, today],
  );
  const [dayOpen, setDayOpen] = useState<DateStr | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [incomeSetup, setIncomeSetup] = useState(false);

  const animated = useCountUp(stats.total);
  const heroText = fmt.formatNumber(Math.round(animated));
  const animatedIncome = useCountUp(income.total);
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
  const writeIncome = () => {
    ui.setEntryKind('income');
    ui.setTab('calc');
  };

  const sparkSummary = `Gasto acumulado de ${name}: ${fmt.formatRounded(stats.total)}${projection && current ? `, con un cierre estimado de ${fmt.formatRounded(projection.total)}` : ''}.`;
  const kept = balance.keptShare !== null ? Math.max(0, balance.keptShare) : 0;
  let tile = 0;

  return (
    <div className="screen--pad month" {...swipe}>
      <div className="screen__head">
        <MonthSwitcher />
      </div>

      <div key={month} className="tiles" data-dir={ui.monthDir}>
        <section className="tile tile--wide tile--hero reveal" style={stagger(tile++)} aria-label="Total del mes">
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

          {!empty && (
            <SpendArea
              byDay={stats.byDay}
              days={stats.daysInMonth}
              elapsed={stats.elapsedDays}
              projection={current ? (projection?.total ?? null) : null}
              budget={budget?.budget ?? null}
              summary={sparkSummary}
            />
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
          <button type="button" className="tile tile--wide tile--story reveal" style={stagger(tile++)} onClick={() => ui.openStory(month)}>
            <span className="story-cta__text">
              <span className="kicker">{current ? 'Resumen parcial' : 'Tu resumen'}</span>
              <span className="story-cta__title">{current ? `Así viene ${name}` : `Mira cómo cerró ${name}`}</span>
            </span>
            <span className="story-cta__play" aria-hidden="true">
              <Play size={22} fill="currentColor" />
            </span>
          </button>
        )}

        {income.total > 0 ? (
          <>
            <section className="tile tile--in reveal" style={stagger(tile++)} aria-label="Ingresos del mes">
              <p className="kicker">{current ? 'Entró este mes' : 'Entró'}</p>
              <p className="tile__big" style={{ '--n': fmt.formatRounded(income.total).length + 1 } as CSSProperties} aria-label={`+${fmt.format(income.total)}`}>
                +{fmt.formatRounded(animatedIncome)}
              </p>
              <div className="tile__foot">
                <div className="stackbar stackbar--on-blue" role="img" aria-label="Proporción del ingreso por tipo">
                  {income.bySource.map((s) => (
                    <i key={s.sourceId} style={{ flexGrow: Math.max(s.share, 0.04) }} data-n={Math.min(income.bySource.indexOf(s), 3)} />
                  ))}
                </div>
                <ul className="tile__legend">
                  {income.bySource.slice(0, 3).map((s, i) => (
                    <li key={s.sourceId}>
                      <i data-n={i} aria-hidden="true" />
                      <span>{incomeSource(s.sourceId).name}</span>
                      <b>{fmt.formatCompact(s.total)}</b>
                    </li>
                  ))}
                </ul>
                {upcomingIncome > 0 && <p className="tile__note">Falta cobrar {fmt.formatRounded(upcomingIncome)}</p>}
              </div>
            </section>

            <section className="tile tile--balance reveal" style={stagger(tile++)} aria-label="Balance del mes" data-sign={balance.balance >= 0 ? 'plus' : 'minus'}>
              <Ring value={kept} size={76} stroke={9} tone={balance.balance >= 0 ? 'accent' : 'bad'}>
                {balance.keptShare !== null && balance.balance >= 0 ? pct(kept) : <TrendingDown size={22} aria-hidden="true" />}
              </Ring>
              <p className="tile__label">{balance.balance >= 0 ? (current ? 'Te queda' : 'Quedó') : current ? 'Vas pasado por' : 'Te pasaste por'}</p>
              <p className="tile__value" style={{ '--n': fmt.formatRounded(Math.abs(balance.balance)).length } as CSSProperties}>
                {balance.balance >= 0 ? '+' : '−'}
                {fmt.formatRounded(Math.abs(balance.balance))}
              </p>
              <p className="tile__note">
                {balance.balance >= 0
                  ? `Guardas el ${pct(kept)} de lo que entra`
                  : upcomingIncome > 0
                    ? `Con lo que falta cobrar: ${balance.balance + upcomingIncome >= 0 ? '+' : '−'}${fmt.formatRounded(Math.abs(balance.balance + upcomingIncome))}`
                    : 'Gastaste más de lo que entró'}
              </p>
            </section>
          </>
        ) : (
          neverGaveIncome &&
          current && (
            <section className="tile tile--wide tile--cta tile--cta-in reveal" style={stagger(tile++)} aria-label="Ingresos">
              <div>
                <p className="card__title" style={{ marginBottom: 4 }}>
                  ¿Cuánto te entra por mes?
                </p>
                <p className="muted">Anota tu sueldo o lo que cobras por tu trabajo y te muestro cuánto te queda cada mes.</p>
              </div>
              <button className="btn btn--blue btn--small" onClick={() => setIncomeSetup(true)}>
                <Plus size={16} aria-hidden="true" />
                Sumar
              </button>
            </section>
          )
        )}

        {showFlow && (
          <section className="tile tile--wide reveal" style={stagger(tile++)} aria-label="Entró contra salió">
            <div className="card__title">
              <span>Entró vs. salió</span>
              <span className="muted tile__small">Últimos 6 meses</span>
            </div>
            <FlowBars series={flow} fmt={fmt} locale={locale} />
          </section>
        )}

        {budget ? (
          <section className="tile tile--wide reveal" style={stagger(tile++)} aria-label="Presupuesto">
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
          <section className="tile tile--wide tile--cta reveal" style={stagger(tile++)} aria-label="Presupuesto">
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
          <section className="tile reveal" style={stagger(tile++)} aria-label="Cierre estimado">
            <p className="tile__label">Cierre estimado</p>
            <p className="tile__value" style={{ '--n': fmt.formatRounded(projection.total).length } as CSSProperties}>
              {fmt.formatRounded(projection.total)}
            </p>
            <p className="tile__note">{projection.method === 'history' ? 'Según cómo siguieron tus meses anteriores' : 'Según el ritmo de este mes'}</p>
          </section>
        )}

        {!empty && (
          <section className="tile reveal" style={stagger(tile++)} aria-label="Días sin gastos">
            <p className="tile__label">Días sin gastar</p>
            <p className="tile__value">{stats.noSpendDays}</p>
            <p className="tile__note">{stats.longestNoSpendStreak >= 2 ? `Racha más larga: ${stats.longestNoSpendStreak} días` : 'de los días ya terminados'}</p>
          </section>
        )}

        {current && data.goals.length > 0 && signal && (
          <button type="button" className="tile tile--wide tile--goals reveal" style={stagger(tile++)} onClick={() => ui.setTab('goals')}>
            <span className="card__title" style={{ marginBottom: 8 }}>
              <span>Tus metas</span>
              <GoalChip
                tone={signal.level === 'over' ? 'off' : signal.level}
                label={signal.level === 'ok' ? 'Vas bien' : signal.level === 'tight' ? 'Justo' : signal.level === 'over' ? 'Te pasas' : expected.amount === null ? 'Falta tu ingreso' : 'Pronto para estimar'}
              />
            </span>
            {signal.allowed !== null && signal.expected !== null ? (
              <span className="tile__note" style={{ fontSize: 14, marginTop: 0 }}>
                Tus metas piden guardar <b>{fmt.formatRounded(totalRequired(data.goals, today))}</b> por mes: quedan <b>{fmt.formatRounded(Math.max(0, signal.allowed))}</b> para gastar. Este mes vas camino a <b>{fmt.formatRounded(signal.expected)}</b>
                {signal.level === 'over' && signal.diff !== null ? `, ${fmt.formatRounded(signal.diff)} de más: cuida lo recortable.` : '.'}
              </span>
            ) : (
              <span className="tile__note" style={{ fontSize: 14, marginTop: 0 }}>
                {expected.amount === null ? 'Suma tu ingreso mensual y te digo si tus metas entran con tu ritmo de gasto.' : 'Cuando haya unos días de gastos, te digo si tu ritmo alcanza para tus metas.'}
              </span>
            )}
          </button>
        )}

        {!empty && (
          <section className="tile tile--wide reveal" style={stagger(tile++)} aria-label="Calendario del mes">
            <div className="card__title">
              <span>Día por día</span>
              <span className="muted tile__small">Toca un día</span>
            </div>
            <HeatCalendar month={month} byDay={stats.byDay} today={today} locale={locale} fmt={fmt} onPick={setDayOpen} />
          </section>
        )}

        {!empty && (
          <section className="tile tile--wide reveal" style={stagger(tile++)} aria-label="Gasto por carpeta">
            <div className="card__title">
              <span>En qué se fue</span>
            </div>
            <FolderBreakdown items={analysis.folders} fmt={fmt} onOpen={openFolder} />
          </section>
        )}

        {facts.length > 0 && (
          <section className="tile tile--wide tile--facts reveal" style={stagger(tile++)} aria-label="Datos curiosos">
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

      {(!empty || income.total > 0) && (
        <div className="month__more">
          <button className="btn btn--soft btn--block" onClick={() => ui.setTab('history')}>
            Ver todos los movimientos
          </button>
          {income.total > 0 || !neverGaveIncome ? (
            <button className="btn btn--ghost btn--block month__add-income" onClick={writeIncome}>
              <ArrowUpRight size={18} aria-hidden="true" />
              Anotar un ingreso
            </button>
          ) : null}
        </div>
      )}

      {dayOpen && <DaySheet date={dayOpen} onClose={() => setDayOpen(null)} />}
      {budgetOpen && <BudgetSheet onClose={() => setBudgetOpen(false)} />}
      {incomeSetup && <IncomeSetupSheet onClose={() => setIncomeSetup(false)} />}
    </div>
  );
}
