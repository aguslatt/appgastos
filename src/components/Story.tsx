import { ChevronLeft, ChevronRight, Share2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { colorVar } from '../lib/categories';
import { weekdayInitial } from '../lib/dates';
import { analyzeMonth, buildStory, plainTitle, shareText, verdictFor } from '../lib/insights';
import { useFmt, useToday } from '../state/derived';
import { useOverlayHistory } from '../state/overlay';
import { useData } from '../state/store';
import { markStorySeen } from '../state/storySeen';
import { useUi } from '../state/ui';
import { cx } from './cx';
import { overlayRoot } from './Sheet';
import { useFocusTrap } from './useFocusTrap';

/** Full-screen month summary, told as a short sequence of slides. Opened with `ui.openStory(month)`. */
export function StoryOverlay() {
  const ui = useUi();
  if (!ui.storyMonth) return null;
  return <Story key={ui.storyMonth} month={ui.storyMonth} onClose={() => ui.openStory(null)} />;
}

function Headline({ text }: { text: string }) {
  if (!text.includes('*')) {
    return (
      <h2 className="story__title">
        <b>{text}</b>
      </h2>
    );
  }
  return (
    <h2 className="story__title" aria-label={plainTitle(text)}>
      {text.split('*').map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>))}
    </h2>
  );
}

function WeekdayBars({ values, highlight, locale }: { values: number[]; highlight: number; locale: string }) {
  const max = Math.max(...values, 1);
  return (
    <div className="wbars" role="img" aria-label="Gasto promedio por día de la semana">
      {values.map((v, i) => (
        <div key={i} className={cx('wbars__col', i === highlight && 'is-hi')}>
          <i style={{ height: `${Math.max(5, (v / max) * 100)}%` }} />
          <span>{weekdayInitial(i, locale)}</span>
        </div>
      ))}
    </div>
  );
}

const TILTS = [-3, 2.5, -1.5];

function Story({ month, onClose }: { month: string; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const fmt = useFmt();
  const ui = useUi();
  const locale = data.settings.locale;
  const rootRef = useRef<HTMLDivElement>(null);
  const startX = useRef<number | null>(null);

  const analysis = useMemo(
    () => analyzeMonth({ month, today, expenses: data.expenses, categories: data.categories, recurring: data.recurring, budget: data.settings.monthlyBudget }),
    [month, today, data.expenses, data.categories, data.recurring, data.settings.monthlyBudget],
  );
  const ctx = useMemo(() => ({ analysis, fmt, locale }), [analysis, fmt, locale]);
  const slides = useMemo(() => buildStory(ctx), [ctx]);
  const [index, setIndex] = useState(0);
  const slide = slides[index] ?? slides[0];

  useOverlayHistory(true, onClose);
  useFocusTrap(rootRef, onClose);
  useEffect(() => markStorySeen(month), [month]);

  if (!slide) return null;
  const last = index === slides.length - 1;
  const next = () => setIndex((n) => Math.min(slides.length - 1, n + 1));
  const prev = () => setIndex((n) => Math.max(0, n - 1));

  const onDown = (e: ReactPointerEvent) => {
    startX.current = e.clientX;
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (startX.current === null) return;
    const dx = e.clientX - startX.current;
    startX.current = null;
    if (Math.abs(dx) > 50) {
      if (dx < 0) next();
      else prev();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    if (e.clientX - rect.left < rect.width * 0.3) prev();
    else next();
  };

  const share = async () => {
    const text = shareText(ctx, verdictFor(analysis, fmt, locale));
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        ui.toast({ text: 'Resumen copiado' });
      }
    } catch {
      // cancelled
    }
  };

  const bigLength = slide.big?.length ?? 0;

  return createPortal(
    <div
      ref={rootRef}
      className="story"
      data-theme={slide.theme}
      role="dialog"
      aria-modal="true"
      aria-label="Resumen del mes"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') next();
        if (e.key === 'ArrowLeft') prev();
      }}
    >
      <div className="story__bars" aria-hidden="true">
        {slides.map((s, i) => (
          <i key={s.id} className={cx(i <= index && 'is-done')} />
        ))}
      </div>
      <div className="story__top">
        <span className="story__count">
          {index + 1}/{slides.length}
        </span>
        <button type="button" className="story__close" aria-label="Cerrar resumen" onClick={onClose}>
          <X size={24} />
        </button>
      </div>

      <div className="story__body" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (startX.current = null)}>
        <span className="story__index" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>
        <div key={slide.id} className="story__slide" aria-live="polite">
          <p className="kicker">{slide.kicker}</p>
          {slide.emoji && (
            <div className="story__emoji" aria-hidden="true">
              {slide.emoji}
            </div>
          )}
          {slide.big && slide.bigFirst && (
            <p className="story__big story__big--first" style={{ '--n': bigLength } as CSSProperties}>
              {slide.big}
            </p>
          )}
          <Headline text={slide.title} />
          {slide.big && !slide.bigFirst && (
            <p className="story__big" style={{ '--n': bigLength } as CSSProperties}>
              {slide.big}
            </p>
          )}
          {slide.weekdayBars && <WeekdayBars values={slide.weekdayBars.values} highlight={slide.weekdayBars.highlight} locale={locale} />}
          {slide.items && (
            <ul className="story__chips">
              {slide.items.map((it, i) => (
                <li key={it.label} style={{ '--tilt': `${TILTS[i % TILTS.length]}deg`, '--dot': colorVar(it.color ?? 'slate') } as CSSProperties}>
                  <span aria-hidden="true">{it.emoji}</span>
                  <span className="story__chip-label">{it.label}</span>
                  <b>{it.value}</b>
                </li>
              ))}
            </ul>
          )}
          {slide.caption && <p className="story__caption">{slide.caption}</p>}
        </div>
      </div>

      <div className="story__foot">
        <button type="button" className="story__nav" aria-label="Anterior" disabled={index === 0} onClick={prev}>
          <ChevronLeft size={24} />
        </button>
        {last ? (
          <button type="button" className="story__share" onClick={() => void share()}>
            <Share2 size={18} />
            Compartir resumen
          </button>
        ) : (
          <span className="story__hint">Toca o desliza para seguir</span>
        )}
        <button type="button" className="story__nav" aria-label="Siguiente" disabled={last} onClick={next}>
          <ChevronRight size={24} />
        </button>
      </div>
    </div>,
    overlayRoot(),
  );
}
