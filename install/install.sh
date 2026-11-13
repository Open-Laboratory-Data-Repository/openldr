#!/usr/bin/env sh
# OpenLDR CE one-line installer (Linux/macOS).
#   curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
# Flags: --dir <path> (default ./openldr),
#        --version <tag> (default latest - the moving tag; "auto" resolves the newest release),
#        --server-name <host> (default localhost — the public hostname/domain),
#        --http-port <n> (default 80), --https-port <n> (default 443 — gateway ports),
#        --letsencrypt <email> (issue a trusted Let's Encrypt cert for --server-name),
#        --staging (use the LE staging CA — for testing, avoids rate limits),
#        --no-start (scaffold + config only), --no-pull (skip image pull).
#        --seedless (empty first run — skips the seeded sample dashboard + demo data; the
#          default seeds them so a fresh install comes up populated. Fresh install only.),
#        --ready-timeout <seconds> (default 180; 0 disables the post-start readiness wait),
#        --require-ready (make a readiness timeout FATAL — exit 1 instead of warning. Off by
#          default: a real lab install leaves the stack up and lets a slow service finish
#          starting. `pnpm release` passes it so the verification install cannot pass by
#          printing warnings.),
#        --target-db postgres|mssql|mysql (default postgres — selects the external analytics/target DB),
#        --mssql-demo (spin up a bundled MSSQL container for evaluation; implies --target-db mssql),
#        --mssql-host/--mssql-port/--mssql-database/--mssql-user/--mssql-password (BYO MSSQL
#          connection — required when --target-db mssql without --mssql-demo; keep the password
#          free of '#', spaces, or quote characters — they confuse Docker Compose's .env reader),
#        --mssql-encrypt true|false (default false), --mssql-trust-cert true|false (default true).
#        --mysql-demo (spin up a bundled MySQL container for evaluation; implies --target-db mysql),
#        --mysql-host/--mysql-port/--mysql-database/--mysql-user/--mysql-password (BYO MySQL
#          connection — required when --target-db mysql without --mysql-demo; keep the password
#          free of '#', spaces, or quote characters — they confuse Docker Compose's .env reader),
#        --mysql-ssl true|false (default false).
#        --auth local|keycloak (sign-in for a new install. local keeps OpenLDR's own accounts and
#          runs no Keycloak. Without the flag the installer asks when it has a terminal, and
#          otherwise uses local. A re-run keeps the mode the install was made with.)
#        --wrapper-only (with --dir, required: rewrite the ./openldr wrapper, and openldr.ps1
#          where it is written, in an existing install folder. Nothing else: no download, no .env
#          change, no compose file, no start. For an install upgraded by the documented steps,
#          which leave the old wrapper on disk.)
set -eu

# Overridable so the test suite can point at the local checkout with a file:// prefix. A real
# install never sets OPENLDR_REPO_RAW and gets exactly the URL below. Without this the shell
# tests download from raw.githubusercontent.com on every run — measured 2026-08-17, two
# consecutive gate runs failed with HTTP 503 then 429 (rate-limited, earned by the hammering).
# A test gate must not depend on GitHub being up.
REPO_RAW="${OPENLDR_REPO_RAW:-https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main}"
DIR="./openldr"
# Default is the moving `latest` tag because no release has published latest.json yet — the
# releases-latest asset URL below 404s today, and defaulting to `auto` would break the advertised
# one-line install for everyone. Flip this default to "auto" once the first release publishes
# latest.json. `--version auto` already works and resolves a concrete version.
VERSION="latest"
LATEST_URL="https://github.com/Open-Laboratory-Data-Repository/openldr/releases/latest/download/latest.json"
HOST="localhost"
# Was --server-name actually typed? The adoption block below must be able to tell a default
# apart from a deliberate choice, or a re-run silently discards the operator's flag.
HOST_EXPLICIT=0
HOST_CHANGED=0
PREVIOUS_HOST=""
HTTP_PORT="80"
HTTPS_PORT="443"
LE_EMAIL=""
LE_STAGING=""
NO_START=0
NO_PULL=0
SEED=1
READY_TIMEOUT=180
REQUIRE_READY=0
TARGET_DB="postgres"
MSSQL_DEMO=0
MSSQL_HOST=""
MSSQL_PORT="1433"
MSSQL_DATABASE="openldr_target"
MSSQL_USER=""
MSSQL_PASSWORD=""
MSSQL_ENCRYPT="false"
MSSQL_TRUST_CERT="true"
MYSQL_DEMO=0
MYSQL_HOST=""
MYSQL_PORT="3306"
MYSQL_DATABASE="openldr_target"
MYSQL_USER=""
MYSQL_PASSWORD=""
MYSQL_SSL="false"
# Empty until --auth, the existing .env, or the question below decides it.
AUTH=""
DIR_SET=0
WRAPPER_ONLY=0
# The first option other than --dir and --wrapper-only, which --wrapper-only refuses.
OTHER_OPTION=""

while [ $# -gt 0 ]; do
  case "$1" in
    --dir|--wrapper-only) ;;
    *) [ -n "$OTHER_OPTION" ] || OTHER_OPTION="$1" ;;
  esac
  case "$1" in
    --dir) DIR="$2"; DIR_SET=1; shift 2 ;;
    --wrapper-only) WRAPPER_ONLY=1; shift ;;
    --version) VERSION="$2"; shift 2 ;;
    --server-name) HOST="$2"; HOST_EXPLICIT=1; shift 2 ;;
    --http-port) HTTP_PORT="$2"; shift 2 ;;
    --https-port) HTTPS_PORT="$2"; shift 2 ;;
    --letsencrypt) LE_EMAIL="$2"; shift 2 ;;
    --staging) LE_STAGING=1; shift ;;
    --no-start) NO_START=1; shift ;;
    --no-pull) NO_PULL=1; shift ;;
    --seedless|--no-seed) SEED=0; shift ;;
    --ready-timeout) READY_TIMEOUT="$2"; shift 2 ;;
    --require-ready) REQUIRE_READY=1; shift ;;
    --target-db) TARGET_DB="$2"; shift 2 ;;
    --mssql-demo) MSSQL_DEMO=1; TARGET_DB="mssql"; shift ;;
    --mssql-host) MSSQL_HOST="$2"; shift 2 ;;
    --mssql-port) MSSQL_PORT="$2"; shift 2 ;;
    --mssql-database) MSSQL_DATABASE="$2"; shift 2 ;;
    --mssql-user) MSSQL_USER="$2"; shift 2 ;;
    --mssql-password) MSSQL_PASSWORD="$2"; shift 2 ;;
    --mssql-encrypt) MSSQL_ENCRYPT="$2"; shift 2 ;;
    --mssql-trust-cert) MSSQL_TRUST_CERT="$2"; shift 2 ;;
    --mysql-demo) MYSQL_DEMO=1; TARGET_DB="mysql"; shift ;;
    --mysql-host) MYSQL_HOST="$2"; shift 2 ;;
    --mysql-port) MYSQL_PORT="$2"; shift 2 ;;
    --mysql-database) MYSQL_DATABASE="$2"; shift 2 ;;
    --mysql-user) MYSQL_USER="$2"; shift 2 ;;
    --mysql-password) MYSQL_PASSWORD="$2"; shift 2 ;;
    --mysql-ssl) MYSQL_SSL="$2"; shift 2 ;;
    --auth) AUTH="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

# The `openldr` operator CLI. It ships inside the api image (apps/server/Dockerfile), so the
# wrapper is a small shell script rather than a downloaded binary. It hands a key or a stored
# session into the container for each call, and runs `login` and `logout` on the host (spec
# section 6.8; the wrapper's own comments say how). `-T` disables TTY allocation so
# `./openldr report list --json | jq` works in a pipeline. `-w /` sets the container's working
# directory to root, so a `data/`-prefixed argument, like `./openldr ingest data/x.json`,
# resolves to the /data bind mount — the same path the operator sees on the host. `-u
# "$(id -u):$(id -g)"` runs the CLI as the invoking user rather than the image's default
# `USER openldr` (uid 10001): on Linux a bind mount carries host ownership through, and `./data`
# is created owned by the installing user, so uid 10001 gets EACCES on every write (`--out`,
# `ingest`, `artifact keygen`). Running as the host uid, which already owns ./data, fixes this
# with no root needed at install time. The path /app/cli/dist/index.js is fixed by the image —
# see the COPY in apps/server/Dockerfile. The heredoc is quoted (`<<'WRAPPER'`) so `$(id -u)` is
# written literally and evaluated when the wrapper RUNS, not when this installer writes it.
# A function, so `--wrapper-only` can write the wrappers and nothing else.
#
# Each wrapper is written to a temporary file in the same folder, made executable, then renamed over
# the old one. So a link named `openldr` is replaced by a real file and its target is left alone, a
# read-only `openldr` is replaced (the folder decides, not the file), a terminal still running the old
# wrapper keeps reading the old text, and a failed write leaves the old wrapper as it was. A link to a
# folder is the one exception: see place_wrapper.
wrapper_failed() {
  rm -f "$1" 2>/dev/null || true
  echo "✗ Could not write $2. The wrapper that was there is unchanged." >&2
  exit 1
}
# Moves the written wrapper ($1) to its name ($2). `mv` onto a folder, or onto a link to one, would
# put the file inside it, so a link to a folder is removed first and a real folder is refused. A link
# to a file, or to nothing, is left for the rename, which replaces it in one step. (`mv -T` would say
# this in one flag, but it is not portable.)
place_wrapper() {
  if [ -h "$2" ] && [ -d "$2" ]; then
    rm -f "$2" || wrapper_failed "$1" "$2"
    # The old link is gone now, so a failed rename keeps the new wrapper and says where it is.
    if ! mv -f "$1" "$2"; then
      echo "✗ Could not write $2. The link that was there was removed. The new wrapper is in $1. Rename it to $2." >&2
      exit 1
    fi
    return 0
  elif [ -d "$2" ]; then
    rm -f "$1" 2>/dev/null || true
    echo "✗ $2 is a folder, not the wrapper. Remove or rename it, then run the installer again." >&2
    exit 1
  fi
  mv -f "$1" "$2" || wrapper_failed "$1" "$2"
}
write_wrappers() {
wrapper_tmp="$DIR/.openldr.$$.tmp"
rm -f "$wrapper_tmp" 2>/dev/null || wrapper_failed "$wrapper_tmp" "$DIR/openldr"
if ! cat > "$wrapper_tmp" <<'WRAPPER'
#!/bin/sh
# OpenLDR operator CLI. Runs inside the api container.
# Files must live under ./data (mounted at /data) — e.g. ./openldr ingest data/bundle.json

# Tracing (`sh -x`) would print the password, the session and the key, so it is turned off.
case $- in
  *x*) set +x; printf '%s\n' 'Tracing is off: this script handles a password and keys.' >&2 ;;
