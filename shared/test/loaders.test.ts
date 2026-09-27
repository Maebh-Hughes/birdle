import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BirdleDataError, loadBirds, loadDictionary } from '../src/server';
import { bird } from './helpers';

const dir = mkdtempSync(join(tmpdir(), 'birdle-data-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content, 'utf8');
  return path;
}

describe('loadBirds', () => {
  it('loads a valid file (tolerating a UTF-8 byte order mark)', () => {
    const path = file('ok.json', String.fromCharCode(0xfeff) + JSON.stringify([bird('ROBIN'), bird('WREN')]));
    expect(loadBirds(path).map((b) => b.word)).toEqual(['ROBIN', 'WREN']);
  });

  it('throws a clear error for a missing file', () => {
    expect(() => loadBirds(join(dir, 'missing.json'))).toThrow(BirdleDataError);
    expect(() => loadBirds(join(dir, 'missing.json'))).toThrow(/^Cannot read .*missing\.json/);
  });

  it('throws a clear error for invalid JSON', () => {
    const path = file('broken.json', '[{"word": "ROBIN",]');
    expect(() => loadBirds(path)).toThrow(/broken\.json is not valid JSON/);
  });

  it('throws a clear error listing structural problems', () => {
    const path = file('bad.json', JSON.stringify([bird('ROBIN'), { ...bird('WREN'), obscurity: 9 }]));
    expect(() => loadBirds(path)).toThrow(/bad\.json is malformed \(1 problem\):\n {2}- \[1\] WREN: "obscurity" must be 1, 2 or 3/);
  });
});

describe('loadDictionary', () => {
  it('loads a valid file', () => {
    expect([...loadDictionary(file('ok.txt', 'crane\r\nroost\r\n'))]).toEqual(['crane', 'roost']);
  });

  it('throws a clear error for malformed lines or a missing file', () => {
    expect(() => loadDictionary(file('bad.txt', 'crane\nRoost\n'))).toThrow(/bad\.txt is malformed \(1 bad line\):\n {2}- line 2: "Roost"/);
    expect(() => loadDictionary(join(dir, 'missing.txt'))).toThrow(/^Cannot read /);
  });
});
