# Resolve-OpenLdrVersion <url> - return the version from a latest.json, or $null.
# Dot-sourced by install/install.ps1. Returns $null on every failure; the caller decides
# what to say, and it must NOT fall back to `latest`.
function Resolve-OpenLdrVersion {
  param([Parameter(Mandatory = $true)][string]$Url)
  try {
    $manifest = Invoke-RestMethod -Uri $Url -TimeoutSec 20
  } catch {
    return $null
  }
  if ($manifest.version -match '^\d+\.\d+\.\d+$') { return $manifest.version }
  return $null
}
