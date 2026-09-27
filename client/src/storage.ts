// localStorage can be missing or throw on every access (sandboxed iframes,
// privacy modes, full quota). Everything here degrades to "nothing stored".

/** `window.localStorage`, or null where touching it throws. */
export function getLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readItem(storage: Storage | null, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns false when the value could not be stored. */
export function writeItem(storage: Storage | null, key: string, value: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
