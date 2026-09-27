import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IDiscordSDK } from '@discord/embedded-app-sdk';
import { localIsoDate } from '@birdle/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../src/api';
import type { DiscordEnv } from '../src/discord/sdk';
import { GameScreen } from '../src/GameScreen';
import { DEFAULT_SETTINGS } from '../src/settings';
import { makeGame, makeStats, row } from './fixtures';

// The screen asks for the real local date's puzzle.
const TODAY = localIsoDate();
const CRANE = { word: 'CRANE', name: 'Crane', kind: 'bird', fact: 'Fixture fact.', wikiUrl: 'https://example.org' } as const;

function embeddedEnv(): DiscordEnv {
  const sdk = {
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
    commands: {
      getInstanceConnectedParticipants: vi.fn(async () => ({ participants: [] })),
      setActivity: vi.fn(async () => ({})),
    },
  } as unknown as IDiscordSDK;
  return { embedded: true, sdk, clientId: '123', instanceId: 'i-1', platform: 'desktop' };
}

function fakeApi(overrides: Partial<Api>): Api {
  const unexpected = (name: string) => vi.fn(() => Promise.reject(new Error(`unexpected ${name}`)));
  return {
    me: unexpected('me'),
    daily: vi.fn(async () => ({ game: makeGame({ date: TODAY }) })),
    dailyGuess: unexpected('dailyGuess'),
    dailyHint: unexpected('dailyHint'),
    practice: vi.fn(async () => ({ game: null })),
    practiceNew: vi.fn(async () => ({ game: makeGame({ mode: 'practice', puzzleNumber: null, date: null, wordLength: 7 }) })),
    practiceGuess: unexpected('practiceGuess'),
    practiceHint: unexpected('practiceHint'),
    joinInstance: vi.fn(async () => ({ ok: true as const })),
    flock: vi.fn(async () => ({ players: [] })),
    ...overrides,
  };
}

function renderScreen(api: Api) {
  return render(
    <GameScreen
      env={embeddedEnv()}
      session={{ api, user: { id: 'me', username: 'me', displayName: 'Me', avatarUrl: null }, stats: makeStats(), presenceEnabled: false }}
      settings={{ ...DEFAULT_SETTINGS, seenHelp: true }}
      updateSettings={() => undefined}
      theme="dark"
    />,
  );
}

/** Emulates prefers-reduced-motion (animations and their waits are skipped). */
function reduceMotion(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

const press = (key: string) => fireEvent.keyDown(window, { key });
const typed = (letter: string) => screen.queryAllByRole('img', { name: letter }).length;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GameScreen', () => {
  it('keeps the physical keyboard working when the player leaves a finished game before its bird card opens', async () => {
    reduceMotion();
    const won = makeGame({ date: TODAY, status: 'won', guesses: [row('CRANE', 'CRANE')], answer: CRANE });
    const api = fakeApi({ dailyGuess: vi.fn(async () => ({ game: won, stats: makeStats({ wins: 1 }) })) });
    renderScreen(api);
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'empty' }).length).toBeGreaterThan(0));

    for (const letter of 'CRANE') press(letter);
    press('Enter');
    await waitFor(() => expect(screen.getByRole('button', { name: /Bird card/ })).toBeInTheDocument());

    // Off to Free Flight before the bird card's delay is up.
    fireEvent.click(screen.getByRole('button', { name: /Free Flight/ }));
    await waitFor(() => expect(screen.getByText(/This bird has/)).toBeInTheDocument());
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)));

    expect(screen.queryByRole('dialog')).toBeNull();
    press('B');
    expect(typed('B')).toBe(1);
  });

  it('keeps the Hint button while a winning guess is still flipping', async () => {
    const guesses = [row('STORK', 'CRANE'), row('SLATE', 'CRANE'), row('BRINE', 'CRANE')];
    const playing = makeGame({ date: TODAY, guesses, hintAvailable: true });
    const won = makeGame({ date: TODAY, status: 'won', guesses: [...guesses, row('CRANE', 'CRANE')], hint: 'Tall', answer: CRANE });
    const api = fakeApi({
      daily: vi.fn(async () => ({ game: playing })),
      dailyGuess: vi.fn(async () => ({ game: won, stats: makeStats({ wins: 1 }) })),
    });
    renderScreen(api);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Hint' })).toBeInTheDocument());

    for (const letter of 'CRANE') press(letter);
    press('Enter');
    await waitFor(() => expect(api.dailyGuess).toHaveBeenCalled());
    await waitFor(() => expect(document.querySelectorAll('.tile--reveal').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: 'Hint' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bird card/ })).toBeNull();
  });

  it('announces a revealed hint and moves focus to it', async () => {
    const guesses = [row('STORK', 'CRANE'), row('SLATE', 'CRANE'), row('BRINE', 'CRANE')];
    const playing = makeGame({ date: TODAY, guesses, hintAvailable: true });
    const api = fakeApi({
      daily: vi.fn(async () => ({ game: playing })),
      dailyHint: vi.fn(async () => ({ game: { ...playing, hintAvailable: false, hintUsed: true, hint: 'Tall wading bird' } })),
    });
    const user = userEvent.setup();
    renderScreen(api);
    const hint = await screen.findByRole('button', { name: 'Hint' });
    await user.click(hint);
    await user.click(screen.getByRole('button', { name: 'Tap again to reveal' }));

    const callout = await screen.findByText('Tall wading bird');
    await waitFor(() => expect(callout.closest('.hint-callout')).toHaveFocus());
    expect(within(document.body).getByText('Hint: Tall wading bird')).toHaveAttribute('aria-live', 'polite');
  });
});
