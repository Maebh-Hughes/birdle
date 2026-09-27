import {
  PRACTICE_CATEGORIES,
  PRACTICE_CATEGORY_DESCRIPTIONS,
  PRACTICE_CATEGORY_LABELS,
  type PracticeCategory,
} from '@birdle/shared';
import { useId } from 'react';

interface CategoryPickerProps {
  value: PracticeCategory;
  onChange: (category: PracticeCategory) => void;
  /** The group's accessible name (visually hidden). */
  legend?: string;
  className?: string;
}

/**
 * Where Free Flight birds come from: all, real birds only, Pokémon, or games &
 * books. A radio group styled as a segmented control; choosing only reports the
 * choice (the caller decides whether that starts a new round).
 */
export function CategoryPicker({ value, onChange, legend = 'Free Flight birds', className }: CategoryPickerProps) {
  const name = useId();
  return (
    <fieldset className={className ? `category-picker ${className}` : 'category-picker'}>
      <legend className="sr-only">{legend}</legend>
      <div className="segmented segmented--categories">
        {PRACTICE_CATEGORIES.map((category) => (
          <label key={category} className="segmented__option" title={PRACTICE_CATEGORY_DESCRIPTIONS[category]}>
            <input
              type="radio"
              name={name}
              value={category}
              checked={value === category}
              onChange={() => onChange(category)}
            />
            <span>{PRACTICE_CATEGORY_LABELS[category]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
