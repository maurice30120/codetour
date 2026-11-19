#!/bin/sh
# Installs or updates the CodeTour IA VS Code extension in one command.
#
# Downloads the platform-matching VSIX from the latest GitHub release of
# ${CODETOUR_REPO:-maurice30120/codetour} — the release assets are the VSIX
# files the Release workflow builds and attaches in CI — then runs
# `code --install-extension` on it. Running the script again upgrades the
# installed extension to the latest published version. See README.md >>
# Install or update with one command.

set -eu

REPO="${CODETOUR_REPO:-maurice30120/codetour}"
API_URL="https://api.github.com/repos/$REPO/releases/latest"
RELEASES_URL="https://github.com/$REPO/releases"

fail() {
  printf 'install-latest: %s\n' "$1" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) vsix_os=darwin ;;
  Linux) vsix_os=linux ;;
  MINGW* | MSYS* | CYGWIN*) vsix_os=win32 ;;
  *)
    fail "Unsupported operating system '$(uname -s)'. Download the VSIX manually from $RELEASES_URL."
    ;;
esac

machine="$(uname -m)"
case "$machine" in
  arm64 | aarch64) vsix_arch=arm64 ;;
  x86_64 | amd64) vsix_arch=x64 ;;
  *)
    fail "Unsupported architecture '$machine'. Download the VSIX manually from $RELEASES_URL."
    ;;
esac

target="$vsix_os-$vsix_arch"

code_cmd="$(command -v code || true)"
if [ -z "$code_cmd" ]; then
  fail "The VS Code 'code' command is not on PATH. In VS Code, run the command palette entry \"Shell Command: install 'code' command in PATH\" (macOS) or add VS Code's bin folder to PATH, then retry."
fi

vsix_url="${CODETOUR_VSIX_URL:-}"
tag=""
if [ -z "$vsix_url" ]; then
  release_json="$(curl -fsSL --retry 3 "$API_URL")" || fail "Could not fetch the latest release from $API_URL. Check the network, the GitHub API rate limit, or that a release exists (none were published when this happened first: $RELEASES_URL)."
  tag="$(printf '%s\n' "$release_json" | grep -o '"tag_name": *"[^"]*"' | sed 's/"tag_name": *"\([^"]*\)".*/\1/' | head -n 1)"
  vsix_url="$(printf '%s\n' "$release_json" \
    | grep -o "https://[^\"]*/download/[^\"]*/codetour-$target-[0-9][0-9.]*\.vsix" \
    | head -n 1)"
  if [ -z "$vsix_url" ]; then
    assets="$(printf '%s\n' "$release_json" | grep -o 'codetour-[a-z0-9]*-[a-z0-9]*-[0-9][0-9.]*\.vsix' | sort -u || true)"
    if [ -n "$assets" ]; then
      fail "The latest release $tag has no 'codetour-$target-*.vsix' asset. Available VSIX assets:
$assets"
    fi
    fail "The latest release $tag has no CodeTour VSIX asset. The Release workflow may still be building; retry in a few minutes."
  fi
else
  tag="pinned URL override"
fi

work_dir="$(mktemp -d)" || fail "Could not create a temporary directory."
trap 'trap - EXIT INT TERM; rm -rf "$work_dir"' EXIT INT TERM

vsix_file="$work_dir/$(printf '%s\n' "$vsix_url" | sed 's|.*/||')"
curl -fSL --retry 3 -o "$vsix_file" "$vsix_url" || fail "Could not download $vsix_url."

printf 'Installing CodeTour IA from %s (release %s)...\n' "$(printf '%s\n' "$vsix_file" | sed 's|.*/||')" "$tag"
"$code_cmd" --install-extension "$vsix_file" --force || fail "VS Code refused to install the downloaded VSIX. Try manually: download it from $RELEASES_URL and run \"Extensions: Install from VSIX...\"."
printf 'Done. Reload the VS Code window to load the installed version.\n'
