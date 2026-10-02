import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { aiConfig, useAiConfig } from '../state/ai';
import { useUi } from '../state/ui';
import { AiKeyForm, AiPrivacy, ModelPicker } from './AiShared';

/** Connect, change or remove the person's own Anthropic key, and pick the model. */
export function AiSettings() {
  const config = useAiConfig();
  const ui = useUi();
  const [changing, setChanging] = useState(false);

  if (!config) {
    return (
      <div className="card">
        <AiKeyForm />
      </div>
    );
  }

  const remove = () => {
    aiConfig.clear();
    setChanging(false);
    ui.toast({ text: 'Clave quitada de este teléfono' });
  };

  return (
    <div className="card stack">
      <div className="ai__status">
        <CheckCircle2 size={20} aria-hidden="true" />
        <div>
          <b>IA conectada</b>
          <span>Clave terminada en …{config.key.slice(-4)}</span>
        </div>
      </div>
      <ModelPicker value={config.model} onChange={(model) => aiConfig.update({ model })} />
      {changing && <AiKeyForm onSaved={() => setChanging(false)} />}
      <div className="ai__actions ai__actions--row">
        <button type="button" className="btn btn--soft btn--small" onClick={() => setChanging((c) => !c)}>
          {changing ? 'Cancelar' : 'Cambiar clave'}
        </button>
        <button type="button" className="btn btn--soft btn--small" onClick={remove}>
          Quitar clave
        </button>
      </div>
      {!changing && <AiPrivacy />}
    </div>
  );
}
