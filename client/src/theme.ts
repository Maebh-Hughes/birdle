import { useLayoutEffect } from 'react';
import { useMediaQuery } from './hooks/useMediaQuery';
import type { ResolvedTheme, Settings, ThemeSetting } from './settings';

export function resolveTheme(setting: ThemeSetting, prefersLight: boolean): ResolvedTheme {
  if (setting === 'system') return prefersLight ? 'light' : 'dark';
  return setting;
}

/** The stylesheet keys its palettes off these attributes on <html>. */
export function applyTheme(root: HTMLElement, theme: ResolvedTheme, colorBlind: boolean): void {
  root.dataset.theme = theme;
  root.dataset.contrast = colorBlind ? 'high' : 'normal';
}

/** Resolves the theme setting (following the OS for 'system') and applies it to the document. */
export function useAppliedTheme(settings: Pick<Settings, 'theme' | 'colorBlind'>): ResolvedTheme {
  const prefersLight = useMediaQuery('(prefers-color-scheme: light)');
  const theme = resolveTheme(settings.theme, prefersLight);

  useLayoutEffect(() => {
    applyTheme(document.documentElement, theme, settings.colorBlind);
  }, [theme, settings.colorBlind]);

  return theme;
}