esac

# ⛔ Git Bash (MSYS) rewrites any argument that looks like a POSIX path into a Windows one before
# Docker ever sees it. Measured on Windows: `-w /` arrived as `-w C:/Program Files/Git/` and the
# runtime refused with "OCI runtime exec failed: Cwd must be an absolute path". The container path
# after `node` would have been mangled next. Every argument this wrapper passes through is either
# a container path or a relative one like `data/bundle.json`, and relative paths are not converted
# anyway, so turning conversion off for this command loses nothing. Non-MSYS shells ignore it.
export MSYS_NO_PATHCONV=1

# Signing in. The container has no terminal and keeps nothing, so the credential is handed in from
# the host for each call:
#   - OPENLDR_KEY, or the key in the file OPENLDR_KEY_FILE names, read here on the host.
#   - Else the session `./openldr login` keeps on the host for this install folder, in
#     ${XDG_CONFIG_HOME:-$HOME/.config}/openldr/docker/<id>.json (folders 0700, file 0600). <id> is
#     a checksum of this folder's real path, so each install keeps its own session. The native
#     client's session.json in the folder above is never read or written here.
# `-e NAME` with no value makes docker compose copy NAME from this process's environment, so a key
# or a session is never on a command line, where other users can read it.
# `login` asks for the password here and pipes it to the CLI, which prints the session as one line
# (its hidden --session-out) and keeps no file. This script keeps the line and hands it back in the
# hidden variable OPENLDR_SESSION. `logout` ends the session and removes the file.
# Known limit: the server gives no new session value on a refresh today. If it ever starts to, this
# script will not see it: only output comes back out of the container.

say() { printf '%s\n' "$*" >&2; }
nl='
'
cr=$(printf '\r')

# Only fixed `-e NAME` words go in $pass, so it is left unquoted on purpose below.
pass=''
if [ -n "${OPENLDR_URL+x}" ]; then pass="$pass -e OPENLDR_URL"; fi
if [ -n "${OPENLDR_ALLOW_PLAIN_HTTP+x}" ]; then pass="$pass -e OPENLDR_ALLOW_PLAIN_HTTP"; fi

cli() {
  docker compose exec -T $pass -u "$(id -u):$(id -g)" -w / api node /app/cli/dist/index.js "$@"
}

# This script's install folder. $0 is followed while it is a link, so a link on PATH (such as
# /usr/local/bin/openldr) runs the install it points at. readlink is not POSIX: where it is missing,
# the loop stops and the link's own folder is used. A loop of links stops after 40 steps.
self=$0
i=0
while [ -h "$self" ] && [ "$i" -lt 40 ]; do
  # 2>/dev/null: where readlink is missing, the shell's own "not found" line stays out of the output.
  target=$(readlink -- "$self" 2>/dev/null) || break
  case $target in
    /*) self=$target ;;
    *) self=$(dirname -- "$self")/$target ;;
  esac
  i=$((i + 1))
done
# -P: a `..` in a relative link is taken on disk. A plain cd takes it by text, so a link reached
# through a linked folder would lead to the wrong folder.
here=$(CDPATH='' cd -P -- "$(dirname -- "$self")" 2>/dev/null && pwd -P) || here=''

# Where this install's session is kept. A relative XDG_CONFIG_HOME is ignored, as the CLI ignores it.
case ${XDG_CONFIG_HOME-} in
  /*) session_root=$XDG_CONFIG_HOME/openldr ;;
  *) session_root=${HOME:+$HOME/.config/openldr} ;;
esac
session_dir=''
session_file=''
if [ -n "$here" ] && [ -n "$session_root" ]; then
  sum=$(printf '%s' "$here" | cksum)
  rest=${sum#* }
  session_dir=$session_root/docker
  session_file=$session_dir/${sum%% *}-${rest%% *}.json
fi

# docker compose finds the stack from the working folder, so it runs from this install's folder,
# the one whose session is handed in. Arguments are not affected: the CLI runs with -w /.
go_home() {
  if [ -z "$here" ] || ! cd -- "$here"; then
    say 'Cannot find the folder this script is in, so the install it belongs to is not known.'
    exit 1
  fi
  # A copy of this script elsewhere cannot be traced back to its install. Both files are checked, as
  # --wrapper-only checks them, so another project's compose file is not taken for an install.
  if [ ! -f .env ] || [ ! -f docker-compose.yml ]; then
    say "This script must stay in its install folder, or be a link to it. $here has no .env or no docker-compose.yml."
    exit 1
  fi
}

# Reads the stored session into OPENLDR_SESSION after the checks the CLI makes on its own file:
# no link, a plain file in a real folder, nothing group or others can read or change, and small
# enough to hand in (a larger value fails at exec with "Argument list too long"). On a problem it
# sets $problem to say what is wrong and fails; the caller says what it did about it.
read_session() {
  if [ -h "$session_dir" ]; then problem="The session folder $session_dir is a link"; return 1; fi
  case $(ls -ld -- "$session_dir" 2>/dev/null) in
    d???------*) ;;
    d*) problem="Other users can read or change the session folder $session_dir"; return 1 ;;
    *) problem="The session folder $session_dir is not a folder"; return 1 ;;
  esac
  if [ -h "$session_file" ]; then problem="The session file $session_file is a link"; return 1; fi
  if [ ! -f "$session_file" ]; then problem="The session file $session_file is not a plain file"; return 1; fi
  case $(ls -ld -- "$session_file" 2>/dev/null) in
    -???------*) ;;
    *) problem="Other users can read or change the session file $session_file"; return 1 ;;
  esac
  # 2>/dev/null first: redirections apply left to right, and a failed < is reported by the shell.
  n=$(wc -c 2>/dev/null < "$session_file" | tr -cd '0-9')
  if [ -n "$n" ] && [ "$n" -gt 65536 ]; then problem="The session file $session_file is too large"; return 1; fi
  if ! OPENLDR_SESSION=$(cat -- "$session_file" 2>/dev/null); then
    problem="The session file $session_file cannot be read"
    return 1
  fi
}

# True when there is a stored session file, or something in its place.
has_session() {
  [ -n "$session_file" ] && { [ -e "$session_file" ] || [ -h "$session_file" ]; }
}

# Hands the stored session in, when there is one.
hand_session() {
  has_session || return 0
  if ! read_session; then
    say "$problem, so it is not used. Remove it and sign in again."
    return 1
  fi
  export OPENLDR_SESSION
  pass="$pass -e OPENLDR_SESSION"
}

# Removes this install's session file. Never through a linked folder, which leads somewhere else.
remove_session() {
  [ -n "$session_file" ] || return 0
  [ ! -h "$session_dir" ] || return 0
  rm -f "$session_file"
}

# Writes the session line whole: a temporary file made owner-only, then renamed over the old one.
store() {
  if [ -h "$session_dir" ]; then
    say "The session folder $session_dir is a link, so it is not used. Remove it and sign in again."
    return 1
  fi
  (umask 077 && mkdir -p "$session_dir") && chmod 700 "$session_dir" || return 1
  tmp=$session_dir/.${session_file##*/}.$$.tmp
  # A file left by an earlier run with the same process id would make the create below fail.
  rm -f "$tmp"
  if (umask 077 && set -C && printf '%s\n' "$1" > "$tmp") && chmod 600 "$tmp" && mv -f "$tmp" "$session_file"; then
    return 0
  fi
  rm -f "$tmp"
  return 1
}

