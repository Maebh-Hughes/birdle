import type { GameMode } from '@birdle/shared';
import { FlightIcon, HelpIcon, SettingsIcon, StatsIcon } from './Icons';
import { Logo } from './Logo';

interface HeaderProps {
  mode: GameMode;
  onToggleMode: () => void;
  onHelp: () => void;
  onStats: () => void;
  onSettings: () => void;
}

export function Header({ mode, onToggleMode, onHelp, onStats, onSettings }: HeaderProps) {
  const practice = mode === 'practice';
  return (
    <header className="header">
      <div className="header__side">
        <button type="button" className="icon-button" aria-label="How to play" title="How to play" onClick={onHelp}>
          <HelpIcon />
        </button>
        <button
          type="button"
          className="mode-toggle"
          aria-pressed={practice}
          title={practice ? 'Back to the daily BIRDLE' : 'Free Flight: unlimited practice birds'}
          onClick={onToggleMode}
        >
          <FlightIcon />
          <span className="mode-toggle__label">Free Flight</span>
        </button>
      </div>

      <h1 className="brand">
        <Logo size={34} className="brand__logo" />
        <span className="brand__title">BIRDLE</span>
      </h1>

      <div className="header__side header__side--end">
        <button type="button" className="icon-button" aria-label="Statistics" title="Statistics" onClick={onStats}>
          <StatsIcon />
        </button>
        <button type="button" className="icon-button" aria-label="Settings" title="Settings" onClick={onSettings}>
          <SettingsIcon />
        </button>
      </div>
    </header>
  );
}
