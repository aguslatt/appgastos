import { AlertTriangle, CheckCircle2, ExternalLink, HelpCircle, Loader2, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AI_MODELS, AiError, DEFAULT_AI_MODEL, checkKey, cleanKey, type AiModelId, type AiProgress, type AiSource, type Confidence } from '../lib/ai';
import { aiConfig, useAiConfig } from '../state/ai';
import { useUi } from '../state/ui';
import { cx } from './cx';

// ---- running a request -------------------------------------------------------------------------------

export type AiTaskState<T> =
  | { status: 'idle' }
  | { status: 'running'; progress: AiProgress | null }
  | { status: 'done'; value: T }
  | { status: 'error'; error: AiError };

export interface AiJobContext {
  signal: AbortSignal;
  onProgress: (progress: AiProgress) => void;
}

/** One AI request at a time: progress, cancel, and nothing left running when the screen goes away. */
export function useAiTask<T>() {
  const [state, setState] = useState<AiTaskState<T>>({ status: 'idle' });
  const current = useRef<AbortController | null>(null);

  const run = useCallback(async (job: (ctx: AiJobContext) => Promise<T>) => {
    current.current?.abort();
    const controller = new AbortController();
    current.current = controller;
    const live = () => current.current === controller;
    setState({ status: 'running', progress: null });
    try {
      const value = await job({
        signal: controller.signal,
        onProgress: (progress) => {
          if (live()) setState({ status: 'running', progress });
        },
      });
      if (live()) setState({ status: 'done', value });
    } catch (e) {
      if (!live()) return;
      const error = e instanceof AiError ? e : new AiError('failed', 'Algo salió mal. Inténtalo de nuevo.');
      setState(error.code === 'aborted' ? { status: 'idle' } : { status: 'error', error });
    }
  }, []);

  const cancel = useCallback(() => current.current?.abort(), []);
  const reset = useCallback(() => {
    current.current?.abort();
    current.current = null;
    setState({ status: 'idle' });
  }, []);

  useEffect(() => () => current.current?.abort(), []);
  return { state, run, cancel, reset };
}

// ---- the key ---------------------------------------------------------------------------------------------

export function AiPrivacy() {
  return (
    <p className="ai__privacy">
      <ShieldCheck size={16} aria-hidden="true" />
      <span>
        La clave se guarda solo en este teléfono. Las consultas van directo a Anthropic y solo llevan la zona o el destino, los días, la fecha y la moneda: nunca tus gastos. Cada consulta usa saldo de tu
        cuenta de Anthropic y suele costar una fracción de dólar.
      </span>
    </p>
  );
}

