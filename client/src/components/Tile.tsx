import type { LetterState } from '@birdle/shared';
import type { CSSProperties } from 'react';

/** 'tbd' = typed but not submitted. */
export type TileState = LetterState | 'tbd' | 'empty';

export function tileLabel(letter: string, state: TileState): string {
  if (state === 'empty') return 'empty';
  if (state === 'tbd') return letter;
  return `${letter}, ${state}`;
}

interface TileProps {
  letter: string;
  state: TileState;
  /** Position in the row; staggers the flip and bounce. */
  index: number;
  reveal?: boolean;
  bounce?: boolean;
}

export function Tile({ letter, state, index, reveal = false, bounce = false }: TileProps) {
  let className = 'tile';
  if (reveal) className += ' tile--reveal';
  if (bounce) className += ' tile--bounce';
  return (
    <div
      className={className}
      data-state={state}
      role="img"
      aria-label={tileLabel(letter, state)}
      style={{ '--i': index } as CSSProperties}
    >
      {letter}
    </div>
  );
}
