import type { GameView } from '@birdle/shared';
import type { CSSProperties } from 'react';
import { FLIP_MS, revealStagger } from '../game/timing';
import { Row } from './Row';

interface BoardProps {
  game: Pick<GameView, 'wordLength' | 'maxGuesses' | 'guesses' | 'status'>;
  current: string;
  revealingRow?: number | null;
  bounceRow?: number | null;
  shake?: { row: number; nonce: number } | null;
}

/** maxGuesses rows of wordLength tiles (4-11 wide); tile size comes from CSS. */
export function Board({ game, current, revealingRow = null, bounceRow = null, shake = null }: BoardProps) {
  const style = {
    '--cols': game.wordLength,
    '--rows': game.maxGuesses,
    '--stagger': `${revealStagger(game.wordLength)}ms`,
    '--flip': `${FLIP_MS}ms`,
  } as CSSProperties;

  const rows = Array.from({ length: game.maxGuesses }, (_, i) => {
    const guess = game.guesses[i];
    if (guess) {
      return (
        <Row
          key={i}
          index={i}
          length={game.wordLength}
          letters={guess.word}
          result={guess.result}
          reveal={i === revealingRow}
          bounce={i === bounceRow}
        />
      );
    }
    const isCurrent = i === game.guesses.length && game.status === 'playing';
    return (
      <Row
        key={i}
        index={i}
        length={game.wordLength}
        letters={isCurrent ? current : ''}
        shakeNonce={shake && shake.row === i ? shake.nonce : 0}
      />
    );
  });

  return (
    <div className="board" role="group" aria-label={`Board, ${game.wordLength} letters`} style={style}>
      {rows}
    </div>
  );
}