login() {
  if [ -z "$session_file" ]; then
    say 'Cannot find your home folder or the folder this script is in, so there is nowhere to keep the session. Set HOME.'
    exit 1
  fi
  go_home
  has_user=0
  for a in "$@"; do
    case $a in --username|--username=*) has_user=1 ;; esac
  done
  if [ -t 0 ]; then
    if [ "$has_user" = 0 ]; then
      printf 'Username: ' >&2
      IFS= read -r username || { say 'Sign-in cancelled.'; exit 1; }
      set -- "$@" --username "$username"
    fi
    printf 'Password: ' >&2
    tty_state=$(stty -g)
    # Echo comes back however this ends: Enter, Ctrl+C, or the window closing.
    trap 'stty "$tty_state"' EXIT
    trap 'exit 130' INT TERM HUP
    stty -echo
    IFS= read -r password
    got=$?
    stty "$tty_state"
    trap - EXIT INT TERM HUP
    printf '\n' >&2
    if [ "$got" -ne 0 ]; then say 'Sign-in cancelled.'; exit 1; fi
    # printf is built into the shell, so the password is on no command line.
    line=$(printf '%s\n' "$password" | cli "$@" --password-stdin --session-out)
    code=$?
    password=''
  else
    if [ "$has_user" = 0 ]; then
      say 'Standard input is not a terminal, so the username cannot be asked for. Use --username, and put the password on standard input.'
      exit 1
    fi
    line=$(cli "$@" --password-stdin --session-out)
    code=$?
  fi
  if [ "$code" -ne 0 ]; then
    # The operator never typed --session-out. An older CLI in the images refuses it as unknown.
    say 'If the message names --session-out, the images are older than this wrapper. Upgrade them first.'
    exit "$code"
  fi
  case $line in
    '' | *"$nl"*) say 'The sign-in gave no session this script can read, so nothing was stored.'; exit 1 ;;
    '{"version":1,"sessions":{'*) ;;
    *) say 'The sign-in gave an answer this script did not expect, so nothing was stored.'; exit 1 ;;
  esac
  if ! store "$line"; then
    # Leave no live session behind that nobody holds.
    say "Cannot write the session file $session_file, so the session was ended."
    OPENLDR_SESSION=$line
    export OPENLDR_SESSION
    pass="$pass -e OPENLDR_SESSION"
    if [ -n "$server_url" ]; then cli --server-url "$server_url" logout; else cli logout; fi >/dev/null 2>&1
    exit 1
  fi
  exit 0
}

# Ends the session and removes the file, whatever the CLI answered. A file that fails the checks is
# removed unused, since a file others can read should go, and the session it held is not ended.
logout() {
  go_home
  if has_session && ! read_session; then
    remove_session
    if has_session; then
      say "$problem, so it was not used, and it could not be removed. Remove it yourself."
    else
      say "$problem, so it was removed without being used. The session on the server was not ended. It ends by itself after 12 idle hours. Changing the account's password ends its other sessions."
    fi
    exit 1
  fi
  if has_session; then
    export OPENLDR_SESSION
    pass="$pass -e OPENLDR_SESSION"
  fi
  cli "$@"
  code=$?
  if ! remove_session; then
    say "Cannot remove the session file $session_file."
    [ "$code" -ne 0 ] || code=1
  fi
  exit "$code"
}

# The command word, after any root option before it. --server-url is noted wherever it is.
cmd=''
server_url=''
skip=''
for a in "$@"; do
  case $skip in
    url) server_url=$a; skip=''; continue ;;
    other) skip=''; continue ;;
  esac
  case $a in
    --server-url) skip=url ;;
    --server-url=*) server_url=${a#--server-url=} ;;
    --actor) [ -n "$cmd" ] || skip=other ;;
    -*) ;;
    *) [ -n "$cmd" ] || cmd=$a ;;
  esac
done
# Help for login or logout is only help: it runs in the container like any other command.
for a in "$@"; do
  case $a in -h | --help) cmd='' ;; esac
done

case $cmd in
  login) login "$@" ;;
  logout) logout "$@" ;;
esac

if [ -n "${OPENLDR_KEY+x}" ]; then
  pass="$pass -e OPENLDR_KEY"
elif [ -n "${OPENLDR_KEY_FILE+x}" ]; then
  # Read here: the file is on the host, where the container cannot see it. A key file that cannot
  # be used stops here. It never falls through to a session, which could be someone else's. The
  # checks are the CLI's own: at most 4096 bytes, one line, blanks around it dropped.
  f=$OPENLDR_KEY_FILE
  if [ -z "$f" ]; then
    say 'OPENLDR_KEY_FILE is set but empty. Set it, or unset it.'
    exit 1
  fi
  if [ ! -r "$f" ] || [ -d "$f" ]; then
    say "The key file named by OPENLDR_KEY_FILE cannot be read: $f"
    exit 1
  fi
  # At most 4097 bytes are read, so /dev/zero or a pipe that never ends cannot hang this. A NUL
  # becomes a newline, which the shell can hold and which is refused below as a second line. The x
  # keeps the trailing newlines that $(...) would drop, so the count is exact.
  key=$(head -c 4097 -- "$f" 2>/dev/null | tr '\000' '\n'; echo x)
  key=${key%x}
  n=$(printf '%s' "$key" | wc -c | tr -cd '0-9')
  if [ "$n" -gt 4096 ]; then
    say "The key file named by OPENLDR_KEY_FILE is too large to hold a key: $f"
    exit 1
  fi
  key=${key#"${key%%[![:space:]]*}"}
  key=${key%"${key##*[![:space:]]}"}
  if [ -z "$key" ]; then
    say "The key file named by OPENLDR_KEY_FILE is empty: $f"
    exit 1
  fi
  case $key in
    *"$nl"* | *"$cr"*) say "The key file named by OPENLDR_KEY_FILE holds more than one line: $f"; exit 1 ;;
  esac
  OPENLDR_KEY=$key
  key=''
  export OPENLDR_KEY
  pass="$pass -e OPENLDR_KEY"
else
  hand_session || exit 1
fi
# After the key file is read: its path may be relative to where the caller stood.
go_home
exec docker compose exec -T $pass -u "$(id -u):$(id -g)" -w / api node /app/cli/dist/index.js "$@"
WRAPPER
then
  wrapper_failed "$wrapper_tmp" "$DIR/openldr"
fi
# chmod can fail on a Windows file system, where the bit means nothing; the rename still counts.
chmod +x "$wrapper_tmp" 2>/dev/null || true
place_wrapper "$wrapper_tmp" "$DIR/openldr"

# ⛔ On Windows the wrapper above is unusable from PowerShell. It has no file extension and
# PowerShell does not read shebangs, so `./openldr` never runs: Windows falls back to file
# association, finds none, and pops a "Select an app to open 'openldr'" dialog. install.ps1
# already writes the wrapper below, but `pnpm release` step 9 calls THIS installer on every
# platform, so a Windows verification install had no CLI its own operator could run.
# Body kept identical to install/install.ps1. No -u on purpose: Windows bind mounts do not
# enforce the ownership check the sh wrapper's `id` call exists for, and there is no `id`
# command to resolve the flag anyway. It signs in with an access key only: no password is asked
# for in PowerShell (unproven: nothing on the Linux build machine runs PowerShell).
case "$(uname -s 2>/dev/null)" in
  MINGW*|MSYS*|CYGWIN*)
    wrapper_tmp="$DIR/.openldr.ps1.$$.tmp"
    rm -f "$wrapper_tmp" 2>/dev/null || wrapper_failed "$wrapper_tmp" "$DIR/openldr.ps1"
    if ! cat > "$wrapper_tmp" <<'PSWRAPPER'
# OpenLDR operator CLI. Runs inside the api container.
# Files must live under .\data (mounted at /data) - e.g. .\openldr.ps1 ingest data/bundle.json
# Signing in: on Windows the CLI signs in with an access key, set in OPENLDR_KEY. `-e NAME` with no
# value copies NAME from this window's environment, so the key is never on a command line.
# Unproven: this was written on Linux, where nothing can run PowerShell.
if ($args.Count -gt 0 -and $args[0] -eq 'login') {
  [Console]::Error.WriteLine('On Windows the CLI signs in with an access key. Set it in OPENLDR_KEY.')
  exit 1
}
if ((Test-Path Env:OPENLDR_KEY_FILE) -and -not (Test-Path Env:OPENLDR_KEY)) {
  [Console]::Error.WriteLine('OPENLDR_KEY_FILE is not read on Windows. Set OPENLDR_KEY.')
  exit 1
}
# docker compose finds the stack from the working folder, so it runs from this script's own folder,
# the install it belongs to, and the caller's folder is put back after. A copy of this script
# elsewhere cannot be traced back to its install: no .env or no docker-compose.yml beside it stops
# here, so an exported OPENLDR_KEY never reaches another project's api.
$here = $PSScriptRoot
if (-not $here) {
  [Console]::Error.WriteLine('Cannot find the folder this script is in, so the install it belongs to is not known.')
  exit 1
}
if (-not (Test-Path -LiteralPath (Join-Path $here '.env') -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $here 'docker-compose.yml') -PathType Leaf)) {
  [Console]::Error.WriteLine("This script must stay in its install folder, or be a link to it. $here has no .env or no docker-compose.yml.")
  exit 1
}
$pass = @()
foreach ($name in 'OPENLDR_KEY', 'OPENLDR_URL', 'OPENLDR_ALLOW_PLAIN_HTTP') {
  if (Test-Path "Env:$name") { $pass += '-e', $name }
}
$caller = Get-Location
Set-Location -LiteralPath $here
try {
  docker compose exec -T @pass -w / api node /app/cli/dist/index.js $args
  $code = $LASTEXITCODE
} finally {
  Set-Location -LiteralPath $caller.Path
}
exit $code
PSWRAPPER
    then
      wrapper_failed "$wrapper_tmp" "$DIR/openldr.ps1"
    fi
    place_wrapper "$wrapper_tmp" "$DIR/openldr.ps1"
    echo "→ Also wrote openldr.ps1 (PowerShell cannot run the extensionless sh wrapper)"
    ;;
