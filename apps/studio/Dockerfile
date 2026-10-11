# syntax=docker/dockerfile:1
# openldr-studio — the studio SPA as a static nginx site served under /studio/.
# ---- build the SPA (@openldr/studio, base '/studio/') ----
# Third-party images come from our GHCR copies (deploy/third-party-images.json).
FROM ghcr.io/open-laboratory-data-repository/node:22-bookworm-slim@sha256:0e2e23be93fe1467322fb0f91add6c27aeb6329fadcf17e9dd6c50daa6fd62a9 AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter @openldr/studio

# ---- serve the static site ----
FROM ghcr.io/open-laboratory-data-repository/nginx:1.27-alpine@sha256:36bc127593b73913fa30b1776cbaa49bb1546fbc06f78a275d785dfd37864136 AS runtime
LABEL org.opencontainers.image.source="https://github.com/Open-Laboratory-Data-Repository/openldr"
COPY --from=build /repo/apps/studio/dist /usr/share/nginx/html/studio
COPY apps/studio/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
