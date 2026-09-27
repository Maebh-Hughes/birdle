import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseSettings,
  saveSettings,
  SETTINGS_KEY,
  useSettings,
} from '../src/settings';
import { getLocalStorage } from '../src/storage';

function throwingStorage(): Storage {
  const fail = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  return { getItem: fail, setItem: fail, removeItem: fail, clear: fail, key: fail, length: 0 } as Storage;
}

describe('settings persistence', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('defaults to the dusk theme with everything off and Free Flight drawing from all birds', () => {
    expect(loadSettings(window.localStorage)).toEqual({ theme: 'dark', colorBlind: false, hardMode: false, freeFlightCategory: 'all' });
  });

  it('round-trips through localStorage', () => {
    const settings = { theme: 'system', colorBlind: true, hardMode: true, freeFlightCategory: 'birds' } as const;
    expect(saveSettings(settings, window.localStorage)).toBe(true);
    expect(loadSettings(window.localStorage)).toEqual(settings);
  });

  it('remembers every Free Flight category and ignores unknown ones', () => {
    for (const freeFlightCategory of ['all', 'birds', 'pokemon', 'fiction'] as const) {
      expect(parseSettings(JSON.stringify({ freeFlightCategory }))).toEqual({ ...DEFAULT_SETTINGS, freeFlightCategory });
    }
    for (const freeFlightCategory of ['dragons', 'BIRDS', 3, null]) {
      expect(parseSettings(JSON.stringify({ freeFlightCategory, hardMode: true }))).toEqual({ ...DEFAULT_SETTINGS, hardMode: true });
    }
  });

  it('ignores the old How to play flag and drops it on the next save', () => {
    const old = JSON.stringify({ theme: 'light', colorBlind: false, hardMode: true, seenHelp: false });
    window.localStorage.setItem(SETTINGS_KEY, old);
    const settings = loadSettings(window.localStorage);
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, theme: 'light', hardMode: true });
    expect(settings).not.toHaveProperty('seenHelp');

    saveSettings({ ...settings, freeFlightCategory: 'pokemon' }, window.localStorage);
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}')).toEqual({
      theme: 'light',
      colorBlind: false,
      hardMode: true,
      freeFlightCategory: 'pokemon',
    });
  });

  it('survives a storage that throws on every call', () => {
    const storage = throwingStorage();
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings({ ...DEFAULT_SETTINGS, hardMode: true }, storage)).toBe(false);
  });

  it('survives window.localStorage itself throwing (sandboxed iframe)', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Access is denied', 'SecurityError');
    });
    expect(getLocalStorage()).toBeNull();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS)).toBe(false);
  });

  it('ignores corrupt JSON and keeps only valid fields', () => {
    expect(parseSettings('{not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(JSON.stringify({ theme: 'neon', colorBlind: 'yes', hardMode: true }))).toEqual({
      ...DEFAULT_SETTINGS,
      hardMode: true,
    });
  });

  it('useSettings keeps working in memory when storage throws', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });
    const { result } = renderHook(() => useSettings());
    act(() => result.current[1]({ colorBlind: true }));
    expect(result.current[0].colorBlind).toBe(true);
    expect(setItem).toHaveBeenCalled();
  });

  it('useSettings saves changes', () => {
    const { result } = renderHook(() => useSettings());
    act(() => result.current[1]({ theme: 'light' }));
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}')).toMatchObject({ theme: 'light' });
  });

  it('useSettings remembers the last Free Flight category across reloads', () => {
    const first = renderHook(() => useSettings());
    act(() => first.result.current[1]({ freeFlightCategory: 'birds' }));
    first.unmount();
    const second = renderHook(() => useSettings());
    expect(second.result.current[0].freeFlightCategory).toBe('birds');
  });
});
