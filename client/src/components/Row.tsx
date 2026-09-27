import type { LetterState } from '@birdle/shared';
import { useLayoutEffect, useRef, type AnimationEvent } from 'react';
import { Tile, type TileState } from './Tile';

interface RowProps {
  index: number;
  length: number;
  /** Submitted word or letters typed so far. */
  letters: string;
  /** Present for a submitted row. */
  result?: readonly LetterState[];
  reveal?: boolean;
  bounce?: boolean;
  /** Changing this (non-zero) value shakes the row. */
  shakeNonce?: number;
}

const SHAKE_CLASS = 'row--shake';

export function Row({ index, length, letters, result, reveal = false, bounce = false, shakeNonce = 0 }: RowProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Restart the shake animation even if it is still running from a previous attempt.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || shakeNonce === 0) return;
    element.classList.remove(SHAKE_CLASS);
    void element.offsetWidth;
    element.classList.add(SHAKE_CLASS);
  }, [shakeNonce]);

  const onAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) event.currentTarget.classList.remove(SHAKE_CLASS);
  };

  const tiles = Array.from({ length }, (_, i) => {
    const letter = letters[i] ?? '';
    const state: TileState = result?.[i] ?? (letter ? 'tbd' : 'empty');
    return <Tile key={i} index={i} letter={letter} state={state} reveal={reveal} bounce={bounce} />;
  });

  return (
    <div ref={ref} className="row" role="group" aria-label={`Row ${index + 1}`} onAnimationEnd={onAnimationEnd}>
      {tiles}
    </div>
  );
}
