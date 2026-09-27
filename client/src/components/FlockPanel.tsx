import { MAX_GUESSES, type LetterState } from '@birdle/shared';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { flockStatusText, type FlockEntry } from '../flock';
import { Avatar } from './Avatar';
import { ChevronIcon, FeatherIcon, FlightIcon } from './Icons';

interface FlockPanelProps {
  entries: readonly FlockEntry[];
  /** 'column' = right-hand panel on wide screens; 'strip' = collapsible bar above the board. */
  variant: 'column' | 'strip';
}

/** A player's colours, never letters. */
function MiniGrid({ rows }: { rows: readonly (readonly LetterState[])[] }) {
  const columns = rows[0]?.length ?? 0;
  if (columns === 0) return null;
  const empty = Math.max(0, MAX_GUESSES - rows.length);
  return (
    <div className="mini-grid" style={{ '--cols': columns } as CSSProperties} aria-hidden="true">
      {rows.flatMap((row, r) => row.map((state, c) => <span key={`${r}-${c}`} className="mini-grid__cell" data-state={state} />))}
      {Array.from({ length: empty * columns }, (_, i) => (
        <span key={`e-${i}`} className="mini-grid__cell" />
      ))}
    </div>
  );
}

function PlayerRow({ entry }: { entry: FlockEntry }) {
  const status = flockStatusText(entry, MAX_GUESSES);
  const name = entry.isSelf ? `${entry.displayName} (you)` : entry.displayName;
  const extras = [entry.hintUsed ? 'used the hint' : '', entry.hardMode ? 'hard mode' : ''];
  const label = [name, status, ...extras, entry.connected ? '' : 'left the Activity'].filter(Boolean).join(', ');

  return (
    <li className="flock-player" data-status={entry.status} data-connected={entry.connected} aria-label={label}>
      <Avatar id={entry.id} name={entry.displayName} url={entry.avatarUrl} size={34} />
      <div className="flock-player__text" aria-hidden="true">
        <span className="flock-player__name">
          {entry.displayName}
          {entry.isSelf && <span className="flock-player__you"> (you)</span>}
        </span>
        <span className="flock-player__status">
          {status}
          {entry.hardMode && (
            <span className="flock-player__badge" title="Hard mode">
              *
            </span>
          )}
          {entry.hintUsed && <FeatherIcon className="flock-player__hint" />}
        </span>
      </div>
      <MiniGrid rows={entry.rows} />
    </li>
  );
}

function PlayerList({ entries, id, hidden }: { entries: readonly FlockEntry[]; id?: string; hidden?: boolean }) {
  return (
    <ul className="flock__list" id={id} hidden={hidden}>
      {entries.map((entry) => (
        <PlayerRow key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}

const EMPTY_NOTE = 'Play in a voice channel with friends to see how the flock is doing: colours only, never letters.';

function FlockColumn({ entries }: { entries: readonly FlockEntry[] }) {
  const titleId = useId();
  const others = entries.filter((entry) => !entry.isSelf).length;
  return (
    <aside className="flock flock--column" aria-labelledby={titleId}>
      <h2 className="flock__title" id={titleId}>
        <FlightIcon /> The Flock <span className="flock__count">{entries.length}</span>
      </h2>
      <p className="flock__subtitle">Today&rsquo;s daily puzzle</p>
      {entries.length > 0 && <PlayerList entries={entries} />}
      {others === 0 && <p className="flock__empty">{EMPTY_NOTE}</p>}
    </aside>
  );
}

/** Narrow screens: a one-line summary that drops the full list over the board. */
function FlockStrip({ entries }: { entries: readonly FlockEntry[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const ref = useRef<HTMLElement>(null);

  // Close on a tap outside or Esc, like a menu.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const solved = entries.filter((entry) => entry.status === 'won').length;
  const playing = entries.filter((entry) => entry.status === 'playing').length;
  const summary = solved > 0 ? `${solved} solved` : playing > 0 ? `${playing} playing` : `${entries.length} here`;

  return (
    <section ref={ref} className={open ? 'flock flock--strip flock--open' : 'flock flock--strip'} aria-label="The Flock">
      <button
        type="button"
        className="flock__toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <FlightIcon />
        <span className="flock__toggle-label">
          Flock <span className="flock__count">{entries.length}</span>
        </span>
        <span className="flock__faces" aria-hidden="true">
          {entries.slice(0, 6).map((entry) => (
            <span key={entry.id} className="flock__face" data-status={entry.status}>
              <Avatar id={entry.id} name={entry.displayName} url={entry.avatarUrl} size={24} />
            </span>
          ))}
        </span>
        <span className="flock__summary">{summary}</span>
        <ChevronIcon className="flock__chevron" />
      </button>
      <PlayerList entries={entries} id={listId} hidden={!open} />
    </section>
  );
}

/** Everyone in this Activity instance and their progress on today's daily puzzle. */
export function FlockPanel({ entries, variant }: FlockPanelProps) {
  if (variant === 'column') return <FlockColumn entries={entries} />;
  // On narrow screens the strip is only worth its space once someone else is here.
  return entries.some((entry) => !entry.isSelf) ? <FlockStrip entries={entries} /> : null;
}
