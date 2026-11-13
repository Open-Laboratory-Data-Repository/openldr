#!/usr/bin/env sh
# OpenLDR CE developer bootstrap (Linux/macOS): clone + install + backing services + DB.
# For running from SOURCE while the published images aren't available yet.
#   curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.sh | bash
# Flags:
#   --dir <path>     where to clone (default ./openldr)
#   --branch <name>  branch to clone (default main)
#   --seed           also load WHONET sample data (needs the wasm build toolchain; starts the API for the load and leaves it running)
#   --reset-db       force a db reset even on an existing setup (DESTRUCTIVE)
#   --no-services    just clone + install; skip Docker + DB
set -eu

REPO_URL="https://github.com/Open-Laboratory-Data-Repository/openldr.git"
DIR="./openldr"
BRANCH="main"
SEED=0
RESET_DB=0
NO_SERVICES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --seed) SEED=1; shift ;;
    --reset-db) RESET_DB=1; shift ;;
    --no-services) NO_SERVICES=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

err() { echo "✗ $1" >&2; exit 1; }

# The API the sample load goes to (--seed): the CLI's own default unless OPENLDR_URL says otherwise.
API_URL="${OPENLDR_URL:-http://127.0.0.1:3000}"
API_LOG="${TMPDIR:-/tmp}/openldr-dev-api.log"
API_PID=""
API_WAS_UP=0
api_up() { API_URL="$API_URL" node -e "fetch(process.env.API_URL + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1; }
# Stops only the API this script started, by its own process ID. A failed step or Ctrl+C runs it.
stop_api() { if [ -n "$API_PID" ]; then kill "$API_PID" 2>/dev/null || true; API_PID=""; fi; }
trap stop_api EXIT
trap 'stop_api; exit 130' INT
trap 'stop_api; exit 143' TERM

# 1. Preflight
command -v git >/dev/null 2>&1 || err "git is not installed."
command -v node >/dev/null 2>&1 || err "Node.js >=20 is not installed. See https://nodejs.org/"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || err "Node.js >=20 required (found $(node -v))."
if ! command -v pnpm >/dev/null 2>&1; then
  if command -v corepack >/dev/null 2>&1; then
    echo "→ Enabling pnpm via corepack"
    corepack enable >/dev/null 2>&1 || true
  fi
  command -v pnpm >/dev/null 2>&1 || err "pnpm not found. See https://pnpm.io/installation (or run: corepack enable)."
fi
if [ "$NO_SERVICES" -eq 0 ]; then
  command -v docker >/dev/null 2>&1 || err "Docker is not installed (needed for backing services). Use --no-services to skip."
  docker compose version >/dev/null 2>&1 || err "Docker Compose plugin not found. Update Docker Desktop or install docker-compose-plugin."
  docker info >/dev/null 2>&1 || err "Docker daemon is not running. Start Docker and retry."
fi

# 2. Clone (or reuse an existing checkout)
if [ -f package.json ] && node -e 'process.exit(require("./package.json").name==="openldr"?0:1)' 2>/dev/null; then
  echo "→ Running inside an existing openldr checkout — skipping clone"
  REPO_DIR="$(pwd)"
elif [ -d "$DIR/.git" ]; then
  echo "→ Reusing existing clone at $DIR"
  REPO_DIR="$DIR"
else
  echo "→ Cloning $REPO_URL ($BRANCH) into $DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$DIR" || err "git clone failed"
  REPO_DIR="$DIR"
fi
cd "$REPO_DIR"

# 3. Install workspace dependencies
echo "→ pnpm install"
pnpm install || err "pnpm install failed"

# 4. .env — dev bypass so the app is usable without configuring Keycloak SSO.
#    .env.example already sets NODE_ENV=development; we only add AUTH_DEV_BYPASS.
FRESH_ENV=0
if [ ! -f .env ]; then
  cp .env.example .env
  printf '\n# --- added by development.sh: no-login dev mode (remove to use real Keycloak) ---\nAUTH_DEV_BYPASS=true\n' >> .env
  printf 'SECRETS_ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d '\n')" >> .env
  FRESH_ENV=1
  echo "→ Wrote .env (dev bypass enabled — loads as a dev admin)"
else
  echo "→ Reusing existing .env"
fi

if [ "$NO_SERVICES" -eq 1 ]; then
  echo "→ Skipping Docker services + DB (--no-services)"
else
  # 5. Backing services (dev docker-compose.yml: postgres, storage, keycloak)
  echo "→ Starting backing services (postgres, storage, keycloak)"
  docker compose up -d || err "docker compose up failed"

  # 6. DB init — only on a fresh setup so a re-run never wipes data; --reset-db forces it.
  if [ "$FRESH_ENV" -eq 1 ] || [ "$RESET_DB" -eq 1 ]; then
    echo "→ Waiting for Postgres to be ready…"
    i=0
    while [ "$i" -lt 30 ]; do
      docker compose exec -T postgres pg_isready -U openldr >/dev/null 2>&1 && break
      i=$((i + 1)); sleep 2
    done
    # The sample load (e2e:seed:load) goes through the API at OPENLDR_URL, signed in by
    # AUTH_DEV_BYPASS. Look before any reset: an API already answering there is used as it is,
    # and it must be the one on this checkout's database. Nothing here can check that.
    # Unproven: this part has not been run. macOS is unproven too.
    if [ "$SEED" -eq 1 ] && api_up; then
      API_WAS_UP=1
      echo "→ An API already answers at $API_URL. The sample load will go to it; it must run on this checkout's database."
    fi
    echo "→ Resetting the database (pnpm openldr db reset)"
    pnpm openldr db reset || err "db reset failed"
    echo "→ Seeding starter set (pnpm openldr db seed)"
    pnpm openldr db seed || err "db seed failed"
    if [ "$SEED" -eq 1 ]; then
      # 1. The reset half needs no server.
      echo "→ Preparing WHONET sample data (pnpm e2e:seed:reset)"
      pnpm e2e:seed:reset || err "seed reset failed"
      # 2. Then an API on the fresh schema, unless one was already there.
      if [ "$API_WAS_UP" -eq 0 ]; then
        echo "→ Starting the API for the sample load (node dev.mjs in apps/server, log in $API_LOG)"
        # One process, no watcher, so its own process ID stops all of it.
        (cd apps/server && exec node dev.mjs) >"$API_LOG" 2>&1 &
        API_PID=$!
        i=0
        until api_up; do
          kill -0 "$API_PID" 2>/dev/null || err "The API stopped while starting (see $API_LOG)."
          i=$((i + 1))
          [ "$i" -lt 60 ] || err "The API did not answer at $API_URL (see $API_LOG)."
          sleep 2
        done
      fi
      # 3. The load half, through that API.
      echo "→ Loading WHONET sample data (pnpm e2e:seed:load)"
      pnpm e2e:seed:load || err "seed load failed"
    fi
  else
    echo "→ Skipping db reset (existing setup; pass --reset-db to wipe & re-init)"
  fi
fi

# 7. Next steps
cat <<EOF

✓ Dev environment ready in $REPO_DIR
Start the app in two terminals:
  1) pnpm -C apps/server dev      # API on http://localhost:3000
  2) pnpm -C apps/studio dev      # Studio UI on http://localhost:5173 (proxies /api → :3000)
Backing services: Postgres :5433 · S3 storage :9010 · Keycloak :8180
Auth: AUTH_DEV_BYPASS is on (loads as a dev admin). Edit .env to use real Keycloak.
EOF

# The API started for the sample load stays up, so it is not started only to be stopped. It does
# not restart on edits, and it holds port 3000, so step 1 above needs it stopped first.
if [ -n "$API_PID" ]; then
  echo "The API started for the sample data is still running (process $API_PID, log in $API_LOG)."
  echo "It does not restart on edits. Stop it with: kill $API_PID, then run step 1."
  API_PID=""
fi
trap - EXIT INT TERM
