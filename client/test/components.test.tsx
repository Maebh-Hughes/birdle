import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { emptyStats, type BirdKind, type GameView, type PracticeCategory } from '@birdle/shared';
import { BirdCard } from '../src/components/BirdCard';
import { Board } from '../src/components/Board';
import { CategoryPicker } from '../src/components/CategoryPicker';
import { Keyboard } from '../src/components/Keyboard';
import { Modal } from '../src/components/Modal';
import { SettingsModal } from '../src/components/SettingsModal';
import { StatsModal } from '../src/components/StatsModal';
import { gameKeyFor, usePhysicalKeyboard } from '../src/hooks/usePhysicalKeyboard';
import { DEFAULT_SETTINGS } from '../src/settings';
import { makeGame, makeReveal, row } from './fixtures';

describe('Board', () => {
  it.each([4, 7, 11])('renders 6 rows of %i tiles', (wordLength) => {
    render(<Board game={makeGame({ wordLength })} current="" />);
    const rows = screen.getAllByRole('group', { name: /^Row \d$/ });
    expect(rows).toHaveLength(6);
    for (const r of rows) expect(within(r).getAllByRole('img')).toHaveLength(wordLength);
  });

  it('labels evaluated, typed and empty tiles', () => {
    render(<Board game={makeGame({ guesses: [row('STORK', 'CRANE')] })} current="CR" />);
    const first = within(screen.getByRole('group', { name: 'Row 1' })).getAllByRole('img');
    expect(first.map((tile) => tile.getAttribute('aria-label'))).toEqual([
      'S, absent',
      'T, absent',
      'O, absent',
      'R, present',
      'K, absent',
    ]);
    const second = within(screen.getByRole('group', { name: 'Row 2' })).getAllByRole('img');
    expect(second.map((tile) => tile.getAttribute('aria-label'))).toEqual(['C', 'R', 'empty', 'empty', 'empty']);
    expect(second[0]).toHaveAttribute('data-state', 'tbd');
  });

  it('flips only the revealing row', () => {
    const game = makeGame({ guesses: [row('STORK', 'CRANE'), row('CRAKE', 'CRANE')] });
    render(<Board game={game} current="" revealingRow={1} />);
    const flipping = within(screen.getByRole('group', { name: 'Row 2' })).getAllByRole('img');
    expect(flipping.every((tile) => tile.classList.contains('tile--reveal'))).toBe(true);
    const settled = within(screen.getByRole('group', { name: 'Row 1' })).getAllByRole('img');
    expect(settled.some((tile) => tile.classList.contains('tile--reveal'))).toBe(false);
  });
});

describe('Keyboard', () => {
  it('colours keys by their best known state', () => {
    render(<Keyboard states={{ C: 'correct', R: 'present', S: 'absent' }} onKey={() => undefined} />);
    expect(screen.getByRole('button', { name: 'C, correct' })).toHaveAttribute('data-state', 'correct');
    expect(screen.getByRole('button', { name: 'R, present' })).toHaveAttribute('data-state', 'present');
    expect(screen.getByRole('button', { name: 'S, absent' })).toHaveAttribute('data-state', 'absent');
    expect(screen.getByRole('button', { name: 'Q' })).not.toHaveAttribute('data-state');
  });

  it('reports letter, Enter and Backspace presses', async () => {
    const onKey = vi.fn();
    const user = userEvent.setup();
    render(<Keyboard states={{}} onKey={onKey} />);
    await user.click(screen.getByRole('button', { name: 'W' }));
    await user.click(screen.getByRole('button', { name: 'Enter' }));
    await user.click(screen.getByRole('button', { name: 'Backspace' }));
    expect(onKey.mock.calls.map(([key]) => key)).toEqual(['W', 'ENTER', 'BACKSPACE']);
    expect(screen.getAllByRole('button')).toHaveLength(28);
  });
});

function ModalHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <Modal
          title="Statistics"
          onClose={() => {
            onClose();
            setOpen(false);
          }}
        >
          <button type="button">First action</button>
          <button type="button">Last action</button>
        </Modal>
      )}
    </>
  );
}

