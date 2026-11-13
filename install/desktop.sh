#!/usr/bin/env sh
# OpenLDR desktop app installer (Linux x64, macOS on Apple silicon).
#   curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.sh | bash
# Options, passed as `| bash -s -- <options>`:
#   --version <X.Y.Z>  install this version instead of the newest one
#   --uninstall        remove the app; OpenLDR's data folder is left alone
#
# Environment overrides. They are for the tests, and for trying a package from a folder before a
# release exists. A normal install sets none of them.
#   OPENLDR_DESKTOP_RELEASES_URL   the list of releases
#                                  (default https://api.github.com/repos/Open-Laboratory-Data-Repository/openldr/releases?per_page=30)
#   OPENLDR_DESKTOP_DOWNLOAD_BASE  where a release's files are; a file is at <base>/v<version>/<name>
#                                  (default https://github.com/Open-Laboratory-Data-Repository/openldr/releases/download)
#   OPENLDR_DESKTOP_USERNS_FILE    (default /proc/sys/kernel/apparmor_restrict_unprivileged_userns)
#   OPENLDR_DESKTOP_APPARMOR_DIR   (default /etc/apparmor.d)
#
# Only Linux is proven. Everything on the macOS path is not proven, waits for the operator.
#
# The whole body runs from main, called on the last line, so a download of this script that was
# cut short runs nothing.
set -eu

err() { echo "✗ $1" >&2; exit 1; }
warn() { echo "⚠ $1" >&2; }

# Removes a folder or file this script owns. Every path comes from HOME (or XDG_CONFIG_HOME), so an
# empty path, /, or a path outside those stops the script instead of removing it.
remove() {
  case ${1-} in
    ''|/) err "Refusing to remove '${1-}'. This is a bug in the installer." ;;
  esac
  case $1 in
    "$HOME"/?*) ;;
    "$CONFIG_HOME"/?*) ;;
    *) err "Refusing to remove $1: it is not in $HOME. This is a bug in the installer." ;;
  esac
  rm -rf -- "$1"
}

# A path as an Exec value in a desktop entry: quoted, with " ` $ and \ taking a backslash, then
# every backslash doubled and % written %%. The same rule as apps/desktop/src/autostart.ts.
desktop_exec() {
  quoted=$(printf '%s' "$1" | sed 's/[\\"`$]/\\&/g')
  printf '"%s"' "$quoted" | sed 's/\\/\\\\/g; s/%/%%/g'
}

# 0 when OpenLDR runs from the installed copy: its own status says so, or a process holds a path
# inside the app folder (which also catches a Postgres left running by that copy).
is_running() {
  if [ -x "$CMD" ] && "$CMD" status </dev/null >/dev/null 2>&1; then
    return 0
  fi
  real_target=$(CDPATH='' cd -P -- "$TARGET" 2>/dev/null && pwd -P) || real_target=$TARGET
  if ps -A -ww -o args= 2>/dev/null | grep -F -e "$TARGET/" -e "$real_target/" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

find_apparmor_parser() {
  apparmor_parser=$(command -v apparmor_parser 2>/dev/null) || apparmor_parser=''
  for d in /usr/sbin /sbin; do
    if [ -z "$apparmor_parser" ] && [ -x "$d/apparmor_parser" ]; then apparmor_parser="$d/apparmor_parser"; fi
  done
}

tmp_profile=''
cleanup_tmp() {
  if [ -n "$tmp_profile" ]; then rm -f -- "$tmp_profile"; fi
}

checksum_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    return 1
  fi
}

download() {
  if [ -t 2 ]; then
    curl -fL --progress-bar -o "$2" "$1"
  else
    curl -fsSL -o "$2" "$1"
  fi
}

# Stops the install after the unpack: removes what this run made and leaves an older copy alone.
abandon() {
  remove "$NEW"
  remove "$DL"
  err "$1"
}

