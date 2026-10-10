# Builds the web app (apps/web: React + Vite PWA) into static files.
#
# There is no web server in this image: Caddy (infra/Caddyfile) serves the files.
# The last stage holds only the contents of apps/web/dist, so the build is
# written straight to a folder on the droplet instead of becoming an image:
#
#   git archive --format=tar <sha> | docker build -f apps/web/Dockerfile \
#     --build-arg APP_VERSION=<sha> --output type=local,dest=<folder> -
#
# infra/scripts/deploy.sh runs exactly that, then points Caddy at the new folder
# (docs/runbooks/deploy.md).
#
# Everything passed in at build time is baked into the JavaScript and visible to
# anyone, so never pass a secret here. One build serves staging and production
# (the same commit is promoted), so settings that differ between them must come
# from the API or the hostname at runtime, not from VITE_* variables.

ARG NODE_IMAGE=node:22-trixie-slim

# ---------------------------------------------------------------------------
# 1. The files pnpm needs to install (see apps/api/Dockerfile for why).
FROM ${NODE_IMAGE} AS manifests
WORKDIR /src
COPY . .
RUN mkdir /out \
 && find . -name node_modules -prune -o -type f \
      \( -name package.json -o -name pnpm-lock.yaml -o -name pnpm-workspace.yaml \) -print0 \
    | xargs -0 cp --parents -t /out

# ---------------------------------------------------------------------------
# 2. Dependencies of the web app and the workspace packages it uses ("@dwrg/web...").
#    Dev dependencies included: Vite, TypeScript and the plugins are build tools.
FROM ${NODE_IMAGE} AS deps
ENV CI=true
WORKDIR /app
COPY --from=manifests /out/ ./

# pnpm at the exact version pinned in package.json "packageManager".
RUN npm install --global --no-fund --no-audit --loglevel=error \
      "$(node -p 'require("./package.json").packageManager.split("+")[0]')"

RUN --mount=type=cache,id=dwrg-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store --filter "@dwrg/web..."

# ---------------------------------------------------------------------------
# 3. Source code, without any node_modules, build output or .env files a dev
#    checkout might carry.
FROM ${NODE_IMAGE} AS source
WORKDIR /src
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN find . -name node_modules -prune -exec rm -rf {} + \
 && find . -name '.env*' ! -name '*.example' -exec rm -rf {} + \
 && rm -rf apps/web/dist apps/web/dev-dist

# ---------------------------------------------------------------------------
# 4. Build.
FROM deps AS build
COPY --from=source /src ./

# The git commit, shown in the app and used as the Sentry release.
ARG APP_VERSION=dev
ENV VITE_APP_VERSION=${APP_VERSION}

# The package's own build script: typecheck, then `vite build` into apps/web/dist.
# Vite writes "hidden" source maps (not linked from the files) for error reports.
# Caddy would serve anything in dist, so the maps are removed from what ships;
# when Sentry is wired in, upload them from this stage before removing them.
RUN pnpm --filter @dwrg/web build \
 && test -f apps/web/dist/index.html \
 && find apps/web/dist -name '*.map' -type f -delete

# ---------------------------------------------------------------------------
# 5. Only the static files. Used with --output type=local,dest=<folder>.
FROM scratch AS dist
COPY --from=build /app/apps/web/dist/ /
