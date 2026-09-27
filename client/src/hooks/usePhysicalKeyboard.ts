import { BACKSPACE_KEY, ENTER_KEY } from '@birdle/shared';
import { useEffect, useRef } from 'react';

export interface FocusModality {
  /** Whether the player moved focus to `element` with Tab (rather than a click, tap or script). */
  isKeyboardFocused(element: Element): boolean;
  dispose(): void;
}

/**
 * Remembers which elements the player reached with Tab. `:focus-visible` can't
 * tell: Chromium (Discord's engine) turns it on for a clicked button as soon as
 * any key is pressed. Focus handed back by a closing dialog keeps the modality
 * of the original focus, since that element stays remembered until the next
 * pointer press.
 */
export function trackFocusModality(doc: Document = document): FocusModality {
  let tabbed = new WeakSet<Element>();
  let navigating = false;
  const onKeyDown = (event: KeyboardEvent) => {
    navigating = event.key === 'Tab';
  };
  const onPointerDown = () => {
    navigating = false;
    tabbed = new WeakSet();
  };
  const onFocusIn = (event: FocusEvent) => {
    if (navigating && event.target instanceof Element) tabbed.add(event.target);
    navigating = false;
  };
  doc.addEventListener('keydown', onKeyDown, true);
  doc.addEventListener('pointerdown', onPointerDown, true);
  doc.addEventListener('focusin', onFocusIn, true);
  return {
    isKeyboardFocused: (element) => tabbed.has(element),
    dispose: () => {
      doc.removeEventListener('keydown', onKeyDown, true);
      doc.removeEventListener('pointerdown', onPointerDown, true);
      doc.removeEventListener('focusin', onFocusIn, true);
    },
  };
}

/**
 * Maps a keydown to a game key (A-Z, ENTER, BACKSPACE), or null to ignore it.
 * `isKeyboardFocused` says whether a control was reached with Tab.
 */
export function gameKeyFor(event: KeyboardEvent, isKeyboardFocused: (element: Element) => boolean = () => false): string | null {
  if (event.defaultPrevented || event.isComposing) return null;
  // Shift only changes case; Ctrl/Alt/Meta (and AltGr) combos belong to the browser or OS.
  if (event.ctrlKey || event.altKey || event.metaKey || event.getModifierState?.('AltGraph')) return null;

  const target = event.target;
  if (target instanceof HTMLElement) {
    if (target.isContentEditable || target.closest('input, textarea, select')) return null;
    // Enter on a control the player tabbed to activates it; on a button last
    // clicked with the mouse it still submits the guess.
    const control = target.closest('button, a[href], [role="button"], [role="switch"]');
    if (event.key === 'Enter' && control && isKeyboardFocused(control)) return null;
  }

  if (event.key === 'Enter') return event.repeat ? null : ENTER_KEY;
  if (event.key === 'Backspace') return BACKSPACE_KEY;
  if (/^[a-z]$/i.test(event.key)) return event.key.toUpperCase();
  return null;
}

/** Physical keyboard input for the game, active only while `enabled` (no modal open). */
export function usePhysicalKeyboard(onKey: (key: string) => void, enabled: boolean): void {
  const onKeyRef = useRef(onKey);
  useEffect(() => {
    onKeyRef.current = onKey;
  }, [onKey]);

  // Tracked even while disabled: focus moves (and is handed back) around modals.
  const modality = useRef<FocusModality | null>(null);
  useEffect(() => {
    const tracker = trackFocusModality();
    modality.current = tracker;
    return () => {
      tracker.dispose();
      modality.current = null;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const isKeyboardFocused = (element: Element) => modality.current?.isKeyboardFocused(element) ?? false;
    const onKeyDown = (event: KeyboardEvent) => {
      const key = gameKeyFor(event, isKeyboardFocused);
      if (key === null) return;
      event.preventDefault();
      onKeyRef.current(key);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
