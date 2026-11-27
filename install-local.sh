#!/usr/bin/env bash
# Install the local agent integrations and refresh CodeTour in VS Code Insiders.
set -euo pipefail
root="$(cd -- "$(dirname -- "$0")" && pwd -P)"
ct="$root/codetour"
te="$root/TokenEconomizer"
usage() {
  cat <<'HELP'
Usage: ./install-local.sh [--pi | --copilot | --insiders] [--help]

Build CodeTour from ./codetour and install its local integration plus the
./TokenEconomizer plugin into Pi and GitHub Copilot CLI (both by default).
--pi or --copilot selects the agent integration to install. If VS Code Insiders
is detected, its CodeTour extension is refreshed from the local build as well.
--insiders installs only the CodeTour extension in VS Code Insiders.
Existing installations of these named plugins may be replaced; other plugins
and settings are preserved.
The CodeTour command line is installed as a real package in the global npm
prefix, so `codetour` stays on PATH for both hosts and keeps working if this
checkout moves; re-running this script replaces it with the revision it builds.
Launch agents with ./launch-local.sh pi or ./launch-local.sh copilot to use
the isolated Python environment. Re-run after source changes; keep both
checkouts in place. The commands modify user-level host configuration and may
need network access for npm and Python dependencies.
HELP
}
pi=1; copilot=1; insiders_only=0
case "${1:-}" in
  '') ;;
  --pi) copilot=0 ;;
  --copilot) pi=0 ;;
  --insiders) pi=0; copilot=0; insiders_only=1 ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { usage >&2; exit 2; }
fail() { printf 'install-local: %s\n' "$*" >&2; exit 1; }
for cmd in node npm; do command -v "$cmd" >/dev/null || fail "$cmd is required on PATH"; done
[ -f "$ct/package.json" ] || fail 'expected the codetour checkout beside this script'

insiders="$(type -P code-insiders || true)"
if [ -z "$insiders" ] && [ "$(uname -s)" = Darwin ]; then
  for app_dir in /Applications "$HOME/Applications"; do
    candidate="$app_dir/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code-insiders"
    if [ -x "$candidate" ]; then insiders="$candidate"; break; fi
  done
fi

prepare_codetour_dependencies() {
  local dir
  for dir in "$ct" "$ct/packages/description-renderer" "$ct/packages/tour-generation"; do
    [ ! -f "$dir/package-lock.json" ] || [ -d "$dir/node_modules" ] || npm ci --prefix "$dir"
  done
}

package_codetour() {
  local target
  target="$(node -p 'require(process.argv[1]).hostTarget()' "$ct/scripts/prepare-resvg-runtime.js")"
  vsix="$ct/$(node -p '
    const pkg = require(process.argv[1]);
    `${pkg.name}-${process.argv[2]}-${pkg.version}.vsix`;
  ' "$ct/package.json" "$target")"
  CODETOUR_TARGET="$target" npm --prefix "$ct" run package
  [ -f "$vsix" ] || fail "packaging did not produce $vsix"
}

install_codetour_insiders() {
  printf '\nInstalling CodeTour in VS Code Insiders...\n'
  "$insiders" --install-extension "$vsix" --force
  printf 'Reload any open VS Code Insiders window to load this build.\n'
}

if (( insiders_only )); then
  [ -n "$insiders" ] || fail 'VS Code Insiders not found; put code-insiders on PATH'
  prepare_codetour_dependencies
  package_codetour
  install_codetour_insiders
  exit 0
fi

if (( pi )); then command -v pi >/dev/null || fail 'pi is required on PATH (or use --copilot)'; fi
if (( copilot )); then command -v copilot >/dev/null || fail 'copilot is required on PATH (or use --pi)'; fi
[ -f "$te/package.json" ] || fail 'expected the TokenEconomizer checkout beside this script'

# Refuse to commandeer a marketplace with the same name from another checkout.
if (( copilot )); then
  marketplaces="$(copilot plugin marketplace list --json)" || fail 'could not list Copilot marketplaces'
  state="$(printf '%s' "$marketplaces" | node -e '
    let s=""; process.stdin.on("data", x => s += x); process.stdin.on("end", () => {
      try { const m = JSON.parse(s).find(x => x.name === "tokeneconomizer");
        console.log(!m ? "missing" : m.source === "Local: " + process.argv[1] ? "local" : "conflict");
      } catch(e) { console.error(e.message); process.exit(1); }
    });' "$te")" || fail 'could not parse Copilot marketplace list'
  [ "$state" != conflict ] || fail "Copilot already has a tokeneconomizer marketplace from another source; inspect it with copilot plugin marketplace list"
fi

# The host processes must inherit TE_PYTHON; launch-local.sh supplies it without
# changing the user's shell or host settings. Never reuse an unrelated venv.
venv="$root/.tokeneconomizer-venv"
if [ -e "$venv" ] && [ ! -f "$venv/.local-install-owned" ]; then
  fail "refusing to modify existing unowned environment: $venv"
fi
if [ ! -e "$venv" ]; then
  python_cmd=""
  for candidate in python3 python3.14 python3.13 python3.12 python3.11 python3.10; do
    if command -v "$candidate" >/dev/null && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3,10))'; then
      python_cmd="$candidate"; break
    fi
  done
  [ -n "$python_cmd" ] || fail 'Python 3.10 or later is required'
  "$python_cmd" -m venv "$venv"
  : > "$venv/.local-install-owned"
