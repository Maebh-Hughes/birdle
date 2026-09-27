// The client imports only @birdle/shared (src/index.ts). Walk its static import
// graph and make sure nothing reachable touches node built-ins, packages, the
// data files or the server-only modules.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
/** A sibling TypeScript module in src/, imported without extension. */
const LOCAL_MODULE = /^\.\/[A-Za-z]+$/;

function importGraph(entry: string): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const name = queue.pop()!;
    if (graph.has(name)) continue;
    const source = readFileSync(resolve(SRC, `${name}.ts`), 'utf8');
    const specifiers = [...source.matchAll(IMPORT)].map((m) => (m[1] ?? m[2] ?? m[3])!);
    graph.set(name, specifiers);
    for (const spec of specifiers) if (LOCAL_MODULE.test(spec)) queue.push(spec.slice(2));
  }
  return graph;
}

describe('client-safe entry point (src/index.ts)', () => {
  const graph = importGraph('index');

  it('reaches only pure sibling modules, never the server-only ones', () => {
    const modules = [...graph.keys()];
    expect(modules).toEqual(expect.arrayContaining(['index', 'evaluate', 'share', 'puzzle']));
    expect(modules).not.toContain('server');
    expect(modules).not.toContain('birdData');
  });

  it('imports no node built-ins, packages or data files', () => {
    const outside = [...graph.values()].flat().filter((spec) => !LOCAL_MODULE.test(spec));
    expect(outside).toEqual([]);
  });

  it('uses no Node-only globals', () => {
    for (const name of graph.keys()) {
      const source = readFileSync(resolve(SRC, `${name}.ts`), 'utf8');
      expect(source, name).not.toMatch(/\bimport\.meta\.url\b|\brequire\s*\(|\bprocess\.|\b__dirname\b/);
    }
  });
});
