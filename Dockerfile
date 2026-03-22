# Production image — two-stage build (deps → app).
# Stage 1: install dependencies and compile the server bundle.
# Stage 2: distroless runtime — no shell, no package manager.

# --- builder stage ---
FROM oven/bun:1.1@sha256:d6ad4d3280d3e7e92b793a924105d68766d60b1f36709f4cee11bc8737782621 AS builder

WORKDIR /app

# Copy workspace manifests and lockfile first for layer caching
COPY package.json bun.lock ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/

# Install all workspace dependencies with frozen lockfile for reproducibility
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Compile the server entry-point to a single bundle targeting the bun runtime
RUN bun build apps/server/src/index.ts \
      --target bun \
      --outfile dist/server.js \
      --external postgres

# --- production stage ---
FROM oven/bun:1.1-distroless@sha256:994252d8978f7fb4f12fb123c30d4405a46addc679f2cf1836d47f7350ce21b2 AS production

WORKDIR /app

# Copy only the compiled bundle and the raw db package (needed for migrations at runtime)
COPY --from=builder /app/dist/server.js ./dist/server.js
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/node_modules ./node_modules

# The server reads PORT from the environment; default to 31415
ENV PORT=31415

# Health check — curl is absent in distroless so we use bun's built-in fetch
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:' + (process.env.PORT || 31415) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 31415

ENTRYPOINT ["bun", "run", "dist/server.js"]
