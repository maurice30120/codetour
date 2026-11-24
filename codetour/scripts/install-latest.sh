#!/bin/sh
# Installs or updates the CodeTour IA VS Code extension in one command.
#
# Downloads the platform-matching VSIX from a GitHub release of
# ${CODETOUR_REPO:-maurice30120/codetour} — the release assets are the VSIX
# files the Release workflow builds and attaches in CI — then runs
# `code --install-extension` on it. Running the script again upgrades the
# installed extension to the selected version. When the codetour CLI is on
# PATH, the script then runs `codetour --install`, which installs the agent
# integrations of every compatible host (Copilot, Pi) and leaves an absent host
# alone. See README.md >>
# Install or update with one command.
#
# Source selection, relative to the default (latest stable release):
#   CODETOUR_TAG=<tag>            install this exact release
#   CODETOUR_CHANNEL=beta         accept the newest release even when it is
#                                 marked as a pre-release
#   CODETOUR_VSIX_URL=<url>       install an explicit VSIX download URL
#   CODETOUR_REPO=<owner>/<repo>  serve a fork

set -eu

REPO="${CODETOUR_REPO:-maurice30120/codetour}"
RELEASES_URL="https://github.com/$REPO/releases"
API_BASE="https://api.github.com/repos/$REPO"

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
channel="${CODETOUR_CHANNEL:-stable}"
tag=""
if [ -z "$vsix_url" ]; then
  api_path="/releases/latest"
  if [ -n "${CODETOUR_TAG:-}" ]; then
    api_path="/releases/tags/$CODETOUR_TAG"
  elif [ "$channel" = "beta" ]; then
    api_path="/releases"
  fi
  release_json="$(curl -fsSL --retry 3 "$API_BASE$api_path")" || fail "Could not fetch https://api.github.com/repos/$REPO$api_path. Check the network, the GitHub API rate limit, or that the release exists ($RELEASES_URL). A repository holding only pre-releases makes the default stable channel fail with 404 — retry with CODETOUR_TAG=<tag>."
  tag="$(printf '%s\n' "$release_json" | grep -o '"tag_name": *"[^"]*"' | sed 's/"tag_name": *"\([^"]*\)".*/\1/' | head -n 1)"
  vsix_url="$(printf '%s\n' "$release_json" \
    | grep -o "https://[^\"]*/download/[^\"]*/codetour-$target-[0-9][0-9.]*\.vsix" \
    | head -n 1)"
  if [ -z "$vsix_url" ]; then
    assets="$(printf '%s\n' "$release_json" | grep -o 'codetour-[a-z0-9]*-[a-z0-9]*-[0-9][0-9.]*\.vsix' | sort -u || true)"
    if [ -n "$assets" ]; then
      fail "Release $tag has no 'codetour-$target-*.vsix' asset. Available VSIX assets:
$assets"
    fi
    if [ "$channel" = "beta" ]; then
      fail "The newest release $tag carries no CodeTour VSIX asset yet; the Release workflow may still be building or the release has no assets at all. Retry in a few minutes, or pin one with CODETOUR_TAG=<tag>."
    fi
    fail "Release $tag has no CodeTour VSIX asset yet; the Release workflow may still be building. Retry in a few minutes."
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
printf 'Installing the agent integrations of this machine (codetour --install)...\n'
if command -v codetour >/dev/null 2>&1; then
  codetour --install || printf 'install-latest: some agent integrations could not be installed; run "codetour --agents" for the state and "codetour --install" to retry.\n' >&2
else
  printf 'install-latest: the codetour CLI is not on PATH, so no agent integration was installed.\n' >&2
  printf 'install-latest: install the standalone CLI, then run: codetour --install\n' >&2
fi
printf 'Done. Reload the VS Code window to load the installed version.\n'
