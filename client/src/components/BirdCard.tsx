import { KIND_LABELS, winMessage, type GameView, type PracticeCategory } from '@birdle/shared';
import type { CSSProperties } from 'react';
import { CategoryPicker } from './CategoryPicker';
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
  /** Free Flight: the category the next bird comes from, chosen next to "New bird". */
  category: PracticeCategory;
  onCategoryChange: (category: PracticeCategory) => void;
  onPlayFreeFlight: () => void;
  onStats: () => void;
  /** Present when today's puzzle has already unlocked (replaces the countdown). */
  onPlayToday?: () => void;
  onClose: () => void;
}

/** The end-of-game reveal: the bird, where it's from, a fun fact, a "Learn more" link and sharing. */
export function BirdCard({
  game,
  onShare,
  onLearnMore,
  onNewBird,
  category,
  onCategoryChange,
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
          {answer.source && <p className="bird-card__source">from {answer.source}</p>}
          <p className="bird-card__kind">{KIND_LABELS[answer.kind] ?? KIND_LABELS.bird}</p>
          {answer.fact && (
            <div className="bird-card__fact">
              <h3 className="bird-card__fact-title">Did you know?</h3>
              <p>{answer.fact}</p>
            </div>
          )}
          <div className="bird-card__actions">
            <button type="button" className="button button--ghost" onClick={() => onLearnMore(answer.infoUrl)}>
              <ExternalIcon /> Learn more on {answer.infoSite}
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
          <div className="bird-card__new">
            <CategoryPicker value={category} onChange={onCategoryChange} legend="Next Free Flight bird from" />
            <button type="button" className="button button--gold" onClick={onNewBird}>
              <RefreshIcon /> New bird
            </button>
          </div>
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