export function ModelPicker({ value, onChange }: { value: AiModelId; onChange: (model: AiModelId) => void }) {
  const hint = AI_MODELS.find((m) => m.id === value)?.hint;
  return (
    <div className="field">
      <span className="field__label">Modelo</span>
      <div className="segmented" role="group" aria-label="Modelo de IA">
        {AI_MODELS.map((m) => (
          <button key={m.id} type="button" className="segmented__item" aria-pressed={value === m.id} onClick={() => onChange(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {hint && <span className="field__hint">{hint}</span>}
    </div>
  );
}

/** Paste the key once: it is tried against Anthropic (for free) before it is kept. */
export function AiKeyForm({ onSaved }: { onSaved?: () => void }) {
  const saved = useAiConfig();
  const ui = useUi();
  const task = useAiTask<void>();
  const [text, setText] = useState('');
  const [model, setModel] = useState<AiModelId>(saved?.model ?? DEFAULT_AI_MODEL);
  const [formatError, setFormatError] = useState(false);
  const busy = task.state.status === 'running';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const key = cleanKey(text);
    setFormatError(key === null);
    if (key === null) return;
    void task.run(async ({ signal }) => {
      await checkKey(key, model, signal);
      const kept = aiConfig.save({ key, model, origin: saved?.origin ?? '' });
      ui.toast(kept ? { text: 'IA conectada' } : { text: 'IA conectada', detail: 'Este navegador no la guarda: tendrás que pegarla de nuevo al cerrar.' });
      onSaved?.();
    });
  };

  return (
    <form className="stack" onSubmit={submit} autoComplete="off">
      <label className="field">
        <span className="field__label">Clave de API de Anthropic</span>
        <input
          className="input"
          type="password"
          name="anthropic-api-key"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="sk-ant-…"
          value={text}
          aria-invalid={formatError}
          onChange={(e) => {
            setText(e.target.value);
            setFormatError(false);
          }}
        />
        <span className="field__hint">
          {formatError ? (
            'Esa clave no parece completa. Cópiala entera desde la consola de Anthropic.'
          ) : (
            <>
              La creas en{' '}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">
                console.anthropic.com <ExternalLink size={12} aria-hidden="true" />
              </a>{' '}
              (API keys). Tu cuenta necesita saldo cargado.
            </>
          )}
        </span>
      </label>
      <ModelPicker value={model} onChange={setModel} />
      {task.state.status === 'error' && (
        <p className="ai__error" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>{task.state.error.message}</span>
        </p>
      )}
      <button className="btn btn--block" type="submit" disabled={busy || text.trim() === ''}>
        {busy ? (
          <>
            <Loader2 size={18} className="ai__spin" aria-hidden="true" /> Probando la clave…
          </>
        ) : (
          'Guardar y probar'
        )}
      </button>
      <AiPrivacy />
    </form>
  );
}

// ---- progress, failure, results ----------------------------------------------------------------------------

export function AiRunning({ progress, onCancel }: { progress: AiProgress | null; onCancel: () => void }) {
  const title = !progress ? 'Conectando…' : progress.phase === 'search' ? 'Buscando en internet' : progress.phase === 'read' ? 'Leyendo los resultados…' : 'Armando la respuesta…';
  const detail =
    progress?.phase === 'search' && progress.query
      ? `«${progress.query}»`
      : progress && progress.searches > 0
        ? `${progress.searches} ${progress.searches === 1 ? 'búsqueda' : 'búsquedas'} hasta ahora`
        : 'Puede tardar hasta un minuto.';
  return (
    <div className="ai__run" role="status" aria-live="polite">
      <Loader2 size={22} className="ai__spin" aria-hidden="true" />
      <div className="ai__run-text">
        <b>{title}</b>
        <span>{detail}</span>
      </div>
      <button type="button" className="btn btn--ghost btn--small" onClick={onCancel}>
        Cancelar
      </button>
    </div>
  );
}

export function AiFailure({ error, onRetry, onChangeKey }: { error: AiError; onRetry: () => void; onChangeKey: () => void }) {
  const keyProblem = error.code === 'bad-key';
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="ai__error" role="alert">
        <AlertTriangle size={16} aria-hidden="true" />
        <span>{error.message}</span>
      </p>
      <div className="ai__actions">
        {keyProblem ? (
          <button type="button" className="btn btn--soft btn--small" onClick={onChangeKey}>
            Cambiar la clave
          </button>
        ) : (
          <button type="button" className="btn btn--soft btn--small" onClick={onRetry}>
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}

const CONFIDENCE: Record<Confidence, { label: string; Icon: typeof CheckCircle2; tone: string }> = {
  high: { label: 'Bien respaldado', Icon: CheckCircle2, tone: 'chip--good' },
  medium: { label: 'Aproximado', Icon: HelpCircle, tone: '' },
  low: { label: 'Poco seguro', Icon: AlertTriangle, tone: 'chip--warn' },
};

/** How much to trust the numbers: always an icon plus words, never color alone. */
export function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  const { label, Icon, tone } = CONFIDENCE[confidence];
  return (
    <span className={cx('chip', tone)}>
      <Icon size={15} aria-hidden="true" />
      {label}
    </span>
  );
}

/** Where the numbers come from, or an honest note that nothing was looked up. */
export function AiSources({ sources, live }: { sources: AiSource[]; live: boolean }) {
  if (!live || sources.length === 0) {
    return <p className="ai__notes">No pudo buscar en internet: respondió con lo que ya sabe. Tómalo como una idea aproximada y ajústalo con valores reales.</p>;
  }
  return (
    <div className="ai__sources">
      <span className="field__label">Fuentes que miró</span>
      <ul>
        {sources.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noopener noreferrer">
              <span>{s.title}</span>
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
