#!/usr/bin/env bash
# resolve_version <url> — print the version from a latest.json, or fail.
#
# Sourced by install/install.sh, and called directly by packages/release/src/shell.test.ts.
# It lives in its own file precisely so it can be tested: a block inlined in the installer
# cannot be invoked without running the whole installer.
#
# Prints nothing and returns non-zero on any failure. The caller decides what to say —
# and it must NOT fall back to `latest`.

resolve_version() {
  url="$1"
  body="$(curl -fsSL --retry 3 --retry-delay 2 "$url" 2>/dev/null)" || return 1
  # Match the `version` KEY specifically. A naive first-quoted-value grep would return
  # releasedAt whenever a future manifest orders the fields differently.
  version="$(printf '%s' "$body" \
    | tr ',{}' '\n\n\n' \
    | grep -E '"version"[[:space:]]*:' \
    | head -1 \
    | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')"
  # Only a plain X.Y.Z resolves. `latest` must never satisfy this.
  printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || return 1
  printf '%s\n' "$version"
}
