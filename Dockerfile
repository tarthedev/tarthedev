# syntax=docker/dockerfile:1

# Debian slim rather than Alpine: sharp and Prisma both ship reliable prebuilt
# binaries for glibc, which avoids a native rebuild on every deploy.
ARG NODE_VERSION=22-bookworm-slim

# ---------------------------------------------------------------------------
# deps — install once, reuse in every later stage
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# builder — generate the Prisma client and build Next
# ---------------------------------------------------------------------------
FROM deps AS builder
WORKDIR /app

COPY . .
RUN npx prisma generate

# `next build` reads env at build time for validation only; real values are
# supplied at runtime. These placeholders never reach the running container.
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV SESSION_SECRET="build-time-placeholder-secret-value-not-used-at-runtime"
ENV AI_DEV_MODE="true"
RUN npm run build

# ---------------------------------------------------------------------------
# migrator — the Prisma CLI, run as a one-shot job before the app starts
# ---------------------------------------------------------------------------
FROM deps AS migrator
WORKDIR /app

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY --from=builder /app/src/generated ./src/generated
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# runner — minimal production image
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Never run the app as root.
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# Next's standalone output carries only the traced runtime dependencies.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Screenshots live on a mounted volume, outside the image.
RUN mkdir -p /app/storage && chown -R nextjs:nodejs /app/storage
VOLUME ["/app/storage"]

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