describe('Modal', () => {
  it('moves focus in, traps Tab, closes on Esc and restores focus', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<ModalHarness onClose={onClose} />);
    const opener = screen.getByRole('button', { name: 'Open' });
    await user.click(opener);

    const dialog = screen.getByRole('dialog', { name: 'Statistics' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveFocus();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Last action' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('closes on a backdrop click but not on a click inside', () => {
    const onClose = vi.fn();
    render(
      <Modal title="Settings" onClose={onClose}>
        <p>Inside</p>
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByText('Inside'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('physical keyboard', () => {
  const key = (init: KeyboardEventInit, target: EventTarget = document.body) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, 'target', { value: target });
    return gameKeyFor(event);
  };

  it('maps letters, Enter and Backspace', () => {
    expect(key({ key: 'a' })).toBe('A');
    expect(key({ key: 'Q', shiftKey: true })).toBe('Q');
    expect(key({ key: 'Enter' })).toBe('ENTER');
    expect(key({ key: 'Backspace' })).toBe('BACKSPACE');
    expect(key({ key: '1' })).toBeNull();
    expect(key({ key: 'ArrowLeft' })).toBeNull();
  });

  it('ignores modifier shortcuts, key repeat on Enter and typing in text fields', () => {
    expect(key({ key: 'c', ctrlKey: true })).toBeNull();
    expect(key({ key: 'r', metaKey: true })).toBeNull();
    expect(key({ key: 'a', altKey: true })).toBeNull();
    expect(key({ key: 'Enter', repeat: true })).toBeNull();
    const textarea = document.createElement('textarea');
    expect(key({ key: 'a' }, textarea)).toBeNull();
  });

  it('lets letters and Enter through from a focused radio button (the category picker)', () => {
    const radio = document.createElement('input');
    radio.type = 'radio';
    expect(key({ key: 'a' }, radio)).toBe('A');
    expect(key({ key: 'Enter' }, radio)).toBe('ENTER');
    const text = document.createElement('input');
    expect(key({ key: 'a' }, text)).toBeNull();
  });

  function KeyboardHarness({ onKey, onStats }: { onKey: (key: string) => void; onStats: () => void }) {
    usePhysicalKeyboard(onKey, true);
    return (
      <>
        <button type="button">Free Flight</button>
        <button type="button" onClick={onStats}>
          Statistics
        </button>
      </>
    );
  }

  it('submits the guess on Enter after a mouse click, but lets a button reached with Tab handle it', async () => {
    const onKey = vi.fn();
    const onStats = vi.fn();
    const user = userEvent.setup();
    render(<KeyboardHarness onKey={onKey} onStats={onStats} />);
    const stats = screen.getByRole('button', { name: 'Statistics' });

    // Clicked with the mouse (focus stays on it), then the player types and presses Enter.
    await user.click(stats);
    expect(onStats).toHaveBeenCalledTimes(1);
    await user.keyboard('ab{Enter}');
    expect(onKey.mock.calls.map(([k]) => k)).toEqual(['A', 'B', 'ENTER']);
    expect(onStats).toHaveBeenCalledTimes(1);

    // Focus handed back by script (a closing dialog) after a click is still not keyboard focus.
    act(() => screen.getByRole('button', { name: 'Free Flight' }).focus());
    act(() => stats.focus());
    await user.keyboard('{Enter}');
    expect(onKey).toHaveBeenLastCalledWith('ENTER');
    expect(onStats).toHaveBeenCalledTimes(1);

    // Reached with Tab: Enter activates the button instead.
    onKey.mockClear();
    await user.click(document.body);
    await user.tab();
    await user.tab();
    expect(stats).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onStats).toHaveBeenCalledTimes(2);
    expect(onKey).not.toHaveBeenCalled();
  });
});

describe('SettingsModal', () => {
  it('keeps Tab inside the dialog from the checked theme radio', async () => {
    const user = userEvent.setup();
    render(
      <SettingsModal
        settings={{ ...DEFAULT_SETTINGS, theme: 'dark' }}
        onChange={() => undefined}
        lockedHardMode={null}
        playerNote="Playing as Alice."
        onClose={() => undefined}
      />,
    );
    const dusk = screen.getByRole('radio', { name: 'Dusk' });
    act(() => dusk.focus());
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.tab({ shift: true });
    expect(dusk).toHaveFocus();
  });
});

describe('next puzzle', () => {
  it('counts down to midnight, or offers today’s puzzle once it has unlocked', async () => {
    const stats = { ...emptyStats() };
    const { unmount } = render(<StatsModal stats={stats} highlight={null} onClose={() => undefined} />);
    expect(screen.getByRole('timer')).toBeInTheDocument();
    unmount();

    const onPlayToday = vi.fn();
    render(<StatsModal stats={stats} highlight={null} onPlayToday={onPlayToday} onClose={() => undefined} />);
    expect(screen.queryByRole('timer')).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Play today’s' }));
    expect(onPlayToday).toHaveBeenCalledTimes(1);
  });
});

describe('CategoryPicker', () => {
  function Harness({ onChange }: { onChange: (category: PracticeCategory) => void }) {
    const [value, setValue] = useState<PracticeCategory>('all');
    return (
      <CategoryPicker
        value={value}
        onChange={(category) => {
          onChange(category);
          setValue(category);
        }}
      />
    );
  }

  it('is a labelled radio group of the four Free Flight categories', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Harness onChange={onChange} />);
    const group = screen.getByRole('group', { name: 'Free Flight birds' });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((radio) => (radio as HTMLInputElement).value)).toEqual(['all', 'birds', 'pokemon', 'fiction']);
    expect(within(group).getByRole('radio', { name: 'All' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Real birds' }).closest('label')).toHaveAttribute(
      'title',
      'Real birds and bird words only',
    );

    await user.click(within(group).getByRole('radio', { name: 'Real birds' }));
    expect(onChange).toHaveBeenLastCalledWith('birds');
    expect(within(group).getByRole('radio', { name: 'Real birds' })).toBeChecked();

    // Arrow keys move between the options like any radio group.
    await user.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenLastCalledWith('pokemon');
  });
});

describe('BirdCard', () => {
  const finished = (patch: Partial<GameView> = {}) =>
    makeGame({ status: 'won', guesses: [row('CRANE', 'CRANE')], answer: makeReveal(), ...patch });

  function renderCard(game: GameView, overrides: Partial<Parameters<typeof BirdCard>[0]> = {}) {
    const props = {
      game,
      onShare: vi.fn(),
      onLearnMore: vi.fn(),
      onNewBird: vi.fn(),
      category: 'all' as PracticeCategory,
      onCategoryChange: vi.fn(),
      onPlayFreeFlight: vi.fn(),
      onStats: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    };
    render(<BirdCard {...props} />);
    return props;
  }

  it.each<[BirdKind, string]>([
    ['bird', 'Bird'],
    ['term', 'Bird word'],
    ['pokemon', 'Pokémon'],
    ['game', 'Video game bird'],
    ['literature', 'Literary bird'],
  ])('labels a %s as "%s"', (kind, label) => {
    renderCard(finished({ answer: makeReveal({ kind, source: kind === 'bird' || kind === 'term' ? null : 'Somewhere' }) }));
    expect(screen.getByText(label, { selector: '.bird-card__kind' })).toBeInTheDocument();
  });

  it('shows where a character comes from under its name and links to its wiki', async () => {
    const answer = makeReveal({
      word: 'FARFETCHD',
      name: 'Farfetch’d',
      kind: 'pokemon',
      source: 'Pokémon Red & Blue',
      infoUrl: 'https://bulbapedia.bulbagarden.net/wiki/Farfetch%27d_(Pok%C3%A9mon)',
      infoSite: 'Bulbapedia',
    });
    const props = renderCard(finished({ wordLength: 9, guesses: [row('FARFETCHD', 'FARFETCHD')], answer }));
    const name = screen.getByText('Farfetch’d');
    expect(name.nextElementSibling).toHaveTextContent('from Pokémon Red & Blue');
    expect(screen.getByRole('group', { name: 'The answer: FARFETCHD' })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Learn more on Bulbapedia' }));
    expect(props.onLearnMore).toHaveBeenCalledWith(answer.infoUrl);
  });

  it('a real bird has no source line and links to Wikipedia', () => {
    renderCard(finished());
    expect(screen.queryByText(/^from /)).toBeNull();
    expect(screen.getByRole('button', { name: 'Learn more on Wikipedia' })).toBeInTheDocument();
    expect(screen.getByText('Did you know?')).toBeInTheDocument();
  });

  it('leaves out the fact box of a minimal card (an answer no longer in the list)', () => {
    renderCard(finished({ answer: makeReveal({ fact: '', infoUrl: 'https://en.wikipedia.org/wiki/Special:Search?search=Crane' }) }));
    expect(screen.queryByText('Did you know?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Learn more on Wikipedia' })).toBeInTheDocument();
  });

  it('offers the next Free Flight category next to "New bird", but not after a daily puzzle', async () => {
    const user = userEvent.setup();
    const practice = renderCard(finished({ mode: 'practice', puzzleNumber: null, date: null }), { category: 'fiction' });
    const group = screen.getByRole('group', { name: 'Next Free Flight bird from' });
    expect(within(group).getByRole('radio', { name: 'Games & books' })).toBeChecked();
    await user.click(within(group).getByRole('radio', { name: 'Pokémon' }));
    expect(practice.onCategoryChange).toHaveBeenCalledWith('pokemon');
    expect(practice.onNewBird).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /New bird/ }));
    expect(practice.onNewBird).toHaveBeenCalledTimes(1);
  });

  it('has no category picker on a daily card', () => {
    renderCard(finished());
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByRole('button', { name: /New bird/ })).toBeNull();
  });
});
