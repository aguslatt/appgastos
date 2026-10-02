import { ChevronRight, Download, FileSpreadsheet, FolderPlus, Plus, Share, Smartphone, Sparkles, Trash2, Upload } from 'lucide-react';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AiSettings } from '../components/AiSettings';
import { BudgetSheet } from '../components/BudgetSheet';
import { IncomeSheet } from '../components/IncomeSheet';
import { ImportSheet } from '../components/ImportSheet';
import { RecurringSheet } from '../components/RecurringSheet';
import { cx } from '../components/cx';
import { backupFileName, expensesToCsv, parseBackup, serializeBackup } from '../lib/backup';
import { colorVar } from '../lib/categories';
import { makeIdGenerator } from '../lib/data';
import { formatShortDate } from '../lib/dates';
import { generateDemo } from '../lib/demo';
import { saveTextFile } from '../lib/files';
import { CURRENCIES, getMoneyFormatter } from '../lib/money';
import { nextPayments } from '../lib/recurring';
import type { AppData, ThemePref } from '../lib/types';
import { useCategoryMap, useFmt, useToday } from '../state/derived';
import { aiConfig } from '../state/ai';
import { useInstall } from '../state/install';
import { store, useData } from '../state/store';
import { useUi } from '../state/ui';

type Sheet = { kind: 'budget' } | { kind: 'income' } | { kind: 'recurring'; id: string } | { kind: 'import'; data: AppData };

const THEMES: Array<{ id: ThemePref; label: string }> = [
  { id: 'system', label: 'Automático' },
  { id: 'light', label: 'Claro' },
  { id: 'dark', label: 'Oscuro' },
];

function readLastBackup(): string | null {
  try {
    return localStorage.getItem('mg:lastBackup');
  } catch {
    return null;
  }
}

function Section({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <section className="section">
      <h2 className="section__title">{title}</h2>
      {children}
      {note && <p className="section__note">{note}</p>}
    </section>
  );
}

function ValueRow({ title, sub, value, onClick }: { title: string; sub?: string; value: string; onClick: () => void }) {
  return (
    <button type="button" className="row" onClick={onClick}>
      <span className="row__main">
        <span className="row__title">{title}</span>
        {sub && <span className="row__sub">{sub}</span>}
      </span>
      <span className="row__value">{value}</span>
      <ChevronRight size={18} className="row__chev" aria-hidden="true" />
    </button>
  );
}

