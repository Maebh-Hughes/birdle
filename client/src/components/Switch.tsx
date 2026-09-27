import { useId, type ReactNode } from 'react';

interface SwitchProps {
  label: string;
  description?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** A labelled on/off setting rendered as a real <button role="switch">. */
export function Switch({ label, description, checked, disabled = false, onChange }: SwitchProps) {
  const id = useId();
  return (
    <div className="setting">
      <div className="setting__text">
        <span className="setting__label" id={`${id}-label`}>
          {label}
        </span>
        {description && (
          <span className="setting__description" id={`${id}-description`}>
            {description}
          </span>
        )}
      </div>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-description` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__thumb" />
      </button>
    </div>
  );
}
