import type { FlockPlayer } from '@birdle/shared';
import { describe, expect, it } from 'vitest';
import type { Participant } from '../src/discord/participants';
import { participantAvatarUrl, participantName } from '../src/discord/participants';
import { flockStatusText, hideUnrevealedRows, mergeFlock } from '../src/flock';

function player(id: string, patch: Partial<FlockPlayer> = {}): FlockPlayer {
  return { id, username: id, displayName: id.toUpperCase(), avatarUrl: null, status: 'playing', rows: [], hintUsed: false, hardMode: false, ...patch };
}

function participant(id: string, patch: Partial<Participant> = {}): Participant {
  return { id, username: id, discriminator: '0', bot: false, flags: 0, ...patch };
}

const G = ['correct', 'correct', 'correct', 'correct', 'correct'] as const;
const X = ['absent', 'present', 'absent', 'absent', 'absent'] as const;

describe('participants', () => {
  it('prefers nickname, then global name, then username', () => {
    expect(participantName(participant('1', { nickname: 'Nick', global_name: 'Global' }))).toBe('Nick');
    expect(participantName(participant('1', { global_name: 'Global' }))).toBe('Global');
    expect(participantName(participant('1', { global_name: null }))).toBe('1');
  });

  it('only builds CSP-allowed avatar URLs', () => {
    expect(participantAvatarUrl(participant('7', { avatar: 'abc' }))).toBe('https://cdn.discordapp.com/avatars/7/abc.png?size=64');
    expect(participantAvatarUrl(participant('7', { avatar: null }))).toBeNull();
  });
});

describe('mergeFlock', () => {
  it('adds connected participants who have not played as idle, and skips bots', () => {
    const entries = mergeFlock(
      [player('me', { status: 'won', rows: [[...X], [...G]] })],
      [participant('me'), participant('newbie', { global_name: 'New Bird' }), participant('bot', { bot: true })],
      'me',
    );
    expect(entries.map((e) => [e.id, e.status, e.isSelf])).toEqual([
      ['me', 'won', true],
      ['newbie', 'idle', false],
    ]);
    expect(entries[1]?.displayName).toBe('New Bird');
  });

  it('keeps players who left but played today, marked as not connected', () => {
    const entries = mergeFlock([player('gone', { status: 'lost' })], [participant('me')], 'me');
    expect(entries.find((e) => e.id === 'gone')).toMatchObject({ connected: false, status: 'lost' });
  });

  it('treats everyone as connected until the participant list is known, or when not tracking (mock mode)', () => {
    expect(mergeFlock([player('a')], null, 'me')[0]?.connected).toBe(true);
    expect(mergeFlock([player('a')], [participant('me')], 'me', false).find((e) => e.id === 'a')?.connected).toBe(true);
  });

  it('sorts self first, then winners by fewest guesses, then players furthest along', () => {
    const entries = mergeFlock(
      [
        player('slow', { status: 'won', rows: [[...X], [...X], [...G]] }),
        player('fast', { status: 'won', rows: [[...G]] }),
        player('mid', { status: 'playing', rows: [[...X], [...X]] }),
        player('early', { status: 'playing', rows: [[...X]] }),
        player('me', { status: 'idle' }),
      ],
      null,
      'me',
    );
    expect(entries.map((e) => e.id)).toEqual(['me', 'fast', 'slow', 'mid', 'early']);
  });

  it('carries colours only', () => {
    const [entry] = mergeFlock([player('a', { rows: [[...X]] })], null, 'me');
    expect(JSON.stringify(entry)).not.toMatch(/"word"/);
  });
});

describe('hideUnrevealedRows', () => {
  it("shows the player's own row as it was before the guess that is still flipping", () => {
    const entries = mergeFlock(
      [player('me', { status: 'won', rows: [[...X], [...G]] }), player('bob', { status: 'won', rows: [[...G]] })],
      null,
      'me',
    );
    const flipping = hideUnrevealedRows(entries, 1);
    expect(flipping.find((e) => e.id === 'me')).toMatchObject({ status: 'playing', rows: [[...X]] });
    expect(flipping.find((e) => e.id === 'bob')).toBe(entries.find((e) => e.id === 'bob'));
    expect(hideUnrevealedRows(entries, 0).find((e) => e.id === 'me')).toMatchObject({ status: 'idle', rows: [] });
    expect(hideUnrevealedRows(entries, 2)).toEqual(entries);
    expect(hideUnrevealedRows(entries, null)).toBe(entries);
  });
});

describe('flockStatusText', () => {
  it('summarises each status', () => {
    expect(flockStatusText({ status: 'won', rows: [[...X], [...G]] }, 6)).toBe('Solved 2/6');
    expect(flockStatusText({ status: 'lost', rows: [] }, 6)).toBe('Stumped X/6');
    expect(flockStatusText({ status: 'playing', rows: [[...X]] }, 6)).toBe('Guess 2 of 6');
    expect(flockStatusText({ status: 'idle', rows: [] }, 6)).toBe('Not started');
  });
});
