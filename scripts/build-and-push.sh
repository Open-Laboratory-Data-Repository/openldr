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
  # `index()` yields the position or null; `// "absent"` turns null into a word.
  set +e
  GH_OUT="$(gh api "orgs/$ORG/packages/container/openldr-api/versions" \
              --jq '[.[].metadata.container.tags[]] | index("'"$VERSION"'") // "absent"' 2>&1)"
  GH_RC=$?
  set -e
  if [ "$GH_RC" -ne 0 ]; then
    # A missing package means the tag is free — the first release of a new image. Anything
    # else (403, network, rate limit) means we DO NOT KNOW, and an unknown must never read as
    # "free": that is how an overwrite guard silently disarms.
    if printf '%s' "$GH_OUT" | grep -qiE '(^|[^0-9])404([^0-9]|$)|not found'; then
      FOUND=absent
    else
      echo "ERROR: cannot check whether $VERSION is already published." >&2
      echo "  $GH_OUT" >&2
      echo "The guard needs a token with read:packages. Fix the token, or pass --allow-overwrite" >&2
      echo "if you have confirmed by hand that this tag was never announced." >&2
      exit 1
    fi
  else
    FOUND="$GH_OUT"
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
