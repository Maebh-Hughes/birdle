// Client-safe entry point (@birdle/shared): rules, types and pure helpers only.
// No fs, no word data. Answers, hints, facts and the dictionary live behind
// @birdle/shared/server, which client code must never import.

export * from './constants';
export * from './types';
export * from './kinds';
export * from './words';
export * from './evaluate';
export * from './hardMode';
export * from './dates';
export * from './keyboard';
export * from './share';
export * from './messages';
export * from './puzzle';
export * from './stats';
