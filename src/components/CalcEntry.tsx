import { CalendarDays, Check, ChevronRight, Delete, FolderPlus, Mic, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { centsToExpr, exprToCents, formatDisplay, formatExpression, hasOperator, pressKey, type CalcKey } from '../lib/calc';
import { capitalize, formatDayHeading, monthKeyOf, monthName, monthShort } from '../lib/dates';
import { resolveEntry } from '../lib/entry';
import { sumIncomes } from '../lib/income';
import { incomeSourceFolders } from '../lib/incomeSources';
import { describeIncomeLive, describeLive } from '../lib/live';
import { parseExpensePhrase } from '../lib/phrase';
import { listen, speechSupported, type Listening } from '../lib/speech';
import { computeMonthStats, sumAmounts } from '../lib/stats';
import { rankFolders } from '../lib/suggest';
import type { Cents, DateStr } from '../lib/types';
import { useKeyboardOpen } from '../state/appearance';
import { useClassifier, useExpectedIncome, useExpensesByMonth, useFmt, useIncomeSuggester, useIncomesByMonth, useToday } from '../state/derived';
import { useData } from '../state/store';
import { storyToPromote } from '../state/storySeen';
import { useUi, type EntryKind } from '../state/ui';
import { Burst } from './Burst';
import { cx } from './cx';
import { DateSheet } from './DateSheet';
import { FolderPill } from './FolderPill';

export interface EntryResult {
  amount: Cents;
  /** The folder of an expense, or the source of an income. */
  categoryId: string;
  note: string;
  date: DateStr;
  /** The folder or source the suggestion had picked for the text, if any (to tell when the user corrected it). */
  suggestedId: string | null;
}

interface CalcEntryProps {
  /** "new": tapping a folder saves right away. "edit": folders are selected and ✓ saves. */
  mode: 'new' | 'edit';
  /** What is being filed: money that left (folders) or money that came in (sources). */
  kind?: EntryKind;
  /** When given, the calculator shows the Gasto | Ingreso switch. */
  onKindChange?: (kind: EntryKind) => void;
  initial?: { amount: Cents; categoryId: string; note: string; date: DateStr };
  onSubmit: (result: EntryResult) => void;
  footer?: ReactNode;
}

interface KeyDef {
  id: string;
  kind: 'digit' | 'op' | 'fn';
  aria: string;
  press: CalcKey;
  label?: string;
}

const PAD: KeyDef[][] = [
  [
    { id: 'clear', kind: 'fn', aria: 'Borrar todo', press: 'clear', label: 'AC' },
    { id: 'back', kind: 'fn', aria: 'Borrar el último', press: 'back' },
    { id: 'pct', kind: 'fn', aria: 'Porcentaje', press: '%', label: '%' },
    { id: 'div', kind: 'op', aria: 'Dividir', press: '/', label: '÷' },
  ],
  [
    { id: '7', kind: 'digit', aria: '7', press: '7', label: '7' },
    { id: '8', kind: 'digit', aria: '8', press: '8', label: '8' },
    { id: '9', kind: 'digit', aria: '9', press: '9', label: '9' },
    { id: 'mul', kind: 'op', aria: 'Multiplicar', press: '*', label: '×' },
  ],
  [
    { id: '4', kind: 'digit', aria: '4', press: '4', label: '4' },
    { id: '5', kind: 'digit', aria: '5', press: '5', label: '5' },
    { id: '6', kind: 'digit', aria: '6', press: '6', label: '6' },
    { id: 'sub', kind: 'op', aria: 'Restar', press: '-', label: '−' },
  ],
  [
    { id: '1', kind: 'digit', aria: '1', press: '1', label: '1' },
    { id: '2', kind: 'digit', aria: '2', press: '2', label: '2' },
    { id: '3', kind: 'digit', aria: '3', press: '3', label: '3' },
    { id: 'add', kind: 'op', aria: 'Sumar', press: '+', label: '+' },
  ],
];

const KEY_FOR: Record<string, CalcKey> = { ',': '.', '.': '.', '+': '+', '-': '-', '*': '*', x: '*', X: '*', '/': '/', '%': '%' };

export function CalcEntry({ mode, kind = 'expense', onKindChange, initial, onSubmit, footer }: CalcEntryProps) {
  const { settings, categories, expenses, incomes } = useData();
  const today = useToday();
  const fmt = useFmt();
  const ui = useUi();
  const classifier = useClassifier();
  const incomeSuggester = useIncomeSuggester();
  const byMonth = useExpensesByMonth();
  const incomesByMonth = useIncomesByMonth();
  const expected = useExpectedIncome();
  const locale = settings.locale;
  const currentMonth = monthKeyOf(today);
  const isIncome = kind === 'income';
  const sources = useMemo(() => incomeSourceFolders(), []);

  const [expr, setExpr] = useState(() => (initial ? centsToExpr(initial.amount) : ''));
  const [concept, setConcept] = useState(initial?.note ?? '');
  const [dateChoice, setDateChoice] = useState<DateStr | null>(initial && initial.date !== today ? initial.date : null);
  const [picked, setPicked] = useState<string | null>(initial?.categoryId ?? null);
  const [typing, setTyping] = useState(false);
  const keyboardOpen = useKeyboardOpen();
  const [dateOpen, setDateOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [shake, setShake] = useState(0);
  const [nudge, setNudge] = useState(0);
  const [bump, setBump] = useState(0);
  const [saved, setSaved] = useState<{ n: number; text: string; income: boolean } | null>(null);
  const [promoTick, setPromoTick] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const pillsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listenRef = useRef<Listening | null>(null);
  const holdTimer = useRef<number | null>(null);
  const heldBack = useRef(false);
  const savedCount = useRef(0);

  // ---- what the entry means right now
  const entry = useMemo(() => resolveEntry(expr, concept, dateChoice, today), [expr, concept, dateChoice, today]);
  const suggestion = useMemo(() => {
    if (!entry.note) return null;
    if (isIncome) {
      const found = incomeSuggester.suggest(entry.note);
      return found ? { categoryId: found.sourceId as string, matched: found.matched } : null;
    }
    const found = classifier.suggest(entry.note);
    return found ? { categoryId: found.categoryId, matched: found.matched } : null;
  }, [isIncome, incomeSuggester, classifier, entry.note]);
  const noteEdited = mode === 'new' || entry.note !== (initial?.note ?? '');
  const suggestedId = noteEdited ? (suggestion?.categoryId ?? null) : null;
  const targetId = mode === 'edit' ? picked : suggestedId;
  const pool = isIncome ? sources : categories;
  const target = pool.find((c) => c.id === targetId);

  const folders = useMemo(
    () => (isIncome ? rankFolders(sources, incomes.map((i) => ({ categoryId: i.sourceId, date: i.date })), today) : rankFolders(categories, expenses, today)),
    [isIncome, sources, incomes, categories, expenses, today],
  );
  const ordered = useMemo(() => {
    const first = suggestedId ? folders.find((f) => f.id === suggestedId) : undefined;
    return first ? [first, ...folders.filter((f) => f.id !== first.id)] : folders;
  }, [folders, suggestedId]);

  useEffect(() => {
    pillsRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
  }, [suggestedId, isIncome]);

  const monthStats = useMemo(() => computeMonthStats(byMonth.get(currentMonth) ?? [], currentMonth, today), [byMonth, currentMonth, today]);
  const incomeThisMonth = useMemo(() => sumIncomes(incomesByMonth.get(currentMonth) ?? []), [incomesByMonth, currentMonth]);

  const live = useMemo(() => {
    if (mode !== 'new' || entry.amount === null) return null;
    if (isIncome) {
      const month = monthKeyOf(entry.date);
      return describeIncomeLive({
        amount: entry.amount,
        date: entry.date,
        today,
        monthIncome: sumIncomes(incomesByMonth.get(month) ?? []),
        monthSpent: sumAmounts(byMonth.get(month) ?? []),
        fmt,
        locale,
      });
    }
    return describeLive({
      amount: entry.amount,
      date: entry.date,
      today,
      stats: monthStats,
      budget: settings.monthlyBudget,
      income: expected.amount,
      folder: target ? { name: target.name, limit: target.limit, spent: monthStats.byCategory.find((c) => c.categoryId === target.id)?.total ?? 0 } : null,
      fmt,
      locale,
    });
  }, [mode, isIncome, entry.amount, entry.date, today, monthStats, incomesByMonth, byMonth, settings.monthlyBudget, expected.amount, target, fmt, locale]);

  // The month summary is promoted at month's end / in the first days of the next one, until opened.
  const promo = useMemo(
    () => (mode === 'new' && !isIncome ? storyToPromote(today, expenses, monthStats.daysInMonth) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, isIncome, today, expenses, monthStats.daysInMonth, promoTick],
  );

  const hint = isIncome
    ? incomeThisMonth > 0
      ? `Este mes entraron ${fmt.formatRounded(incomeThisMonth)}`
      : incomes.length === 0
        ? 'Anota lo que te entra: sueldo, clientes, ventas'
        : 'Todavía no entró nada este mes'
    : monthStats.todayTotal > 0
      ? `Hoy llevas ${fmt.formatRounded(monthStats.todayTotal)}`
      : expenses.length === 0
        ? 'Un monto, una carpeta y listo'
        : 'Hoy sin gastos todavía';

  // ---- actions
  const press = (key: CalcKey) => {
    ui.haptic('tap');
    setBump((n) => n + 1);
    setExpr((prev) => pressKey(prev, key));
  };

  const reject = (message: string) => {
    ui.haptic('error');
    setShake((n) => n + 1);
    ui.toast({ text: message, tone: 'bad' });
  };

  const switchKind = (next: EntryKind) => {
    if (next === kind) return;
    ui.haptic('tap');
    setPicked(null);
    onKindChange?.(next);
  };

  const submit = (categoryId: string) => {
    if (entry.amount === null) {
      reject('Falta el monto');
      return;
    }
    ui.haptic('ok');
    onSubmit({ amount: entry.amount, categoryId, note: entry.note, date: entry.date, suggestedId: suggestion?.categoryId ?? null });
    if (mode === 'new') {
      setSaved({ n: ++savedCount.current, text: `${isIncome ? '+' : ''}${fmt.format(entry.amount)}`, income: isIncome });
      setExpr('');
      setConcept('');
      setDateChoice(null);
      inputRef.current?.blur();
    }
  };

  useEffect(() => {
    if (!saved) return;
    const id = window.setTimeout(() => setSaved(null), 1100);
    return () => window.clearTimeout(id);
  }, [saved]);

  const go = () => {
    if (entry.amount === null) return reject('Falta el monto');
    if (!targetId) {
      ui.haptic('error');
      setNudge((n) => n + 1);
      ui.toast({ text: isIncome ? 'Falta elegir de dónde viene' : 'Falta elegir la carpeta', tone: 'bad' });
      return;
    }
    submit(targetId);
  };

  /** Applies what can be understood from the concept text (an amount, a day) and tidies it up. */
  const commitConcept = (text: string) => {
    const p = parseExpensePhrase(text, today);
    if (p.amount === null && p.date === null) return;
    const typed = exprToCents(expr);
    if (p.amount !== null && !(typed !== null && typed > 0)) setExpr(centsToExpr(p.amount));
    if (p.date !== null && dateChoice === null) setDateChoice(p.date === today ? null : p.date);
    setConcept(p.concept);
  };

  const toggleMic = () => {
    if (listening) {
      listenRef.current?.stop();
      return;
    }
    ui.haptic('tap');
    setListening(true);
    let latest = '';
    listenRef.current = listen({
      lang: locale,
      onText: (text) => {
        latest = text;
        setConcept(text);
      },
      onEnd: () => {
        setListening(false);
        if (latest) commitConcept(latest);
      },
      onProblem: (problem) => {
        setListening(false);
        if (problem === 'denied') ui.toast({ text: 'No hay permiso para usar el micrófono', tone: 'bad' });
        else if (problem === 'other') ui.toast({ text: 'No se pudo escuchar. Prueba de nuevo', tone: 'bad' });
      },
    });
  };

  useEffect(() => () => listenRef.current?.stop(), []);

  // Physical keyboard (desktop): digits, operators, Enter to save.
  const latest = useRef({ press, go });
  latest.current = { press, go };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const dialogs = document.querySelectorAll('[role="dialog"],[role="alertdialog"]');
      const top = dialogs[dialogs.length - 1];
      const root = rootRef.current;
      if (!root) return;
      const active = mode === 'new' ? dialogs.length === 0 : !!top && top.getAttribute('role') === 'dialog' && top.contains(root);
      if (!active) return;
      if (/^[0-9]$/.test(e.key)) latest.current.press(e.key as CalcKey);
      else if (KEY_FOR[e.key]) {
        e.preventDefault();
        latest.current.press(KEY_FOR[e.key] as CalcKey);
      } else if (e.key === 'Backspace') latest.current.press('back');
      else if (e.key === 'Escape' && mode === 'new') latest.current.press('clear');
      else if (e.key === 'Enter') {
        e.preventDefault();
        latest.current.go();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  // Backspace: tap deletes one, hold clears everything.
  const startHold = () => {
    heldBack.current = false;
    holdTimer.current = window.setTimeout(() => {
      heldBack.current = true;
      ui.haptic('ok');
      setExpr('');
    }, 450);
  };
  const endHold = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  // ---- render
  const display = formatDisplay(expr, fmt);
  const showExpr = hasOperator(expr);
  const canSave = entry.amount !== null && targetId !== null && targetId !== undefined;

  const renderKey = (k: KeyDef) => (
    <button
      key={k.id}
      type="button"
      className={cx('key', `key--${k.kind}`)}
      aria-label={k.aria}
      onClick={() => {
        if (k.id === 'back') {
          if (heldBack.current) {
            heldBack.current = false;
            return;
          }
        }
        press(k.press);
      }}
      onPointerDown={k.id === 'back' ? startHold : undefined}
      onPointerUp={k.id === 'back' ? endHold : undefined}
      onPointerLeave={k.id === 'back' ? endHold : undefined}
      onPointerCancel={k.id === 'back' ? endHold : undefined}
    >
      {k.id === 'back' ? <Delete size={26} strokeWidth={2.2} /> : k.label}
    </button>
  );

  return (
    <div ref={rootRef} className={cx('calc', typing && keyboardOpen && 'calc--typing', mode === 'edit' && 'calc--edit')} data-kind={kind}>
      <div className="calc__panel">
        {mode === 'new' && <h1 className="sr-only">{isIncome ? 'Anotar un ingreso' : 'Anotar un gasto'}</h1>}
        {mode === 'new' && (
          <div className="calc__top">
            {onKindChange && (
              <div className="kindswitch" role="group" aria-label="Tipo de movimiento" style={{ '--i': isIncome ? 1 : 0 } as CSSProperties}>
                <button type="button" aria-pressed={!isIncome} onClick={() => switchKind('expense')}>
                  Gasto
                </button>
                <button type="button" aria-pressed={isIncome} onClick={() => switchKind('income')}>
                  Ingreso
                </button>
              </div>
            )}
            <button
              type="button"
              className="calc__month"
              aria-label={`Ver el resumen del mes: ${capitalize(monthName(currentMonth, locale))}, ${isIncome ? 'entró' : 'gastado'} ${fmt.formatRounded(isIncome ? incomeThisMonth : monthStats.total)}`}
              onClick={() => {
                ui.setMonth(currentMonth);
                ui.setTab('month');
              }}
            >
              <span aria-hidden="true">{capitalize(monthShort(currentMonth, locale))}</span>
              <strong aria-hidden="true">{isIncome ? `+${fmt.symbol} ${fmt.formatCompact(incomeThisMonth)}` : `${fmt.symbol} ${fmt.formatCompact(monthStats.total)}`}</strong>
              <ChevronRight size={16} strokeWidth={2.6} aria-hidden="true" />
            </button>
          </div>
        )}
        {promo && (
          <button
            type="button"
            className="calc__promo"
            onClick={() => {
              ui.openStory(promo);
              setPromoTick((t) => t + 1);
            }}
          >
            <Sparkles size={15} aria-hidden="true" />
            Tu {monthName(promo, locale)}
          </button>
        )}

        <div className="calc__display">
          <div className="calc__expr" aria-hidden={!showExpr}>
            {showExpr ? formatExpression(expr, fmt) : ' '}
          </div>
          <output key={shake} className={cx('calc__amount', shake > 0 && 'is-shaking')} aria-label="Monto">
            <span className="calc__cur">{isIncome ? `+${fmt.symbol}` : fmt.symbol}</span>
            <span key={bump} className={cx('calc__num', bump > 0 && 'is-bump')} style={{ '--n': display.length } as CSSProperties}>
              {display}
            </span>
          </output>
          {saved && (
            <span key={saved.n} className={cx('calc__fly', saved.income && 'calc__fly--in')} aria-hidden="true">
              {saved.text}
              {saved.income && <Burst />}
            </span>
          )}
        </div>

        <div className="calc__concept">
          <input
            ref={inputRef}
            className="calc__input"
            type="text"
            inputMode="text"
            enterKeyHint="done"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            maxLength={80}
            placeholder={isIncome ? '¿De qué? Ej: sueldo, cliente, venta' : '¿En qué? Ej: propina, uber, súper'}
            aria-label={isIncome ? '¿De qué es el ingreso?' : '¿En qué gastaste?'}
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            onFocus={() => setTyping(true)}
            onBlur={() => {
              setTyping(false);
              commitConcept(concept);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              const resolved = resolveEntry(expr, concept, dateChoice, today);
              commitConcept(concept);
              if (mode === 'new' && resolved.amount !== null && suggestion) submit(suggestion.categoryId);
              else inputRef.current?.blur();
            }}
          />
          {speechSupported() && (
            <button type="button" className={cx('calc__mic', listening && 'is-on')} aria-label={listening ? 'Dejar de escuchar' : 'Dictar'} aria-pressed={listening} onClick={toggleMic}>
              <Mic size={22} />
            </button>
          )}
        </div>

        <p className="calc__live" data-tone={live?.tone ?? 'neutral'} aria-live="polite">
          {live ? live.text : mode === 'new' ? hint : ''}
        </p>
      </div>

      <div key={nudge} ref={pillsRef} className={cx('calc__pills', nudge > 0 && 'is-nudged')}>
        <button type="button" className={cx('pill pill--date', dateChoice && 'is-set')} onClick={() => setDateOpen(true)}>
          <CalendarDays size={18} aria-hidden="true" />
          {formatDayHeading(entry.date, today, locale)}
        </button>
        {ordered.map((c) => (
          <FolderPill
            key={c.id}
            category={c}
            suggested={c.id === suggestedId}
            selected={mode === 'edit' && c.id === picked}
            reason={c.id === suggestedId && suggestion ? `Interpreté «${suggestion.matched}»` : undefined}
            onClick={() => (mode === 'new' ? submit(c.id) : setPicked(c.id))}
          />
        ))}
        {!isIncome && (
          <button type="button" className="pill pill--add" onClick={() => ui.editFolder('new')}>
            <FolderPlus size={18} aria-hidden="true" />
            Carpeta
          </button>
        )}
      </div>

      <div className="calc__pad" role="group" aria-label="Teclado">
        {PAD.map((row) => row.map(renderKey))}
        <button type="button" className="key key--digit" aria-label="Coma decimal" onClick={() => press('.')}>
          {fmt.decimalSeparator}
        </button>
        <button type="button" className="key key--digit" aria-label="0" onClick={() => press('0')}>
          0
        </button>
        <button type="button" className="key key--go" aria-disabled={!canSave} onClick={go}>
          <Check size={24} strokeWidth={3} aria-hidden="true" />
          <span className="key__go-text">
            <span>{mode === 'edit' ? 'Guardar cambios' : 'Guardar'}</span>
            {target && (
              <span className="key__sub">
                {target.emoji} {target.name}
              </span>
            )}
          </span>
        </button>
      </div>

      {footer}
      {dateOpen && <DateSheet value={dateChoice} today={today} locale={locale} onPick={setDateChoice} onClose={() => setDateOpen(false)} />}

      {suggestedId && suggestion && target && (
        <p className="sr-only" role="status">
          Interpreté «{suggestion.matched}»: {isIncome ? 'fuente' : 'carpeta'} {target.name}
        </p>
      )}
    </div>
  );
}
