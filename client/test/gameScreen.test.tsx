import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IDiscordSDK } from '@discord/embedded-app-sdk';
import { localIsoDate, type GameView, type PracticeCategory } from '@birdle/shared';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type Api } from '../src/api';
import type { DiscordEnv } from '../src/discord/sdk';
import { GameScreen } from '../src/GameScreen';
import { DEFAULT_SETTINGS, parseSettings, type Settings, type UpdateSettings } from '../src/settings';
import { makeGame, makeReveal, makeStats, row } from './fixtures';

// The screen asks for the real local date's puzzle.
const TODAY = localIsoDate();
const CRANE = makeReveal();

function embeddedEnv(): DiscordEnv {
  const sdk = {
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
    commands: {
      getInstanceConnectedParticipants: vi.fn(async () => ({ participants: [] })),
      setActivity: vi.fn(async () => ({})),
      openExternalLink: vi.fn(async () => ({ opened: true })),
    },
  } as unknown as IDiscordSDK;
  return { embedded: true, sdk, clientId: '123', instanceId: 'i-1', platform: 'desktop' };
}

function practiceGame(patch: Partial<GameView> = {}): GameView {
  return makeGame({ mode: 'practice', puzzleNumber: null, date: null, wordLength: 7, ...patch });
}

function fakeApi(overrides: Partial<Api>): Api {
  const unexpected = (name: string) => vi.fn(() => Promise.reject(new Error(`unexpected ${name}`)));
  return {
    me: unexpected('me'),
    daily: vi.fn(async () => ({ game: makeGame({ date: TODAY }) })),
    dailyGuess: unexpected('dailyGuess'),
    dailyHint: unexpected('dailyHint'),
    practice: vi.fn(async () => ({ game: null })),
    practiceNew: vi.fn(async (category: PracticeCategory) => ({ game: practiceGame({ category }) })),
    practiceGuess: unexpected('practiceGuess'),
    practiceHint: unexpected('practiceHint'),
    joinInstance: vi.fn(async () => ({ ok: true as const })),
    flock: vi.fn(async () => ({ players: [] })),
    ...overrides,
  };
}

/** The screen with settings kept in state (as App does), so a change re-renders it. */
function Harness({ api, env, initial, onUpdate }: { api: Api; env: DiscordEnv; initial: Settings; onUpdate: UpdateSettings }) {
  const [settings, setSettings] = useState(initial);
  const updateSettings: UpdateSettings = (patch) => {
    onUpdate(patch);
    setSettings((previous) => ({ ...previous, ...patch }));
  };
  return (
    <GameScreen
      env={env}
      session={{ api, user: { id: 'me', username: 'me', displayName: 'Me', avatarUrl: null }, stats: makeStats(), presenceEnabled: false }}
      settings={settings}
      updateSettings={updateSettings}
      theme="dark"
    />
  );
}

function renderScreen(api: Api, settings: Settings = DEFAULT_SETTINGS) {
  const env = embeddedEnv();
  const updateSettings = vi.fn<UpdateSettings>();
  const view = render(<Harness api={api} env={env} initial={settings} onUpdate={updateSettings} />);
  return { ...view, env, updateSettings };
}

const categoryPicker = () => screen.getByRole('group', { name: 'Free Flight birds' });

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

describe('GameScreen without How to play', () => {
  it('opens straight to the board, with no help button, even for settings saved by older versions', async () => {
    const api = fakeApi({});
    renderScreen(api, parseSettings(JSON.stringify({ theme: 'dark', seenHelp: false })));
    await waitFor(() => expect(screen.getAllByRole('img', { name: 'empty' }).length).toBeGreaterThan(0));
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: /how to play/i })).toBeNull();
    expect(screen.queryByText(/how to play/i)).toBeNull();
    const header = screen.getByRole('banner');
    expect(within(header).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
      'Free Flight',
      'Statistics',
      'Settings',
    ]);
    press('W');
    expect(typed('W')).toBe(1);
  });
});

