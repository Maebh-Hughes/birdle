import { EPOCH_DATE } from './constants';

// Calendar maths on YYYY-MM-DD strings via integer day numbers (days since
// 1970-01-01), so there are no time-zone or two-digit-year Date quirks.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

// Howard Hinnant's days_from_civil / civil_from_days.
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

function civilFromDays(days: number): string {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  const year = yoe + era * 400 + (month <= 2 ? 1 : 0);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toDayNumber(date: string): number {
  const parts = parseIsoDate(date);
  if (!parts) throw new RangeError(`Invalid date "${date}" (expected a real YYYY-MM-DD date)`);
  return daysFromCivil(parts.year, parts.month, parts.day);
}

const EPOCH_DAY = toDayNumber(EPOCH_DATE);

/** True for a real calendar date written exactly as YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && parseIsoDate(value) !== null;
}

/** Whole days from `from` to `to` (negative when `to` is earlier). Throws on invalid dates. */
export function daysBetween(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** `date` shifted by `days` (may be negative). Throws on an invalid date. */
export function addDays(date: string, days: number): string {
  return civilFromDays(toDayNumber(date) + days);
}

/** Puzzle number for a calendar date: EPOCH_DATE is #1. Can be <= 0 for earlier dates. */
export function puzzleNumberForDate(date: string): number {
  return toDayNumber(date) - EPOCH_DAY + 1;
}

/** Calendar date of a puzzle number (inverse of puzzleNumberForDate). */
export function dateForPuzzleNumber(puzzleNumber: number): string {
  if (!Number.isInteger(puzzleNumber)) throw new RangeError(`Invalid puzzle number ${puzzleNumber}`);
  return civilFromDays(EPOCH_DAY + puzzleNumber - 1);
}

/** The UTC calendar date of an instant, as YYYY-MM-DD. */
export function utcIsoDate(now: Date): string {
  return civilFromDays(Math.floor(now.getTime() / MS_PER_DAY));
}

/** The local calendar date of an instant (the player's "today"), as YYYY-MM-DD. */
export function localIsoDate(now: Date = new Date()): string {
  return civilFromDays(daysFromCivil(now.getFullYear(), now.getMonth() + 1, now.getDate()));
}

/**
 * Whether the server accepts a client-supplied puzzle date: a real calendar date
 * within [UTC today - 1 day, UTC today + 1 day] (covers every time zone) whose
 * puzzle number is at least 1. Accepts any value (e.g. a raw query parameter).
 */
export function isPlayableDate(date: unknown, now: Date): date is string {
  if (!isIsoDate(date)) return false;
  if (puzzleNumberForDate(date) < 1) return false;
  return Math.abs(daysBetween(utcIsoDate(now), date)) <= 1;
}

/** Milliseconds from `now` until the next local midnight (when the next puzzle unlocks). */
export function msUntilNextLocalMidnight(now: Date = new Date()): number {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return midnight.getTime() - now.getTime();
}

/** Formats a duration as HH:MM:SS, rounding partial seconds up; negative -> 00:00:00. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours, minutes, seconds].map((n) => String(n).padStart(2, '0')).join(':');
}