export function SettingsScreen() {
  const { settings, categories, recurring, expenses } = useData();
  const fmt = useFmt();
  const today = useToday();
  const ui = useUi();
  const install = useInstall();
  const catMap = useCategoryMap();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const active = categories.filter((c) => !c.archived);
  const hidden = categories.filter((c) => c.archived);
  const hasDemo = expenses.some((e) => e.demo);
  const payments = nextPayments(recurring, today);
  const paused = recurring.filter((r) => !r.active);
  const lastBackup = readLastBackup();

  const stamp = () => {
    try {
      localStorage.setItem('mg:lastBackup', new Date().toISOString());
    } catch {
      // not critical
    }
  };

  const exportJson = async () => {
    const result = await saveTextFile(backupFileName('json', today), serializeBackup(store.getData()), 'application/json');
    if (result === 'cancelled') return;
    stamp();
    ui.toast({ text: result === 'shared' ? 'Copia lista para guardar' : 'Copia descargada' });
  };

  const exportCsv = async () => {
    const result = await saveTextFile(backupFileName('csv', today), expensesToCsv(store.getData(), getMoneyFormatter(settings.locale, settings.currency)), 'text/csv');
    if (result !== 'cancelled') ui.toast({ text: result === 'shared' ? 'Planilla lista para guardar' : 'Planilla descargada' });
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    const parsed = parseBackup(await file.text(), makeIdGenerator());
    if (!parsed) {
      ui.toast({ text: 'Ese archivo no parece una copia de esta app', tone: 'bad' });
      return;
    }
    setSheet({ kind: 'import', data: parsed });
  };

  const loadDemo = () => {
    const n = store.addDemoExpenses(generateDemo({ today, currency: settings.currency, categories }));
    ui.toast({ text: `Listo: ${n} gastos de ejemplo de los últimos meses` });
    ui.setTab('month');
  };

  const removeDemo = () => {
    const n = store.removeDemoExpenses();
    ui.toast({ text: `Se quitaron ${n} gastos de ejemplo` });
  };

  const wipe = async () => {
    const ok = await ui.confirm({
      title: '¿Borrar todo?',
      text: 'Se eliminan gastos, carpetas, ajustes y la clave de la IA de este teléfono. No se puede deshacer. Si no hiciste una copia, se pierde.',
      confirmLabel: 'Borrar todo',
      danger: true,
    });
    if (!ok) return;
    store.resetAll();
    aiConfig.clear();
    ui.setTab('calc');
  };

  const relative = (iso: string): string => {
    const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
    return new Intl.RelativeTimeFormat(settings.locale, { numeric: 'auto' }).format(-days, 'day');
  };

  return (
    <div className="screen--pad settings">
      <div className="screen__head">
        <h1 className="screen__title">Ajustes</h1>
      </div>

      <Section title="Tu plata">
        <div className="list">
          <ValueRow title="Presupuesto mensual" sub="Para ver cuánto queda por día" value={settings.monthlyBudget ? fmt.formatRounded(settings.monthlyBudget) : 'Sin definir'} onClick={() => setSheet({ kind: 'budget' })} />
          <ValueRow title="Ingreso mensual" sub="Opcional: gastos en horas de trabajo" value={settings.monthlyIncome ? fmt.formatRounded(settings.monthlyIncome) : 'Sin definir'} onClick={() => setSheet({ kind: 'income' })} />
          <label className="row">
            <span className="row__main">
              <span className="row__title">Moneda</span>
              <span className="row__sub">Cambia el símbolo; los montos no se convierten</span>
            </span>
            <select
              className="select-inline"
              value={settings.currency}
              aria-label="Moneda"
              onChange={(e) => store.updateSettings({ currency: e.target.value })}
            >
              {CURRENCIES.some((c) => c.code === settings.currency) ? null : <option value={settings.currency}>{settings.currency}</option>}
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Section>

      <Section title="Carpetas" note="Tocar una carpeta al anotar guarda el gasto ahí. La IA aprende de dónde las pones.">
        <div className="list">
          {active.map((c) => (
            <button key={c.id} type="button" className="row" onClick={() => ui.editFolder(c.id)}>
              <span className="badge" style={{ '--badge-color': colorVar(c.color) } as CSSProperties}>
                {c.emoji}
              </span>
              <span className="row__main">
                <span className="row__title">{c.name}</span>
                {(c.limit || c.flexible) && (
                  <span className="row__sub">
                    {c.limit ? `Tope ${fmt.formatRounded(c.limit)}` : ''}
                    {c.limit && c.flexible ? ' · ' : ''}
                    {c.flexible ? 'Recortable' : ''}
                  </span>
                )}
              </span>
              <ChevronRight size={18} className="row__chev" aria-hidden="true" />
            </button>
          ))}
        </div>
        {hidden.length > 0 && (
          <div className="list list--muted">
            {hidden.map((c) => (
              <button key={c.id} type="button" className="row" onClick={() => ui.editFolder(c.id)}>
                <span className="badge" style={{ '--badge-color': colorVar(c.color) } as CSSProperties}>
                  {c.emoji}
                </span>
                <span className="row__main">
                  <span className="row__title">{c.name}</span>
                  <span className="row__sub">Oculta del teclado</span>
                </span>
                <ChevronRight size={18} className="row__chev" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        <button className="btn btn--soft btn--block section__action" onClick={() => ui.editFolder('new')}>
          <FolderPlus size={18} />
          Nueva carpeta
        </button>
      </Section>

      <Section title="Pagos fijos" note="Alquiler, servicios, suscripciones: se anotan solos el día que corresponde.">
        {payments.length + paused.length > 0 && (
          <div className="list">
            {payments.map(({ rule, date }) => {
              const cat = catMap.get(rule.categoryId);
              return (
                <button key={rule.id} type="button" className="row" onClick={() => setSheet({ kind: 'recurring', id: rule.id })}>
                  <span className="badge" style={{ '--badge-color': colorVar(cat?.color ?? 'slate') } as CSSProperties}>
                    {cat?.emoji ?? '🔁'}
                  </span>
                  <span className="row__main">
                    <span className="row__title">{rule.note || cat?.name || 'Pago fijo'}</span>
                    <span className="row__sub">Próximo: {formatShortDate(date, settings.locale)}</span>
                  </span>
                  <span className="row__end tnum">{fmt.formatRounded(rule.amount)}</span>
                </button>
              );
            })}
            {paused.map((rule) => {
              const cat = catMap.get(rule.categoryId);
              return (
                <button key={rule.id} type="button" className="row row--paused" onClick={() => setSheet({ kind: 'recurring', id: rule.id })}>
                  <span className="badge" style={{ '--badge-color': colorVar(cat?.color ?? 'slate') } as CSSProperties}>
                    {cat?.emoji ?? '🔁'}
                  </span>
                  <span className="row__main">
                    <span className="row__title">{rule.note || cat?.name || 'Pago fijo'}</span>
                    <span className="row__sub">En pausa</span>
                  </span>
                  <span className="row__end tnum">{fmt.formatRounded(rule.amount)}</span>
                </button>
              );
            })}
          </div>
        )}
        <button className="btn btn--soft btn--block section__action" onClick={() => setSheet({ kind: 'recurring', id: 'new' })}>
          <Plus size={18} />
          Agregar pago fijo
        </button>
      </Section>

      <Section title="Apariencia">
        <div className="card stack" style={{ gap: 16 }}>
          <div className="segmented" role="group" aria-label="Tema">
            {THEMES.map((t) => (
              <button key={t.id} type="button" className="segmented__item" aria-pressed={settings.theme === t.id} onClick={() => store.updateSettings({ theme: t.id })}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="row row--plain">
            <div className="row__main">
              <div className="row__title">Vibración al tocar</div>
              <div className="row__sub">Un toque suave en las teclas (según el teléfono)</div>
            </div>
            <button type="button" role="switch" aria-checked={settings.haptics} aria-label="Vibración al tocar" className="switch" onClick={() => store.updateSettings({ haptics: !settings.haptics })} />
          </div>
        </div>
      </Section>

      {!install.standalone && (
        <Section title="Instalar">
          <div className="card install">
            <span className="install__icon" aria-hidden="true">
              <Smartphone size={26} />
            </span>
            <div className="install__text">
              <div className="row__title">Úsala como una app</div>
              {install.canPrompt ? (
                <p className="muted">Se abre directo en la calculadora, a pantalla completa y sin internet.</p>
              ) : install.ios ? (
                <p className="muted">
                  Toca <Share size={14} style={{ verticalAlign: '-2px' }} aria-label="Compartir" /> y luego «Agregar a pantalla de inicio».
                </p>
              ) : (
                <p className="muted">En el menú del navegador busca «Instalar app» o «Agregar a pantalla de inicio».</p>
              )}
            </div>
            {install.canPrompt && (
              <button className="btn btn--small" onClick={() => void install.prompt()}>
                Instalar
              </button>
            )}
          </div>
        </Section>
      )}

      <Section title="IA con búsqueda en internet" note="Opcional. Para las metas de viaje y de mudanza: busca precios de ahora y completa los datos por ti. La app funciona igual sin esto.">
        <AiSettings />
      </Section>

      <Section title="Tus datos" note="Todo se guarda solo en este teléfono, sin cuentas ni servidores. Haz una copia de vez en cuando, por si cambias de equipo.">
        <div className="list">
          <button type="button" className="row" onClick={exportJson}>
            <Download size={20} aria-hidden="true" />
            <span className="row__main">
              <span className="row__title">Guardar copia de seguridad</span>
              <span className="row__sub">{lastBackup ? `Última copia: ${relative(lastBackup)}` : 'Aún sin copias'}</span>
            </span>
          </button>
          <button type="button" className="row" onClick={() => fileRef.current?.click()}>
            <Upload size={20} aria-hidden="true" />
            <span className="row__main">
              <span className="row__title">Importar copia</span>
              <span className="row__sub">Desde un archivo .json guardado antes</span>
            </span>
          </button>
          <button type="button" className="row" onClick={exportCsv}>
            <FileSpreadsheet size={20} aria-hidden="true" />
            <span className="row__main">
              <span className="row__title">Exportar a planilla</span>
              <span className="row__sub">CSV para Excel o Google Sheets</span>
            </span>
          </button>
          {hasDemo ? (
            <button type="button" className="row" onClick={removeDemo}>
              <Sparkles size={20} aria-hidden="true" />
              <span className="row__main">
                <span className="row__title">Quitar datos de ejemplo</span>
                <span className="row__sub">Tus gastos reales no se tocan</span>
              </span>
            </button>
          ) : (
            <button type="button" className="row" onClick={loadDemo}>
              <Sparkles size={20} aria-hidden="true" />
              <span className="row__main">
                <span className="row__title">Cargar datos de ejemplo</span>
                <span className="row__sub">Para ver cómo se ve con meses de movimientos</span>
              </span>
            </button>
          )}
          <button type="button" className={cx('row', 'row--danger')} onClick={wipe}>
            <Trash2 size={20} aria-hidden="true" />
            <span className="row__main">
              <span className="row__title">Borrar todo</span>
              <span className="row__sub">Gastos, carpetas, ajustes y clave de IA</span>
            </span>
          </button>
        </div>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => {
          void pickFile(e.target.files?.[0]);
          e.target.value = '';
        }} />
      </Section>

      <p className="about">
        Cuánto · versión {__APP_VERSION__}
        <br />
        Hecha para ver cuánto gastas, sin complicarte.
      </p>

      {sheet?.kind === 'budget' && <BudgetSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === 'income' && <IncomeSheet onClose={() => setSheet(null)} />}
      {sheet?.kind === 'recurring' && <RecurringSheet id={sheet.id} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'import' && <ImportSheet incoming={sheet.data} onClose={() => setSheet(null)} />}
    </div>
  );
}
