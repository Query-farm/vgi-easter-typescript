# vgi-easter (TypeScript)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A tiny [VGI (Vector Gateway Interface)](https://github.com/Query-farm) worker
that gives DuckDB one SQL function — `easter_date(year)` — returning the date of
Western (Gregorian) Easter Sunday. It has no external data and almost no code,
which makes it a clean, copyable example of a VGI scalar-function worker.

This is the **TypeScript** port of the
[Python `vgi-easter` worker](../vgi-easter-python-fly), built on the
[`@query-farm/vgi`](https://github.com/Query-farm/vgi-typescript) SDK. It runs
on the [Bun](https://bun.sh) runtime (the SDK's runtime); the built worker also
runs under Node for the stdio transport.

## Quick start

In DuckDB:

```sql
-- VGI isn't bundled with DuckDB yet, so load it from the community channel
-- (INSTALL is a one-time download; LOAD is once per session).
INSTALL vgi FROM community;
LOAD vgi;

ATTACH 'easter' (TYPE 'vgi', LOCATION 'launch:/abs/path/to/bin/vgi-easter');

SELECT easter.easter_date(2025);   -- 2025-04-20

SELECT year, easter.easter_date(year) AS easter
FROM range(2020, 2025) t(year);
```

DuckDB launches the worker for you, and `easter_date` then behaves like a native
function (a null year yields a null date).

## How it works

A VGI worker publishes catalogs, schemas, and functions that DuckDB can `ATTACH`
and query as if they were built in. Values cross the boundary as Apache Arrow,
so they stay columnar end to end.

This worker publishes a single function:

```
easter                                  (catalog)
└── main                                (schema)
    └── easter_date(year BIGINT) → DATE
```

The implementation lives in two small files:

- [`src/easter.ts`](src/easter.ts) — the date calculation (`easterSunday`, the
  Anonymous Gregorian *Computus*, a faithful port of the Python integer
  arithmetic) plus `daysSinceEpoch` for the Arrow `date32` encoding.
- [`src/worker.ts`](src/worker.ts) — a `defineScalarFunction` mapping an Arrow
  column of years to `date32` (with null propagation), the catalog descriptor,
  a versioned read-only catalog interface, and the `Worker` assembly.

## Running it

| Entry             | Transport | Use it when                                              |
| ----------------- | --------- | -------------------------------------------------------- |
| `bin/vgi-easter`  | stdio     | DuckDB spawns the worker as a subprocess (the quickstart)|
| `src/serve.ts`    | HTTP      | you want a long-running server to attach to              |

Build first, then use the stdio launcher:

```bash
bun install
bun run build
# LOCATION for DuckDB: launch:$PWD/bin/vgi-easter  (or the bare path for stdio)
```

Run over HTTP (Bun):

```bash
VGI_SIGNING_KEY=$(openssl rand -hex 32) PORT=8000 bun run src/serve.ts
```

```sql
LOAD vgi;   -- after a one-time INSTALL vgi FROM community
ATTACH 'easter' (TYPE 'vgi', LOCATION 'http://localhost:8000/vgi');
```

## Configuration

| Variable                  | Purpose                                                          |
| ------------------------- | --------------------------------------------------------------- |
| `VGI_SIGNING_KEY`         | Hex signing key for HTTP state tokens (recommended for the HTTP server; random if unset). |
| `PORT` / `HOST`           | HTTP bind port/address (default `8080` / `0.0.0.0`).            |
| `VGI_EASTER_GIT_COMMIT`   | Reported as the catalog's `implementation_version`.            |
| `VGI_WORKER_IDLE_TIMEOUT` | Override the launcher's AF_UNIX idle-shutdown timeout (seconds).|

## The SDK dependency

`@query-farm/vgi` is not published to npm. This repo vendors it as a packed
tarball (`vendor-query-farm-vgi-0.1.0.tgz`, produced by `npm pack` of the SDK
checkout) and references it via `"@query-farm/vgi": "file:./vendor-...tgz"` in
`package.json`. A `github:` git dependency was attempted first but the SDK repo
is not publicly resolvable, and a `github:` install would not build `dist/`
anyway (the SDK has no `prepare` script). The tarball ships both `src/` and
`dist/`, so the import resolves under Bun (via the package's `bun` export → `src`)
and under Node (via the `import` export → `dist`).

## Development

Requires [Bun](https://bun.sh) 1.3+.

```bash
bun install
bun test          # unit tests (test/easter.test.ts)
bun run build     # typecheck (tsc) + bundle (bun build) into dist/
```

The unit suite covers the Easter calculation (including the March 22 / April 25
extremes), the Arrow compute path (date32 + null propagation), and the
implementation-version logic. A separate
[sqllogictest](https://duckdb.org/dev/sqllogictest/intro) suite in `test/sql/`
drives the worker through the **real** DuckDB `vgi` extension via
[Haybarn](https://github.com/Query-farm-haybarn). CI runs both on Linux, macOS,
and Windows — see [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Built with

- **[DuckDB](https://duckdb.org)** attaches and queries the worker.
- **[@query-farm/vgi](https://github.com/Query-farm/vgi-typescript)** is the VGI
  worker SDK this is built on.
- **[Haybarn](https://github.com/Query-farm-haybarn)** provides the
  DuckDB-compatible `unittest` runner that drives the cross-platform CI.

## License

MIT — see [LICENSE](LICENSE). Copyright 2026 Query Farm LLC — https://query.farm
