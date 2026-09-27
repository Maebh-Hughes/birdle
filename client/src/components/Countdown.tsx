import { formatCountdown } from '@birdle/shared';
import { useCountdown } from '../hooks/useCountdown';

/** "Next BIRDLE in HH:MM:SS" (the next puzzle unlocks at local midnight). */
export function Countdown({ label = 'Next BIRDLE in' }: { label?: string }) {
  const ms = useCountdown();
  return (
    <div className="countdown">
      <span className="countdown__label">{label}</span>
      <span className="countdown__time" role="timer" aria-live="off">
        {formatCountdown(ms)}
      </span>
    </div>
  );
}

interface NextPuzzleProps {
  /** Set once today's puzzle is already waiting (yesterday's board is still shown). */
  onPlayToday?: () => void;
}

/** The countdown to the next puzzle, or a way to today's when it has already unlocked. */
export function NextPuzzle({ onPlayToday }: NextPuzzleProps) {
  if (!onPlayToday) return <Countdown />;
  return (
    <div className="countdown countdown--ready">
      <span className="countdown__label">A new BIRDLE has hatched</span>
      <button type="button" className="button button--gold button--small" onClick={onPlayToday}>
        Play today&rsquo;s
      </button>
    </div>
  );
}
