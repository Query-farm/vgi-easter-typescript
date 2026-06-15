// Copyright 2026 Query Farm LLC - https://query.farm
//
// HTTP entrypoint for the Easter VGI worker. DuckDB clients ATTACH it over
// http(s):// — see README. Mirrors the SDK's examples/http-worker.ts. Runs on
// the Bun runtime (uses Bun.serve), matching the SDK.

import { createHttpHandler, unpackStateToken } from "@query-farm/vgi-rpc";
import {
  buildVgiProtocol,
  arrowStateSerializer,
  FunctionRegistry,
} from "@query-farm/vgi";
import {
  easterDateFunction,
  buildEasterCatalogInterface,
} from "./worker.js";

const registry = new FunctionRegistry();
registry.register(easterDateFunction);

const catalogInterface = buildEasterCatalogInterface();

// Shared signing key so buildVgiProtocol can decode state tokens created by
// createHttpHandler. Prefer VGI_SIGNING_KEY (a hex string) so tokens survive
// across machine restarts (e.g. on Fly); otherwise generate an ephemeral key.
const signingKey = (() => {
  const hex = process.env.VGI_SIGNING_KEY;
  if (hex && /^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0) {
    const buf = new Uint8Array(hex.length / 2);
    for (let i = 0; i < buf.length; i++) {
      buf[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return buf;
  }
  return crypto.getRandomValues(new Uint8Array(32));
})();
const tokenTtl = 3600;

const protocol = buildVgiProtocol({
  registry,
  catalogInterface,
  catalogName: "easter",
  signingKey,
  recoverExchangeState: (opaqueData: Uint8Array) => {
    const tokenString = new TextDecoder().decode(opaqueData);
    const unpacked = unpackStateToken(tokenString, signingKey, tokenTtl, null);
    return arrowStateSerializer.deserialize(unpacked.stateBytes);
  },
});

const handler = createHttpHandler(protocol, {
  prefix: "/vgi",
  serverId: "vgi-easter-http",
  tokenKey: signingKey,
  tokenTtl,
  stateSerializer: arrowStateSerializer,
});

const port = Number(process.env.PORT ?? 8080);
const hostname = process.env.HOST ?? "0.0.0.0";

const server = Bun.serve({ port, hostname, fetch: handler });
console.log(`PORT:${server.port}`);