esac
}

# --wrapper-only: rewrite the wrappers in an existing install folder and change nothing else. An
# upgrade by the documented steps leaves the old wrapper on disk, which hands in no credential.
# No download, no .env change, no compose file, no Docker check, no start.
if [ "$WRAPPER_ONLY" -eq 1 ]; then
  if [ -n "$OTHER_OPTION" ]; then
    echo "✗ --wrapper-only takes no other option than --dir (got $OTHER_OPTION)." >&2
    exit 2
  fi
  if [ "$DIR_SET" -eq 0 ]; then
    echo "✗ --wrapper-only needs --dir <the install folder>, so a fresh install is never made by accident." >&2
    exit 2
  fi
  if [ ! -f "$DIR/.env" ] || [ ! -f "$DIR/docker-compose.yml" ]; then
    echo "✗ $DIR is not an OpenLDR install folder: it has no .env or no docker-compose.yml." >&2
    exit 2
  fi
  write_wrappers
  echo "✓ Rewrote the openldr wrapper in $DIR. Nothing else was changed."
  exit 0
fi

case "$AUTH" in
  ''|local|keycloak) ;;
  *) echo "✗ --auth must be 'local' or 'keycloak' (got '$AUTH')" >&2; exit 2 ;;
esac

# Resolve `auto` to a concrete published version, so .env records exactly what this lab runs.
# Two installs on the same day then get the same stack, and a rollback has something to name.
if [ "$VERSION" = "auto" ]; then
  echo "Resolving the newest release..."
  # `curl | bash` runs this script with no real path in $0, so a local sibling file cannot be
  # sourced (the repo isn't on disk). Reuse the same $REPO_RAW source everything else in this
  # installer downloads from, falling back to it only when the local file isn't there — so a
  # git checkout still sources the sibling file directly, with no network round-trip.
  LIB_LOCAL="$(dirname "$0")/lib/resolve-version.sh"
  if [ -f "$LIB_LOCAL" ]; then
    # shellcheck source=install/lib/resolve-version.sh
    . "$LIB_LOCAL"
  else
    LIB_TMP="$(mktemp)"
    if ! curl -fsSL --retry 3 --retry-delay 2 "$REPO_RAW/install/lib/resolve-version.sh" -o "$LIB_TMP" 2>/dev/null; then
      echo "ERROR: could not download resolve-version.sh from $REPO_RAW" >&2
      rm -f "$LIB_TMP"
      exit 1
    fi
    # shellcheck source=install/lib/resolve-version.sh
    . "$LIB_TMP"
    rm -f "$LIB_TMP"
  fi
  if ! VERSION="$(resolve_version "$LATEST_URL")"; then
    echo "ERROR: could not resolve the newest release from $LATEST_URL" >&2
    echo "Pass a version explicitly, e.g.:  $0 --version 0.1.0" >&2
    echo "(Passing --version latest tracks the moving tag instead, which is fine for a demo" >&2
    echo " but means an upgrade is unbounded.)" >&2
    exit 1
  fi
  echo "Newest release: $VERSION"
fi

# An existing .env (from a prior run in this dir) is never overwritten below, so its
# GATEWAY_*_PORT/SERVER_NAME are what will actually be used — adopt them instead of
# re-deriving from (possibly stale/different) CLI args.
ENV_EXISTS=0
if [ -f "$DIR/.env" ]; then
  ENV_EXISTS=1
  EXISTING_HTTP="$(grep -E '^GATEWAY_HTTP_PORT=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
  EXISTING_HTTPS="$(grep -E '^GATEWAY_HTTPS_PORT=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
  EXISTING_HOST="$(grep -E '^SERVER_NAME=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
  [ -n "$EXISTING_HTTP" ] && HTTP_PORT="$EXISTING_HTTP"
  [ -n "$EXISTING_HTTPS" ] && HTTPS_PORT="$EXISTING_HTTPS"
  # ⛔ An explicit --server-name WINS over the stored one. This used to adopt unconditionally, so
  # a re-run threw the operator's flag away without a word: a site installed once as localhost and
  # then re-run with --server-name <ip> kept localhost, studio still worked because the gateway
  # serves any host, and only Keycloak gave it away by redirecting to localhost. Measured against
  # a real deployment 2026-08-20. Without --server-name the stored value is still adopted, which is
  # what makes a bare re-run safe.
  if [ -n "$EXISTING_HOST" ]; then
    if [ "$HOST_EXPLICIT" -eq 1 ] && [ "$EXISTING_HOST" != "$HOST" ]; then
      HOST_CHANGED=1
      PREVIOUS_HOST="$EXISTING_HOST"
    else
      HOST="$EXISTING_HOST"
    fi
  fi
  EXISTING_ADAPTER="$(grep -E '^TARGET_STORE_ADAPTER=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
  if [ "$EXISTING_ADAPTER" = "mssql" ]; then
    TARGET_DB="mssql"
    EXISTING_MSSQL_HOST="$(grep -E '^MSSQL_HOST=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
    [ -n "$EXISTING_MSSQL_HOST" ] && MSSQL_HOST="$EXISTING_MSSQL_HOST"
    # host 'mssql' is the managed-demo signature → re-enable the overlay on re-runs
    [ "$EXISTING_MSSQL_HOST" = "mssql" ] && MSSQL_DEMO=1
  fi
  if [ "$EXISTING_ADAPTER" = "mysql" ]; then
    TARGET_DB="mysql"
    EXISTING_MYSQL_HOST="$(grep -E '^MYSQL_HOST=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
    [ -n "$EXISTING_MYSQL_HOST" ] && MYSQL_HOST="$EXISTING_MYSQL_HOST"
    # host 'mysql' is the managed-demo signature → re-enable the overlay on re-runs
    [ "$EXISTING_MYSQL_HOST" = "mysql" ] && MYSQL_DEMO=1
  fi
  # An existing install keeps its sign-in mode. The database records the mode it first started
  # with and refuses another, so a switch here would only break the stack. No AUTH_ADAPTER line
  # means keycloak: the server's default, and what every install made before this flag runs.
  EXISTING_AUTH="$(grep -E '^AUTH_ADAPTER=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
  [ -n "$EXISTING_AUTH" ] || EXISTING_AUTH="keycloak"
  if [ -n "$AUTH" ] && [ "$AUTH" != "$EXISTING_AUTH" ]; then
    echo "✗ This install uses $EXISTING_AUTH sign-in. Moving an install between sign-in modes is not supported." >&2
    echo "  To start again with $AUTH sign-in, install into a new directory." >&2
    exit 2
  fi
  AUTH="$EXISTING_AUTH"
fi
if [ "$HTTPS_PORT" = "443" ]; then
  ORIGIN="https://$HOST"
else
  ORIGIN="https://$HOST:$HTTPS_PORT"
fi

# The host changed on an install that already exists. `.env` is never rewritten on a re-run (the
# secrets block below is guarded on ENV_EXISTS), so the four host-derived keys have to be edited in
# place or the flag would win in this script and lose everywhere it matters.
if [ "$HOST_CHANGED" -eq 1 ]; then
  echo "→ --server-name $HOST overrides the stored $PREVIOUS_HOST"
  HOST_KEYS="SERVER_NAME=$HOST PUBLIC_ORIGIN=$ORIGIN"
  if [ "$AUTH" != "local" ]; then
    HOST_KEYS="$HOST_KEYS OIDC_ISSUER_URL=$ORIGIN/auth/realms/openldr KC_HOSTNAME=$ORIGIN/auth"
  fi
  for kv in $HOST_KEYS; do
    k="${kv%%=*}"
    # `|` as the delimiter: every value here contains the `/` of a URL.
    sed "s|^$k=.*|$kv|" "$DIR/.env" > "$DIR/.env.tmp" && mv "$DIR/.env.tmp" "$DIR/.env"
  done
  if [ "$AUTH" = "local" ]; then
    echo "→ Rewrote SERVER_NAME and PUBLIC_ORIGIN in .env"
  else
    echo "→ Rewrote SERVER_NAME, PUBLIC_ORIGIN, OIDC_ISSUER_URL and KC_HOSTNAME in .env"
  fi
  # The self-signed cert carries the OLD host in its SAN, and the generator below only runs when
  # fullchain.pem is absent. Drop it so it is reissued for the new host. Let's Encrypt certs are
  # left alone: they are issued by a different path and are not ours to delete.
  if [ -z "$LE_EMAIL" ] && [ -f "$DIR/config/nginx/certs/fullchain.pem" ]; then
    rm -f "$DIR/config/nginx/certs/fullchain.pem" "$DIR/config/nginx/certs/privkey.pem"
    echo "→ Removed the old self-signed cert so it is reissued for $HOST"
  fi
