// Copyright 2026 Query Farm LLC - https://query.farm
// Unit tests for the Easter date worker. Mirrors the Python tests/test_easter.py.

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Schema, Field, DateDay, makeData, Struct, RecordBatch } from "@query-farm/apache-arrow";
import { easterSunday, daysSinceEpoch, type EasterDate } from "../src/easter.js";
import {
  buildDate32Batch,
  computeEasterDays,
  easterDateFunction,
  implementationVersion,
} from "../src/worker.js";

/** Decode a date32 cell (arrow-js returns ms-since-epoch) to {year,month,day}. */
function date32CellToDate(ms: number): EasterDate {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

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

/** day-number (days since epoch) -> {year, month, day} via UTC. */
function dayNumberToDate(days: number): EasterDate {
  const d = new Date(days * 86_400_000);
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

describe("easter_date scalar function", () => {
  test("declares a date32 output type", () => {
    const outType = easterDateFunction.defaultOutputSchema!.fields[0].type as any;
    expect(outType.constructor.name).toBe("DateDay");
  });

  test("compute returns date32 day-numbers for a batch", () => {
    const computed = computeEasterDays([2024, 2025, 2026]);
    expect(computed.map((d) => dayNumberToDate(d!))).toEqual([
      { year: 2024, month: 3, day: 31 },
      { year: 2025, month: 4, day: 20 },
      { year: 2026, month: 4, day: 5 },
    ]);
  });

  test("compute output builds a valid date32 column DuckDB renders as DATE", () => {
    const days = computeEasterDays([2025]);
    const field = new Field("result", new DateDay(), true);
    const data = new Int32Array([days[0]!]);
    const nullBitmap = new Uint8Array([0b1]);
    const child = makeData({
      type: new DateDay(),
      length: 1,
      data,
      nullBitmap,
      nullCount: 0,
    } as any);
    const struct = makeData({
      type: new Struct([field]),
      length: 1,
      children: [child],
      nullCount: 0,
    });
    const batch = new RecordBatch(new Schema([field]), struct);
    // arrow-js decodes a Date32 cell to milliseconds-since-epoch (UTC midnight).
    const ms = batch.getChildAt(0)!.get(0) as number;
    const v = new Date(ms);
    expect([v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate()]).toEqual([2025, 4, 20]);
  });

  test("null propagation", () => {
    const computed = computeEasterDays([2025, null, 2026]);
    expect(computed[1]).toBeNull();
    expect(dayNumberToDate(computed[0]!)).toEqual({ year: 2025, month: 4, day: 20 });
    expect(dayNumberToDate(computed[2]!)).toEqual({ year: 2026, month: 4, day: 5 });
  });

  test("accepts bigint years (int64 wire form)", () => {
    const computed = computeEasterDays([2025n]);
    expect(dayNumberToDate(computed[0]!)).toEqual({ year: 2025, month: 4, day: 20 });
  });
});

// Regression: the SDK's array→column path builds a non-null date32 column via
// arrow-js vectorFromArray(numbers, DateDay), which writes all zeros on this
// apache-arrow fork — so a *constant* call like `easter_date(2025)` came back as
// 1970-01-01. compute now returns a hand-built date32 batch (buildDate32Batch);
// these tests exercise that output path so the cells decode to real dates.
describe("buildDate32Batch (date32 output path)", () => {
  function decodeBatch(batch: ReturnType<typeof buildDate32Batch>) {
    const col = batch.getChildAt(0)!;
    const out: Array<EasterDate | null> = [];
    for (let i = 0; i < col.length; i++) {
      out.push(col.isValid(i) ? date32CellToDate(col.get(i) as number) : null);
    }
    return out;
  }

  test("single constant row decodes to the right date (not 1970-01-01)", () => {
    const batch = buildDate32Batch(computeEasterDays([2025]));
    expect(batch.numRows).toBe(1);
    expect(decodeBatch(batch)).toEqual([{ year: 2025, month: 4, day: 20 }]);
  });

  test("multi-row column decodes to the right dates", () => {
    const batch = buildDate32Batch(computeEasterDays([2023, 2024, 2025, 2026]));
    expect(decodeBatch(batch)).toEqual([
      { year: 2023, month: 4, day: 9 },
      { year: 2024, month: 3, day: 31 },
      { year: 2025, month: 4, day: 20 },
      { year: 2026, month: 4, day: 5 },
    ]);
  });

  test("propagates nulls through the validity bitmap", () => {
    const batch = buildDate32Batch(computeEasterDays([2025, null, 2026]));
    const col = batch.getChildAt(0)!;
    expect(col.isValid(0)).toBe(true);
    expect(col.isValid(1)).toBe(false);
    expect(col.isValid(2)).toBe(true);
    expect(decodeBatch(batch)).toEqual([
      { year: 2025, month: 4, day: 20 },
      null,
      { year: 2026, month: 4, day: 5 },
    ]);
  });

  test("day 0 (1970-01-01) round-trips so the constant bug can't masquerade as it", () => {
    const batch = buildDate32Batch([0]);
    expect(decodeBatch(batch)).toEqual([{ year: 1970, month: 1, day: 1 }]);
  });
});

describe("daysSinceEpoch", () => {
  test("1970-01-01 is day 0", () => {
    expect(daysSinceEpoch({ year: 1970, month: 1, day: 1 })).toBe(0);
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
