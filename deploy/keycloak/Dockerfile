# OpenLDR CE Keycloak image: stock Keycloak 26 with the OpenLDR login theme baked in
# so it is on local disk (fast, cached by production `start` mode) rather than mounted
# at runtime. Build context is deploy/keycloak (see scripts/build-and-push.sh).
# Third-party images come from our GHCR copies (deploy/third-party-images.json).
FROM ghcr.io/open-laboratory-data-repository/keycloak:26.0@sha256:09a381c715ab0b111835b70f2905955274843a219c6f27efb348e4d9f4086858
COPY themes/openldr /opt/keycloak/themes/openldr
