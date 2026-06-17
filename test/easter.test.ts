// Copyright 2026 Query Farm LLC - https://query.farm
// Unit tests for the Easter date worker. Mirrors the Python tests/test_easter.py.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { DateUnit, Type as ArrowType } from "@query-farm/apache-arrow";
import { easterSunday, easterDateUtc, type EasterDate } from "../src/easter.js";
import {
  computeEasterDates,
  easterDateFunction,
  implementationVersion,
} from "../src/worker.js";

// Known Western (Gregorian) Easter Sunday dates.
const KNOWN_EASTERS: Array<[number, EasterDate]> = [
  [2020, { year: 2020, month: 4, day: 12 }],
  [2021, { year: 2021, month: 4, day: 4 }],
  [2022, { year: 2022, month: 4, day: 17 }],
  [2023, { year: 2023, month: 4, day: 9 }],
  [2024, { year: 2024, month: 3, day: 31 }],
  [2025, { year: 2025, month: 4, day: 20 }],
  [2026, { year: 2026, month: 4, day: 5 }],
  [2027, { year: 2027, month: 3, day: 28 }],
  [2030, { year: 2030, month: 4, day: 21 }],
  [1818, { year: 1818, month: 3, day: 22 }], // earliest possible Easter (March 22)
  [1943, { year: 1943, month: 4, day: 25 }], // latest possible Easter (April 25)
];

/** Decompose a UTC `Date` to {year, month (1-based), day}. */
function dateToParts(d: Date): EasterDate {
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

describe("easterSunday: known dates", () => {
  for (const [year, expected] of KNOWN_EASTERS) {
    test(`Easter ${year}`, () => {
      expect(easterSunday(year)).toEqual(expected);
    });
  }
});

describe("easterDateUtc", () => {
  test("builds a UTC-midnight Date for 2025-04-20", () => {
    const d = easterDateUtc({ year: 2025, month: 4, day: 20 });
    expect(d.getTime()).toBe(Date.UTC(2025, 3, 20));
    expect(dateToParts(d)).toEqual({ year: 2025, month: 4, day: 20 });
  });
});

describe("easter_date scalar function", () => {
  test("declares a date32 (Date/DAY) output type", () => {
    const outType = easterDateFunction.defaultOutputSchema!.fields[0].type as any;
    // dateDay() builds an arrow-js Date_ with DateUnit.DAY (i.e. date32).
    expect(outType.typeId).toBe(ArrowType.Date);
    expect(outType.unit).toBe(DateUnit.DAY);
  });

  // The rich contract: compute returns one `Date | null` per row. Known dates
  // must come back as UTC-midnight Dates equal to the expected calendar date.
  test("compute returns the correct Date per row (rich contract)", () => {
    const dates = computeEasterDates([2024, 2025, 2026]);
    expect(dates.map((d) => dateToParts(d!))).toEqual([
      { year: 2024, month: 3, day: 31 },
      { year: 2025, month: 4, day: 20 },
      { year: 2026, month: 4, day: 5 },
    ]);
  });

  test("2025 maps to a Date equal to 2025-04-20 UTC", () => {
    const dates = computeEasterDates([2025]);
    expect(dates).toHaveLength(1);
    expect(dates[0]).toBeInstanceOf(Date);
    expect(dates[0]!.getTime()).toBe(Date.UTC(2025, 3, 20));
  });

  test("all known dates round-trip through compute", () => {
    for (const [year, expected] of KNOWN_EASTERS) {
      const [d] = computeEasterDates([year]);
      expect(dateToParts(d!)).toEqual(expected);
    }
  });

  test("null propagation (null year -> null Date)", () => {
    const dates = computeEasterDates([2025, null, 2026]);
    expect(dates[1]).toBeNull();
    expect(dateToParts(dates[0]!)).toEqual({ year: 2025, month: 4, day: 20 });
    expect(dateToParts(dates[2]!)).toEqual({ year: 2026, month: 4, day: 5 });
  });

  test("accepts bigint years (int64 wire form)", () => {
    const dates = computeEasterDates([2025n]);
    expect(dateToParts(dates[0]!)).toEqual({ year: 2025, month: 4, day: 20 });
  });
});

describe("implementation version", () => {
  const ORIG = process.env.VGI_EASTER_GIT_COMMIT;
  beforeEach(() => {
    delete process.env.VGI_EASTER_GIT_COMMIT;
  });
  afterEach(() => {
    if (ORIG === undefined) delete process.env.VGI_EASTER_GIT_COMMIT;
    else process.env.VGI_EASTER_GIT_COMMIT = ORIG;
  });

  test("prefers VGI_EASTER_GIT_COMMIT", () => {
    process.env.VGI_EASTER_GIT_COMMIT = "deadbeef";
    expect(implementationVersion()).toBe("deadbeef");
  });

  test("falls back to package version", () => {
    delete process.env.VGI_EASTER_GIT_COMMIT;
    const pkg = require("../package.json") as { version: string };
    expect(implementationVersion()).toBe(pkg.version);
  });
});
