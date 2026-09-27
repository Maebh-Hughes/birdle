import { winMessage, type GameView } from '@birdle/shared';
import type { CSSProperties } from 'react';
import { NextPuzzle } from './Countdown';
import { ExternalIcon, FlightIcon, RefreshIcon, ShareIcon, StatsIcon } from './Icons';
import { Modal } from './Modal';
import { Tile } from './Tile';

interface BirdCardProps {
  /** A finished game (the server includes `answer` only then). */
  game: GameView;
  onShare: () => void;
  onLearnMore: (url: string) => void;
  onNewBird: () => void;
  onPlayFreeFlight: () => void;
  onStats: () => void;
  /** Present when today's puzzle has already unlocked (replaces the countdown). */
  onPlayToday?: () => void;
  onClose: () => void;
}

/** The end-of-game reveal: the bird, a fun fact, Wikipedia and sharing. */
export function BirdCard({
  game,
  onShare,
  onLearnMore,
  onNewBird,
  onPlayFreeFlight,
  onStats,
  onPlayToday,
  onClose,
}: BirdCardProps) {
  const answer = game.answer;
  const won = game.status === 'won';
  const headline = won ? winMessage(game.guesses.length) : 'Stumped this time';
  const score = won ? `${game.guesses.length}/${game.maxGuesses}` : `X/${game.maxGuesses}`;
  const practice = game.mode === 'practice';

  return (
    <Modal title={headline} onClose={onClose} className="bird-card">
      <p className="bird-card__score">
        {practice ? 'Free Flight' : `BIRDLE #${game.puzzleNumber ?? ''}`} &middot; {score}
        {game.hardMode && ' · hard mode'}
        {game.hintUsed && ' · 🪶 hint used'}
      </p>

      {answer ? (
        <>
          <div
            className="bird-card__tiles"
            role="group"
            aria-label={`The answer: ${answer.word}`}
            style={{ '--cols': answer.word.length } as CSSProperties}
          >
            {[...answer.word].map((letter, i) => (
              <Tile key={i} index={i} letter={letter} state="correct" />
            ))}
          </div>
          <p className="bird-card__name">{answer.name}</p>
          <p className="bird-card__kind">{answer.kind === 'term' ? 'Bird word' : 'Bird'}</p>
          <div className="bird-card__fact">
            <h3 className="bird-card__fact-title">Did you know?</h3>
            <p>{answer.fact}</p>
          </div>
          <div className="bird-card__actions">
            <button
              type="button"
              className="button button--ghost"
              onClick={() => onLearnMore(answer.wikiUrl)}
              aria-label={`Learn more about ${answer.name} on Wikipedia`}
            >
              <ExternalIcon /> Learn more
            </button>
            <button type="button" className="button button--primary" onClick={onShare}>
              <ShareIcon /> Share
            </button>
          </div>
        </>
      ) : (
        <div className="bird-card__actions">
          <button type="button" className="button button--primary" onClick={onShare}>
            <ShareIcon /> Share
          </button>
        </div>
      )}

      <div className="bird-card__next">
        {practice ? (
          <button type="button" className="button button--gold" onClick={onNewBird}>
            <RefreshIcon /> New bird
          </button>
        ) : (
          <>
            <NextPuzzle onPlayToday={onPlayToday} />
            <div className="bird-card__links">
              <button type="button" className="button button--ghost button--small" onClick={onStats}>
                <StatsIcon /> Stats
              </button>
              <button type="button" className="button button--ghost button--small" onClick={onPlayFreeFlight}>
                <FlightIcon /> Free Flight
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
