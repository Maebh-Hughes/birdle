import type { Request } from 'express';
import {
  DEFAULT_PRACTICE_CATEGORY,
  PRACTICE_CATEGORIES,
  isPlayableDate,
  isPracticeCategory,
  type PracticeCategory,
} from '@birdle/shared';
import { ApiError } from './errors';

/** Longest string accepted for a guess field (anything longer is not a word). */
const MAX_GUESS_INPUT_LENGTH = 64;
/** Discord instance ids look like "i-1234567890-gc-123-456"; the mock uses digits only. */
const INSTANCE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** The JSON body as an object; a missing body counts as `{}`. */
export function bodyObject(req: Request): Record<string, unknown> {
  const body: unknown = req.body;
  if (body === undefined) return {};
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError('BAD_REQUEST', 'Expected a JSON object body');
  }
  return body as Record<string, unknown>;
}

/** A playable puzzle date (UTC today ± 1 day, puzzle #1 or later), else 400 BAD_DATE. */
export function requirePlayableDate(value: unknown, now: Date): string {
  if (!isPlayableDate(value, now)) {
    throw new ApiError('BAD_DATE', value === undefined ? 'Missing puzzle date' : "That puzzle isn't available");
  }
  return value;
}

/** The `guess` field: must be a string (its letters and length are checked by the game). */
export function requireGuess(body: Record<string, unknown>): string {
  const guess = body.guess;
  if (typeof guess !== 'string') throw new ApiError('BAD_REQUEST', 'guess must be a string');
  if (guess.length > MAX_GUESS_INPUT_LENGTH) throw new ApiError('INVALID_GUESS', 'Too many letters');
  return guess;
}

/** The `hardMode` field: optional boolean, default false. */
export function optionalHardMode(body: Record<string, unknown>): boolean {
  const hardMode = body.hardMode;
  if (hardMode === undefined) return false;
  if (typeof hardMode !== 'boolean') throw new ApiError('BAD_REQUEST', 'hardMode must be a boolean');
  return hardMode;
}

/** The `category` field of POST /api/practice/new: optional, default 'all'. */
export function optionalCategory(body: Record<string, unknown>): PracticeCategory {
  const category = body.category;
  if (category === undefined) return DEFAULT_PRACTICE_CATEGORY;
  if (!isPracticeCategory(category)) {
    throw new ApiError('BAD_REQUEST', `category must be one of ${PRACTICE_CATEGORIES.join(', ')}`);
  }
  return category;
}

export function requireInstanceId(value: unknown): string {
  if (typeof value !== 'string' || !INSTANCE_ID_PATTERN.test(value)) {
    throw new ApiError('BAD_REQUEST', 'Invalid activity instance id');
  }
  return value;
}
