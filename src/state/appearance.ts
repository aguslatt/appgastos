import { useEffect, useState } from 'react';
import type { ThemePref } from '../lib/types';
import type { EntryKind, Tab } from './ui';

/** Applies the chosen theme and keeps the browser's top bar color in step with the screen (and with the calculator's mode). */
export function useAppearance(theme: ThemePref, tab: Tab, kind: EntryKind = 'expense'): void {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);

    const apply = () => {
      const token = tab === 'calc' ? (kind === 'income' ? '--panel-in-bg' : '--panel-bg') : '--bg';
      const color = getComputedStyle(root).getPropertyValue(token).trim();
      let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"][data-dynamic]');
      if (!meta) {
        document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
        meta = document.createElement('meta');
        meta.name = 'theme-color';
        meta.dataset.dynamic = '1';
        document.head.appendChild(meta);
      }
      meta.content = color;
    };
    apply();
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme, tab, kind]);
}

/** Tracks the visible viewport so the app shrinks above the on-screen keyboard instead of hiding behind it. */
export function useViewportHeight(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    const apply = () => {
      const h = vv ? vv.height : window.innerHeight;
      document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
      if (vv && vv.offsetTop > 0) window.scrollTo(0, 0);
    };
    apply();
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    window.addEventListener('resize', apply);
    return () => {
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      window.removeEventListener('resize', apply);
    };
  }, []);
}

/** True while the phone's on-screen keyboard is covering a good part of the screen. */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setOpen(vv.scale === 1 && vv.height < window.innerHeight * 0.78);
    vv.addEventListener('resize', update);
    update();
    return () => vv.removeEventListener('resize', update);
  }, []);
  return open;
}
