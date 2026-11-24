#!/usr/bin/env bash
# Install both checkouts into the user's Pi and Copilot CLI installations.
set -euo pipefail
root="$(cd -- "$(dirname -- "$0")" && pwd -P)"
ct="$root/codetour"
te="$root/TokenEconomizer"
usage() {
  cat <<'HELP'
Usage: ./install-local.sh [--pi | --copilot] [--help]

Build CodeTour from ./codetour and install its local integration plus the
./TokenEconomizer plugin into Pi and GitHub Copilot CLI (both by default).
--pi or --copilot limits installation to that host. Existing installations of
these named plugins may be replaced; other plugins and settings are preserved.
Launch agents with ./launch-local.sh pi or ./launch-local.sh copilot to use
the isolated Python environment. Re-run after source changes; keep both
checkouts in place. The commands modify user-level host configuration and may
need network access for npm and Python dependencies.
HELP
}
pi=1; copilot=1
case "${1:-}" in
  '') ;;
  --pi) copilot=0 ;;
  --copilot) pi=0 ;;
  -h|--help) usage; exit 0 ;;
  *) usage >&2; exit 2 ;;
esac
[ "$#" -le 1 ] || { usage >&2; exit 2; }
fail() { printf 'install-local: %s\n' "$*" >&2; exit 1; }
for cmd in node npm; do command -v "$cmd" >/dev/null || fail "$cmd is required on PATH"; done
if (( pi )); then command -v pi >/dev/null || fail 'pi is required on PATH (or use --copilot)'; fi
if (( copilot )); then command -v copilot >/dev/null || fail 'copilot is required on PATH (or use --pi)'; fi
[ -f "$ct/package.json" ] && [ -f "$te/package.json" ] || fail 'expected codetour and TokenEconomizer checkouts beside this script'

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
for dir in "$ct" "$ct/packages/description-renderer" "$ct/packages/knowledge" "$ct/packages/mcp-server"; do
  [ ! -f "$dir/package-lock.json" ] || [ -d "$dir/node_modules" ] || npm ci --prefix "$dir"
done
# Embedded integrations must be regenerated before building the CLI.
npm --prefix "$ct" run embed:copilot-plugin
npm --prefix "$ct" run embed:pi-plugin
npm --prefix "$ct" run build
cli="$ct/dist/cli.js"
[ -f "$cli" ] || fail "build did not produce $cli"
if (( pi )); then
  printf '\nInstalling CodeTour and TokenEconomizer in Pi...\n'
  node "$cli" --install pi
  pi install "$te"
fi
if (( copilot )); then
  printf '\nInstalling CodeTour and TokenEconomizer in Copilot CLI...\n'
  node "$cli" --install copilot
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
printf '\nInstallation complete. Start new sessions in a trusted project.\n'
(( pi == 0 )) || printf 'Pi: /codetour and /te status (built-in MCP must be enabled).\n'
(( copilot == 0 )) || printf 'Copilot: /tokeneconomizer:status; run /tokeneconomizer:toolprune refresh-catalog once and after Copilot updates.\n'
printf 'Launch with ./launch-local.sh pi or ./launch-local.sh copilot so plugins use the isolated Python.\n'
printf 'Keep both checkouts at their current paths; rerun this script after changes.\n'
