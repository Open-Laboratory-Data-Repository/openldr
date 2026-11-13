# OpenLDR CE developer bootstrap (Windows PowerShell): clone + install + services + DB.
# For running from SOURCE while the published images aren't available yet.
#   irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.ps1 | iex
# Flags:
#   -Dir <path>     where to clone (default ./openldr)
#   -Branch <name>  branch to clone (default main)
#   -Seed           also load WHONET sample data (needs the wasm build toolchain and port 3000 free; starts the API for the load and leaves it running)
#   -ResetDb        force a db reset even on an existing setup (DESTRUCTIVE)
#   -NoServices     just clone + install; skip Docker + DB
param(
  [string]$Dir = "./openldr",
  [string]$Branch = "main",
  [switch]$Seed,
  [switch]$ResetDb,
  [switch]$NoServices
)
$ErrorActionPreference = "Stop"
$RepoUrl = "https://github.com/Open-Laboratory-Data-Repository/openldr.git"

# The API for the sample load (-Seed). The script starts it on this port itself and sends the load
# there, whatever OPENLDR_URL the session holds. $api and $apiLog start empty: under `irm | iex`
# this runs in the caller's scope, and a second run must not find the first run's process.
$apiPort = 3000
$apiUrl = "http://127.0.0.1:$apiPort"
$apiUp = { try { Invoke-WebRequest -UseBasicParsing -Uri "$apiUrl/health" -TimeoutSec 2 *> $null; $true } catch { $false } }
$api = $null
$apiLog = $null

function Die($m) { Write-Error "X $m"; exit 1 }

# 1. Preflight
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die "git is not installed." }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Die "Node.js >=20 is not installed. See https://nodejs.org/" }
# Parse `node -v` (e.g. v24.6.0) in PowerShell — passing a quoted JS snippet to
# node via the native-arg path mangles the embedded quotes under PowerShell.
$nodeVer = (node -v)
$nodeMajor = [int]($nodeVer.TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { Die "Node.js >=20 required (found $nodeVer)." }
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  if (Get-Command corepack -ErrorAction SilentlyContinue) { Write-Host "-> Enabling pnpm via corepack"; corepack enable *> $null }
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Die "pnpm not found. See https://pnpm.io/installation (or run: corepack enable)." }
}
if (-not $NoServices) {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Die "Docker is not installed (needed for backing services). Use -NoServices to skip." }
  docker compose version *> $null; if ($LASTEXITCODE -ne 0) { Die "Docker Compose plugin not found. Update Docker Desktop." }
  docker info *> $null; if ($LASTEXITCODE -ne 0) { Die "Docker daemon is not running. Start Docker Desktop and retry." }
}

# 2. Clone (or reuse an existing checkout)
if ((Test-Path package.json) -and (((Get-Content package.json -Raw | ConvertFrom-Json).name) -eq 'openldr')) {
  Write-Host "-> Running inside an existing openldr checkout - skipping clone"
  $repoDir = (Get-Location).Path
} elseif (Test-Path "$Dir/.git") {
  Write-Host "-> Reusing existing clone at $Dir"
  $repoDir = $Dir
} else {
  Write-Host "-> Cloning $RepoUrl ($Branch) into $Dir"
  git clone --branch $Branch $RepoUrl $Dir
  if ($LASTEXITCODE -ne 0) { Die "git clone failed" }
  $repoDir = $Dir
}
Set-Location $repoDir

# 3. Install workspace dependencies
Write-Host "-> pnpm install"
pnpm install
if ($LASTEXITCODE -ne 0) { Die "pnpm install failed" }

# 4. .env - dev bypass so the app is usable without configuring Keycloak SSO.
#    .env.example already sets NODE_ENV=development; we only add AUTH_DEV_BYPASS.
$freshEnv = $false
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Add-Content -Path .env -Value "`n# --- added by development.ps1: no-login dev mode (remove to use real Keycloak) ---`nAUTH_DEV_BYPASS=true"
  $devBytes = New-Object 'System.Byte[]' 32
  $rngDev = [System.Security.Cryptography.RNGCryptoServiceProvider]::new()
  try { $rngDev.GetBytes($devBytes) } finally { $rngDev.Dispose() }
  Add-Content -Path .env -Value "SECRETS_ENCRYPTION_KEY=$([Convert]::ToBase64String($devBytes))"
  $freshEnv = $true
  Write-Host "-> Wrote .env (dev bypass enabled - loads as a dev admin)"
} else {
  Write-Host "-> Reusing existing .env"
}

