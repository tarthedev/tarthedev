# Production image for the API (apps/api: Hono + WebSockets).
#
# Build from the repo root. infra/scripts/deploy.sh feeds Docker a clean copy of
# one commit, so local node_modules, .env files and uncommitted work never reach
# the image:
#
#   git archive --format=tar <sha> | docker build -f apps/api/Dockerfile \
#     --build-arg APP_VERSION=<sha> -t dwrg-api:<sha> -
#
# How the API runs: TypeScript source with tsx (`node --import tsx src/server.ts`),
# exactly like `pnpm --filter @dwrg/api start` in development. Why not a bundle:
# the workspace packages (@dwrg/core, @dwrg/db, @dwrg/shared) export .ts source,
# and @dwrg/db finds its SQL migrations relative to its own source file
# (import.meta.url). A bundler would break that and add a second build config
# that can drift from dev. tsx needs no config and compiles at startup (about a
# second). The cost is size: tsx is a root devDependency, so dev dependencies are
# installed too (about 360 MB of node_modules). That layer is rebuilt only when a
# package.json or the lockfile changes, so versions that differ only in source
# share it on disk.
#
# The same image runs database migrations (packages/db/src/migrate.ts) and, for
# now, the worker placeholder: see infra/docker-compose.prod.yml.
#
# Plain Dockerfile syntax (no `# syntax=` line, no COPY --parents), so any
# BuildKit-enabled Docker (the default since Docker 23) builds it without
# downloading a frontend image.

ARG NODE_IMAGE=node:22-trixie-slim

# ---------------------------------------------------------------------------
# 1. The files pnpm needs to install: every package.json, the lockfile and the
#    workspace list. This stage reruns on any change, but its output changes
#    only when those files do, so the install in stage 2 stays cached.
FROM ${NODE_IMAGE} AS manifests
WORKDIR /src
COPY . .
RUN mkdir /out \
 && find . -name node_modules -prune -o -type f \
      \( -name package.json -o -name pnpm-lock.yaml -o -name pnpm-workspace.yaml \) -print0 \
    | xargs -0 cp --parents -t /out

# ---------------------------------------------------------------------------
# 2. Dependencies of the API and the workspace packages it uses ("@dwrg/api...").
FROM ${NODE_IMAGE} AS deps
ENV CI=true
WORKDIR /app
COPY --from=manifests /out/ ./

# pnpm at the exact version pinned in package.json "packageManager".
RUN npm install --global --no-fund --no-audit --loglevel=error \
      "$(node -p 'require("./package.json").packageManager.split("+")[0]')"

RUN --mount=type=cache,id=dwrg-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store --filter "@dwrg/api..." \
 && test -x node_modules/.bin/tsx

# ---------------------------------------------------------------------------
# 3. Source code. A build from a dev checkout (instead of git archive) could
#    carry host node_modules or .env files; drop them so they never reach the image.
FROM ${NODE_IMAGE} AS source
WORKDIR /src
COPY tsconfig.base.json ./
COPY packages ./packages
COPY tools ./tools
COPY apps/api ./apps/api
RUN find . -name node_modules -prune -exec rm -rf {} + \
 && find . -name '.env*' ! -name '*.example' -exec rm -rf {} + \
 && test -f apps/api/src/server.ts \
 && test -f packages/db/src/migrate.ts

# ---------------------------------------------------------------------------
# 4. Runtime.
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    TZ=America/New_York
WORKDIR /app

# Everything stays owned by root, so the app user can't change its own code.
COPY --from=deps /app ./
COPY --from=source /src ./

WORKDIR /app/apps/api
USER node
EXPOSE 8787

# /health must answer 200 when the API can serve requests (docs/runbooks/monitoring.md).
# Node's fetch, because the slim image has no curl or wget.
# Checked every 2 s while starting, then every 15 s; three misses in a row mark
# it unhealthy, so deploy.sh notices a bad version within about a minute.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --start-interval=2s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Last, so a new version only adds tiny layers. Sentry uses it as the release.
ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}
LABEL org.opencontainers.image.revision=${APP_VERSION} \
      org.opencontainers.image.title="dwrg-api"

# `node --import tsx` keeps Node as the main process (no tsx wrapper process),
# so SIGTERM from `docker stop` reaches the server's own shutdown handler.
CMD ["node", "--import", "tsx", "src/server.ts"]