fi

err() { echo "✗ $1" >&2; exit 1; }

if [ "$TARGET_DB" != "postgres" ] && [ "$TARGET_DB" != "mssql" ] && [ "$TARGET_DB" != "mysql" ]; then
  echo "✗ --target-db must be 'postgres', 'mssql', or 'mysql' (got '$TARGET_DB')" >&2; exit 2
fi
case "$READY_TIMEOUT" in
  ''|*[!0-9]*) echo "✗ --ready-timeout must be a non-negative integer (got '$READY_TIMEOUT')" >&2; exit 2 ;;
esac

# --require-ready asks for readiness to be PROVEN. Both of these skip the readiness gate
# entirely, so the flag would exit 0 having checked nothing — the exact silence it exists to
# break. Refuse the combination instead of passing vacuously.
if [ "$REQUIRE_READY" -eq 1 ]; then
  [ "$READY_TIMEOUT" -gt 0 ] || { echo "✗ --require-ready needs a --ready-timeout above 0; there is nothing to wait for" >&2; exit 2; }
  [ "$NO_START" -eq 0 ] || { echo "✗ --require-ready cannot be used with --no-start; nothing is started to become ready" >&2; exit 2; }
fi

for bv in "mssql-encrypt=$MSSQL_ENCRYPT" "mssql-trust-cert=$MSSQL_TRUST_CERT" "mysql-ssl=$MYSQL_SSL"; do
  bname="${bv%%=*}"; bval="${bv#*=}"
  if [ "$bval" != "true" ] && [ "$bval" != "false" ]; then
    echo "✗ --$bname must be 'true' or 'false' (got '$bval')" >&2; exit 2
  fi
done

# Managed-demo MSSQL: point the app at the bundled 'mssql' compose service and (below) generate a
# policy-compliant SA password. Developer/Express editions are NOT licensed for production — this
# container is for evaluation only.
if [ "$MSSQL_DEMO" -eq 1 ]; then
  MSSQL_HOST="mssql"
  MSSQL_PORT="1433"
  MSSQL_DATABASE="openldr_target"
  MSSQL_USER="sa"
  MSSQL_ENCRYPT="false"
  MSSQL_TRUST_CERT="true"
fi

# Managed-demo MySQL: point the app at the bundled 'mysql' compose service and (below) generate a
# root password. For evaluation only.
if [ "$MYSQL_DEMO" -eq 1 ]; then
  MYSQL_HOST="mysql"
  MYSQL_PORT="3306"
  MYSQL_DATABASE="openldr_target"
  MYSQL_USER="root"
  MYSQL_SSL="false"
fi

# BYO MSSQL: require connection details before writing .env / starting the stack.
# Fresh install only — on a re-run the never-overwritten on-disk .env is authoritative,
# so don't demand flags the operator already provided the first time.
if [ "$ENV_EXISTS" -eq 0 ] && [ "$TARGET_DB" = "mssql" ] && [ "$MSSQL_DEMO" -eq 0 ]; then
  for pair in "MSSQL_HOST=$MSSQL_HOST" "MSSQL_USER=$MSSQL_USER" "MSSQL_PASSWORD=$MSSQL_PASSWORD"; do
    key="${pair%%=*}"; val="${pair#*=}"
    [ -n "$val" ] || err "--target-db mssql (BYO) requires --mssql-host, --mssql-user, and --mssql-password (missing $key). The target database '$MSSQL_DATABASE' must already exist on your SQL Server."
  done
fi

# BYO MySQL: require connection details before writing .env / starting the stack.
# Fresh install only — on a re-run the never-overwritten on-disk .env is authoritative,
# so don't demand flags the operator already provided the first time.
if [ "$ENV_EXISTS" -eq 0 ] && [ "$TARGET_DB" = "mysql" ] && [ "$MYSQL_DEMO" -eq 0 ]; then
  for pair in "MYSQL_HOST=$MYSQL_HOST" "MYSQL_USER=$MYSQL_USER" "MYSQL_PASSWORD=$MYSQL_PASSWORD"; do
    key="${pair%%=*}"; val="${pair#*=}"
    [ -n "$val" ] || err "--target-db mysql (BYO) requires --mysql-host, --mysql-user, and --mysql-password (missing $key). The target database '$MYSQL_DATABASE' must already exist on your MySQL/MariaDB server."
  done
fi

# Let's Encrypt needs a public hostname reachable over :80 — reject localhost / bare IPs.
if [ -n "$LE_EMAIL" ]; then
  if [ "$HOST" = "localhost" ] || echo "$HOST" | grep -qE '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
    err "--letsencrypt needs a public --server-name (a domain), not localhost or an IP."
  fi
fi

# 1. Preflight
command -v docker >/dev/null 2>&1 || err "Docker is not installed. See https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || err "Docker Compose plugin not found. Update Docker Desktop or install docker-compose-plugin."
# docker-compose.yml uses `depends_on` with `required: false`, which needs Compose 2.20 or later.
# An older Compose refuses the file, so stop here, before anything is written. A version this
# cannot read is let through with a warning: refusing it would block a Compose we do not know.
COMPOSE_VERSION="$(docker compose version --short 2>/dev/null | head -1 | tr -d '\r')"
COMPOSE_MAJOR="$(printf '%s' "$COMPOSE_VERSION" | sed -n 's/^v\{0,1\}\([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1/p')"
COMPOSE_MINOR="$(printf '%s' "$COMPOSE_VERSION" | sed -n 's/^v\{0,1\}\([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\2/p')"
if [ -z "$COMPOSE_MAJOR" ] || [ -z "$COMPOSE_MINOR" ]; then
  echo "⚠ Could not read the Docker Compose version ('$COMPOSE_VERSION'). It needs 2.20 or later. Continuing."
elif [ "$COMPOSE_MAJOR" -lt 2 ] || { [ "$COMPOSE_MAJOR" -eq 2 ] && [ "$COMPOSE_MINOR" -lt 20 ]; }; then
  err "Docker Compose 2.20 or later is needed. This machine has $COMPOSE_VERSION."
fi
docker info >/dev/null 2>&1 || err "Docker daemon is not running. Start Docker and retry."

# Port-conflict detection — fail fast with remediation instead of a confusing failure deep
# inside `docker compose up`. Only for fresh installs: if .env already exists, HTTP_PORT/
# HTTPS_PORT above were adopted from it, so "in use" almost certainly means this same
# install's own (already running) stack, not a real conflict. Best-effort: falls back
# through ss/netstat/nc/lsof and silently skips the check if none are available.
port_in_use() {
  p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[.:]${p}\$"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -an 2>/dev/null | grep -i listen | grep -qE "[.:]${p}([[:space:]]|\$)"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$p" >/dev/null 2>&1
  else
    return 1
  fi
}
if [ "$ENV_EXISTS" -eq 0 ]; then
  for p in "$HTTP_PORT" "$HTTPS_PORT"; do
    if port_in_use "$p"; then
      err "Port $p is already in use by another process/service. Free it, or install to different ports, e.g.:
    install.sh --http-port 8080 --https-port 8443"
    fi
  done
fi

# Sign-in for a new install. `curl | bash` feeds this script on stdin, so the answer is read from
# /dev/tty. With no terminal (CI, `pnpm release`, a test) the installer asks nothing and uses local.
if [ -z "$AUTH" ]; then
  AUTH="local"
  if [ -t 1 ] && (: < /dev/tty) 2>/dev/null; then
    printf '\nHow should people sign in?\n' > /dev/tty
    printf '  1) OpenLDR accounts, called local. No Keycloak runs. This is the default.\n' > /dev/tty
    printf '  2) Keycloak. Pick this for a sync central.\n' > /dev/tty
    printf 'Choose 1 or 2 [1]: ' > /dev/tty
    ANSWER=""
    read -r ANSWER < /dev/tty || ANSWER=""
    case "$ANSWER" in 2|keycloak) AUTH="keycloak" ;; esac
  fi
  echo "→ Sign-in: $AUTH. To choose without the question, pass --auth local or --auth keycloak."
fi

# 2. Scaffold
echo "→ Scaffolding $DIR"
mkdir -p "$DIR/config/nginx/certs" "$DIR/config/nginx/certs/central" "$DIR/config/keycloak" "$DIR/data"

# Placeholder for a CENTRAL's certificate, so a lab can trust one without hand-editing compose.
# It must EXIST before `docker compose up`: Docker bind-mounting a missing file silently creates a
# DIRECTORY at that path, and the api then fails to start. Empty is fine and honest — it means
# "no extra CAs trusted yet"; Node accepts an empty NODE_EXTRA_CA_CERTS file (verified on the
# api image's node v22). To trust a central, overwrite this file with its certificate and restart
# the api — no .env or compose edit needed.
[ -f "$DIR/config/nginx/certs/central/fullchain.pem" ] || : > "$DIR/config/nginx/certs/central/fullchain.pem"
fetch() { curl -fsSL "$REPO_RAW/$1" -o "$2" || err "failed to download $1"; }
fetch "deploy/install/docker-compose.yml" "$DIR/docker-compose.yml"
# The realm is imported by Keycloak only, so a local install does not download it.
if [ "$AUTH" != "local" ]; then
  fetch "infra/keycloak/openldr-realm.json" "$DIR/config/keycloak/openldr-realm.json"
