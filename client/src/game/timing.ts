// Animation timings shared by the CSS (via custom properties) and the game hook,
// which waits for the reveal before colouring the keyboard or celebrating.

/** One tile's flip. */
export const FLIP_MS = 500;
/** Delay between neighbouring tiles' bounce on a win. */
export const BOUNCE_STAGGER_MS = 80;
export const BOUNCE_MS = 600;
/** Pause between the end of the reveal/bounce and the bird card opening. */
export const GAME_OVER_DELAY_MS = 900;

/** Per-tile flip delay: 250 ms for short words, tighter for long ones so an 11-letter reveal stays brisk. */
export function revealStagger(wordLength: number): number {
  return Math.min(250, Math.round(1500 / Math.max(1, wordLength)));
}

/** Time from submit response to the last tile finishing its flip. */
export function revealDuration(wordLength: number): number {
  return (wordLength - 1) * revealStagger(wordLength) + FLIP_MS;
}

export function bounceDuration(wordLength: number): number {
  return (wordLength - 1) * BOUNCE_STAGGER_MS + BOUNCE_MS;
}
