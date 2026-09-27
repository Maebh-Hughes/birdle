import { describe, expect, it } from 'vitest';
import {
  BirdleDataError,
  checkBirdData,
  infoSiteFor,
  minimalBirdReveal,
  parseBirdData,
  parseDictionary,
  toBirdReveal,
  wikiUrl,
} from '../src/birdData';
import { bird, character } from './helpers';

/** An entry without the given fields. */
function without(entry: object, ...fields: string[]): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...entry };
  for (const field of fields) delete copy[field];
  return copy;
}

const valid = [
  bird('ROBIN'),
  bird('WREN', { obscurity: 2 }),
  bird('TALON', { kind: 'term', obscurity: 3 }),
  character('FARFETCHD', 'pokemon', { name: "Farfetch'd", source: 'Pokémon Red & Blue' }),
  character('KAEPORA', 'game', { name: 'Kaepora Gaebora', source: 'The Legend of Zelda', obscurity: 2 }),
  { ...without(character('HEDWIG', 'literature', { source: 'Harry Potter', obscurity: 3 }), 'link'), wiki: 'Hedwig (Harry Potter)' },
];

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
      '[1] WREN: "kind" must be one of "bird", "term", "pokemon", "game", "literature", got "mammal"',
      '[2] KITE: "obscurity" must be 1, 2 or 3, got 4',
      '[3] RAIL: "obscurity" must be 1, 2 or 3, got "1"',
      '[4] TERN: "obscurity" must be 1, 2 or 3, got 1.5',
    ]);
  });

  it('requires non-empty name, hint, fact and wiki', () => {
    const data = [bird('ROBIN', { name: '', hint: '   ', wiki: '' }), { ...bird('WREN'), fact: 42 }, bird('KITE', { wiki: '#Section' })];
    expect(checkBirdData(data).errors).toEqual([
      '[0] ROBIN: "name" must be a non-empty string',
      '[0] ROBIN: "hint" must be a non-empty string',
      '[0] ROBIN: "wiki" must be a non-empty Wikipedia article title',
      '[1] WREN: "fact" must be a non-empty string',
      '[2] KITE: "wiki" must be a non-empty Wikipedia article title',
    ]);
  });

  it('requires at least one daily-eligible entry', () => {
    const { errors } = checkBirdData([bird('ROBIN', { obscurity: 3 }), character('HOOH', 'pokemon', { obscurity: 2 })]);
    expect(errors).toEqual([
      'no entry is daily-eligible (bird/term with obscurity <= 2, or pokemon/game/literature with obscurity 1), so there would be no daily answers',
    ]);
    expect(checkBirdData([bird('ROBIN', { obscurity: 3 }), character('HOOH', 'pokemon')]).errors).toEqual([]);
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

  it('flags hints that give the answer away through punctuation or the display name', () => {
    const data = [
      character('FARFETCHD', 'pokemon', { name: "Farfetch'd", hint: "Farfetch'd carries a leek" }),
      character('HOOH', 'pokemon', { name: 'Ho-Oh', hint: "Ho-Oh's rainbow wings" }),
      character('KAEPORA', 'game', { name: 'Kaepora Gaebora', hint: 'The owl Kaepora-Gaebora never stops talking' }),
      character('HEDWIG', 'literature', { name: 'Hedwig', hint: 'Snowy owl who delivers letters at a school of magic' }),
      character('SCUTTLE', 'literature', { name: 'Old Blue Scuttle', hint: 'Everyone calls him old blue, a gull who misnames things' }),
      character('ZAZU', 'literature', { name: 'Major-domo Zazu', hint: 'Hornbill who is the major domo of the Pride Lands' }),
      character('LAGO', 'literature', { name: 'Lago the parrot', hint: 'Sly parrot of the sultan; think "Lago, the parrot!"' }),
    ];
    expect(checkBirdData(data).editorial).toEqual([
      '[0] FARFETCHD: hint contains the word',
      '[1] HOOH: hint contains the word',
      '[2] KAEPORA: hint contains the word',
      '[6] LAGO: hint contains the word',
    ]);
    const nameOnly = [character('AMAURI', 'literature', { name: 'Old Amauri', hint: 'Tell tales of old; amaur is not it' })];
    expect(checkBirdData(nameOnly).editorial).toEqual([]);
    const fullName = [character('CROAKY', 'game', { name: 'Sir Hootington', hint: 'Knighted owl: Sir-Hootington of the castle' })];
    expect(checkBirdData(fullName).editorial).toEqual(['[0] CROAKY: hint contains the name']);
  });

  it('flags unexpected fields and stray whitespace as editorial problems', () => {
    const data = [{ ...bird('ROBIN'), extra: true }, bird('WREN', { name: ' Wren' })];
    expect(checkBirdData(data).editorial).toEqual([
      '[0] ROBIN: unexpected field "extra"',
      '[1] WREN: "name" has leading or trailing whitespace',
    ]);
  });
});

