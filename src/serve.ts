// Copyright 2026 Query Farm LLC - https://query.farm
//
// HTTP entrypoint for the Easter VGI worker. DuckDB clients ATTACH it over
// http(s):// — see README. Uses the SDK's serveVgiWorker
// (@query-farm/vgi/serve), which runs on the Bun runtime (Bun.serve).

import { serveVgiWorker } from "@query-farm/vgi/serve";
import { FunctionRegistry } from "@query-farm/vgi";
import {
  easterDateFunction,
  buildEasterCatalogInterface,
  IMPLEMENTATION_VERSION,
} from "./worker.js";

const registry = new FunctionRegistry();
registry.register(easterDateFunction);

const catalogInterface = buildEasterCatalogInterface();

// Shared signing key for HTTP state tokens. Prefer VGI_SIGNING_KEY (a hex
// string) so tokens survive across machine restarts (e.g. on Fly); otherwise
// serveVgiWorker generates an ephemeral key.
const signingKey = (() => {
  const hex = process.env.VGI_SIGNING_KEY;
  if (hex && /^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
    const buf = new Uint8Array(hex.length / 2);
    for (let i = 0; i < buf.length; i++) {
      buf[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return buf;
  }
  return undefined;
})();

serveVgiWorker({
  name: "easter",
  doc: "Date of Western (Gregorian) Easter Sunday for a given year.",
  version: IMPLEMENTATION_VERSION,
  repositoryUrl: "https://github.com/Query-farm/vgi-easter-typescript",
  registry,
  catalogInterface,
  signingKey,
  tokenTtl: 3600,
  prefix: "/vgi",
  serverId: "vgi-easter-http",
  port: Number(process.env.PORT ?? 8080),
  hostname: process.env.HOST ?? "0.0.0.0",
});
