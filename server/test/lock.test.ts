import { describe, expect, it } from 'vitest';
import { KeyedMutex } from '../src/lock';

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('KeyedMutex', () => {
  it('runs tasks for the same key one at a time, in order', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const task = (name: string, ms: number) => async () => {
      log.push(`${name}:start`);
      await tick(ms);
      log.push(`${name}:end`);
      return name;
    };
    const results = await Promise.all([mutex.run('u', task('a', 10)), mutex.run('u', task('b', 1))]);
    expect(results).toEqual(['a', 'b']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('lets different keys run concurrently and survives failures', async () => {
    const mutex = new KeyedMutex();
    const log: string[] = [];
    const slow = mutex.run('a', async () => {
      await tick(10);
      log.push('a');
    });
    const fast = mutex.run('b', async () => {
      log.push('b');
    });
    await Promise.all([slow, fast]);
    expect(log).toEqual(['b', 'a']);

    await expect(mutex.run('a', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(mutex.run('a', async () => 'next')).resolves.toBe('next');
    await tick(0);
    expect(mutex.activeKeys).toBe(0);
  });
});
