import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { emptyStats } from '@birdle/shared';
import { Board } from '../src/components/Board';
import { Keyboard } from '../src/components/Keyboard';
import { Modal } from '../src/components/Modal';
import { SettingsModal } from '../src/components/SettingsModal';
import { StatsModal } from '../src/components/StatsModal';
import { gameKeyFor, usePhysicalKeyboard } from '../src/hooks/usePhysicalKeyboard';
import { DEFAULT_SETTINGS } from '../src/settings';
import { makeGame, row } from './fixtures';

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