describe('GameScreen Free Flight categories', () => {
  it('shows the category picker only in Free Flight, with the remembered category chosen', async () => {
    const api = fakeApi({});
    renderScreen(api, { ...DEFAULT_SETTINGS, freeFlightCategory: 'birds' });
    await waitFor(() => expect(screen.getByText(/Today’s bird has/)).toBeInTheDocument());
    expect(screen.queryByRole('group', { name: 'Free Flight birds' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Free Flight/ }));
    const picker = categoryPicker();
    expect(within(picker).getAllByRole('radio').map((radio) => radio.closest('label')?.textContent)).toEqual([
      'All',
      'Real birds',
      'Pokémon',
      'Games & books',
    ]);
    expect(within(picker).getByRole('radio', { name: 'Real birds' })).toBeChecked();
    await waitFor(() => expect(api.practiceNew).toHaveBeenCalledWith('birds', expect.anything()));
    await waitFor(() => expect(screen.getByText(/Free Flight · Real birds/)).toBeInTheDocument());
  });

  it('remembers a new choice and swaps the untouched round for one from that category', async () => {
    const api = fakeApi({});
    const user = userEvent.setup();
    const { updateSettings } = renderScreen(api);
    await waitFor(() => expect(screen.getByText(/Today’s bird has/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Free Flight/ }));
    await waitFor(() => expect(screen.getByText(/This bird has/)).toBeInTheDocument());
    expect(api.practiceNew).toHaveBeenCalledTimes(1);
    expect(within(categoryPicker()).getByRole('radio', { name: 'All' })).toBeChecked();

    await user.click(within(categoryPicker()).getByRole('radio', { name: 'Real birds' }));
    expect(updateSettings).toHaveBeenCalledWith({ freeFlightCategory: 'birds' });
    await waitFor(() => expect(api.practiceNew).toHaveBeenCalledTimes(2));
    expect(api.practiceNew).toHaveBeenLastCalledWith('birds', undefined);
    await waitFor(() => expect(screen.getByText(/Free Flight · Real birds/)).toBeInTheDocument());

    // Letters typed with the picker focused still go to the board.
    press('W');
    expect(typed('W')).toBe(1);
  });

  it('keeps a round under way and says the choice applies to the next bird', async () => {
    const started = practiceGame({ category: 'all', wordLength: 5, guesses: [row('STORK', 'CRANE')] });
    const api = fakeApi({ practice: vi.fn(async () => ({ game: started })) });
    const user = userEvent.setup();
    renderScreen(api);
    await waitFor(() => expect(screen.getByText(/Today’s bird has/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Free Flight/ }));
    await waitFor(() => expect(screen.getByRole('img', { name: 'S, absent' })).toBeInTheDocument());

    await user.click(within(categoryPicker()).getByRole('radio', { name: 'Pokémon' }));
    expect(await screen.findByText('Next round: Pokémon')).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(api.practiceNew).not.toHaveBeenCalled();
  });

  it('shows why a category has no birds and lets the player pick another', async () => {
    const reason = 'There are no bird Pokémon in Free Flight yet. Pick another category.';
    const practiceNew = vi.fn(async (category: PracticeCategory) => {
      if (category === 'pokemon') throw new ApiError('BAD_REQUEST', reason, 400);
      return { game: practiceGame({ category }) };
    });
    const api = fakeApi({ practiceNew });
    const user = userEvent.setup();
    renderScreen(api, { ...DEFAULT_SETTINGS, freeFlightCategory: 'pokemon' });
    await waitFor(() => expect(screen.getByText(/Today’s bird has/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Free Flight/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(reason);
    await user.click(within(categoryPicker()).getByRole('radio', { name: 'Games & books' }));
    await waitFor(() => expect(screen.getByText(/Free Flight · Games & books/)).toBeInTheDocument());
    expect(practiceNew.mock.calls.map(([category]) => category)).toEqual(['pokemon', 'fiction']);
  });

  it("says when an untouched round couldn't switch category, and Try again switches it", async () => {
    let offline = false;
    const practiceNew = vi.fn(async (category: PracticeCategory) => {
      if (offline) throw new ApiError('NETWORK', 'Failed to fetch');
      return { game: practiceGame({ category }) };
    });
    const api = fakeApi({ practiceNew });
    const user = userEvent.setup();
    renderScreen(api);
    await waitFor(() => expect(screen.getByText(/Today’s bird has/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Free Flight/ }));
    await waitFor(() => expect(screen.getByText(/This bird has/)).toBeInTheDocument());
    expect(screen.queryByText(/Couldn’t switch/)).toBeNull();

    offline = true;
    await user.click(within(categoryPicker()).getByRole('radio', { name: 'Real birds' }));
    expect(await screen.findByText('Couldn’t switch to Real birds.')).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 30)));
    expect(practiceNew).toHaveBeenCalledTimes(2);

    offline = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByText(/Free Flight · Real birds/)).toBeInTheDocument());
    expect(practiceNew).toHaveBeenLastCalledWith('birds', undefined);
    expect(screen.queryByText(/Couldn’t switch/)).toBeNull();
  });

  it('shows a character bird card with its source and a Learn more link to its wiki', async () => {
    reduceMotion();
    const answer = makeReveal({
      word: 'PIDGEY',
      name: 'Pidgey',
      kind: 'pokemon',
      source: 'Pokémon Red & Blue',
      fact: 'A fixture fact about a small bird Pokémon.',
      infoUrl: 'https://bulbapedia.bulbagarden.net/wiki/Pidgey_(Pok%C3%A9mon)',
      infoSite: 'Bulbapedia',
    });
    const playing = practiceGame({ category: 'pokemon', wordLength: 6 });
    const won = { ...playing, status: 'won' as const, guesses: [row('PIDGEY', 'PIDGEY')], answer };
    const api = fakeApi({
      practiceNew: vi.fn(async () => ({ game: playing })),
      practiceGuess: vi.fn(async () => ({ game: won })),
    });
    const { env, updateSettings } = renderScreen(api, { ...DEFAULT_SETTINGS, freeFlightCategory: 'pokemon' });
    await waitFor(() => expect(screen.getByText(/Today’s bird has/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Free Flight/ }));
    await waitFor(() => expect(screen.getByText(/This bird has/)).toBeInTheDocument());

    for (const letter of 'PIDGEY') press(letter);
    press('Enter');
    const card = await screen.findByRole('dialog', {}, { timeout: 3000 });
    expect(within(card).getByText('Pidgey')).toBeInTheDocument();
    expect(within(card).getByText('from Pokémon Red & Blue')).toBeInTheDocument();
    expect(within(card).getByText('Pokémon', { selector: '.bird-card__kind' })).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Learn more on Bulbapedia' }));
    await waitFor(() => expect(env.sdk.commands.openExternalLink).toHaveBeenCalledWith({ url: answer.infoUrl }));

    // The next bird's category is picked next to "New bird".
    const next = within(card).getByRole('group', { name: 'Next Free Flight bird from' });
    expect(within(next).getByRole('radio', { name: 'Pokémon' })).toBeChecked();
    fireEvent.click(within(next).getByRole('radio', { name: 'Real birds' }));
    expect(updateSettings).toHaveBeenCalledWith({ freeFlightCategory: 'birds' });
    fireEvent.click(within(card).getByRole('button', { name: /New bird/ }));
    await waitFor(() => expect(api.practiceNew).toHaveBeenLastCalledWith('birds', undefined));
  });
});
