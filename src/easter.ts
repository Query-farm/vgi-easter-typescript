// Copyright 2026 Query Farm LLC - https://query.farm
// Computus: the date of Western (Gregorian) Easter Sunday.

/** Year/month/day triple (month and day are 1-based). */
export interface EasterDate {
  year: number;
  /** 1-based month (1 = January). */
  month: number;
  /** 1-based day of month. */
  day: number;
}

/**
 * Return the Gregorian date of Easter Sunday for `year`.
 *
 * Uses the Anonymous Gregorian algorithm (Meeus/Jones/Butcher Computus),
 * valid for any year in the Gregorian calendar (1583 onward). This is a
 * faithful port of the Python reference's `_easter_sunday`, reproducing the
 * integer arithmetic exactly (`//` -> Math.floor of a non-negative quotient,
 * `%` -> JS remainder, which matches Python's `%` for non-negative operands).
 */
export function easterSunday(year: number): EasterDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const ell = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * ell) / 451);
  const month = Math.floor((h + ell - 7 * m + 114) / 31);
  const day = ((h + ell - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

/**
 * Number of whole days from the Unix epoch (1970-01-01) to the given
 * Gregorian calendar date, as required for an Arrow `date32` value. Uses
 * `Date.UTC` so the result is independent of the host timezone.
 */
export function daysSinceEpoch(d: EasterDate): number {
  const ms = Date.UTC(d.year, d.month - 1, d.day);
  return Math.round(ms / 86_400_000);
}