fi
fetch "scripts/init-target-db.sql" "$DIR/config/init-target-db.sql"
# Fetched for every install: the postgres service mounts it whatever the sign-in mode, and Docker
# turns a missing bind-mount source into a directory, which breaks postgres's first start. Under
# local sign-in it creates an empty `keycloak` database that nothing uses.
fetch "scripts/init-keycloak-db.sql" "$DIR/config/init-keycloak-db.sql"
fetch "deploy/install/garage.toml" "$DIR/config/garage.toml"
fetch "deploy/install/renew-cert.sh" "$DIR/renew-cert.sh"
chmod +x "$DIR/renew-cert.sh" 2>/dev/null || true

write_wrappers
if [ "$MSSQL_DEMO" -eq 1 ]; then
  fetch "deploy/install/docker-compose.mssql.yml" "$DIR/docker-compose.mssql.yml"
  fetch "scripts/init-target-db-mssql.sql" "$DIR/config/init-target-db-mssql.sql"
fi
if [ "$MYSQL_DEMO" -eq 1 ]; then
  fetch "deploy/install/docker-compose.mysql.yml" "$DIR/docker-compose.mysql.yml"
  fetch "scripts/init-target-db-mysql.sql" "$DIR/config/init-target-db-mysql.sql"
fi

# 3. Secrets + cert (only on first run — never overwrite an existing .env)
# Read a bounded block of /dev/urandom (not an unbounded stream) and take the
# first 24 alnum chars with cut — cut consumes all of its input, so no early
# pipe close can SIGPIPE an upstream reader even under `set -o pipefail`.
rand() { head -c 3072 /dev/urandom | LC_ALL=C tr -dc 'A-Za-z0-9' | cut -c1-24; }
# Garage refuses any other format: key ID is GK + 24 hex, secrets are 64 hex.
hex() { od -An -tx1 -N"$1" /dev/urandom | tr -d ' \n'; }

# Keycloak only: register the origin in the realm, and give it per-install secrets. Local sign-in
# has no realm, no labadmin user and no Keycloak admin, so it writes none of this.
if [ "$AUTH" != "local" ]; then
# Register this deploy's origin as a valid OIDC redirect so studio login works behind the
# gateway. The shipped realm lists localhost + dev URLs; a non-localhost host (or https://localhost)
# must be added or Keycloak rejects the /studio/auth/callback redirect. webOrigins is already "+".
REALM="$DIR/config/keycloak/openldr-realm.json"
if ! grep -qF "\"$ORIGIN/*\"" "$REALM" 2>/dev/null; then
  sed "s|\"redirectUris\": \[|\"redirectUris\": [\"$ORIGIN/*\", |" "$REALM" > "$REALM.tmp" && mv "$REALM.tmp" "$REALM"
  echo "→ Registered $ORIGIN/* as an OIDC redirect in the realm"
fi

# Pin the openldr-admin service-account secret in the realm import to a per-install value. The
# committed realm ships a well-known dev secret ("openldr-admin-dev-secret") that a real deployment
# must not use; without a matching KEYCLOAK_ADMIN_CLIENT_SECRET in .env the server's identity-admin
# actions (Distributed Sync site enrollment, password reset, force sign-out) fail with a 503. Generate
# one — reusing the existing .env value on a re-run so the on-disk import stays consistent with what the
# app authenticates with — substitute it into the realm import, and write it to .env below.
if [ -f "$DIR/.env" ] && grep -q '^KEYCLOAK_ADMIN_CLIENT_SECRET=' "$DIR/.env"; then
  KC_ADMIN_SECRET="$(grep '^KEYCLOAK_ADMIN_CLIENT_SECRET=' "$DIR/.env" | cut -d= -f2-)"
else
  KC_ADMIN_SECRET="$(rand)"
fi
sed "s|\"openldr-admin-dev-secret\"|\"$KC_ADMIN_SECRET\"|" "$REALM" > "$REALM.tmp" && mv "$REALM.tmp" "$REALM"

# Same per-install treatment for the seeded human `labadmin` user. The committed realm ships the
# well-known "labadmin" password (marked temporary → forced change on first login); a real deployment
# must not import that guessable credential. Generate a per-install password — reusing the existing
# .env value on a re-run so the on-disk import stays consistent — substitute it into the CREDENTIAL
# value (the "username": "labadmin" line does not match this pattern), and surface it below.
if [ -f "$DIR/.env" ] && grep -q '^INITIAL_LAB_ADMIN_PASSWORD=' "$DIR/.env"; then
  LABADMIN_PW="$(grep '^INITIAL_LAB_ADMIN_PASSWORD=' "$DIR/.env" | cut -d= -f2-)"
else
  LABADMIN_PW="$(rand)"
fi
sed "s|\"value\": \"labadmin\"|\"value\": \"$LABADMIN_PW\"|" "$REALM" > "$REALM.tmp" && mv "$REALM.tmp" "$REALM"
fi

if [ ! -f "$DIR/.env" ]; then
  PG_PW="$(rand)"; KC_PW="$(rand)"; S3_KEY="GK$(hex 12)"; S3_SECRET="$(hex 32)"; GARAGE_RPC="$(hex 32)"; GARAGE_ADMIN="$(hex 32)"
  if [ "$MSSQL_DEMO" -eq 1 ] && [ -z "$MSSQL_PASSWORD" ]; then MSSQL_PASSWORD="$(rand)Aa1!"; fi
  if [ "$MYSQL_DEMO" -eq 1 ] && [ -z "$MYSQL_PASSWORD" ]; then MYSQL_PASSWORD="$(rand)Aa1"; fi
  SECRETS_KEY="$(openssl rand -base64 32 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -d '\n')"
  # Seed the sample dashboard + demo data on first boot unless --seedless was passed.
  SEED_ON_START_VAL=true; [ "$SEED" -eq 0 ] && SEED_ON_START_VAL=false

  # COMPOSE_PROJECT_NAME: Compose's own default (the install dir's leaf name) collides
  # whenever two installs share a leaf dir name (e.g. two "./openldr" installs from
  # different parent paths on the same Docker host). Derive a name that is stable for
  # THIS install dir but unique across install dirs: leaf name + a short hash of the
  # resolved absolute path.
  RESOLVED_DIR="$(cd "$DIR" 2>/dev/null && pwd)"
  [ -n "$RESOLVED_DIR" ] || RESOLVED_DIR="$(pwd)/$DIR"
  LEAF="$(basename "$RESOLVED_DIR" | tr '[:upper:]' '[:lower:]' | sed -e 's/[^a-z0-9_-]/-/g' -e 's/^-*//' -e 's/-*$//')"
  [ -n "$LEAF" ] || LEAF="openldr"
  LOWER_PATH="$(printf '%s' "$RESOLVED_DIR" | tr '[:upper:]' '[:lower:]')"
  if command -v md5sum >/dev/null 2>&1; then
    HASH="$(printf '%s' "$LOWER_PATH" | md5sum | cut -c1-8)"
  elif command -v md5 >/dev/null 2>&1; then
    HASH="$(printf '%s' "$LOWER_PATH" | md5 | cut -c1-8)"
  else
    HASH="$(printf '%s' "$LOWER_PATH" | cksum | cut -d' ' -f1)"
  fi
  PROJECT_NAME="${LEAF}-${HASH}"

  # Restrict before writing so the plaintext secrets are never briefly world-readable.
  ( umask 077; : > "$DIR/.env" )
  if [ "$TARGET_DB" = "mssql" ]; then
    TARGET_DB_ENV_BLOCK="TARGET_STORE_ADAPTER=mssql
MSSQL_HOST=$MSSQL_HOST
MSSQL_PORT=$MSSQL_PORT
MSSQL_DATABASE=$MSSQL_DATABASE
MSSQL_USER=$MSSQL_USER
MSSQL_PASSWORD=$MSSQL_PASSWORD
MSSQL_ENCRYPT=$MSSQL_ENCRYPT
MSSQL_TRUST_SERVER_CERT=$MSSQL_TRUST_CERT"
  elif [ "$TARGET_DB" = "mysql" ]; then
    TARGET_DB_ENV_BLOCK="TARGET_STORE_ADAPTER=mysql
MYSQL_HOST=$MYSQL_HOST
MYSQL_PORT=$MYSQL_PORT
MYSQL_DATABASE=$MYSQL_DATABASE
MYSQL_USER=$MYSQL_USER
MYSQL_PASSWORD=$MYSQL_PASSWORD
MYSQL_SSL=$MYSQL_SSL"
  else
    TARGET_DB_ENV_BLOCK="TARGET_STORE_ADAPTER=pg
TARGET_DATABASE_URL=postgres://openldr:$PG_PW@postgres:5432/openldr_target"
  fi
  # Local sign-in writes no OIDC or Keycloak key. The server refuses an empty OIDC_ISSUER_URL, and
  # needs SECRETS_ENCRYPTION_KEY, which is written below for every install. A Keycloak install
  # writes the same keys as before, plus COMPOSE_PROFILES so `docker compose up` starts Keycloak.
  if [ "$AUTH" = "local" ]; then
    AUTH_ENV_BLOCK="AUTH_ADAPTER=local"
  else
    AUTH_ENV_BLOCK="AUTH_ADAPTER=keycloak
