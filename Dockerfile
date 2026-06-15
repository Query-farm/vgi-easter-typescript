# Copyright 2026 Query Farm LLC - https://query.farm
#
# Container for the easter VGI worker's HTTP transport (`vgi-easter-http`).
# DuckDB clients ATTACH it over http:// — see README.
#
# Runs on the Bun runtime (the SDK's runtime; serve.ts uses Bun.serve).
FROM oven/bun:1.3-slim

WORKDIR /app

# Install dependencies first (cached layer). The VGI SDK is vendored as a
# packed tarball (not yet on npm), so it must be copied before `bun install`.
COPY package.json bun.lock vendor-query-farm-vgi-0.1.0.tgz ./
RUN bun install --frozen-lockfile

# Then the source.
COPY tsconfig.json README.md LICENSE ./
COPY src ./src

# Fly routes external traffic to this internal port (see fly.toml).
ENV PORT=8080 HOST=0.0.0.0
EXPOSE 8080
CMD ["bun", "run", "src/serve.ts"]
