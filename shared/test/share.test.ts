import { describe, expect, it } from 'vitest';
import { buildShareText, shareEmoji, type ShareableGame } from '../src/share';
import { states } from './helpers';

function game(overrides: Partial<ShareableGame> = {}, patterns = ['Y....', '.G.Y.', 'GG.G.', 'GGGGG']): ShareableGame {
  return {
    mode: 'daily',
    puzzleNumber: 12,
    status: 'won',
    hardMode: false,
    hintUsed: false,
    maxGuesses: 6,
    guesses: patterns.map((pattern) => ({ result: states(pattern) })),
    answer: { name: 'Robin' },
    ...overrides,
  };
}

describe('buildShareText', () => {
  it('matches the spec example (daily, hard mode, hint used)', () => {
    expect(buildShareText(game({ hardMode: true, hintUsed: true }))).toBe(
      ['BIRDLE #12 4/6*', '🟨⬛⬛⬛⬛', '⬛🟩⬛🟨⬛', '🟩🟩⬛🟩⬛', '🟩🟩🟩🟩🟩', '🪶 hint used'].join('\n'),
    );
  });

  it('omits the hard-mode star and the hint line when not applicable', () => {
    expect(buildShareText(game())).toBe(['BIRDLE #12 4/6', '🟨⬛⬛⬛⬛', '⬛🟩⬛🟨⬛', '🟩🟩⬛🟩⬛', '🟩🟩🟩🟩🟩'].join('\n'));
  });

  it('scores a loss as X/6', () => {
    const lost = game({ status: 'lost' }, ['....', '.Y..', '.Y..', 'G...', 'G.G.', 'GGG.']);
    expect(buildShareText(lost)).toBe(
      ['BIRDLE #12 X/6', '⬛⬛⬛⬛', '⬛🟨⬛⬛', '⬛🟨⬛⬛', '🟩⬛⬛⬛', '🟩⬛🟩⬛', '🟩🟩🟩⬛'].join('\n'),
    );
  });

  it('never names the answer of a daily puzzle', () => {
    expect(buildShareText(game({ hintUsed: true }))).not.toContain('Robin');
    expect(buildShareText(game())).not.toContain('🐦');
  });

  it('uses the Free Flight header and names the bird in practice mode', () => {
    const practice = game({ mode: 'practice', puzzleNumber: null }, ['.Y.G', 'GGGG']);
    expect(buildShareText(practice)).toBe(['BIRDLE Free Flight 2/6', '⬛🟨⬛🟩', '🟩🟩🟩🟩', '🐦 Robin'].join('\n'));
  });

  it('puts the hint line before the bird line and marks hard mode in practice', () => {
    const practice = game({ mode: 'practice', puzzleNumber: null, hardMode: true, hintUsed: true, status: 'lost' }, [
      '.....',
      '.....',
      '.....',
      '.....',
      '.....',
      'GGGG.',
    ]);
    expect(buildShareText(practice).split('\n')).toEqual([
      'BIRDLE Free Flight X/6*',
      '⬛⬛⬛⬛⬛',
      '⬛⬛⬛⬛⬛',
      '⬛⬛⬛⬛⬛',
      '⬛⬛⬛⬛⬛',
      '⬛⬛⬛⬛⬛',
      '🟩🟩🟩🟩⬛',
      '🪶 hint used',
      '🐦 Robin',
    ]);
  });

  it('uses orange/blue in colour-blind mode', () => {
    expect(buildShareText(game(), { colorBlind: true })).toBe(
      ['BIRDLE #12 4/6', '🟦⬛⬛⬛⬛', '⬛🟧⬛🟦⬛', '🟧🟧⬛🟧⬛', '🟧🟧🟧🟧🟧'].join('\n'),
    );
  });

  it('uses white squares for absent tiles in the light theme', () => {
    expect(buildShareText(game(), { theme: 'light' })).toBe(
      ['BIRDLE #12 4/6', '🟨⬜⬜⬜⬜', '⬜🟩⬜🟨⬜', '🟩🟩⬜🟩⬜', '🟩🟩🟩🟩🟩'].join('\n'),
    );
  });

  it('combines colour-blind mode with the light theme', () => {
    expect(buildShareText(game(), { colorBlind: true, theme: 'light' }).split('\n')[1]).toBe('🟦⬜⬜⬜⬜');
  });

  it('handles 11-letter rows', () => {
    const long = game({}, ['GGGGGGGGGGG']);
    expect(buildShareText(long)).toBe(`BIRDLE #12 1/6\n${'🟩'.repeat(11)}`);
  });

  it('refuses to share a game in progress or a daily game without a number', () => {
    expect(() => buildShareText(game({ status: 'playing' }))).toThrow();
    expect(() => buildShareText(game({ puzzleNumber: null }))).toThrow();
  });
});

describe('shareEmoji', () => {
  it('defaults to the dark, normal-colour palette', () => {
    expect(shareEmoji()).toEqual({ correct: '🟩', present: '🟨', absent: '⬛' });
    expect(shareEmoji({ colorBlind: true, theme: 'light' })).toEqual({ correct: '🟧', present: '🟦', absent: '⬜' });
  });
});
