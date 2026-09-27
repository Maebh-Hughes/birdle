import { describe, expect, it } from 'vitest';
import {
  BirdleDataError,
  checkBirdData,
  parseBirdData,
  parseDictionary,
  toBirdReveal,
  wikiUrl,
} from '../src/birdData';
import { bird } from './helpers';

const valid = [bird('ROBIN'), bird('WREN', { obscurity: 2 }), bird('TALON', { kind: 'term', obscurity: 3 })];

describe('checkBirdData', () => {
  it('accepts well-formed data', () => {
    expect(checkBirdData(valid)).toEqual({ errors: [], editorial: [] });
  });

  it('requires a non-empty array', () => {
    expect(checkBirdData({ word: 'ROBIN' }).errors).toEqual(['expected a JSON array of bird entries']);
    expect(checkBirdData([]).errors).toEqual(['the list is empty']);
  });

  it('rejects non-object entries', () => {
    expect(checkBirdData([bird('ROBIN'), null, 'WREN']).errors).toEqual([
      '[1]: expected an object, got null',
      '[2]: expected an object, got string',
    ]);
  });

  it.each([
    ['lowercase', 'robin'],
    ['too short', 'EMU'],
    ['too long', 'HUMMINGBIRDS'],
    ['non-letters', 'BLUE-JAY'],
    ['diacritics', 'KĀKĀ'],
  ])('rejects a %s word', (_label, word) => {
    const { errors } = checkBirdData([bird('ROBIN'), { ...bird('WREN'), word }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^\[1\] .*"word" must be 4-11 uppercase letters A-Z/);
  });

  it('rejects a missing word', () => {
    const { word: _word, ...rest } = bird('WREN');
    expect(checkBirdData([bird('ROBIN'), rest]).errors).toEqual(['[1]: "word" must be 4-11 uppercase letters A-Z, got undefined']);
  });

  it('rejects duplicate words', () => {
    expect(checkBirdData([bird('ROBIN'), bird('WREN'), bird('ROBIN')]).errors).toEqual([
      '[2] ROBIN: duplicate word (first at [0])',
    ]);
  });

  it('validates kind and obscurity', () => {
    const data = [
      bird('ROBIN'),
      { ...bird('WREN'), kind: 'mammal' },
      { ...bird('KITE'), obscurity: 4 },
      { ...bird('RAIL'), obscurity: '1' },
      { ...bird('TERN'), obscurity: 1.5 },
    ];
    expect(checkBirdData(data).errors).toEqual([
      '[1] WREN: "kind" must be one of "bird", "term", got "mammal"',
      '[2] KITE: "obscurity" must be 1, 2 or 3, got 4',
      '[3] RAIL: "obscurity" must be 1, 2 or 3, got "1"',
      '[4] TERN: "obscurity" must be 1, 2 or 3, got 1.5',
    ]);
  });

  it('requires non-empty name, hint, fact and wiki', () => {
    const data = [bird('ROBIN', { name: '', hint: '   ', wiki: '' }), { ...bird('WREN'), fact: 42 }];
    expect(checkBirdData(data).errors).toEqual([
      '[0] ROBIN: "name" must be a non-empty string',
      '[0] ROBIN: "hint" must be a non-empty string',
      '[0] ROBIN: "wiki" must be a non-empty string',
      '[1] WREN: "fact" must be a non-empty string',
    ]);
  });

  it('requires at least one daily-eligible entry', () => {
    const { errors } = checkBirdData([bird('ROBIN', { obscurity: 3 })]);
    expect(errors).toEqual(['no entry has obscurity <= 2, so there would be no daily answers']);
  });

  it('flags long hints and facts as editorial problems (counting characters, not UTF-16 units)', () => {
    const data = [
      bird('ROBIN', { hint: 'h'.repeat(110), fact: 'f'.repeat(220) }),
      bird('WREN', { hint: 'h'.repeat(111), fact: 'f'.repeat(221) }),
      bird('KITE', { hint: '🐦'.repeat(110) }),
    ];
    expect(checkBirdData(data)).toEqual({
      errors: [],
      editorial: ['[1] WREN: hint is 111 characters (max 110)', '[1] WREN: fact is 221 characters (max 220)'],
    });
  });

  it('flags hints that contain the word, ignoring case and diacritics', () => {
    const data = [
      bird('ROBIN', { hint: 'The American robin is a thrush' }),
      bird('KAKAPO', { hint: 'The kākāpō cannot fly' }),
      bird('WREN', { hint: 'Tiny brown songbird with a cocked tail' }),
    ];
    expect(checkBirdData(data).editorial).toEqual(['[0] ROBIN: hint contains the word', '[1] KAKAPO: hint contains the word']);
  });

  it('flags unexpected fields and stray whitespace as editorial problems', () => {
    const data = [{ ...bird('ROBIN'), extra: true }, bird('WREN', { name: ' Wren' })];
    expect(checkBirdData(data).editorial).toEqual([
      '[0] ROBIN: unexpected field "extra"',
      '[1] WREN: "name" has leading or trailing whitespace',
    ]);
  });
});

describe('parseBirdData', () => {
  it('returns clean typed entries (extra fields dropped)', () => {
    const parsed = parseBirdData([{ ...bird('ROBIN'), extra: 1 }]);
    expect(parsed).toEqual([bird('ROBIN')]);
  });

  it('throws a BirdleDataError listing every structural problem', () => {
    const run = () => parseBirdData([bird('ROBIN'), bird('ROBIN'), { ...bird('WREN'), kind: 'x' }], 'fixture.json');
    expect(run).toThrow(BirdleDataError);
    expect(run).toThrow(/^fixture\.json is malformed \(2 problems\):\n {2}- \[1\] ROBIN: duplicate word/);
    try {
      run();
    } catch (error) {
      expect((error as BirdleDataError).problems).toHaveLength(2);
    }
  });

  it('does not fail on editorial problems', () => {
    expect(parseBirdData([bird('ROBIN', { hint: 'robin'.repeat(30) })])).toHaveLength(1);
  });
});

describe('parseDictionary', () => {
  it('reads one lowercase word per line (LF or CRLF), skipping blank lines', () => {
    expect([...parseDictionary('aahed\nrobin\r\nwrens\n\nzyzzyvas\n')]).toEqual(['aahed', 'robin', 'wrens', 'zyzzyvas']);
  });

  it('throws on malformed lines with their line numbers', () => {
    const run = () => parseDictionary('robin\nWREN\nemu\nok-no\n', 'words.txt');
    expect(run).toThrow(BirdleDataError);
    expect(run).toThrow(/words\.txt is malformed \(3 bad lines\)/);
    expect(run).toThrow(/line 2: "WREN"/);
    expect(run).toThrow(/line 3: "emu"/);
  });

  it('throws on an empty dictionary', () => {
    expect(() => parseDictionary('\n\n')).toThrow(/contains no words/);
  });
});

describe('wikiUrl / toBirdReveal', () => {
  it('builds English Wikipedia URLs', () => {
    expect(wikiUrl('Albatross')).toBe('https://en.wikipedia.org/wiki/Albatross');
    expect(wikiUrl('Talon (anatomy)')).toBe('https://en.wikipedia.org/wiki/Talon_(anatomy)');
    expect(wikiUrl('Kākāpō')).toBe('https://en.wikipedia.org/wiki/K%C4%81k%C4%81p%C5%8D');
  });

  it('reveals the card fields only', () => {
    expect(toBirdReveal(bird('KAKAPO', { name: 'Kākāpō', wiki: 'Kākāpō', obscurity: 2 }))).toEqual({
      word: 'KAKAPO',
      name: 'Kākāpō',
      kind: 'bird',
      fact: 'Fixture fact about a 6-letter entry.',
      wikiUrl: 'https://en.wikipedia.org/wiki/K%C4%81k%C4%81p%C5%8D',
    });
  });
});