describe('checkBirdData: fictional birds (source, wiki / link)', () => {
  it('accepts every kind with its fields', () => {
    expect(checkBirdData(valid)).toEqual({ errors: [], editorial: [] });
  });

  it.each(['pokemon', 'game', 'literature'] as const)('requires a non-empty source for kind "%s"', (kind) => {
    const data = [bird('ROBIN'), without(character('HOOH', kind), 'source'), character('LUGIA', kind, { source: '  ' })];
    expect(checkBirdData(data).errors).toEqual([
      `[1] HOOH: "source" must be a non-empty string for kind "${kind}" (e.g. the game or book)`,
      `[2] LUGIA: "source" must be a non-empty string for kind "${kind}" (e.g. the game or book)`,
    ]);
  });

  it.each(['bird', 'term'] as const)('rejects a source on kind "%s"', (kind) => {
    const data = [bird('ROBIN'), bird('WREN', { kind, source: 'Nature' })];
    expect(checkBirdData(data).errors).toEqual([
      `[1] WREN: "source" is only for kinds "pokemon", "game", "literature"; remove it from a "${kind}" entry`,
    ]);
  });

  it('flags a source longer than 60 characters as editorial', () => {
    const data = [bird('ROBIN'), character('HOOH', 'pokemon', { source: 's'.repeat(60) }), character('LUGIA', 'pokemon', { source: 's'.repeat(61) })];
    expect(checkBirdData(data)).toEqual({ errors: [], editorial: ['[2] LUGIA: source is 61 characters (max 60)'] });
  });

  it('needs exactly one of wiki or link, for every kind', () => {
    const data = [
      bird('ROBIN'),
      without(bird('WREN'), 'wiki'),
      bird('KITE', { link: 'https://example.org/kite' }),
      without(character('HOOH', 'pokemon'), 'link'),
      character('LUGIA', 'pokemon', { wiki: 'Lugia' }),
    ];
    expect(checkBirdData(data).errors).toEqual([
      '[1] WREN: needs exactly one of "wiki" (a Wikipedia title) or "link" (a full https URL)',
      '[2] KITE: has both "wiki" and "link"; use exactly one',
      '[3] HOOH: needs exactly one of "wiki" (a Wikipedia title) or "link" (a full https URL)',
      '[4] LUGIA: has both "wiki" and "link"; use exactly one',
    ]);
  });

  it('counts a present but null wiki or link as present', () => {
    const data = [bird('ROBIN'), { ...bird('WREN'), link: null }, { ...without(bird('KITE'), 'wiki'), wiki: null }];
    expect(checkBirdData(data).errors).toEqual([
      '[1] WREN: has both "wiki" and "link"; use exactly one',
      '[2] KITE: "wiki" must be a non-empty Wikipedia article title',
    ]);
  });

  it('lets any kind use either wiki or link', () => {
    const data = [
      { ...without(bird('ROBIN'), 'wiki'), link: 'https://www.audubon.org/field-guide/bird/american-robin' },
      { ...without(character('HEDWIG', 'literature'), 'link'), wiki: 'Hedwig' },
    ];
    expect(checkBirdData(data)).toEqual({ errors: [], editorial: [] });
  });

  it.each([
    ['http', 'http://bulbapedia.bulbagarden.net/wiki/Lugia'],
    ['relative', '/wiki/Lugia'],
    ['bare host', 'bulbapedia.bulbagarden.net/wiki/Lugia'],
    ['javascript', 'javascript:alert(1)'],
    ['credentials', 'https://user:pass@example.org/'],
    ['whitespace', ' https://example.org/lugia'],
    ['empty', ''],
    ['non-string', 42],
  ])('rejects a %s link', (_label, link) => {
    const data = [bird('ROBIN'), { ...character('LUGIA', 'pokemon'), link }];
    expect(checkBirdData(data).errors).toEqual([`[1] LUGIA: "link" must be a full https:// URL, got ${JSON.stringify(link)}`]);
  });

  it('suggests wiki for a link to Wikipedia', () => {
    const data = [bird('ROBIN'), character('LUGIA', 'pokemon', { link: 'https://en.wikipedia.org/wiki/Lugia' })];
    expect(checkBirdData(data)).toEqual({
      errors: [],
      editorial: ['[1] LUGIA: "link" points to Wikipedia; use "wiki" with the article title instead'],
    });
  });

  it('flags stray whitespace in source and wiki fields', () => {
    const data = [bird('ROBIN', { wiki: 'Robin ' }), character('LUGIA', 'pokemon', { source: ' Pokémon Gold' })];
    expect(checkBirdData(data).editorial).toEqual([
      '[0] ROBIN: "wiki" has leading or trailing whitespace',
      '[1] LUGIA: "source" has leading or trailing whitespace',
    ]);
  });

  it('counts fictional birds as daily-eligible only at obscurity 1', () => {
    for (const kind of ['pokemon', 'game', 'literature'] as const) {
      expect(checkBirdData([character('LUGIA', kind, { obscurity: 1 })]).errors).toEqual([]);
      expect(checkBirdData([character('LUGIA', kind, { obscurity: 2 })]).errors).toHaveLength(1);
    }
    expect(checkBirdData([bird('ROBIN', { kind: 'term', obscurity: 2 })]).errors).toEqual([]);
  });
});