fi
[ -x "$venv/bin/python" ] || fail "invalid environment at $venv"
printf 'Installing TokenEconomizer and its Python dependencies in %s\n' "$venv"
"$venv/bin/python" -m pip install -e "$te"
"$venv/bin/python" -c 'from tree_sitter_language_pack import get_parser; get_parser("python")' || fail 'Tree-sitter parser verification failed'

printf 'Building CodeTour from %s\n' "$ct"
prepare_codetour_dependencies
# Embedded integrations must be regenerated before building the CLI.
npm --prefix "$ct" run embed:copilot-plugin
npm --prefix "$ct" run embed:pi-plugin
if [ -n "$insiders" ]; then
  package_codetour
else
  npm --prefix "$ct" run build
fi
cli="$ct/dist/cli.js"
[ -f "$cli" ] || fail "build did not produce $cli"
# The bundle is written without the executable bit: the global `codetour` entry
# is a symlink to it, and the command would answer "Permission denied".
chmod +x "$cli"

# Both hosts need `codetour` on PATH by name (the Copilot skill and the Pi
# launcher.json invoke the command, not a checkout path), so the CLI goes into
# the global npm prefix as a real package rather than a symlink into the
# checkout: a link dies with the checkout, as happened before. Each run of this
# script replaces that package with the revision just built.
#
# The staged package.json declares the only two runtime externals of the CLI
# bundle (webpack.config.js: `@b9g/termdom` and `punycode/`; the rasterizer
# travels inside dist/resvg-runtime). The `--help` probe below is what proves
# the closure is complete before the hosts are installed.
printf 'Installing the CodeTour CLI in the global npm prefix\n'
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/package"
cp -R "$ct/dist" "$stage/package/dist"
node -e '
  const fs = require("fs"), path = require("path");
  const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
  const src = read(process.argv[1]);
  const punycode = read(path.join(process.argv[2], "node_modules", "punycode", "package.json"));
  const staged = {
    name: src.name,
    version: src.version,
    description: src.description,
    license: src.license,
    bin: src.bin,
    dependencies: {
      "@b9g/termdom": src.dependencies["@b9g/termdom"],
      "punycode": punycode.version
    }
  };
  fs.writeFileSync(process.argv[3], JSON.stringify(staged, null, 2) + "\n");
' "$ct/package.json" "$ct" "$stage/package/package.json" \
  || fail 'could not prepare the global CodeTour package'
npm install -g --install-links --no-audit --no-fund "$stage/package" >/dev/null \
  || fail 'could not install codetour globally; check that the global npm prefix is writable'
bin="$(command -v codetour || true)"
[ -n "$bin" ] || fail 'codetour is not on PATH after the global install; check the global npm bin directory'
"$bin" --help >/dev/null || fail "the installed command $bin does not start: its runtime dependencies are incomplete"
printf 'CodeTour CLI: %s\n' "$bin"
if (( pi )); then
  printf '\nInstalling CodeTour and TokenEconomizer in Pi...\n'
  "$bin" --install pi
  pi install "$te"
fi
if (( copilot )); then
  printf '\nInstalling CodeTour and TokenEconomizer in Copilot CLI...\n'
  "$bin" --install copilot
  if [ "$state" = missing ]; then copilot plugin marketplace add "$te"; fi
  # Copilot reports an error on reinstall; preserve an already installed entry.
  plugins="$(copilot plugin list --json)" || fail 'could not list Copilot plugins'
  installed="$(printf '%s' "$plugins" | node -e '
    let s=""; process.stdin.on("data", x => s += x); process.stdin.on("end", () => {
      try { const p = JSON.parse(s).find(x => x.name === "tokeneconomizer" && x.marketplace === "tokeneconomizer"); console.log(!p ? "no" : p.source === "live" && p.installedFrom === process.argv[1] ? (p.enabled ? "yes" : "disabled") : "conflict"); }
      catch(e) { console.error(e.message); process.exit(1); }
    });' "$te")" || fail 'could not parse Copilot plugin list'
  [ "$installed" != conflict ] || fail 'existing TokenEconomizer plugin does not point live to this checkout; inspect copilot plugin list --json'
  if [ "$installed" = no ]; then copilot plugin install tokeneconomizer@tokeneconomizer; fi
  if [ "$installed" = disabled ]; then copilot plugin enable tokeneconomizer@tokeneconomizer; fi
fi
if [ -n "$insiders" ]; then install_codetour_insiders; fi
printf '\nInstallation complete. Start new sessions in a trusted project.\n'
(( pi == 0 )) || printf 'Pi: /codetour and /te status (built-in MCP must be enabled).\n'
(( copilot == 0 )) || printf 'Copilot: /tokeneconomizer:status; run /tokeneconomizer:toolprune refresh-catalog once and after Copilot updates.\n'
printf 'Launch with ./launch-local.sh pi or ./launch-local.sh copilot so plugins use the isolated Python.\n'
printf 'The global codetour command is a copy of this checkout: this script replaces it on every run.\n'
printf 'Keep both checkouts at their current paths; rerun this script after changes.\n'
