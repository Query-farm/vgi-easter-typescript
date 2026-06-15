// Copyright 2026 Query Farm LLC - https://query.farm
//
// CommonJS stdio / AF_UNIX entry for the easter VGI worker.
//
// The DuckDB `vgi` extension launches the worker via `bin/vgi-easter`, which
// execs `node dist/worker.cjs`. That subprocess transport uses
// `@query-farm/vgi-rpc`'s `IpcStreamWriter`, which needs a *synchronous*
// `node:fs.writeSync`. vgi-rpc resolves it lazily via
// `import.meta.require ?? globalThis.require` (see its src/wire/writer.ts) so
// that bundlers don't statically pull `node:fs` into worker/browser builds.
//
// Under Bun, `import.meta.require` is defined. Under Node CommonJS, neither
// `import.meta.require` (it's stubbed to `undefined` by esbuild in a CJS
// bundle) nor `globalThis.require` is defined by default — so vgi-rpc throws
//   "IpcStreamWriter requires Bun or Node.js CJS ... Subprocess transport is
//    not available in this runtime."
//
// vgi-rpc's own comment spells out the contract: "Node ESM consumers must
// polyfill require if they need the subprocess transport." This entry is built
// as a CommonJS bundle (esbuild --format=cjs --platform=node), where a real
// CJS `require` is available, and we publish it on `globalThis.require` *before*
// anything in vgi-rpc instantiates an IpcStreamWriter. That satisfies the
// `globalThis.require` branch of vgi-rpc's runtime detection under plain Node.
//
// The HTTP `serve` entry does not use the subprocess transport (it uses
// Bun.serve), so it stays ESM and is unaffected.

// In a CJS bundle, `require` is the genuine Node require for this module.
// Publish it where vgi-rpc looks. Guard so this is a no-op if already set
// (e.g. when somehow loaded under Bun, which already provides it).
if (typeof (globalThis as { require?: unknown }).require !== "function") {
  // `require` here is the CJS module-local require provided by Node when this
  // file is loaded as CommonJS (esbuild --format=cjs keeps it intact).
  (globalThis as { require?: unknown }).require = require;
}

import { worker } from "./worker.js";

// stdio / AF_UNIX transport. The C++ launcher appends `--unix PATH` /
// `--idle-timeout SEC` when LOCATION uses the `launch:` scheme.
worker.run(process.argv.slice(2));