describe('parseBirdData', () => {
  it('returns clean typed entries (extra fields dropped)', () => {
    const parsed = parseBirdData([{ ...bird('ROBIN'), extra: 1 }]);
    expect(parsed).toEqual([bird('ROBIN')]);
  });

  it('keeps source and link, and never adds fields an entry does not have', () => {
    const hooh = character('HOOH', 'pokemon', { name: 'Ho-Oh', source: 'Pokémon Gold & Silver' });
    const [robin, parsed] = parseBirdData([bird('ROBIN'), hooh]);
    expect(parsed).toEqual(hooh);
    expect(Object.keys(parsed!).sort()).toEqual(['fact', 'hint', 'kind', 'link', 'name', 'obscurity', 'source', 'word']);
    expect(Object.keys(robin!).sort()).toEqual(['fact', 'hint', 'kind', 'name', 'obscurity', 'wiki', 'word']);
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

describe('wikiUrl / infoSiteFor / toBirdReveal', () => {
  it('builds English Wikipedia URLs', () => {
    expect(wikiUrl('Albatross')).toBe('https://en.wikipedia.org/wiki/Albatross');
    expect(wikiUrl('Talon (anatomy)')).toBe('https://en.wikipedia.org/wiki/Talon_(anatomy)');
    expect(wikiUrl('Kākāpō')).toBe('https://en.wikipedia.org/wiki/K%C4%81k%C4%81p%C5%8D');
  });

  it('keeps a #Section fragment as a fragment', () => {
    expect(wikiUrl('Owl#In culture')).toBe('https://en.wikipedia.org/wiki/Owl#In_culture');
    expect(wikiUrl('List of Pokémon#Generation I')).toBe('https://en.wikipedia.org/wiki/List_of_Pok%C3%A9mon#Generation_I');
    expect(wikiUrl('Owl#')).toBe('https://en.wikipedia.org/wiki/Owl');
  });

  it.each([
    ['https://bulbapedia.bulbagarden.net/wiki/Ho-Oh_(Pok%C3%A9mon)', 'Bulbapedia'],
    ['https://zelda.fandom.com/wiki/Kaepora_Gaebora', 'Fandom'],
    ['https://harrypotter.fandom.com/wiki/Hedwig', 'Fandom'],
    ['https://zeldawiki.wiki/wiki/Kaepora_Gaebora', 'Zelda Wiki'],
    ['https://www.zeldawiki.wiki/wiki/Kaepora_Gaebora', 'Zelda Wiki'],
    ['https://en.wikipedia.org/wiki/Lugia', 'Wikipedia'],
    ['https://www.serebii.net/pokedex/250.shtml', 'serebii.net'],
    ['https://Example.ORG/page', 'example.org'],
    ['not a url', 'the web'],
  ])('names the site of %s', (url, site) => {
    expect(infoSiteFor(url)).toBe(site);
  });

  it('reveals the card fields only, linking Wikipedia for wiki entries', () => {
    expect(toBirdReveal(bird('KAKAPO', { name: 'Kākāpō', wiki: 'Kākāpō', obscurity: 2 }))).toEqual({
      word: 'KAKAPO',
      name: 'Kākāpō',
      kind: 'bird',
      source: null,
      fact: 'Fixture fact about a 6-letter entry.',
      infoUrl: 'https://en.wikipedia.org/wiki/K%C4%81k%C4%81p%C5%8D',
      infoSite: 'Wikipedia',
    });
  });

  it('reveals the source and the linked site for fictional birds', () => {
    const link = 'https://bulbapedia.bulbagarden.net/wiki/Farfetch%27d_(Pok%C3%A9mon)';
    expect(toBirdReveal(character('FARFETCHD', 'pokemon', { name: "Farfetch'd", source: 'Pokémon Red & Blue', link }))).toEqual({
      word: 'FARFETCHD',
      name: "Farfetch'd",
      kind: 'pokemon',
      source: 'Pokémon Red & Blue',
      fact: 'Fixture fact about a 9-letter entry.',
      infoUrl: link,
      infoSite: 'Bulbapedia',
    });
    const [hedwig] = parseBirdData([{ ...without(character('HEDWIG', 'literature'), 'link'), wiki: 'Hedwig (Harry Potter)' }]);
    expect(toBirdReveal(hedwig!)).toMatchObject({
      kind: 'literature',
      source: 'Fixture Adventures',
      infoUrl: 'https://en.wikipedia.org/wiki/Hedwig_(Harry_Potter)',
      infoSite: 'Wikipedia',
    });
  });

  it('builds a minimal card for an answer that left the list', () => {
    expect(minimalBirdReveal('FARFETCHD')).toEqual({
      word: 'FARFETCHD',
      name: 'Farfetchd',
      kind: 'bird',
      source: null,
      fact: '',
      infoUrl: 'https://en.wikipedia.org/wiki/Special:Search?search=Farfetchd',
      infoSite: 'Wikipedia',
    });
  });
});
