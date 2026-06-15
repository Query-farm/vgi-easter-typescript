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
import { DateDay } from "@query-farm/apache-arrow";
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
    return computeEasterDays(years);
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

// Runnable entry: stdio / AF_UNIX transport. The C++ launcher appends
// `--unix PATH` / `--idle-timeout SEC` when LOCATION uses the `launch:` scheme.
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.main === true;

if (isMain) {
  worker.run(process.argv.slice(2));
}
