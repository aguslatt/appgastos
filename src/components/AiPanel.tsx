import { Sparkles } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useAiConfig } from '../state/ai';
import { AiFailure, AiKeyForm, AiRunning, type useAiTask } from './AiShared';

type Task<T> = ReturnType<typeof useAiTask<T>>;

interface AiPanelProps<T> {
  title: string;
  task: Task<T>;
  /** What to show before searching, with the button that starts it. */
  controls: ReactNode;
  /** What to show once there is an answer. */
  result: (value: T) => ReactNode;
  onRetry: () => void;
}

/**
 * The frame around an optional AI search: connecting the key, waiting, failing, and showing the answer.
 * Without a key it stays a quiet invitation; the app works the same without it.
 */
export function AiPanel<T>({ title, task, controls, result, onRetry }: AiPanelProps<T>) {
  const config = useAiConfig();
  const [connecting, setConnecting] = useState(false);
  const { state } = task;

  let body: ReactNode;
  if (state.status === 'running') {
    body = <AiRunning progress={state.progress} onCancel={task.cancel} />;
  } else if (connecting) {
    body = (
      <>
        <AiKeyForm onSaved={() => setConnecting(false)} />
        <button type="button" className="btn btn--ghost btn--small" onClick={() => setConnecting(false)}>
          Ahora no
        </button>
      </>
    );
  } else if (!config) {
    body = (
      <>
        <p className="ai__lead">Para buscar precios reales hace falta tu propia clave de Anthropic. Es opcional: sin ella sigues con las estimaciones de la app.</p>
        <button type="button" className="btn btn--soft btn--block" onClick={() => setConnecting(true)}>
          Conectar la IA
        </button>
      </>
    );
  } else if (state.status === 'error') {
    body = (
      <AiFailure
        error={state.error}
        onRetry={onRetry}
        onChangeKey={() => {
          task.reset();
          setConnecting(true);
        }}
      />
    );
  } else if (state.status === 'done') {
    body = result(state.value);
  } else {
    body = controls;
  }

  return (
    <section className="ai" aria-label={title}>
      <div className="ai__head">
        <Sparkles size={18} aria-hidden="true" />
        <b>{title}</b>
        <span className="chip">Opcional</span>
      </div>
      {body}
    </section>
  );
}