if ($NoServices) {
  Write-Host "-> Skipping Docker services + DB (-NoServices)"
} else {
  # 5. Backing services (dev docker-compose.yml: postgres, storage, keycloak)
  Write-Host "-> Starting backing services (postgres, storage, keycloak)"
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { Die "docker compose up failed" }

  # 6. DB init - only on a fresh setup so a re-run never wipes data; -ResetDb forces it.
  if ($freshEnv -or $ResetDb) {
    # The sample load (e2e:seed:load) goes through an API, signed in by AUTH_DEV_BYPASS. An API
    # already answering on the port is not this run's: on a fresh checkout it is someone else's, and
    # the load would land in its database. So stop before any reset, load or start.
    # Unproven twice over: edited on Linux, never parsed by PowerShell, never run.
    if ($Seed -and (& $apiUp)) {
      Die "An API is already running at $apiUrl. Stop it and run this script again, or seed by hand in the order given in e2e/README.md."
    }
    Write-Host "-> Waiting for Postgres to be ready..."
    for ($i = 0; $i -lt 30; $i++) {
      docker compose exec -T postgres pg_isready -U openldr *> $null
      if ($LASTEXITCODE -eq 0) { break }
      Start-Sleep 2
    }
    Write-Host "-> Resetting the database (pnpm openldr db reset)"
    pnpm openldr db reset
    if ($LASTEXITCODE -ne 0) { Die "db reset failed" }
    Write-Host "-> Seeding starter set (pnpm openldr db seed)"
    pnpm openldr db seed
    if ($LASTEXITCODE -ne 0) { Die "db seed failed" }
    if ($Seed) {
      $keepApi = $false
      try {
        # 1. The reset half needs no server.
        Write-Host "-> Preparing WHONET sample data (pnpm e2e:seed:reset)"
        pnpm e2e:seed:reset
        if ($LASTEXITCODE -ne 0) { Die "seed reset failed" }
        # 2. Then an API on the fresh schema, on the script's own port. One node process with no
        #    watcher, so its own handle stops all of it. PORT is set for the child only, then put back.
        $apiLog = Join-Path ([System.IO.Path]::GetTempPath()) 'openldr-dev-api.log'
        Write-Host "-> Starting the API for the sample load (node dev.mjs in apps/server on port $apiPort, log in $apiLog)"
        $oldPort = $env:PORT
        try {
          $env:PORT = "$apiPort"
          $api = Start-Process -FilePath node -ArgumentList 'dev.mjs' -WorkingDirectory (Resolve-Path apps/server).Path -PassThru -NoNewWindow -RedirectStandardOutput $apiLog -RedirectStandardError "$apiLog.err"
        } finally { $env:PORT = $oldPort }
        for ($i = 0; -not (& $apiUp); $i++) {
          if ($api.HasExited) { Die "The API stopped while starting (see $apiLog)." }
          if ($i -ge 60) { Die "The API did not answer at $apiUrl (see $apiLog)." }
          Start-Sleep 2
        }
        # 3. The load half, through that API and no other.
        Write-Host "-> Loading WHONET sample data (pnpm e2e:seed:load)"
        $oldUrl = $env:OPENLDR_URL
        try {
          $env:OPENLDR_URL = $apiUrl
          pnpm e2e:seed:load
          $loadExit = $LASTEXITCODE
        } finally { $env:OPENLDR_URL = $oldUrl }
        if ($loadExit -ne 0) { Die "seed load failed" }
        $keepApi = $true
      } finally {
        # A failed step or Ctrl+C stops only the API this script started, by its handle.
        if ($api -and -not $keepApi -and -not $api.HasExited) { $api.Kill() }
      }
    }
  } else {
    Write-Host "-> Skipping db reset (existing setup; pass -ResetDb to wipe & re-init)"
  }
}

# 7. Next steps
Write-Host ""
Write-Host "OK Dev environment ready in $repoDir"
Write-Host "Start the app in two terminals:"
Write-Host "  1) pnpm -C apps/server dev      # API on http://localhost:3000"
Write-Host "  2) pnpm -C apps/studio dev      # Studio UI on http://localhost:5173 (proxies /api)"
Write-Host "Backing services: Postgres :5433, S3 storage :9010, Keycloak :8180"
Write-Host "Auth: AUTH_DEV_BYPASS is on (loads as a dev admin). Edit .env to use real Keycloak."
# The API started for the sample load stays up, so it is not started only to be stopped. It does
# not restart on edits, and it holds port 3000, so step 1 above needs it stopped first.
if ($api -and -not $api.HasExited) {
  Write-Host "The API started for the sample data is running now as process $($api.Id) (log in $apiLog)."
  Write-Host "It does not restart on edits. Stop it before step 1, while it is still running: Stop-Process -Id $($api.Id)"
  Write-Host "A process ID is reused once its process ends, so do not use this one later."
}
