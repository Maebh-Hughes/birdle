import { MAX_GUESSES, type Stats } from '@birdle/shared';
import type { CSSProperties } from 'react';
import { NextPuzzle } from './Countdown';
import { ShareIcon } from './Icons';
import { Modal } from './Modal';

interface StatsModalProps {
  /** Already adjusted for display (lapsed streaks show as 0). */
  stats: Stats;
  /** Distribution row to highlight: today's winning guess count, 1-based. */
  highlight: number | null;
  /** Present when today's daily game is over and can be shared. */
  onShare?: () => void;
  /** Present when today's puzzle has already unlocked (replaces the countdown). */
  onPlayToday?: () => void;
  onClose: () => void;
}

export function StatsModal({ stats, highlight, onShare, onPlayToday, onClose }: StatsModalProps) {
  const winPct = stats.played === 0 ? 0 : Math.round((stats.wins / stats.played) * 100);
  const distribution = Array.from({ length: MAX_GUESSES }, (_, i) => stats.distribution[i] ?? 0);
  const maxCount = Math.max(1, ...distribution);
  const figures: [string, number][] = [
    ['Played', stats.played],
    ['Win %', winPct],
    ['Current streak', stats.currentStreak],
    ['Max streak', stats.maxStreak],
  ];

  return (
    <Modal title="Statistics" onClose={onClose} className="stats">
      <dl className="stats__figures">
        {figures.map(([label, value]) => (
          <div className="stats__figure" key={label}>
            <dt className="stats__label">{label}</dt>
            <dd className="stats__value">{value}</dd>
          </div>
        ))}
      </dl>

      <h3 className="stats__heading">Guess distribution</h3>
      {stats.wins === 0 ? (
        <p className="stats__empty">Solve a daily BIRDLE to start your distribution.</p>
      ) : (
        <ol className="stats__distribution">
          {distribution.map((count, i) => (
            <li
              key={i}
              className={highlight === i + 1 ? 'stats__bar-row stats__bar-row--today' : 'stats__bar-row'}
              aria-label={`${i + 1} ${i === 0 ? 'guess' : 'guesses'}: ${count} ${count === 1 ? 'win' : 'wins'}`}
            >
              <span className="stats__guess" aria-hidden="true">
                {i + 1}
              </span>
              <span className="stats__track" aria-hidden="true">
                <span className="stats__bar" style={{ '--share': count / maxCount } as CSSProperties}>
                  {count}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="stats__note">Stats count daily puzzles only; Free Flight games are just for fun.</p>

      <div className="stats__footer">
        <NextPuzzle onPlayToday={onPlayToday} />
        {onShare && (
          <button type="button" className="button button--primary" onClick={onShare}>
            <ShareIcon /> Share
          </button>
        )}
      </div>
    </Modal>
  );
}
