import { DEFAULT_PRACTICE_CATEGORY, isPracticeCategory, type PracticeCategory } from '@birdle/shared';
import { useCallback, useEffect, useState } from 'react';
import { getLocalStorage, readItem, writeItem } from './storage';

/** 'dark' = Dusk (default), 'light' = Daylight, 'system' follows prefers-color-scheme. */
export type ThemeSetting = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

export interface Settings {
  theme: ThemeSetting;
  colorBlind: boolean;
  /** Applied to the next game that has no guesses yet; a started game keeps its own flag. */
  hardMode: boolean;
  /** Where new Free Flight birds come from (the last category the player picked). */
  freeFlightCategory: PracticeCategory;
}

export const SETTINGS_KEY = 'birdle:settings:v1';

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  theme: 'dark',
  colorBlind: false,
  hardMode: false,
  freeFlightCategory: DEFAULT_PRACTICE_CATEGORY,
});

const THEMES: readonly ThemeSetting[] = ['dark', 'light', 'system'];

/**
 * Parses stored settings, keeping each valid field and defaulting the rest.
 * Unknown fields (such as `seenHelp` from older versions) are ignored, and the
 * next save drops them.
 */
export function parseSettings(raw: string | null): Settings {
  const settings: Settings = { ...DEFAULT_SETTINGS };
  if (!raw) return settings;

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return settings;
  }
  if (typeof data !== 'object' || data === null) return settings;

  const record = data as Record<string, unknown>;
  if (THEMES.includes(record.theme as ThemeSetting)) settings.theme = record.theme as ThemeSetting;
  if (typeof record.colorBlind === 'boolean') settings.colorBlind = record.colorBlind;
  if (typeof record.hardMode === 'boolean') settings.hardMode = record.hardMode;
  if (isPracticeCategory(record.freeFlightCategory)) settings.freeFlightCategory = record.freeFlightCategory;
  return settings;
}

export function loadSettings(storage: Storage | null = getLocalStorage()): Settings {
  return parseSettings(readItem(storage, SETTINGS_KEY));
}

/** Persists settings; returns false (and keeps playing) when storage is unavailable. */
export function saveSettings(settings: Settings, storage: Storage | null = getLocalStorage()): boolean {
  return writeItem(storage, SETTINGS_KEY, JSON.stringify(settings));
}

export type UpdateSettings = (patch: Partial<Settings>) => void;

/** Settings state that is saved to localStorage whenever it changes. */
export function useSettings(initial?: Settings): [Settings, UpdateSettings] {
  const [settings, setSettings] = useState<Settings>(() => initial ?? loadSettings());
  const update = useCallback<UpdateSettings>((patch) => setSettings((prev) => ({ ...prev, ...patch })), []);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  return [settings, update];
}
