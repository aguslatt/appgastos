import { Plus, Target } from 'lucide-react';
import { useState } from 'react';
import { GoalChip } from '../components/GoalChip';
import { GoalSheet, ProgressBar } from '../components/GoalSheet';
import { GoalWizard } from '../components/GoalWizard';
import { IncomeSheet } from '../components/IncomeSheet';
import { formatMonthLabel } from '../lib/dates';
import { describeGoal } from '../lib/goalText';
import { goalStatus, monthsLeft, progress, requiredPerMonth, totalRequired } from '../lib/goals';
import { useFmt, useToday } from '../state/derived';
import { useCapacity } from '../state/goals';
import { useData } from '../state/store';

export function GoalsScreen() {
  const { goals, settings } = useData();
  const today = useToday();
  const fmt = useFmt();
  const capacity = useCapacity();
  const locale = settings.locale;
  const [wizard, setWizard] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [incomeOpen, setIncomeOpen] = useState(false);

  const open = (id: string) => setDetail(id);

  return (
    <div className="screen--pad goals">
      <div className="screen__head">
        <h1 className="screen__title">Metas</h1>
        {goals.length > 0 && (
          <button className="btn btn--small" onClick={() => setWizard('new')}>
            <Plus size={16} />
            Nueva
          </button>
        )}
      </div>

      {goals.length === 0 ? (
        <section className="goals__empty">
          <span className="goals__empty-icon" aria-hidden="true">
            <Target size={34} />
          </span>
          <h2>¿Un viaje, una mudanza, algo grande?</h2>
          <p className="muted">Ponle monto y fecha: te digo cuánto guardar por mes y si tu ritmo de gasto alcanza.</p>
          <div className="goals__examples" aria-hidden="true">
            <span>✈️ Viaje a Europa</span>
            <span>🏠 Mudarme a Palermo</span>
            <span>💻 Compu nueva</span>
          </div>
          <button className="btn" onClick={() => setWizard('new')}>
            Crear mi primera meta
          </button>
        </section>
      ) : (
        <div className="stack">
          {settings.monthlyIncome === null && (
            <section className="tile tile--cta">
              <div>
                <p className="card__title" style={{ marginBottom: 4 }}>
                  ¿Cuánto cobras al mes?
                </p>
                <p className="muted">Con tu ingreso te digo si cada meta entra o hay que recortar.</p>
              </div>
              <button className="btn btn--small" onClick={() => setIncomeOpen(true)}>
                Sumar
              </button>
            </section>
          )}

          {goals.map((g) => {
            const committed = totalRequired(goals.filter((x) => x.id !== g.id), today);
            const status = goalStatus(g, capacity, committed, today);
            const message = describeGoal(g, status, capacity, committed, fmt, locale);
            const left = monthsLeft(g.deadline, today);
            return (
              <button key={g.id} type="button" className="card goal" onClick={() => open(g.id)}>
                <span className="goal__top">
                  <span className="badge" style={{ '--badge-color': 'var(--c-blue)' } as React.CSSProperties}>
                    {g.emoji}
                  </span>
                  <span className="goal__name">
                    <b>{g.name}</b>
                    <span className="muted">
                      {formatMonthLabel(g.deadline, locale)}
                      {left > 0 ? ` · ${left} ${left === 1 ? 'mes' : 'meses'}` : ''}
                    </span>
                  </span>
                  <GoalChip tone={message.tone} label={message.label} />
                </span>
                <ProgressBar value={progress(g)} label={`Avance de ${g.name}`} />
                <span className="goal__foot">
                  <span>
                    <b className="tnum">{fmt.formatRounded(g.saved)}</b> <span className="muted">de {fmt.formatRounded(g.target)}</span>
                  </span>
                  {status.level !== 'done' && (
                    <span>
                      Guardar <b>{fmt.formatRounded(requiredPerMonth(g, today))}</b>/mes
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {wizard && (
        <GoalWizard
          goalId={wizard}
          onClose={() => setWizard(null)}
        />
      )}
      {detail && (
        <GoalSheet
          id={detail}
          onClose={() => setDetail(null)}
          onEdit={(id) => {
            setDetail(null);
            setWizard(id);
          }}
        />
      )}
      {incomeOpen && <IncomeSheet onClose={() => setIncomeOpen(false)} />}
    </div>
  );
}
