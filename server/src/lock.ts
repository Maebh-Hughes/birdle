/**
 * Runs async tasks one at a time per key (in call order), e.g. so two
 * simultaneous guesses from the same user can't both read the same game state.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }

  /** Number of keys with queued or running tasks. */
  get activeKeys(): number {
    return this.tails.size;
  }
}
