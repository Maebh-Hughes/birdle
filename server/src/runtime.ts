// Small injectable runtime dependencies, so tests can control time and silence logs.

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export type Logger = Pick<Console, 'info' | 'warn' | 'error'>;

export const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
