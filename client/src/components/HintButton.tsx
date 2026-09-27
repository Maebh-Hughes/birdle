import { HINT_AFTER_GUESSES, type GameView } from '@birdle/shared';
import { useEffect, useId, useState } from 'react';
import { FeatherIcon } from './Icons';

interface HintButtonProps {
  game: Pick<GameView, 'status' | 'guesses' | 'hintAvailable' | 'hintUsed'>;
  pending: boolean;
  onReveal: () => void;
}

const CONFIRM_WINDOW_MS = 4000;

/**
 * Unlocks after HINT_AFTER_GUESSES guesses. Asks for a second tap first, since
 * a used hint is marked in the share text.
 */
export function HintButton({ game, pending, onReveal }: HintButtonProps) {
  const [armed, setArmed] = useState(false);
  const noteId = useId();

  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), CONFIRM_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (game.hintUsed || game.status !== 'playing') return null;

  const remaining = Math.max(0, HINT_AFTER_GUESSES - game.guesses.length);
  if (!game.hintAvailable) {
    return (
      <button type="button" className="button button--ghost hint-button" disabled>
        <FeatherIcon />
        {remaining > 0 ? `Hint in ${remaining} ${remaining === 1 ? 'guess' : 'guesses'}` : 'No hint'}
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        className={armed ? 'button button--gold hint-button' : 'button button--ghost hint-button'}
        disabled={pending}
        aria-describedby={noteId}
        onClick={() => {
          if (armed) {
            setArmed(false);
            onReveal();
          } else {
            setArmed(true);
          }
        }}
      >
        <FeatherIcon />
        {pending ? 'Fetching hint…' : armed ? 'Tap again to reveal' : 'Hint'}
      </button>
      <span id={noteId} className="sr-only">
        Using the hint adds a feather to your shared result.
      </span>
    </>
  );
}
