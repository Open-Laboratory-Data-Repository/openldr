# OpenLDR desktop app installer (Windows x64).
#   irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1 | iex
# "irm | iex" passes no options. To pass one, use the script-block form:
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1))) -Version 0.1.12
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1))) -Uninstall
# Options:
#   -Version <X.Y.Z>  install this version instead of the newest one
#   -Uninstall        remove the app; OpenLDR's data folder is left alone
#
# Environment overrides. They are for trying a package from a web folder before a release exists.
# A normal install sets none of them.
#   OPENLDR_DESKTOP_RELEASES_URL   the list of releases
#                                  (default https://api.github.com/repos/Open-Laboratory-Data-Repository/openldr/releases?per_page=30)
#   OPENLDR_DESKTOP_DOWNLOAD_BASE  where a release's files are; a file is at <base>/v<version>/<name>
#                                  (default https://github.com/Open-Laboratory-Data-Repository/openldr/releases/download)
#
# Nothing on the machine this was written on runs PowerShell. Every line of this script is not
# proven, waits for the operator.
#
# Windows PowerShell 5.1. No administrator rights: it writes only under the person's own folders
# (LOCALAPPDATA and APPDATA) and under HKCU.
#
# The whole body runs from Install-OpenLdrDesktop, called on the last line, so a download of this
# script that was cut short runs nothing. Under "irm | iex" the script runs in the person's own
# PowerShell session. So it never ends with exit, which would close their window. And it sets
# $ErrorActionPreference and $ProgressPreference only inside functions: a value set inside a
# function ends with that function, while one set at the top would stay set in their session.

param(
  [string]$Version = '',
  [switch]$Uninstall
)

# Output lines. ASCII only: -> for a step, OK for a success, ! for a warning, X for a stop.
function Write-OpenLdrStep([string]$Message) {
  Write-Host "-> $Message"
}

function Write-OpenLdrOk([string]$Message) {
  Write-Host "OK $Message" -ForegroundColor Green
}

function Write-OpenLdrWarn([string]$Message) {
  Write-Host "! $Message" -ForegroundColor Yellow
}

function Write-OpenLdrFail([string]$Message) {
  Write-Host "X $Message" -ForegroundColor Red
}

# The machine's own processor type. A 32-bit PowerShell on 64-bit Windows sees x86 in
# PROCESSOR_ARCHITECTURE, and the real type in PROCESSOR_ARCHITEW6432.
function Get-OpenLdrArchitecture {
  if ($env:PROCESSOR_ARCHITEW6432) {
    return $env:PROCESSOR_ARCHITEW6432
  }
  return $env:PROCESSOR_ARCHITECTURE
}

# GitHub takes TLS 1.2 or later. An older Windows 10 may hand PowerShell 5.1 a fixed list of
# protocols without it. Then TLS 1.2 is added to that list. A value of 0 means Windows picks
# (.NET 4.7 and later), and TLS 1.2 is already in what it picks, so 0 is left as it is. This
# setting belongs to the session, so it stays after the script ends. It only ever adds TLS 1.2.
function Enable-OpenLdrTls12 {
  $tls12 = 3072
  $protocols = [int][System.Net.ServicePointManager]::SecurityProtocol
  if (($protocols -ne 0) -and (($protocols -band $tls12) -eq 0)) {
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
  }
}

