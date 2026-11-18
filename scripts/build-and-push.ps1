#!/usr/bin/env pwsh
# Build and push the OpenLDR CE images to GHCR (GitHub Container Registry) (Windows).
#   ./scripts/build-and-push.ps1 [-Registry ghcr.io/open-laboratory-data-repository] [-Tag latest] [-Platform linux/amd64] [-NoPush] [-DryRun] [-AllowOverwrite]
# Keep this in step with build-and-push.sh. The overwrite guard below is ported from it.
param(
  [string]$Registry = "ghcr.io/open-laboratory-data-repository",
  [string]$Tag = "latest",
  [string]$Platform = "linux/amd64",
  [switch]$NoPush,
  [switch]$DryRun,
  [switch]$AllowOverwrite
)
$ErrorActionPreference = "Stop"
if (-not (Test-Path package.json) -or -not (Test-Path apps)) { throw "run from the repo root" }
$Version = (Get-Content package.json -Raw | ConvertFrom-Json).version

# Refuse to overwrite a published version tag, as build-and-push.sh does. A version tag that
# silently changes content is worse than :latest, and the studio's About card reports this number.
if (-not $NoPush -and -not $AllowOverwrite -and -not $DryRun) {
  $Org = Split-Path $Registry -Leaf
  $CantCheck = {
    param($detail)
    Write-Host "ERROR: cannot check whether $Version is already published." -ForegroundColor Red
    if ($detail) { Write-Host "  $detail" -ForegroundColor Red }
    Write-Host "The guard needs gh with a token that has read:packages. Fix the token, or pass -AllowOverwrite" -ForegroundColor Red
    Write-Host "if you have confirmed by hand that this tag was never announced." -ForegroundColor Red
    exit 1
  }
  if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { & $CantCheck "gh is not installed" }
  # Native stderr must not throw here: a failed lookup is handled below, never as "free".
  $prev = $ErrorActionPreference; $ErrorActionPreference = "Continue"
  # Read EVERY version (--paginate). A published tag drops off the first page within a few releases.
  $GhOut = @(& gh api --paginate "orgs/$Org/packages/container/openldr-api/versions?per_page=100" --jq '.[].metadata.container.tags[]' 2>&1 | ForEach-Object { "$_" })
  $GhRc = $LASTEXITCODE
  $Found = $false
  if ($GhRc -ne 0) {
    # A missing package means the tag is free (first release of a new image). Anything else means
    # we do not know. GitHub also answers 404 for a package an under-scoped token cannot see, so
    # believe a 404 only if the token can list the org's container packages at all.
    $Text = $GhOut -join "`n"
    $Is404 = $Text -match '(^|[^0-9])404([^0-9]|$)|not found'
    & gh api "orgs/$Org/packages?package_type=container&per_page=1" *> $null
    $CanList = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $prev
    if (-not ($Is404 -and $CanList)) { & $CantCheck $Text }
  } else {
    $ErrorActionPreference = $prev
    # Exact, case-sensitive, whole-tag match: 0.1.10 must not read as 0.1.0.
    $Tags = @($GhOut | ForEach-Object { $_.Trim() })
    $Found = $Tags -ccontains $Version
  }
  if ($Found) {
    Write-Host "ERROR: $Registry/openldr-api:$Version is already published." -ForegroundColor Red
    Write-Host "Bump the version in package.json, or pass -AllowOverwrite if that tag was never announced." -ForegroundColor Red
    exit 1
  }
}

$Out = if ($NoPush) { "--load" } else { "--push" }

function Build-One($name, $dockerfile, $context) {
  Write-Host "--- $name ---"
  # APP_VERSION makes the running install report $Version, as build-and-push.sh does. Only
  # apps/server/Dockerfile declares the ARG; the other images ignore it.
  $args = @("buildx","build","--platform",$Platform,
            "--build-arg","APP_VERSION=$Version",
            "-t","$Registry/$name`:$Tag","-t","$Registry/$name`:$Version",
            "-f",$dockerfile,$Out,$context)
  Write-Host "+ docker $($args -join ' ')"
  if (-not $DryRun) { & docker @args }
}

Write-Host "Registry=$Registry Tag=$Tag(+$Version) Platform=$Platform NoPush=$NoPush DryRun=$DryRun AllowOverwrite=$AllowOverwrite"
Build-One "openldr-api"     "apps/server/Dockerfile" "."
Build-One "openldr-studio"  "apps/studio/Dockerfile" "."
Build-One "openldr-web"     "apps/web/Dockerfile"    "."
Build-One "openldr-gateway"  "deploy/nginx/Dockerfile"     "deploy/nginx"
Build-One "openldr-keycloak" "deploy/keycloak/Dockerfile"  "deploy/keycloak"
Write-Host "Done. Images: $Registry/openldr-{api,studio,web,gateway,keycloak}:{$Tag,$Version}"
