import { Check, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { guessKind } from '../lib/classifier';
import { COLOR_KEYS, COLOR_LABELS, EMOJI_CHOICES, FALLBACK_CATEGORY_ID, colorVar, pickNewCategoryColor } from '../lib/categories';
import { parseAmountText } from '../lib/money';
import type { Category } from '../lib/types';
import { useFmt } from '../state/derived';
import { store, useData } from '../state/store';
import { useUi } from '../state/ui';
import { cx } from './cx';
import { FolderPill } from './FolderPill';
import { Sheet } from './Sheet';

/** Create or edit a folder (name, emoji, color, monthly limit). Opened with `ui.editFolder(id | 'new')`. */
export function FolderSheet() {
  const ui = useUi();
  const { categories } = useData();
  if (ui.folderEdit === null) return null;
  const existing = ui.folderEdit === 'new' ? undefined : categories.find((c) => c.id === ui.folderEdit);
  if (ui.folderEdit !== 'new' && !existing) return null;
  return <FolderForm key={ui.folderEdit} existing={existing} />;
}

function FolderForm({ existing }: { existing?: Category }) {
  const ui = useUi();
  const fmt = useFmt();
  const { categories } = useData();
  const [name, setName] = useState(existing?.name ?? '');
  const [emoji, setEmoji] = useState(existing?.emoji ?? '📁');
  const [color, setColor] = useState(existing?.color ?? pickNewCategoryColor(categories));
  const [flexible, setFlexible] = useState(existing?.flexible ?? false);
  const [limitText, setLimitText] = useState(existing?.limit ? String(existing.limit / 100).replace('.', fmt.decimalSeparator) : '');

  const close = () => ui.editFolder(null);
  const limit = limitText.trim() === '' ? null : parseAmountText(limitText);
  const limitInvalid = limitText.trim() !== '' && (limit === null || limit <= 0);
  const valid = name.trim().length > 0 && !limitInvalid;
  const isFallback = existing?.id === FALLBACK_CATEGORY_ID;

  const save = () => {
    if (!valid) return;
    if (existing) {
      store.updateCategory(existing.id, { name, emoji, color, flexible, limit });
      ui.toast({ text: 'Carpeta actualizada' });
    } else {
      const kind = guessKind(name);
      store.addCategory({ name, emoji, color, flexible, limit, ...(kind && { kind }) });
      ui.toast({ text: `Carpeta «${name.trim()}» creada` });
    }
    ui.haptic('ok');
    close();
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await ui.confirm({
      title: `¿Eliminar «${existing.name}»?`,
      text: 'Sus gastos pasan a la carpeta Otros. No se pierde ninguno.',
      confirmLabel: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    store.deleteCategory(existing.id);
    ui.toast({ text: 'Carpeta eliminada' });
    close();
  };

  const preview: Category = { id: 'preview', name: name.trim() || 'Nombre', emoji, color, flexible, limit: null, archived: false };

  return (
    <Sheet title={existing ? 'Editar carpeta' : 'Nueva carpeta'} onClose={close}>
      <div className="stack">
        <div className="folder-preview">
          <FolderPill category={preview} onClick={() => undefined} />
        </div>

        <label className="field">
          <span className="field__label">Nombre</span>
          <input className="input" value={name} maxLength={30} placeholder="Ej: Viaje a Brasil" onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="field">
          <span className="field__label">Ícono</span>
          <div className="emoji-grid" role="radiogroup" aria-label="Ícono">
            {EMOJI_CHOICES.map((e) => (
              <button key={e} type="button" role="radio" aria-checked={e === emoji} aria-label={e} className={cx('emoji-btn', e === emoji && 'is-on')} onClick={() => setEmoji(e)}>
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field__label">Color</span>
          <div className="color-row" role="radiogroup" aria-label="Color">
            {COLOR_KEYS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={k === color}
                aria-label={COLOR_LABELS[k]}
                className={cx('color-dot', k === color && 'is-on')}
                style={{ '--dot': colorVar(k) } as CSSProperties}
                onClick={() => setColor(k)}
              >
                {k === color && <Check size={16} strokeWidth={3.4} />}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span className="field__label">Tope mensual (opcional)</span>
          <input
            className="input"
            inputMode="decimal"
            placeholder={`Ej: ${fmt.formatNumber(50_000_00)}`}
            value={limitText}
            aria-invalid={limitInvalid}
            onChange={(e) => setLimitText(e.target.value)}
          />
          <span className="field__hint">{limitInvalid ? 'Escribe un monto válido' : 'Te aviso al anotar un gasto que se acerque o pase este tope.'}</span>
        </label>

        <div className="row row--plain">
          <div className="row__main">
            <div className="row__title">Gasto recortable</div>
            <div className="row__sub">Ocio, salidas, compras… Los consejos del resumen empiezan por acá.</div>
          </div>
          <button type="button" role="switch" aria-checked={flexible} aria-label="Gasto recortable" className="switch" onClick={() => setFlexible((v) => !v)} />
        </div>

        <button className="btn btn--block" disabled={!valid} onClick={save}>
          {existing ? 'Guardar cambios' : 'Crear carpeta'}
        </button>

        {existing && !isFallback && (
          <div className="folder-danger">
            <button
              className="btn btn--soft btn--block"
              onClick={() => {
                store.updateCategory(existing.id, { archived: !existing.archived });
                ui.toast({ text: existing.archived ? 'Carpeta visible otra vez' : 'Carpeta oculta del teclado' });
                close();
              }}
            >
              {existing.archived ? <Eye size={18} /> : <EyeOff size={18} />}
              {existing.archived ? 'Mostrar en el teclado' : 'Ocultar del teclado'}
            </button>
            <button className="btn btn--ghost btn--block" onClick={remove}>
              <Trash2 size={18} />
              Eliminar carpeta
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