COMPOSE_PROFILES=keycloak
OIDC_ISSUER_URL=$ORIGIN/auth/realms/openldr
OIDC_INTERNAL_JWKS_URL=http://keycloak:8080/auth/realms/openldr/protocol/openid-connect/certs
OIDC_INTERNAL_ISSUER_URL=http://keycloak:8080/auth/realms/openldr
OIDC_WEB_CLIENT_ID=openldr-web
KC_HOSTNAME=$ORIGIN/auth
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=$KC_PW
KEYCLOAK_ADMIN_CLIENT_ID=openldr-admin
KEYCLOAK_ADMIN_CLIENT_SECRET=$KC_ADMIN_SECRET
INITIAL_LAB_ADMIN_PASSWORD=$LABADMIN_PW"
  fi
  cat > "$DIR/.env" <<EOF
OPENLDR_VERSION=$VERSION
SERVER_NAME=$HOST
PUBLIC_ORIGIN=$ORIGIN
GATEWAY_HTTP_PORT=$HTTP_PORT
GATEWAY_HTTPS_PORT=$HTTPS_PORT
COMPOSE_PROJECT_NAME=$PROJECT_NAME
TLS_MODE=self-signed
PORT=3000
NODE_ENV=production
# One reverse-proxy hop (the gateway) fronts the app: trust its X-Forwarded-For so req.ip and the
# auth.failed audit record the real client, not the gateway's container IP.
TRUST_PROXY=1
INTERNAL_DATABASE_URL=postgres://openldr:$PG_PW@postgres:5432/openldr
$TARGET_DB_ENV_BLOCK
POSTGRES_PASSWORD=$PG_PW
S3_ENDPOINT=http://storage:3900
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=$S3_KEY
S3_SECRET_ACCESS_KEY=$S3_SECRET
S3_BUCKET=openldr
S3_FORCE_PATH_STYLE=true
GARAGE_RPC_SECRET=$GARAGE_RPC
GARAGE_ADMIN_TOKEN=$GARAGE_ADMIN
$AUTH_ENV_BLOCK
TLS_CERT_PATH=/etc/openldr/tls-cert.pem
NODE_EXTRA_CA_CERTS=/etc/ssl/central-ca.pem
SECRETS_ENCRYPTION_KEY=$SECRETS_KEY
MIGRATE_ON_START=true
SEED_ON_START=$SEED_ON_START_VAL
LETSENCRYPT_EMAIL=$LE_EMAIL
MARKETPLACE_REGISTRY_URL=https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/marketplace/main
EOF
  echo "→ Wrote $DIR/.env (generated secrets, compose project '$PROJECT_NAME')"
else
  echo "→ Reusing existing $DIR/.env"
  # The compose file downloaded above starts Keycloak only under the `keycloak` profile. An install
  # made before that has no COMPOSE_PROFILES line, so without this Keycloak would stop on the next
  # `docker compose up` and sign-in would break. Add the profile, keep any others, change nothing else.
  if [ "$AUTH" != "local" ]; then
    CUR_PROFILES="$(grep -E '^COMPOSE_PROFILES=' "$DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r')"
    case ",$CUR_PROFILES," in
      *,keycloak,*) ;;
      *)
        if grep -qE '^COMPOSE_PROFILES=' "$DIR/.env"; then
          NEW_PROFILES="${CUR_PROFILES:+$CUR_PROFILES,}keycloak"
          ( umask 077; sed "s|^COMPOSE_PROFILES=.*|COMPOSE_PROFILES=$NEW_PROFILES|" "$DIR/.env" > "$DIR/.env.tmp" )
          mv "$DIR/.env.tmp" "$DIR/.env"
        else
          # Start on a new line if the file does not end with one.
          [ -z "$(tail -c1 "$DIR/.env")" ] || printf '\n' >> "$DIR/.env"
          printf 'COMPOSE_PROFILES=keycloak\n' >> "$DIR/.env"
        fi
        echo "→ Added the keycloak profile to COMPOSE_PROFILES in .env, so Keycloak keeps running"
        ;;
    esac
  fi
fi

if [ ! -f "$DIR/config/nginx/certs/fullchain.pem" ]; then
  CERT_DIR="$DIR/config/nginx/certs"
  SUBJ="/CN=$HOST"
  # `host.docker.internal` is how a CONTAINER on this host reaches this stack — which is exactly
  # how an enrolled lab's api container talks to a central. Without it in the SAN list, lab->central
  # sync failed TLS hostname validation and surfaced as a bare `fetch failed`, indistinguishable
  # from "central is down". Harmless on a stack that never becomes a central.
  SAN="subjectAltName=DNS:$HOST,DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1"
  # ⛔ MSYS2_ARG_CONV_EXCL. Git Bash rewrites any argument that looks like a POSIX path into a
  # Windows one, so `-subj /CN=localhost` reached openssl as `C:/Program Files/Git/CN=localhost`.
  # openssl wrote privkey.pem, died on the subject, and `|| true` swallowed it — leaving a key
  # with no certificate. docker compose then turned the missing fullchain.pem into a DIRECTORY
  # (that is what a missing bind-mount source becomes) and the gateway crash-looped on
  # "PEM_read_bio_X509_AUX() failed", 180s later, as an opaque readiness timeout.
  # Excluding only `/CN=` leaves the file paths converted, which they must be — openssl here is a
  # native Windows binary and cannot open /tmp/… . Non-MSYS shells ignore the variable entirely.
  CERT_ERR=""
  if command -v openssl >/dev/null 2>&1; then
    CERT_ERR="$(MSYS2_ARG_CONV_EXCL='/CN=' openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
      -keyout "$CERT_DIR/privkey.pem" -out "$CERT_DIR/fullchain.pem" \
      -subj "$SUBJ" -addext "$SAN" 2>&1)" || true
  else
    # No local openssl — Docker is a prereq, so generate the cert via a throwaway container.
    echo "→ openssl not on PATH; generating cert via Docker (alpine/openssl)"
    CERT_DIR_ABS="$(cd "$CERT_DIR" && pwd)"
    # ⚠ UNVERIFIED on Windows. This branch has the same `-subj` conversion trap, but excluding
    # arguments here is not a one-liner: `-v` and the two `/certs/…` paths need opposite
    # treatment, and MSYS2_ARG_CONV_EXCL='*' would break the mount. Left as it was rather than
    # guessing — it is only reached without openssl on PATH, which no machine here has. The
    # error print below is what makes a failure here legible instead of silent.
    CERT_ERR="$(docker run --rm -v "$CERT_DIR_ABS:/certs" ghcr.io/open-laboratory-data-repository/openssl:3.5.9@sha256:96cd55d081ce5d7a13090c4afa70b4f09403c9abcd4862bc8b64b4b3118594aa \
      req -x509 -newkey rsa:2048 -nodes -days 825 \
      -keyout /certs/privkey.pem -out /certs/fullchain.pem \
      -subj "$SUBJ" -addext "$SAN" 2>&1)" || true
  fi
  if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
    echo "→ Generated self-signed cert"
  else
    # Print why. Hiding this cost a whole release round-trip: the only visible symptom was the
    # gateway failing to start three minutes later, which reads as a slow machine.
    echo "! Could not generate a self-signed cert — provide certs in $CERT_DIR/ (fullchain.pem + privkey.pem)."
    [ -n "$CERT_ERR" ] && printf '%s\n' "$CERT_ERR" | tail -5 | sed 's/^/    /'
  fi
fi

# 4. Start
if [ "$NO_START" -eq 1 ]; then
  echo "✓ Scaffolded $DIR (--no-start). Run: cd $DIR && docker compose up -d"
  exit 0
