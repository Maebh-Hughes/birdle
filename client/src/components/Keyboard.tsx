import { BACKSPACE_KEY, ENTER_KEY, KEYBOARD_ROWS, type LetterState } from '@birdle/shared';
import type { MouseEvent } from 'react';
import { BackspaceIcon } from './Icons';

interface KeyboardProps {
  /** Best known state per letter (from keyStates). */
  states: Readonly<Record<string, LetterState>>;
  onKey: (key: string) => void;
}

function keyLabel(key: string, state: LetterState | undefined): string {
  if (key === ENTER_KEY) return 'Enter';
  if (key === BACKSPACE_KEY) return 'Backspace';
  return state ? `${key}, ${state}` : key;
}

// Keep focus where it was on mouse/touch presses, so a later physical Enter
// submits the guess instead of re-pressing the last on-screen key.
const keepFocus = (event: MouseEvent) => event.preventDefault();

/** On-screen QWERTY keyboard (the game never uses a text input). */
export function Keyboard({ states, onKey }: KeyboardProps) {
  return (
    <div className="keyboard" role="group" aria-label="Keyboard">
      {KEYBOARD_ROWS.map((row, rowIndex) => (
        <div className="keyboard__row" key={rowIndex}>
          {rowIndex === 1 && <span className="keyboard__spacer" aria-hidden="true" />}
          {row.map((key) => {
            const state = states[key];
            const wide = key === ENTER_KEY || key === BACKSPACE_KEY;
            return (
              <button
                key={key}
                type="button"
                className={wide ? 'key key--wide' : 'key'}
                data-state={state}
                aria-label={keyLabel(key, state)}
                onMouseDown={keepFocus}
                onClick={() => onKey(key)}
              >
                {key === BACKSPACE_KEY ? <BackspaceIcon /> : key === ENTER_KEY ? 'Enter' : key}
              </button>
            );
          })}
          {rowIndex === 1 && <span className="keyboard__spacer" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}