# The version becomes part of a URL and a file name, so it must look like one: 0.1.12, or
# 0.1.12-rc.1. The same rule as install/desktop.sh.
function Test-OpenLdrVersionText([string]$Text) {
  return ($Text -cmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$')
}

# The newest release with a Windows package. Releases come newest first, so the first asset name
# that matches wins. The pattern takes strictly three numbers, so a release tagged with anything
# after them is passed over.
function Find-OpenLdrVersion([string]$ReleasesUrl) {
  $pattern = '^openldr-desktop-(\d+\.\d+\.\d+)-win32-x64\.zip$'
  try {
    # Assigned to a variable, not piped on: Invoke-RestMethod in 5.1 hands a JSON array on as
    # one object, and a foreach over the variable walks the array either way.
    $releases = Invoke-RestMethod -Uri $ReleasesUrl -UseBasicParsing
  } catch {
    throw 'Could not read the list of OpenLDR releases. Try again in a few minutes, or pass -Version <X.Y.Z>.'
  }
  foreach ($release in $releases) {
    foreach ($asset in $release.assets) {
      $found = [regex]::Match([string]$asset.name, $pattern)
      if ($found.Success) {
        return $found.Groups[1].Value
      }
    }
  }
  throw 'No OpenLDR release has a desktop package for win32-x64 yet.'
}

# Downloads one file. -UseBasicParsing, because Windows PowerShell 5.1 otherwise needs Internet
# Explorer's engine to read the reply.
function Save-OpenLdrFile([string]$Url, [string]$OutFile) {
  try {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
  } catch {
    throw "Could not download $Url. Check the version and the connection, then run this again."
  }
}

# Bytes free on the disk that holds Path, or -1 when that cannot be told (a network path, say).
function Get-OpenLdrFreeBytes([string]$Path) {
  try {
    $root = [System.IO.Path]::GetPathRoot($Path)
    $drive = New-Object System.IO.DriveInfo -ArgumentList $root
    return [int64]$drive.AvailableFreeSpace
  } catch {
    return -1
  }
}

# Stops unless SHA256SUMS has a line for the zip and the zip's SHA-256 is that value. A line is
# "<hex>  <name>" or "<hex> *<name>". Get-FileHash gives upper case hex and the file gives lower
# case, so the case is ignored.
function Assert-OpenLdrChecksum([string]$Zip, [string]$Sums, [string]$Name) {
  $want = ''
  $lines = @(Get-Content -LiteralPath $Sums)
  foreach ($line in $lines) {
    $parts = $line.Trim() -split '\s+', 2
    if ($parts.Count -eq 2 -and ($parts[1] -ceq $Name -or $parts[1] -ceq "*$Name")) {
      $want = $parts[0]
      break
    }
  }
  $got = (Get-FileHash -LiteralPath $Zip -Algorithm SHA256).Hash
  if (-not $want -or $want -ine $got) {
    throw 'The download does not match its checksum. Nothing was installed.'
  }
}

# True when the installed copy's own status command says OpenLDR runs. It exits 0 when OpenLDR
# runs and 3 when it does not.
function Test-OpenLdrStatus([string]$Command) {
  # In 5.1 a native command that writes to standard error under 'Stop' can throw. So this one call
  # runs under 'Continue', with all of its output dropped, and its exit code decides.
  $ErrorActionPreference = 'Continue'
  & $Command status *> $null
  return ($LASTEXITCODE -eq 0)
}

# True when OpenLDR runs from the installed copy: its own status says so, or a process runs from
# a file inside the app folder. That also catches a Postgres left running by that copy.
function Test-OpenLdrRunning([string]$Target) {
  $command = "$Target\openldr-standalone.cmd"
  if ((Test-Path -LiteralPath $command -PathType Leaf) -and (Test-OpenLdrStatus $command)) {
    return $true
  }
  $prefix = $Target.TrimEnd('\') + '\'
  foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
    # Path is empty, or throws, for a process this user may not read. Those are not this copy.
    $path = $null
    try {
      $path = $process.Path
    } catch {
      $path = $null
    }
    if ($path -and $path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $true
    }
  }
  return $false
}

# Stops unless Path is one of the paths in Owned. Owned is the short list the install function
# builds: the app folder, its .new, .old and .download siblings, the unpacked folder, the
# shortcut, and the app's own folder. The data folder is never in it, and a path that is the data
# folder or holds it also stops.
function Assert-OpenLdrOwned([string]$Path, [string[]]$Owned, [string]$DataDir) {
  if ([string]::IsNullOrEmpty($Path)) {
    throw 'Refusing to touch an empty path. This is a bug in the installer.'
  }
  $isOwned = $false
  foreach ($one in $Owned) {
    if ($one -and ($Path -ieq $one)) {
      $isOwned = $true
    }
  }
  $plain = $Path.TrimEnd('\')
  $data = $DataDir.TrimEnd('\')
  $holdsData = ($data -ieq $plain) -or $data.StartsWith($plain + '\', [System.StringComparison]::OrdinalIgnoreCase)
  if (-not $isOwned -or $holdsData) {
    throw "Refusing to touch $Path. It is not a path this installer owns. This is a bug in the installer."
  }
}

# Removes a folder or file this script owns. A path that is not there is left alone.
function Remove-OpenLdrPath([string]$Path, [string[]]$Owned, [string]$DataDir) {
  Assert-OpenLdrOwned $Path $Owned $DataDir
  if (Test-Path -LiteralPath $Path) {
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

# Moves a folder this script owns to another path it owns, on the same disk. .NET's
# Directory.Move takes both paths as they are, with no wildcards, and fails if the destination
# exists. Move-Item would instead move a folder into an existing one, and in 5.1 it cannot move a
# folder to another disk. That is why the download folder sits beside the app folder, not in TEMP.
function Move-OpenLdrPath([string]$From, [string]$To, [string[]]$Owned, [string]$DataDir) {
  Assert-OpenLdrOwned $From $Owned $DataDir
  Assert-OpenLdrOwned $To $Owned $DataDir
  if (Test-Path -LiteralPath $To) {
    throw "Refusing to move $From onto $To, which exists. This is a bug in the installer."
  }
  [System.IO.Directory]::Move($From, $To)
}

# Unpacks the zip into the new folder Into. Windows' own tar.exe, in Windows 10 1803 and later,
# is much faster than Expand-Archive on a zip of several hundred megabytes. It is called by its
# full path, because a tar found first on PATH may be GNU tar from Git for Windows, which cannot
# read a zip.
function Expand-OpenLdrArchive([string]$Zip, [string]$Into) {
  $name = [System.IO.Path]::GetFileName($Zip)
  [System.IO.Directory]::CreateDirectory($Into) | Out-Null
  $tar = "$env:SystemRoot\System32\tar.exe"
  if (Test-Path -LiteralPath $tar -PathType Leaf) {
    # In 5.1 a line tar writes to standard error under 'Stop' can throw. Its exit code decides.
    $ErrorActionPreference = 'Continue'
    & $tar -xf $Zip -C $Into
    if ($LASTEXITCODE -ne 0) {
      throw "Could not unpack $name. Nothing was installed."
    }
  } else {
    try {
      Expand-Archive -LiteralPath $Zip -DestinationPath $Into -Force
    } catch {
      throw "Could not unpack $name. Nothing was installed."
    }
  }
}

# The Start menu shortcut, made with the WScript.Shell COM object, which is part of Windows.
function New-OpenLdrShortcut([string]$Path, [string]$Exe, [string]$Icon) {
  [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($Path)) | Out-Null
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($Path)
  $link.TargetPath = $Exe
  $link.WorkingDirectory = [System.IO.Path]::GetDirectoryName($Exe)
  $link.IconLocation = "$Icon,0"
  $link.Description = 'OpenLDR'
  $link.Save()
}

# Removes every value under HKCU:\Software\Microsoft\Windows\CurrentVersion\Run whose data names
# the installed OpenLDR.exe. That value is the app's "start when I sign in" entry. It is matched
# by its data, not its name, because Electron chooses the name. The .NET registry calls take the
# name as it is; Remove-ItemProperty would read wildcards in it. Returns how many it removed.
function Remove-OpenLdrRunValues([string]$Exe) {
  $removed = 0
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Run', $true)
  if ($null -eq $key) {
    return $removed
  }
  try {
    foreach ($name in $key.GetValueNames()) {
      $data = [string]$key.GetValue($name)
      if ($data.IndexOf($Exe, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $key.DeleteValue($name)
        Write-OpenLdrStep "Removed the sign-in entry '$name' from HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
        $removed++
      }
    }
  } finally {
    $key.Close()
  }
  return $removed
}

# -Uninstall: removes the app, what earlier runs left beside it, the shortcut, the app's own
# folder and its sign-in entry. The data folder is left alone.
function Uninstall-OpenLdrDesktop([string]$Target, [string[]]$Remove, [string[]]$Owned, [string]$DataDir) {
  if ((Test-Path -LiteralPath $Target) -and (Test-OpenLdrRunning $Target)) {
    throw 'OpenLDR is running. Quit it from its tray icon, then run this again.'
  }
  $found = $false
  foreach ($path in $Remove) {
    if (Test-Path -LiteralPath $path) {
      Remove-OpenLdrPath $path $Owned $DataDir
      Write-OpenLdrStep "Removed $path"
      $found = $true
    }
  }
  if ((Remove-OpenLdrRunValues "$Target\OpenLDR.exe") -gt 0) {
    $found = $true
  }
  if ($found) {
    Write-OpenLdrOk 'The OpenLDR desktop app is removed.'
  } else {
    Write-OpenLdrStep 'The OpenLDR desktop app is not installed here. There was nothing to remove.'
  }
  Write-Host "  Your data was left alone. It is in $DataDir"
}

function Install-OpenLdrDesktop {
  param([string]$Version, [switch]$Uninstall)
  $ErrorActionPreference = 'Stop'
  # Invoke-WebRequest drawing its progress bar is many times slower on a large file.
  $ProgressPreference = 'SilentlyContinue'
  Enable-OpenLdrTls12

  $releasesUrl = $env:OPENLDR_DESKTOP_RELEASES_URL
  if (-not $releasesUrl) {
    $releasesUrl = 'https://api.github.com/repos/Open-Laboratory-Data-Repository/openldr/releases?per_page=30'
  }
  $downloadBase = $env:OPENLDR_DESKTOP_DOWNLOAD_BASE
  if (-not $downloadBase) {
    $downloadBase = 'https://github.com/Open-Laboratory-Data-Repository/openldr/releases/download'
  }

  if ($Version.StartsWith('v')) {
    $Version = $Version.Substring(1)
  }
  if ($Version -and -not (Test-OpenLdrVersionText $Version)) {
    Write-OpenLdrFail "-Version takes a version such as 0.1.12, not $Version"
    return
  }

  # Every path this script writes or removes is built from these two, so both must be set.
  if (-not $env:LOCALAPPDATA -or -not $env:APPDATA) {
    Write-OpenLdrFail 'LOCALAPPDATA or APPDATA is not set. Run this from a normal PowerShell window.'
    return
  }

  $arch = Get-OpenLdrArchitecture
  if ((-not $Uninstall) -and ($arch -ne 'AMD64')) {
    Write-OpenLdrFail "There is no OpenLDR desktop package for Windows $arch. Packages exist for Linux x64, macOS on Apple silicon and Windows x64."
    return
  }

  $parent = "$env:LOCALAPPDATA\Programs"
  $target = "$env:LOCALAPPDATA\Programs\OpenLDR"
  $new = "$target.new"
  $old = "$target.old"
  $dl = "$target.download"
  $unpacked = "$dl\unpack\OpenLDR"
  $exe = "$target\OpenLDR.exe"
  $command = "$target\openldr-standalone.cmd"
  $icon = "$target\resources\app\apps\desktop\assets\icon.ico"
  $shortcut = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\OpenLDR.lnk"
  # Electron's own folder for the app.
  $appDir = "$env:APPDATA\OpenLDR Desktop"
  # The same folder resolveDataDir in apps/standalone/src/state.ts picks on Windows.
  $dataDir = "$env:LOCALAPPDATA\OpenLDR"
  if ($env:OPENLDR_HOME) {
    $dataDir = $env:OPENLDR_HOME
  }
  $owned = @($target, $new, $old, $dl, $unpacked, $shortcut, $appDir)

  # Set once this run has made the download folder. A stop after that removes what this run made.
  $cleanup = $false
  try {
    # A swap from an earlier run that died half way: the older copy is at .old and nothing is at
    # the app folder. Put it back before anything else.
    if ((Test-Path -LiteralPath $old) -and -not (Test-Path -LiteralPath $target)) {
      Move-OpenLdrPath $old $target $owned $dataDir
      Write-OpenLdrStep "Put back the copy an earlier run left at $old"
    } elseif (Test-Path -LiteralPath $old) {
      Remove-OpenLdrPath $old $owned $dataDir
    }

    if ($Uninstall) {
      Uninstall-OpenLdrDesktop $target @($target, $old, $new, $dl, $shortcut, $appDir) $owned $dataDir
      return
    }

    # 1. The version.
    if (-not $Version) {
      Write-OpenLdrStep 'Looking for the newest OpenLDR release with a desktop package for win32-x64'
      $Version = Find-OpenLdrVersion $releasesUrl
    }
    $archive = "openldr-desktop-${Version}-win32-x64.zip"
    $url = "$downloadBase/v$Version"

    # 2. Room for the download, beside the app folder. A leftover download folder is removed
    # first, so its space counts as free.
    [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    Remove-OpenLdrPath $dl $owned $dataDir
    $free = Get-OpenLdrFreeBytes $parent
    if ($free -lt 0) {
      Write-OpenLdrWarn "Could not tell how much disk space is free in $parent. Going on."
    } elseif ($free -lt 2GB) {
      throw "Only $([math]::Floor($free / 1MB)) MB is free on the disk that holds $parent. OpenLDR needs 2 GB free to install. Free some space, then run this again."
    }

    # 3. Download and check. Nothing is unpacked before the checksum matches.
    $cleanup = $true
    [System.IO.Directory]::CreateDirectory($dl) | Out-Null
    $zip = "$dl\$archive"
    $sums = "$dl\SHA256SUMS"
    Write-OpenLdrStep "Downloading OpenLDR $Version for win32-x64. It is several hundred megabytes, so this may take some minutes."
    Save-OpenLdrFile "$url/$archive" $zip
    Save-OpenLdrFile "$url/SHA256SUMS" $sums
    Assert-OpenLdrChecksum $zip $sums $archive
    Write-OpenLdrOk 'The download matches its checksum'

    # 4. Never replace a copy OpenLDR is running from.
    if ((Test-Path -LiteralPath $target) -and (Test-OpenLdrRunning $target)) {
      throw 'OpenLDR is running. Quit it from its tray icon, then run this again.'
    }

    # 5. Unpack inside the download folder, then move the one top folder to .new.
    Remove-OpenLdrPath $new $owned $dataDir
    Expand-OpenLdrArchive $zip "$dl\unpack"
    if (-not (Test-Path -LiteralPath $unpacked -PathType Container)) {
      throw 'The package holds no OpenLDR folder. Nothing was installed.'
    }
    Move-OpenLdrPath $unpacked $new $owned $dataDir

    # 6. Swap the new copy in. If the second move fails, the older copy is put back.
    if (Test-Path -LiteralPath $target) {
      try {
        Move-OpenLdrPath $target $old $owned $dataDir
      } catch {
        throw 'Could not move the older copy aside. Nothing was changed.'
      }
      try {
        Move-OpenLdrPath $new $target $owned $dataDir
      } catch {
        Move-OpenLdrPath $old $target $owned $dataDir
        throw 'Could not move the new copy into place. The older copy was put back.'
      }
      Remove-OpenLdrPath $old $owned $dataDir
    } else {
      try {
        Move-OpenLdrPath $new $target $owned $dataDir
      } catch {
        throw 'Could not move the new copy into place.'
      }
    }
    Remove-OpenLdrPath $dl $owned $dataDir
    $cleanup = $false

    # 7. The Start menu shortcut. The app is in place by now, so a failure here is a warning.
    $inMenu = $true
    try {
      New-OpenLdrShortcut $shortcut $exe $icon
    } catch {
      $inMenu = $false
      Write-OpenLdrWarn "Could not make the Start menu shortcut $shortcut."
    }

    # 8. Where everything is. No PATH is changed.
    Write-OpenLdrOk "OpenLDR $Version is installed in $target"
    if ($inMenu) {
      Write-Host "  Start it from the Start menu (OpenLDR), or run: `"$exe`""
    } else {
      Write-Host "  Start it by running: `"$exe`""
    }
    Write-Host "  The command line tool: $command"
    Write-Host '  It was not added to your PATH. Run it by its full path.'
    Write-Host "  Your data is in $dataDir. This installer never changes it."
  } catch {
    $message = $_.Exception.Message
    # Remove what this run made. The app folder itself is never removed here.
    if ($cleanup) {
      foreach ($path in @($new, $dl)) {
        try {
          Remove-OpenLdrPath $path $owned $dataDir
        } catch {
          Write-OpenLdrWarn "Could not remove $path. Remove it by hand."
        }
      }
    }
    Write-OpenLdrFail $message
    return
  }
}

Install-OpenLdrDesktop -Version $Version -Uninstall:$Uninstall
