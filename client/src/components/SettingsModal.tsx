import { useId } from 'react';
import type { Settings, ThemeSetting, UpdateSettings } from '../settings';
import { Modal } from './Modal';
import { Switch } from './Switch';

interface SettingsModalProps {
  settings: Settings;
  onChange: UpdateSettings;
  /** Hard mode is fixed once the current game has guesses; this is its value then. */
  lockedHardMode: boolean | null;
  /** Who is playing and how (Discord or browser preview). */
  playerNote: string;
  onClose: () => void;
}

const THEMES: readonly { value: ThemeSetting; label: string }[] = [
  { value: 'dark', label: 'Dusk' },
  { value: 'light', label: 'Daylight' },
  { value: 'system', label: 'System' },
];

export function SettingsModal({ settings, onChange, lockedHardMode, playerNote, onClose }: SettingsModalProps) {
  const themeName = useId();
  const locked = lockedHardMode !== null;

  return (
    <Modal title="Settings" onClose={onClose} className="settings">
      <Switch
        label="Hard mode"
        description={
          locked
            ? 'Locked while this game is in progress: it is set by your first guess.'
            : 'Any revealed hints must be used in later guesses.'
        }
        checked={locked ? lockedHardMode : settings.hardMode}
        disabled={locked}
        onChange={(hardMode) => onChange({ hardMode })}
      />
      <Switch
        label="Colour-blind mode"
        description="High-contrast orange and blue tiles."
        checked={settings.colorBlind}
        onChange={(colorBlind) => onChange({ colorBlind })}
      />

      <fieldset className="setting setting--theme">
        <legend className="setting__label">Theme</legend>
        <div className="segmented">
          {THEMES.map((theme) => (
            <label key={theme.value} className="segmented__option">
              <input
                type="radio"
                name={themeName}
                value={theme.value}
                checked={settings.theme === theme.value}
                onChange={() => onChange({ theme: theme.value })}
              />
              <span>{theme.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="settings__note">{playerNote}</p>
    </Modal>
  );
}
