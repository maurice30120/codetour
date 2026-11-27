#!/usr/bin/env bash
# Run the selected host with the checkout's isolated TokenEconomizer Python.
set -euo pipefail
root="$(cd -- "$(dirname -- "$0")" && pwd -P)"
usage() {
  cat <<'HELP'
Usage : ./launch-local.sh {pi|copilot} [--memory=CHOIX] [arguments de l'outil...]

Lance Pi ou Copilot avec les versions locales de CodeTour et TokenEconomizer.
Exécutez d'abord ./install-local.sh pour préparer les intégrations et Python.

Choix de mémoire (valable uniquement pour cette session) :
  config     Utilise la configuration TE existante, sans la modifier (défaut).
  native     Active les micro-skills natifs de TE et désactive Knowledge.
  knowledge  Active Knowledge avec preuves et désactive les micro-skills natifs.
  both       Active les micro-skills natifs et Knowledge ensemble.
  off        Désactive ces deux mémoires pour la session.

Sans --memory, un menu est proposé dans un terminal ; sans terminal, la
configuration existante est utilisée. Les micro-skills natifs activés peuvent
faire appel à un modèle pour proposer des faits. Knowledge utilise aussi le
proposeur TE ; ses preuves sont vérifiées localement avant injection.
Ces choix ne modifient pas les autres mécanismes TE ni les réglages enregistrés.

Exemples :
  ./launch-local.sh pi
  ./launch-local.sh copilot --memory=knowledge
  ./launch-local.sh pi --memory=both
  ./launch-local.sh copilot --memory=off --experimental

  -h, --help  Affiche cette aide.
HELP
}
case "${1:-}" in
  -h|--help) usage; exit 0 ;;
  pi|copilot) host="$1"; shift ;;
  *) usage >&2; exit 2 ;;
esac
if [[ "${1:-}" == -h || "${1:-}" == --help ]]; then usage; exit 0; fi
python="$root/.tokeneconomizer-venv/bin/python"
[ -x "$python" ] && [ -f "$root/.tokeneconomizer-venv/.local-install-owned" ] || { printf 'Run ./install-local.sh first.\n' >&2; exit 1; }
export TE_PYTHON="$python"

# Choices apply only to this process and its children, not to saved TE settings.
memory=""
if [[ "${1:-}" == --memory=* ]]; then
  memory="${1#--memory=}"
  shift
elif [ -t 0 ]; then
  printf '\nQuelle mémoire activer pour cette session ?\n'
  printf '  1) Configuration existante (défaut)\n'
  printf '  2) Mémoire native TE (micro-skills)\n'
  printf '  3) Knowledge avec preuves\n'
  printf '  4) Les deux\n'
  printf '  5) Aucune\n'
  while :; do
    read -r -p 'Choix [1-5] : ' choice || exit 1
    case "$choice" in
      ''|1) memory=config; break ;;
      2) memory=native; break ;;
      3) memory=knowledge; break ;;
      4) memory=both; break ;;
      5) memory=off; break ;;
      *) printf 'Choisissez un nombre de 1 à 5.\n' >&2 ;;
    esac
  done
else
  memory=config
fi
case "$memory" in
  config) ;;
  native)    export TE_MICROSKILLS=on TE_KNOWLEDGE=off ;;
  knowledge) export TE_MICROSKILLS=off TE_KNOWLEDGE=on ;;
  both)      export TE_MICROSKILLS=on TE_KNOWLEDGE=on ;;
  off)       export TE_MICROSKILLS=off TE_KNOWLEDGE=off ;;
  *) printf 'Mémoire inconnue : %s (config, native, knowledge, both, off)\n' "$memory" >&2; exit 2 ;;
esac
exec "$host" "$@"
