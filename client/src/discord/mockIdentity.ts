import { hashString } from '@birdle/shared';
import { readItem, writeItem } from '../storage';

// Browser (non-Discord) play: the player is named by ?user=<name>, or gets a
// random guest id remembered in localStorage. The server accepts the resulting
// `mock:<id>:<displayName>` bearer token only when mock auth is enabled.

export interface MockIdentity {
  id: string;
  displayName: string;
  token: string;
}

export const MOCK_USER_KEY = 'birdle:mock-user-id';
const MAX_NAME_LENGTH = 32;
const ID_PATTERN = /^[a-z0-9-]{1,40}$/;

/** "Álvaro Díaz!" -> "alvaro-diaz"; empty when nothing usable is left. */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_NAME_LENGTH);
}

export function mockToken(id: string, displayName: string): string {
  return `mock:${id}:${encodeURIComponent(displayName)}`;
}

function identity(id: string, displayName: string): MockIdentity {
  return { id, displayName, token: mockToken(id, displayName) };
}

export function resolveMockIdentity(
  search: string,
  storage: Storage | null,
  random: () => number = Math.random,
): MockIdentity {
  const requested = new URLSearchParams(search).get('user')?.trim().slice(0, MAX_NAME_LENGTH);
  if (requested) {
    const id = slugify(requested) || `user-${hashString(requested).toString(36)}`;
    return identity(id, requested);
  }

  let id = readItem(storage, MOCK_USER_KEY);
  if (id === null || !ID_PATTERN.test(id)) {
    id = `guest-${Math.floor(random() * 36 ** 6)
      .toString(36)
      .padStart(6, '0')}`;
    writeItem(storage, MOCK_USER_KEY, id);
  }
  return identity(id, `Guest ${id.slice(-4).toUpperCase()}`);
}
