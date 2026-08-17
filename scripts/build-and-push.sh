#!/usr/bin/env bash
# Build and push the OpenLDR CE images to GHCR (GitHub Container Registry).
#   ./scripts/build-and-push.sh                      # ghcr.io/open-laboratory-data-repository/*, :latest + :<version>, push
#   ./scripts/build-and-push.sh --registry myorg
#   ./scripts/build-and-push.sh --tag rc1
#   ./scripts/build-and-push.sh --platform linux/amd64,linux/arm64
#   ./scripts/build-and-push.sh --no-push            # build + load locally, don't push
#   ./scripts/build-and-push.sh --dry-run             # print commands only
# Must be run from the repo root.
set -euo pipefail

REGISTRY="${DOCKER_REGISTRY:-ghcr.io/open-laboratory-data-repository}"
TAG="${IMAGE_TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
DRY_RUN=false
PUSH=true
ALLOW_OVERWRITE=false

while [ $# -gt 0 ]; do
  case "$1" in
    --registry) REGISTRY="$2"; shift 2 ;;
    --tag)      TAG="$2"; shift 2 ;;
    --platform) PLATFORM="$2"; shift 2 ;;
    --no-push)  PUSH=false; shift ;;
    --dry-run)  DRY_RUN=true; shift ;;
    --allow-overwrite) ALLOW_OVERWRITE=true; shift ;;
    -h|--help)  echo "Usage: $0 [--registry <org>] [--tag <tag>] [--platform <p>] [--no-push] [--dry-run] [--allow-overwrite]"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

[ -f package.json ] && [ -d apps ] || { echo "ERROR: run from the repo root" >&2; exit 1; }
VERSION="$(node -p "require('./package.json').version")"

# Refuse to overwrite a published version tag. A version tag that silently changes content is
# worse than :latest — :latest at least advertises that it moves, and readAppVersion() reports
# this same number in the studio's About card.
if [ "$PUSH" = true ] && [ "$ALLOW_OVERWRITE" = false ] && [ "$DRY_RUN" = false ]; then
  ORG="$(basename "$REGISTRY")"
  # Read EVERY version, not just the first page. A response holds 30 items by default, and
  # openldr-api gains a version per pushed manifest plus buildx's untagged per-arch and
  # attestation manifests — so a published tag drops off page 1 within a few releases. Without
  # --paginate the lookup then misses it and the guard permits the overwrite, silently.
  # --paginate applies --jq per page and concatenates, so the filter must emit one tag per
  # line rather than build a single array to index into.
  set +e
  GH_OUT="$(gh api --paginate "orgs/$ORG/packages/container/openldr-api/versions?per_page=100" \
              --jq '.[].metadata.container.tags[]' 2>&1)"
  GH_RC=$?
  set -e
  if [ "$GH_RC" -ne 0 ]; then
    # A missing package means the tag is free — the first release of a new image. Anything
    # else (403, network, rate limit) means we DO NOT KNOW, and an unknown must never read as
    # "free": that is how an overwrite guard silently disarms.
    #
    # 404 is not proof of absence either: GitHub answers 404 for a package that exists but is
    # invisible to an under-scoped token, so "absent" and "hidden from you" arrive as the same
    # reply. Before believing it, prove the token can see the org's container packages at all.
    # If that probe fails we cannot tell the two apart — fail closed. Message text is not
    # evidence, so do not try to separate 403 from 404 by reading it.
    if printf '%s' "$GH_OUT" | grep -qiE '(^|[^0-9])404([^0-9]|$)|not found' \
       && gh api "orgs/$ORG/packages?package_type=container&per_page=1" >/dev/null 2>&1; then
      FOUND=absent
    else
      echo "ERROR: cannot check whether $VERSION is already published." >&2
      echo "  $GH_OUT" >&2
      echo "The guard needs a token with read:packages. Fix the token, or pass --allow-overwrite" >&2
      echo "if you have confirmed by hand that this tag was never announced." >&2
      exit 1
    fi
  else
    # Fixed-string, whole-line: a substring match would read 0.1.10 as 0.1.0.
    if printf '%s\n' "$GH_OUT" | grep -Fxq "$VERSION"; then
      FOUND="$VERSION"
    else
      FOUND=absent
    fi
  fi
  if [ "$FOUND" != "absent" ]; then
    echo "ERROR: $REGISTRY/openldr-api:$VERSION is already published." >&2
    echo "Bump the version in package.json, or pass --allow-overwrite if that tag was never announced." >&2
    exit 1
  fi
fi

OUT="--push"
[ "$PUSH" = true ] || OUT="--load"

run() { echo "+ $*"; [ "$DRY_RUN" = true ] || "$@"; }

# name -> "dockerfile context" (context defaults to repo root '.')
build_one() {
  name="$1"; dockerfile="$2"; context="$3"
  echo "--- $name ---"
  run docker buildx build --platform "$PLATFORM" \
    -t "$REGISTRY/$name:$TAG" -t "$REGISTRY/$name:$VERSION" \
    -f "$dockerfile" $OUT "$context"
}

echo "Registry=$REGISTRY  Tag=$TAG(+$VERSION)  Platform=$PLATFORM  Push=$PUSH  DryRun=$DRY_RUN"
build_one openldr-api     apps/server/Dockerfile .
build_one openldr-studio  apps/studio/Dockerfile .
build_one openldr-web     apps/web/Dockerfile    .
build_one openldr-gateway  deploy/nginx/Dockerfile     deploy/nginx
build_one openldr-keycloak deploy/keycloak/Dockerfile  deploy/keycloak
echo "Done. Images: $REGISTRY/openldr-{api,studio,web,gateway,keycloak}:{$TAG,$VERSION}"
