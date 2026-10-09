# syntax=docker/dockerfile:1
# openldr-gateway — nginx reverse proxy with the OpenLDR routing baked in.
# The official nginx entrypoint runs envsubst on /etc/nginx/templates/*.template at start,
# so ${SERVER_NAME} is still substituted at runtime. TLS certs stay mounted (host-specific).
# Third-party images come from our GHCR copies (deploy/third-party-images.json).
FROM ghcr.io/open-laboratory-data-repository/nginx:1.27-alpine@sha256:36bc127593b73913fa30b1776cbaa49bb1546fbc06f78a275d785dfd37864136
LABEL org.opencontainers.image.source="https://github.com/Open-Laboratory-Data-Repository/openldr"
COPY openldr.conf.template /etc/nginx/templates/default.conf.template
EXPOSE 80 443
