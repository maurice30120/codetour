#!/bin/sh
# Installs the current checkout as the complete local CodeTour stack.
#
# The local counterpart of install-latest.sh: instead of downloading a release
# from GitHub, everything is built from this working tree, so the installed
# stack is exactly the code in the current checkout:
#   1. build + package the platform VSIX (npm run package, with its checks);
#   2. install that VSIX into VS Code;
#   3. expose the CLI built from this tree on PATH (npm link), as the bundled
#      copilot plugin declares its MCP server as `codetour mcp`;
#   4. install every compatible agent integration (codetour --install): the
#      Copilot plugin surfaces and the Pi package are installed on the hosts
#      this machine actually has, and an absent host is skipped with its reason
#      instead of failing the whole install.
# Running the script again rebuilds and reinstalls in place.
#
# Prerequisites: Node.js 24.18.0 (see .nvmrc), npm, git, and the VS Code
# `code` command on PATH. GitHub Copilot CLI 1.0.106+ and the Pi coding agent
# are installed only when they are present: a missing host is reported, not
# fatal.

set -eu

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail() {
  printf 'install-local: %s\n' "$1" >&2
  exit 1
}

command -v node >/dev/null 2>&1 || fail "node is not on PATH. CodeTour needs Node.js 24.18.0 (see .nvmrc)."
command -v npm >/dev/null 2>&1 || fail "npm is not on PATH."
code_cmd="$(command -v code || true)"
[ -n "$code_cmd" ] || fail "The VS Code 'code' command is not on PATH. In VS Code, run the command palette entry \"Shell Command: install 'code' command in PATH\" (macOS), then retry."

# Install dependencies only where they are missing; a repeat run stays fast.
[ -d node_modules ] || npm ci
[ -d packages/description-renderer/node_modules ] || npm ci --prefix packages/description-renderer
[ -d packages/knowledge/node_modules ] || npm ci --prefix packages/knowledge
[ -d packages/mcp-server/node_modules ] || npm ci --prefix packages/mcp-server

printf 'Building and packaging the VSIX from %s...\n' "$root"
npm run package

case "$(uname -s)" in
  Darwin) vsix_os=darwin ;;
  Linux) vsix_os=linux ;;
  MINGW* | MSYS* | CYGWIN*) vsix_os=win32 ;;
  *) fail "Unsupported operating system '$(uname -s)'." ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) vsix_arch=arm64 ;;
  x86_64 | amd64) vsix_arch=x64 ;;
  *) fail "Unsupported architecture '$(uname -m)'." ;;
esac
target="$vsix_os-$vsix_arch"
version="$(node -p "require('./package.json').version")"
vsix="$root/codetour-$target-$version.vsix"
[ -f "$vsix" ] || fail "Expected $vsix after packaging, but it is missing."

printf 'Installing the VS Code extension from %s...\n' "$(basename "$vsix")"
"$code_cmd" --install-extension "$vsix" --force || fail "VS Code refused to install $vsix."

printf 'Exposing the codetour CLI from this checkout on PATH (npm link)...\n'
existing="$(command -v codetour || true)"
if [ -n "$existing" ]; then
  resolved="$(readlink -f "$existing" 2>/dev/null || true)"
  if [ -n "$resolved" ] && [ "$resolved" != "$root" ] && [ "${resolved#"$root"/}" = "$resolved" ]; then
    printf 'install-local: an existing codetour at %s (resolves to %s) will be repointed to this checkout.\n' "$existing" "$resolved" >&2
  fi
fi
npm link >/dev/null || fail "npm link failed."
command -v codetour >/dev/null 2>&1 || fail "codetour is still not on PATH after npm link."

printf 'Installing the compatible agent integrations (codetour --install)...\n'
codetour --install || fail "codetour --install failed for at least one agent."

printf '\nInstalled from this checkout:\n'
printf '  - VS Code extension codetour (maurice30120), %s, from %s\n' "$version" "$(basename "$vsix")"
printf '  - codetour CLI on PATH -> %s/dist/cli.js\n' "$root"
printf '  - agent integrations for every host present (Copilot plugin surfaces, Pi package)\n'
printf '  - MCP for those sessions served by the installed surface as: codetour mcp --workspace-root <workspace>\n'
printf '\nVerify:\n'
printf '  code --list-extensions --show-versions | grep codetour\n'
printf '  codetour --agents\n'
if command -v copilot >/dev/null 2>&1; then
  printf '  copilot plugin list && copilot mcp list && copilot skill list\n'
else
  printf '  (GitHub Copilot CLI not found on PATH; install 1.0.106+ then re-run codetour --install.)\n'
fi
if command -v pi >/dev/null 2>&1; then
  printf '  pi list && pi mcp list\n'
else
  printf '  (Pi not found on PATH; install it then re-run codetour --install.)\n'
fi
printf '\nReload the VS Code window to load the installed version. For Codex, run the VS Code\n'
printf 'command "CodeTour IA: Configure MCP for Codex" from the command palette.\n'
