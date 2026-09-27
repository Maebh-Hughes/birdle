import { describe, expect, it } from 'vitest';
import { EPOCH_DATE } from '../src/constants';
import {
  addDays,
  dateForPuzzleNumber,
  daysBetween,
  formatCountdown,
  isIsoDate,
  isPlayableDate,
  localIsoDate,
  msUntilNextLocalMidnight,
  puzzleNumberForDate,
  utcIsoDate,
} from '../src/dates';

describe('isIsoDate', () => {
  it.each(['2026-09-26', '2026-12-31', '2028-02-29', '2000-02-29', '1999-01-01'])('accepts %s', (value) => {
    expect(isIsoDate(value)).toBe(true);
  });

  it.each([
    '2026-02-29', // 2026 is not a leap year
    '1900-02-29', // century rule
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-01-00',
    '2026-9-26',
    '26-09-26',
    '2026/09/26',
    '2026-09-26T00:00:00Z',
    ' 2026-09-26',
    '',
  ])('rejects %j', (value) => {
    expect(isIsoDate(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isIsoDate(20260926)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
    expect(isIsoDate(new Date())).toBe(false);
  });
});

describe('puzzle numbers', () => {
  it('numbers puzzles from EPOCH_DATE = #1', () => {
    expect(EPOCH_DATE).toBe('2026-09-26');
    expect(puzzleNumberForDate('2026-09-26')).toBe(1);
    expect(puzzleNumberForDate('2026-09-27')).toBe(2);
    expect(puzzleNumberForDate('2026-10-26')).toBe(31);
    expect(puzzleNumberForDate('2027-09-26')).toBe(366);
    expect(puzzleNumberForDate('2028-09-26')).toBe(732); // across 2028-02-29
    expect(puzzleNumberForDate('2026-09-25')).toBe(0);
    expect(puzzleNumberForDate('2026-09-01')).toBe(-24);
  });

  it('maps puzzle numbers back to dates', () => {
    expect(dateForPuzzleNumber(1)).toBe('2026-09-26');
    expect(dateForPuzzleNumber(7)).toBe('2026-10-02');
    expect(dateForPuzzleNumber(366)).toBe('2027-09-26');
    expect(dateForPuzzleNumber(0)).toBe('2026-09-25');
  });

  it('round-trips over several years', () => {
    for (let n = -400; n <= 4000; n += 7) {
      const date = dateForPuzzleNumber(n);
      expect(isIsoDate(date)).toBe(true);
      expect(puzzleNumberForDate(date)).toBe(n);
    }
  });

  it('throws on invalid input', () => {
    expect(() => puzzleNumberForDate('2026-02-30')).toThrow(RangeError);
    expect(() => dateForPuzzleNumber(1.5)).toThrow(RangeError);
  });
});

describe('daysBetween / addDays', () => {
  it('counts calendar days across month, year and leap-day boundaries', () => {
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-10-05', '2026-10-01')).toBe(-4);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('utcIsoDate / localIsoDate', () => {
  it('uses the UTC calendar date', () => {
    expect(utcIsoDate(new Date('2026-10-05T23:59:59.999Z'))).toBe('2026-10-05');
    expect(utcIsoDate(new Date('2026-10-06T00:00:00.000Z'))).toBe('2026-10-06');
  });

  it('uses the local calendar date', () => {
    expect(localIsoDate(new Date(2026, 9, 5, 0, 0, 1))).toBe('2026-10-05');
    expect(localIsoDate(new Date(2026, 9, 5, 23, 59, 59))).toBe('2026-10-05');
  });
});

describe('isPlayableDate', () => {
  const now = new Date('2026-10-05T12:00:00Z');

  it('accepts UTC yesterday, today and tomorrow (every time zone)', () => {
    expect(isPlayableDate('2026-10-04', now)).toBe(true);
    expect(isPlayableDate('2026-10-05', now)).toBe(true);
    expect(isPlayableDate('2026-10-06', now)).toBe(true);
  });

  it('rejects dates outside the window', () => {
    expect(isPlayableDate('2026-10-03', now)).toBe(false);
    expect(isPlayableDate('2026-10-07', now)).toBe(false);
    expect(isPlayableDate('2025-10-05', now)).toBe(false);
  });

  it('rejects malformed or impossible dates', () => {
    expect(isPlayableDate('2026-10-5', now)).toBe(false);
    expect(isPlayableDate('2026-10-32', now)).toBe(false);
    expect(isPlayableDate('yesterday', now)).toBe(false);
    expect(isPlayableDate(undefined, now)).toBe(false);
    expect(isPlayableDate(['2026-10-05'], now)).toBe(false);
  });

  it('rejects dates before puzzle #1 even inside the window', () => {
    const launchMorning = new Date('2026-09-26T05:00:00Z');
    expect(isPlayableDate('2026-09-25', launchMorning)).toBe(false);
    expect(isPlayableDate('2026-09-26', launchMorning)).toBe(true);
    expect(isPlayableDate('2026-09-27', launchMorning)).toBe(true);
  });

  it('follows the UTC day boundary of `now`', () => {
    const lateUtc = new Date('2026-10-05T23:30:00Z');
    expect(isPlayableDate('2026-10-04', lateUtc)).toBe(true);
    const earlyUtc = new Date('2026-10-06T00:30:00Z');
    expect(isPlayableDate('2026-10-04', earlyUtc)).toBe(false);
    expect(isPlayableDate('2026-10-07', earlyUtc)).toBe(true);
  });
});

describe('countdown helpers', () => {
  it('measures the time to the next local midnight', () => {
    expect(msUntilNextLocalMidnight(new Date(2026, 5, 15, 23, 59, 30))).toBe(30_000);
    expect(msUntilNextLocalMidnight(new Date(2026, 5, 15, 12, 0, 0))).toBe(12 * 3_600_000);
  });

  it('formats HH:MM:SS, rounding partial seconds up', () => {
    expect(formatCountdown(3_723_000)).toBe('01:02:03');
    expect(formatCountdown(86_400_000)).toBe('24:00:00');
    expect(formatCountdown(999)).toBe('00:00:01');
    expect(formatCountdown(0)).toBe('00:00:00');
    expect(formatCountdown(-5_000)).toBe('00:00:00');
  });
});