fi
cd "$DIR"
COMPOSE_FILES="-f docker-compose.yml"
[ "$MSSQL_DEMO" -eq 1 ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.mssql.yml"
[ "$MYSQL_DEMO" -eq 1 ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.mysql.yml"
# COMPOSE_PROFILES in .env already turns Keycloak on for a Keycloak install. The flag says it again
# so this command does not depend on that line.
[ "$AUTH" = "local" ] || COMPOSE_FILES="$COMPOSE_FILES --profile keycloak"
[ "$NO_PULL" -eq 1 ] || docker compose $COMPOSE_FILES pull
docker compose $COMPOSE_FILES up -d

# Readiness gate: poll the full user path over the local gateway until every service a first
# visit touches is serving, so we only hand over a URL that actually works. Probes loopback
# (127.0.0.1) so external DNS / a not-yet-resolving --server-name can't cause a false timeout.
# Non-fatal BY DEFAULT: on timeout we warn and leave the stack up (exit 0), like the Let's
# Encrypt path. Real labs depend on that — a slow first boot must not tear anything down.
#
# ⛔ That default made this script useless as a verification: `pnpm release` ran it against the
# just-published tag and read only the exit code, so an API that crash-loops on a bad migration
# scrolled 180s of warnings past and still exited 0, and the release tagged and published. Pass
# --require-ready to make the timeout fatal. Nothing else in the tree passes it.
ready_check() { curl -fsSk -o /dev/null "https://127.0.0.1:$HTTPS_PORT$1" 2>/dev/null; }
READY_OK=0
if [ "$READY_TIMEOUT" -gt 0 ]; then
  echo ""
  echo "→ Waiting for services to be ready (up to ${READY_TIMEOUT}s)..."
  ok_gw=0; ok_studio=0; ok_api=0; ok_kc=0
  # Local sign-in runs no Keycloak, so there is no realm to wait for.
  [ "$AUTH" != "local" ] || ok_kc=1
  deadline=$(( $(date +%s) + READY_TIMEOUT ))
  while : ; do
    if [ "$ok_gw" -eq 0 ] && ready_check "/"; then ok_gw=1; echo "  ✓ gateway (TLS)"; fi
    if [ "$ok_studio" -eq 0 ] && ready_check "/studio/"; then ok_studio=1; echo "  ✓ studio"; fi
    if [ "$ok_api" -eq 0 ] && ready_check "/health"; then ok_api=1; echo "  ✓ api"; fi
    if [ "$ok_kc" -eq 0 ] && ready_check "/auth/realms/openldr/.well-known/openid-configuration"; then ok_kc=1; echo "  ✓ keycloak realm"; fi
    if [ "$ok_gw" -eq 1 ] && [ "$ok_studio" -eq 1 ] && [ "$ok_api" -eq 1 ] && [ "$ok_kc" -eq 1 ]; then
      READY_OK=1; break
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then break; fi
    remain=""
    [ "$ok_gw" -eq 0 ] && remain="${remain}gateway (TLS), "
    [ "$ok_studio" -eq 0 ] && remain="${remain}studio, "
    [ "$ok_api" -eq 0 ] && remain="${remain}api, "
    [ "$ok_kc" -eq 0 ] && remain="${remain}keycloak realm, "
    echo "  … waiting for: ${remain%, }"
    sleep 3
  done
  if [ "$READY_OK" -eq 0 ]; then
    echo ""
    [ "$ok_gw" -eq 0 ] && echo "  ! gateway (TLS) still starting"
    [ "$ok_studio" -eq 0 ] && echo "  ! studio still starting"
    [ "$ok_api" -eq 0 ] && echo "  ! api still starting"
    [ "$ok_kc" -eq 0 ] && echo "  ! keycloak realm still starting"
    if [ "$AUTH" = "local" ]; then
      echo "  Give it another minute, or inspect: docker compose logs -f api"
    else
      echo "  Give it another minute, or inspect: docker compose logs -f keycloak"
    fi
    if [ "$REQUIRE_READY" -eq 1 ]; then
      echo ""
      echo "✗ --require-ready: the stack did not become ready within ${READY_TIMEOUT}s." >&2
      echo "  The containers are still running in $(pwd) — inspect them with: docker compose logs" >&2
      exit 1
    fi
  fi
fi

# Let's Encrypt: the stack is up (nginx serving the http-01 webroot on :80). Issue a trusted cert,
# install it where the gateway reads it, reload, and wire up auto-renewal. Non-fatal: on failure the
# stack stays up on the self-signed cert.
if [ -n "$LE_EMAIL" ]; then
  echo "→ Requesting Let's Encrypt cert for $HOST ${LE_STAGING:+(staging)}..."
  # give nginx a moment to be ready to serve the challenge
  i=0; while [ "$i" -lt 12 ]; do curl -fsS -o /dev/null "http://localhost:$HTTP_PORT/.well-known/acme-challenge/" 2>/dev/null && break; i=$((i+1)); sleep 2; done
  if docker compose --profile letsencrypt run --rm --entrypoint certbot certbot \
       certonly --webroot -w /var/www/certbot -d "$HOST" --email "$LE_EMAIL" \
       --agree-tos --no-eff-email --keep-until-expiring --non-interactive ${LE_STAGING:+--staging}; then
    docker compose --profile letsencrypt run --rm --entrypoint sh certbot -c \
      "cp /etc/letsencrypt/live/$HOST/fullchain.pem /certs-out/fullchain.pem && cp /etc/letsencrypt/live/$HOST/privkey.pem /certs-out/privkey.pem"
    docker compose exec gateway nginx -s reload
    echo "✓ Trusted cert installed for $ORIGIN"
    ABS_DIR="$(pwd)"
    if [ "$(id -u)" = "0" ]; then
      printf '0 3,15 * * * root cd %s && sh renew-cert.sh >> /var/log/openldr-cert.log 2>&1\n' "$ABS_DIR" > /etc/cron.d/openldr-cert
      chmod 0644 /etc/cron.d/openldr-cert
      echo "→ Installed auto-renewal cron: /etc/cron.d/openldr-cert"
    else
      echo "! Not root — add this to your crontab (crontab -e) for auto-renewal:"
      echo "  0 3,15 * * * cd $ABS_DIR && sh renew-cert.sh >> /tmp/openldr-cert.log 2>&1"
    fi
  else
    echo "! Let's Encrypt issuance failed (DNS not pointing at this host yet? port 80 blocked?)."
    echo "  The stack is UP on the self-signed cert. Once DNS/ports are ready, re-run the installer"
    echo "  with the same --server-name $HOST --letsencrypt $LE_EMAIL to retry."
  fi
fi

echo ""
if [ "$READY_OK" -eq 1 ]; then
  echo "✓ OpenLDR is ready. Open $ORIGIN"
else
  echo "✓ OpenLDR is starting. Open $ORIGIN"
fi
if [ "$AUTH" = "local" ]; then
  # The first administrator is made in Studio with a setup code. Ask the api container for one
  # through the ./openldr wrapper, the same command an operator runs. --json, so the code can be
  # picked out even if a log line lands in the same output. The code goes to this terminal only.
  SETUP_OUT="$(sh ./openldr auth setup-code --json 2>&1)" || true
  SETUP_CODE="$(printf '%s\n' "$SETUP_OUT" | sed -n 's/.*"setupCode": *"\([^"]*\)".*/\1/p' | head -1)"
  if [ -n "$SETUP_CODE" ]; then
    echo "  Setup code: $SETUP_CODE, valid for 30 minutes"
    echo "  Open $ORIGIN/studio/ and enter it on the Create the administrator page."
    echo "  For a new code, run: ./openldr auth setup-code"
  elif printf '%s\n' "$SETUP_OUT" | grep -q 'an administrator already exists'; then
    echo "  An administrator already exists. Sign in at $ORIGIN/studio/"
  else
    echo "  Could not get a setup code yet. Once the api is up, run: ./openldr auth setup-code"
    # One line of the reason, no more. It is the last thing the command printed.
    SETUP_REASON="$(printf '%s\n' "$SETUP_OUT" | sed '/^[[:space:]]*$/d' | tail -1)"
    [ -z "$SETUP_REASON" ] || echo "  Reason: $SETUP_REASON"
  fi
else
  echo "  Keycloak admin password: $(grep '^KEYCLOAK_ADMIN_PASSWORD=' .env | cut -d= -f2)"
  echo "  App sign-in: labadmin / $(grep '^INITIAL_LAB_ADMIN_PASSWORD=' .env | cut -d= -f2-)  (change it on first login)"
fi
# ⛔ The one part of a host change this script CANNOT do for you. The realm patch above edits the
# JSON, but the compose runs `start --import-realm`, and Keycloak imports a realm only when it is
# not already in its database. On an existing install it is, carrying the OLD redirect URI, so
# login will bounce to $PREVIOUS_HOST no matter what this script rewrote. Saying nothing here is
# how the operator concludes the whole flag was ignored again. Local sign-in has no realm.
if [ "$HOST_CHANGED" -eq 1 ] && [ "$AUTH" != "local" ]; then
  echo ""
  echo "  ⚠ Keycloak still has the realm it imported as $PREVIOUS_HOST, and an existing realm is"
  echo "    never re-imported. Sign-in will redirect to $PREVIOUS_HOST until you either:"
  echo "      a) add $ORIGIN/* to the openldr-web client's Valid redirect URIs at $ORIGIN/auth"
  echo "         (Administration Console, realm 'openldr', Clients, openldr-web), or"
  echo "      b) install into a fresh directory, which imports the realm cleanly."
fi
if [ "$MSSQL_DEMO" -eq 1 ]; then
  echo "  MSSQL (demo) SA password: $(grep '^MSSQL_PASSWORD=' .env | cut -d= -f2-)"
  echo "  ⚠ The demo SQL Server container is for evaluation only — not licensed for production."
fi
if [ "$MYSQL_DEMO" -eq 1 ]; then
  echo "  MySQL (demo) root password: $(grep '^MYSQL_PASSWORD=' .env | cut -d= -f2-)"
fi
if [ "$HTTP_PORT" != "80" ] || [ "$HTTPS_PORT" != "443" ]; then
  echo "  Gateway ports: HTTP $HTTP_PORT / HTTPS $HTTPS_PORT"
fi
if [ "$AUTH" != "local" ]; then
  echo "  Distributed Sync: identity-admin client provisioned (unique secret in .env) — site enrollment is ready."
fi
echo ""
echo "  Public domain + trusted TLS in one shot:"
echo "    install.sh --server-name your.domain.com --letsencrypt you@email.com"
echo "  (add --staging first to test without hitting Let's Encrypt rate limits)"
echo "  Non-default ports: install.sh --http-port 8080 --https-port 8443"
