# syntax=docker/dockerfile:1
# openldr-api — the backend/API image (no SPA; the studio image serves the UI).
# ---- build: install, build the server, produce a standalone deploy ----
FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter @openldr/server --filter @openldr/cli
# pnpm deploy resolves the server's workspace deps into a self-contained dir (/deploy).
RUN pnpm --filter @openldr/server deploy --prod --legacy /deploy
# The operator CLI, deployed the same way into its own dir. It is NOT a dependency of the
# server — a separate deploy keeps the server's runtime tree unchanged. Shipping it here
# rather than as a sixth image is deliberate: every workspace package the CLI needs is already
# in this image via @openldr/bootstrap, and a new GHCR package defaults to PRIVATE, where one
# private image aborts the whole `docker compose pull`.
RUN pnpm --filter @openldr/cli deploy --prod --legacy /deploy-cli
# Bundled, license-safe terminology fixtures (FHIR R4 ValueSet catalog + full UCUM). @openldr/db
# resolves these at runtime relative to the server bundle (dist/../fixtures/fhir), but pnpm deploy
# carries only code, not packages/db's data dir — so stage them explicitly. Without this the
# first-boot seed logs "fixture missing" and coded form-fields come up with no terminology.
RUN mkdir -p /deploy/fixtures/fhir && cp packages/db/fixtures/fhir/*.gz /deploy/fixtures/fhir/
# Same resolution rule, different bundle directory: the CLI's copy of @openldr/db computes
# <cli-dist>/../fixtures/fhir, so it needs its own staged copy. Without it `openldr db seed`
# and the terminology commands come up with no terminology inside the container.
RUN mkdir -p /deploy-cli/fixtures/fhir && cp packages/db/fixtures/fhir/*.gz /deploy-cli/fixtures/fhir/

# ---- runtime: slim node, non-root, API-only (no SPA — WEB_DIST_DIR unset) ----
FROM node:22-bookworm-slim AS runtime
LABEL org.opencontainers.image.source="https://github.com/Open-Laboratory-Data-Repository/openldr"
ENV NODE_ENV=production
ENV PORT=3000
# ⛔ The version this install reports — the About card, /api/update, and `openldr update check`
# all read it via readAppVersion(). Without it that function falls back to the nearest
# package.json, which inside this image is /app/package.json: @openldr/server's OWN version, not
# the release. Measured on the published 0.1.1 image: it reported 0.1.0. build-and-push.sh passes
# the root package.json version here. Left empty the fallback still applies, so a plain
# `docker build` with no --build-arg behaves exactly as it did before.
ARG APP_VERSION=""
ENV APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --from=build /deploy /app
# The operator CLI at a fixed path. install/install.sh's `openldr` wrapper hardcodes
# /app/cli/dist/index.js — changing this path breaks every installed wrapper already on disk.
COPY --from=build /deploy-cli /app/cli
# No WEB_DIST_DIR / no /app/web: app.ts guards SPA serving on existsSync(webDist), so with the
# default path absent the server runs API + /health only. The studio image owns the SPA.
RUN useradd --system --uid 10001 openldr && chown -R openldr /app
USER openldr
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
