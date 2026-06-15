@echo off
rem Copyright 2026 Query Farm LLC - https://query.farm
rem Windows stdio launcher entry for the easter VGI worker.
rem Runs the CommonJS bundle (dist\worker.cjs) under Node: the subprocess stdio
rem transport needs sync node:fs.writeSync via globalThis.require (Node CJS),
rem which Node ESM (dist\worker.js) does not provide. See src/worker-stdio.ts.
node "%~dp0..\dist\worker.cjs" %*