uninstall() {
  if [ -e "$TARGET" ] && is_running; then
    err "OpenLDR is running. Quit it from its tray icon, then run this again."
  fi
  found=0
  for p in "$TARGET" "$TARGET.old" "$TARGET.new" "$DL" "$MENU" "$APP_DIR" "$AUTOSTART_FILE" "$AUTOSTART_FILE_XDG"; do
    if [ -e "$p" ] || [ -h "$p" ]; then
      remove "$p"
      echo "→ Removed $p"
      found=1
    fi
  done
  link="$HOME/.local/bin/openldr-standalone"
  if [ -h "$link" ]; then
    case $(readlink -- "$link" 2>/dev/null) in
      "$TARGET"/*)
        rm -f -- "$link"
        echo "→ Removed $link"
        found=1
        ;;
    esac
  fi
  if [ "$OS" = linux ] && [ -e "$profile_file" ]; then
    found=1
    echo "→ Removing the AppArmor profile $profile_file needs the administrator password."
    find_apparmor_parser
    if [ -z "$apparmor_parser" ]; then
      warn "apparmor_parser was not found, so the profile $profile_file was not unloaded."
    elif ! sudo "$apparmor_parser" -R "$profile_file"; then
      warn "The AppArmor profile $profile_file was not unloaded."
    fi
    if ! sudo rm -f "$profile_file"; then
      warn "The AppArmor profile $profile_file was not removed. Remove it with: sudo rm $profile_file"
    fi
  fi
  if [ "$found" = 0 ]; then
    echo "→ The OpenLDR desktop app is not installed here. There was nothing to remove."
  else
    echo "✓ The OpenLDR desktop app is removed."
  fi
  if [ "$OS" = macos ]; then
    echo "  If you set OpenLDR to start when you sign in, remove it from the login items in System Settings."
  fi
  echo "  Your data was left alone. It is in $DATA_DIR"
}

main() {
  VERSION=''
  UNINSTALL=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --version)
        if [ $# -lt 2 ]; then echo "--version needs a version, such as 0.1.12" >&2; exit 2; fi
        VERSION=${2#v}
        shift 2
        ;;
      --uninstall) UNINSTALL=1; shift ;;
      *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
  done
  # The version becomes part of a URL and a file name, so it must look like one.
  if [ -n "$VERSION" ] && ! printf '%s\n' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'; then
    echo "--version takes a version such as 0.1.12, not $VERSION" >&2
    exit 2
  fi

  RELEASES_URL=${OPENLDR_DESKTOP_RELEASES_URL:-https://api.github.com/repos/Open-Laboratory-Data-Repository/openldr/releases?per_page=30}
  DOWNLOAD_BASE=${OPENLDR_DESKTOP_DOWNLOAD_BASE:-https://github.com/Open-Laboratory-Data-Repository/openldr/releases/download}
  USERNS_FILE=${OPENLDR_DESKTOP_USERNS_FILE:-/proc/sys/kernel/apparmor_restrict_unprivileged_userns}
  APPARMOR_DIR=${OPENLDR_DESKTOP_APPARMOR_DIR:-/etc/apparmor.d}

  # Every path this script writes or removes is built from HOME, so HOME must be a real folder.
  case ${HOME-} in
    /?*) ;;
    *) err "HOME is not set to a folder. Set HOME, then run this again." ;;
  esac
  while [ "${HOME%/}" != "$HOME" ]; do HOME=${HOME%/}; done
  [ -d "$HOME" ] || err "The home folder $HOME does not exist."

  # Electron keeps the app's own folder under XDG_CONFIG_HOME when that is set. A relative value is
  # not valid there and is ignored.
  case ${XDG_CONFIG_HOME-} in
    /?*) CONFIG_HOME=${XDG_CONFIG_HOME%/} ;;
    *) CONFIG_HOME="$HOME/.config" ;;
  esac

  os_name=$(uname -s 2>/dev/null || echo unknown)
  machine=$(uname -m 2>/dev/null || echo unknown)
  case $os_name in
    Linux) OS=linux ;;
    Darwin) OS=macos ;;
    *) OS=other ;;
  esac
  case "$os_name $machine" in
    "Linux x86_64") SYS=linux-x64 ;;
    "Darwin arm64") SYS=darwin-arm64 ;;
    *) SYS='' ;;
  esac
  if [ -z "$SYS" ] && { [ "$UNINSTALL" = 0 ] || [ "$OS" = other ]; }; then
    err "There is no OpenLDR desktop package for $os_name $machine. Packages exist for Linux x64, macOS on Apple silicon and Windows x64."
  fi

  if [ "$OS" = linux ]; then
    PARENT="$HOME/.local/share"
    TARGET="$PARENT/openldr-desktop"
    DL="$PARENT/openldr-desktop.download"
    TOP=openldr-desktop
    BIN="$TARGET/openldr-desktop"
    CMD="$TARGET/openldr-standalone"
    MENU="$HOME/.local/share/applications/openldr.desktop"
    APP_DIR="$CONFIG_HOME/OpenLDR Desktop"
    # The app writes its start-at-sign-in file under ~/.config/autostart. A set XDG_CONFIG_HOME is
    # where the desktop looks, so both places are cleared on --uninstall.
    AUTOSTART_FILE="$HOME/.config/autostart/openldr-desktop.desktop"
    AUTOSTART_FILE_XDG=''
    if [ "$CONFIG_HOME" != "$HOME/.config" ]; then
      AUTOSTART_FILE_XDG="$CONFIG_HOME/autostart/openldr-desktop.desktop"
    fi
    # The same folder resolveDataDir in apps/standalone/src/state.ts picks.
    case ${XDG_DATA_HOME-} in
      /?*) DATA_DIR="${XDG_DATA_HOME%/}/openldr" ;;
      *) DATA_DIR="$HOME/.local/share/openldr" ;;
    esac
  else
    PARENT="$HOME/Applications"
    TARGET="$PARENT/OpenLDR.app"
    DL="$PARENT/.OpenLDR.download"
    TOP=OpenLDR.app
    BIN="$TARGET/Contents/MacOS/Electron"
    CMD="$TARGET/Contents/Resources/openldr-standalone"
    MENU=''
    APP_DIR="$HOME/Library/Application Support/OpenLDR Desktop"
    AUTOSTART_FILE=''
    AUTOSTART_FILE_XDG=''
    DATA_DIR="$HOME/Library/Application Support/OpenLDR"
  fi
  if [ -n "${OPENLDR_HOME-}" ]; then DATA_DIR=$OPENLDR_HOME; fi
  NEW="$TARGET.new"
  OLD="$TARGET.old"
  uid=$(id -u)
  profile_file="$APPARMOR_DIR/openldr-desktop-$uid"

  # A swap from an earlier run that died half way: the older copy is at .old and nothing is at the
  # target. Put it back before anything else.
  if [ -e "$OLD" ] && [ ! -e "$TARGET" ]; then
    mv -- "$OLD" "$TARGET"
    echo "→ Put back the copy an earlier run left at $OLD"
  elif [ -e "$OLD" ]; then
    remove "$OLD"
  fi

  if [ "$UNINSTALL" = 1 ]; then
    uninstall
    return 0
  fi

  # 1. The version.
  ARCHIVE_RE="openldr-desktop-[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*-$SYS\.tar\.gz"
  if [ -z "$VERSION" ]; then
    echo "→ Looking for the newest OpenLDR release with a desktop package for $SYS"
    releases=$(curl -fsSL "$RELEASES_URL" 2>/dev/null) ||
      err "Could not read the list of OpenLDR releases. Try again in a few minutes, or pass --version <X.Y.Z>."
    # No jq: break the text at every , and { so each "name" starts a line, whether the list came
    # pretty-printed or on one line. Releases come newest first, so the first match wins. A "name"
    # inside a release's text is escaped (\"name\") and never starts a line.
    name=$(printf '%s\n' "$releases" | tr ',{' '\n\n' |
      sed -n 's/^[[:space:]]*"name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*$/\1/p' |
      grep -x "$ARCHIVE_RE" | head -n 1) || name=''
    [ -n "$name" ] || err "No OpenLDR release has a desktop package for $SYS yet."
    VERSION=$(printf '%s\n' "$name" | sed "s/^openldr-desktop-\(.*\)-$SYS\.tar\.gz\$/\1/")
  fi
  ARCHIVE="openldr-desktop-$VERSION-$SYS.tar.gz"
  URL="$DOWNLOAD_BASE/v$VERSION"

  # 2. Room for the download, beside the target. A leftover download folder is removed first, so
  # its space counts as free.
  mkdir -p -- "$PARENT"
  if [ -e "$DL" ]; then remove "$DL"; fi
  free_kb=$(df -Pk -- "$PARENT" 2>/dev/null | awk 'NR == 2 {print $4}') || free_kb=''
  case $free_kb in
    ''|*[!0-9]*) warn "Could not tell how much disk space is free in $PARENT. Going on." ;;
    *)
      if [ "$free_kb" -lt 2097152 ]; then
        err "Only $((free_kb / 1024)) MB is free on the disk that holds $PARENT. OpenLDR needs 2 GB free to install. Free some space, then run this again."
      fi
      ;;
  esac

  # 3. Download and check.
  mkdir -- "$DL"
  echo "→ Downloading OpenLDR $VERSION for $SYS"
  if ! download "$URL/$ARCHIVE" "$DL/$ARCHIVE"; then
    remove "$DL"
    err "Could not download $URL/$ARCHIVE. Check the version and the connection, then run this again."
  fi
  if ! download "$URL/SHA256SUMS" "$DL/SHA256SUMS"; then
    remove "$DL"
    err "Could not download $URL/SHA256SUMS. Check the connection, then run this again."
  fi
  want=$(awk -v n="$ARCHIVE" '$2 == n || $2 == "*" n {print $1; exit}' "$DL/SHA256SUMS" | tr 'A-F' 'a-f')
  got=$(checksum_of "$DL/$ARCHIVE") || { remove "$DL"; err "Neither sha256sum nor shasum is installed, so the download cannot be checked. Nothing was installed."; }
  if [ -z "$want" ] || [ "$want" != "$got" ]; then
    remove "$DL"
    err "The download does not match its checksum. Nothing was installed."
  fi
  echo "✓ The download matches its checksum"

  # 4. Never replace a copy OpenLDR is running from.
  if [ -e "$TARGET" ] && is_running; then
    remove "$DL"
    err "OpenLDR is running. Quit it from its tray icon, then run this again."
  fi

  # 5. Unpack beside the target, then move the one top folder to .new.
  if [ -e "$NEW" ]; then remove "$NEW"; fi
  mkdir -- "$DL/unpack"
  if ! tar -xzf "$DL/$ARCHIVE" -C "$DL/unpack"; then
    abandon "Could not unpack $ARCHIVE. Nothing was installed."
  fi
  [ -d "$DL/unpack/$TOP" ] || abandon "The package holds no $TOP folder. Nothing was installed."
  mv -- "$DL/unpack/$TOP" "$NEW"

  # 6. Linux: an AppArmor profile, where the system will not let an app start its sandbox without one.
  if [ "$OS" = linux ]; then
    userns=''
    if [ -r "$USERNS_FILE" ]; then userns=$(tr -d ' \n' < "$USERNS_FILE") || userns=''; fi
    if [ "$userns" = 1 ]; then
      # AppArmor matches the real path, so a home folder that is a link is followed here.
      real_home=$(CDPATH='' cd -P -- "$HOME" && pwd -P)
      trap cleanup_tmp EXIT
      tmp_profile=$(mktemp "${TMPDIR:-/tmp}/openldr-desktop-profile.XXXXXX")
      {
        echo 'abi <abi/4.0>,'
        echo 'include <tunables/global>'
        echo ''
        echo "profile openldr-desktop-$uid \"$real_home/.local/share/openldr-desktop/openldr-desktop\" flags=(unconfined) {"
        echo '  userns,'
        echo ''
        echo "  include if exists <local/openldr-desktop-$uid>"
        echo '}'
      } > "$tmp_profile"
      if [ -f "$profile_file" ] && cmp -s "$tmp_profile" "$profile_file"; then
        :
      else
        echo "→ This system does not let an app start its sandbox without an AppArmor profile."
        echo "→ This script will install a small profile for OpenLDR at $profile_file with sudo, which asks for the administrator password once."
        find_apparmor_parser
        # Load first, then write: a profile that fails to load is never left on disk.
        if [ -z "$apparmor_parser" ] ||
          ! sudo "$apparmor_parser" -r "$tmp_profile" ||
          ! sudo install -m 0644 "$tmp_profile" "$profile_file"; then
          abandon "The sandbox profile was not installed, so OpenLDR was not installed."
        fi
        echo "✓ Installed the AppArmor profile $profile_file"
      fi
    fi
  fi

  # 7. macOS: an ad-hoc signature, inside out. --deep does not reach the Postgres files under
  # Contents/Resources. Not proven, waits for the operator.
  if [ "$OS" = macos ]; then
    if command -v codesign >/dev/null 2>&1; then
      pg="$NEW/Contents/Resources/app/apps/standalone/node_modules/@embedded-postgres/darwin-arm64/native"
      for f in "$pg"/bin/* "$pg"/lib/*; do
        if [ -f "$f" ] && [ ! -h "$f" ]; then
          codesign --force --sign - "$f" >/dev/null 2>&1 || warn "Could not sign ${f#"$NEW"/}. macOS may refuse to run it."
        fi
      done
      codesign --force --deep --sign - "$NEW" >/dev/null 2>&1 || warn "Could not sign OpenLDR.app. macOS may refuse to open it."
    else
      warn "codesign was not found, so OpenLDR.app was not signed. macOS may refuse to open it."
    fi
  fi

  # 8. Swap the new copy in.
  if [ -e "$TARGET" ]; then
    mv -- "$TARGET" "$OLD" || abandon "Could not move the older copy aside. Nothing was changed."
    if ! mv -- "$NEW" "$TARGET"; then
      mv -- "$OLD" "$TARGET"
      abandon "Could not move the new copy into place. The older copy was put back."
    fi
    remove "$OLD"
  else
    mv -- "$NEW" "$TARGET" || abandon "Could not move the new copy into place."
  fi
  remove "$DL"

  # 9. Linux: the menu entry.
  if [ "$OS" = linux ]; then
    mkdir -p -- "$(dirname -- "$MENU")"
    {
      echo '[Desktop Entry]'
      echo 'Type=Application'
      echo 'Name=OpenLDR'
      echo 'Comment=Laboratory data repository'
      echo "Exec=$(desktop_exec "$BIN")"
      echo "Icon=$TARGET/resources/app/apps/desktop/assets/icon.png"
      echo 'Terminal=false'
      echo 'Categories=Science;MedicalSoftware;'
    } > "$MENU"
    if command -v update-desktop-database >/dev/null 2>&1; then
      update-desktop-database "$(dirname -- "$MENU")" >/dev/null 2>&1 || true
    fi
  fi

  # 10. The command, linked into ~/.local/bin when that folder is on PATH. A real file is never replaced.
  bin_dir="$HOME/.local/bin"
  link="$bin_dir/openldr-standalone"
  linked=''
  if [ -d "$bin_dir" ]; then
    case ":$PATH:" in
      *":$bin_dir:"*|*":$bin_dir/:"*)
        if [ -h "$link" ] || [ ! -e "$link" ]; then
          rm -f -- "$link"
          ln -s -- "$CMD" "$link"
          linked=1
        else
          warn "$link is a file, not a link, so it was left alone."
        fi
        ;;
    esac
  fi

  # 11. Where everything is.
  echo "✓ OpenLDR $VERSION is installed in $TARGET"
  if [ "$OS" = linux ]; then
    echo "  Start it from the applications menu (OpenLDR), or run: \"$BIN\""
  else
    echo "  Start it from Launchpad, or open $TARGET in Finder."
  fi
  echo "  The command line tool: $CMD"
  if [ -n "$linked" ]; then
    echo "  It is linked as $link, so \"openldr-standalone\" works in a new terminal."
  else
    echo "  It was not linked into a folder on your PATH. Run it by its full path."
  fi
  echo "  Your data is in $DATA_DIR. This installer never changes it."
}

main "$@"
