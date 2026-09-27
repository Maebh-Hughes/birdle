import { HINT_AFTER_GUESSES, MAX_GUESSES, MAX_WORD_LENGTH, MIN_WORD_LENGTH, type LetterState } from '@birdle/shared';
import type { CSSProperties } from 'react';
import { Modal } from './Modal';
import { Tile } from './Tile';

interface Example {
  word: string;
  /** Index of the highlighted letter. */
  at: number;
  state: LetterState;
  explanation: string;
}

// Words of different lengths to show that the board is as wide as the answer.
const EXAMPLES: readonly Example[] = [
  { word: 'WREN', at: 0, state: 'correct', explanation: 'is in the word and in the right spot.' },
  { word: 'ROBIN', at: 3, state: 'present', explanation: 'is in the word but in the wrong spot.' },
  { word: 'PELICAN', at: 5, state: 'absent', explanation: 'is not in the word in any spot.' },
];

function ExampleRow({ word, at, state, explanation }: Example) {
  const letter = word[at] ?? '';
  return (
    <div className="help__example">
      <div className="help__tiles" role="group" aria-label={`Example: ${word}`} style={{ '--cols': word.length } as CSSProperties}>
        {[...word].map((ch, i) => (
          <Tile key={i} index={i} letter={ch} state={i === at ? state : 'tbd'} />
        ))}
      </div>
      <p>
        <strong>{letter}</strong> {explanation}
      </p>
    </div>
  );
}

export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose} className="help">
      <p className="help__lead">
        Guess the hidden bird word in {MAX_GUESSES} tries.
      </p>
      <ul className="help__rules">
        <li>
          Every answer is a bird or a bird word, from {MIN_WORD_LENGTH} to {MAX_WORD_LENGTH} letters long (think WREN
          up to HUMMINGBIRD). The board is as wide as today&rsquo;s bird.
        </li>
        <li>Each guess must be a real word of that length. Press Enter to submit.</li>
        <li>After each guess, the tiles change colour to show how close you were.</li>
      </ul>

      <h3 className="help__heading">Examples</h3>
      {EXAMPLES.map((example) => (
        <ExampleRow key={example.word} {...example} />
      ))}

      <h3 className="help__heading">Extras</h3>
      <ul className="help__rules">
        <li>
          <strong>Hint:</strong> after {HINT_AFTER_GUESSES} guesses you can reveal a clue. Shared results show a 🪶
          when you used it.
        </li>
        <li>
          <strong>Hard mode:</strong> revealed letters must be used in later guesses, and green ones stay put.
        </li>
        <li>
          <strong>Free Flight:</strong> practise on unlimited random birds, rarer ones included. It doesn&rsquo;t count
          toward your stats.
        </li>
        <li>
          <strong>The Flock:</strong> see how everyone in this Activity is doing on the daily puzzle. Colours only,
          never letters.
        </li>
      </ul>
      <p className="help__footer">A new BIRDLE hatches every day at midnight, your local time.</p>
    </Modal>
  );
}
