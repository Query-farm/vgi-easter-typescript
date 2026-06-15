// Copyright 2026 Query Farm LLC - https://query.farm
//
// VGI worker that computes the date of Easter Sunday for a given year.
//
// Provides a single scalar function, `easter_date(year)`, returning the
// Gregorian (Western) date of Easter Sunday using the Anonymous Gregorian
// algorithm (a.k.a. the Meeus/Jones/Butcher Computus). TypeScript port of the
// Python `easter_worker.py`.

import { createRequire } from "node:module";
import {
  defineScalarFunction,
  Worker,
  ReadOnlyCatalogInterface,
  FunctionRegistry,
  int,
  type CatalogDescriptor,
  type CatalogInfo,
  type CatalogAttachResult,
  type VgiFunction,
} from "@query-farm/vgi";
import {
  DateDay,
  Field,
  Schema,
  Struct,
  RecordBatch,
  makeData,
} from "@query-farm/apache-arrow";
import { easterSunday, daysSinceEpoch } from "./easter.js";

export const DATA_VERSION = "1.0.0";

/**
 * Version reported as the catalog's `implementation_version`.
 *
 * Prefer an explicit git SHA from `VGI_EASTER_GIT_COMMIT` (handy in CI/dev
 * builds); otherwise fall back to the installed package version, so a normal
 * install reports the release version. `"unknown"` only if neither is
 * available.
 */
export function implementationVersion(): string {
  const sha = process.env.VGI_EASTER_GIT_COMMIT;
  if (sha) return sha;
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {
    // fall through
  }
  return "unknown";
}

export const IMPLEMENTATION_VERSION = implementationVersion();

const CATALOG_NAME = "easter";

/**
 * Map a column of years (numbers/bigints, possibly null) to date32 values
 * (integer days since the Unix epoch), propagating nulls. Shared by the scalar
 * function's `compute` and the unit tests so there is a single source of truth.
 */
export function computeEasterDays(
  years: Iterable<number | bigint | null | undefined>,
): Array<number | null> {
  const out: Array<number | null> = [];
  for (const y of years) {
    if (y === null || y === undefined) {
      out.push(null);
    } else {
      // year may arrive as bigint (int64); Number() is exact for any
      // realistic Gregorian year.
      out.push(daysSinceEpoch(easterSunday(Number(y))));
    }
  }
  return out;
}

/**
 * Build a one-column `date32` RecordBatch from day-numbers (days since the Unix
 * epoch), propagating nulls via the validity bitmap.
 *
 * Why we build the batch by hand instead of returning a plain array: the SDK's
 * array-to-column path (`batchFromColumns` → `buildColumnData`) routes a
 * *non-null* Date32 column through arrow-js `vectorFromArray(numbers, DateDay)`,
 * and on this apache-arrow fork that builder writes all zeros for raw
 * day-number inputs (it only stores the right value when fed `Date` objects).
 * The net effect was that any all-non-null result — e.g. the constant call
 * `easter_date(2025)` — serialized as day 0 (1970-01-01). Returning an
 * already-built `date32` batch (an `Int32Array` of day-numbers plus an explicit
 * null bitmap) sidesteps that builder entirely and is correct for flat,
 * constant, and dictionary-encoded inputs alike. See the integration test
 * `test/sql/easter_function.test`.
 */
export function buildDate32Batch(days: Array<number | null>): RecordBatch {
  const length = days.length;
  const data = new Int32Array(length);
  const nullBitmap = new Uint8Array(Math.ceil(length / 8) || 1);
  let nullCount = 0;
  for (let i = 0; i < length; i++) {
    const d = days[i];
    if (d === null || d === undefined) {
      nullCount++;
      continue;
    }
    nullBitmap[i >> 3] |= 1 << (i & 7);
    data[i] = d;
  }

  const resultField = new Field("result", new DateDay(), true);
  const child = makeData({
    type: new DateDay(),
    length,
    data,
    nullBitmap: nullCount > 0 ? nullBitmap : undefined,
    nullCount,
  } as any);
  const struct = makeData({
    type: new Struct([resultField]),
    length,
    children: [child],
    nullCount: 0,
  });
  return new RecordBatch(new Schema([resultField]), struct);
}

/**
 * Scalar function: Date of Western (Gregorian) Easter Sunday for a given year.
 *
 * - single column input (`int64` year)
 * - explicit `date32` output type
 * - null propagation (a null year yields a null date)
 */
export const easterDateFunction: VgiFunction = defineScalarFunction({
  name: "easter_date",
  description: "Date of Western (Gregorian) Easter Sunday for a given year",
  params: { year: int }, // int === int64
  returns: new DateDay(), // date32
  compute: (batch) => {
    const col = batch.getChildAt(0);
    const n = col ? col.length : batch.numRows;
    const years: Array<number | bigint | null> = [];
    for (let i = 0; i < n; i++) {
      years.push(col ? (col.get(i) as number | bigint | null) : null);
    }
    return buildDate32Batch(computeEasterDays(years));
  },
  examples: [
    {
      sql: "SELECT easter_date(2025)",
      description: "Easter Sunday in 2025 (2025-04-20)",
    },
    {
      sql:
        "SELECT year, easter_date(year) AS easter FROM range(2020, 2031) t(year)",
      description: "Easter dates for 2020 through 2030",
    },
  ],
});

export const easterCatalogDescriptor: CatalogDescriptor = {
  name: CATALOG_NAME,
  defaultSchema: "main",
  schemas: [
    {
      name: "main",
      comment: "Computus: the date of Western (Gregorian) Easter Sunday",
      functions: [easterDateFunction],
    },
  ],
};

/**
 * Easter catalog advertising a data version and an implementation version.
 *
 * `implementation_version` is the git SHA (`VGI_EASTER_GIT_COMMIT`) when set,
 * else the package version. See `implementationVersion`.
 */
export class EasterCatalog extends ReadOnlyCatalogInterface {
  override catalogsInfo(): CatalogInfo[] {
    return [
      {
        name: CATALOG_NAME,
        implementation_version: IMPLEMENTATION_VERSION,
        data_version_spec: DATA_VERSION,
        attach_option_specs: [],
        releases: [],
      },
    ];
  }

  override async attach(
    name: string,
    options?: Record<string, unknown>,
    dataVersionSpec?: string | null,
    implementationVersionArg?: string | null,
  ): Promise<CatalogAttachResult> {
    const result = await super.attach(
      name,
      options,
      dataVersionSpec,
      implementationVersionArg,
    );
    return {
      ...result,
      resolved_data_version: DATA_VERSION,
      resolved_implementation_version: IMPLEMENTATION_VERSION,
    };
  }
}

export function buildEasterCatalogInterface(): EasterCatalog {
  const registry = new FunctionRegistry();
  registry.register(easterDateFunction);
  return new EasterCatalog(easterCatalogDescriptor, registry);
}

export function createWorker(): Worker {
  return new Worker({
    functions: [easterDateFunction],
    catalogInterface: buildEasterCatalogInterface(),
    catalogName: CATALOG_NAME,
  });
}

export const worker = createWorker();

// NOTE: This module is a library (imported by both the stdio entry,
// `worker-stdio.ts`, and the HTTP entry, `serve.ts`) and intentionally does NOT
// auto-run a transport on import. The runnable stdio / AF_UNIX entry is
// `worker-stdio.ts` (built to `dist/worker.cjs`); see that file for why the
// subprocess transport must run as a CommonJS bundle under Node.
