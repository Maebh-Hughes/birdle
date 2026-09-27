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

  it('defaults to the dusk theme with everything off', () => {
    expect(loadSettings(window.localStorage)).toEqual({ theme: 'dark', colorBlind: false, hardMode: false, seenHelp: false });
  });

  it('round-trips through localStorage', () => {
    const settings = { theme: 'system', colorBlind: true, hardMode: true, seenHelp: true } as const;
    expect(saveSettings(settings, window.localStorage)).toBe(true);
    expect(loadSettings(window.localStorage)).toEqual(settings);
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
});
