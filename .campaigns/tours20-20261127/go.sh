#!/bin/sh
# Les vingt essais, l'un après l'autre. Chaque essai : foyer TE de sa variante, session Pi
# neuve, puis archivage du Tour produit hors du workspace.
set -u
cd "$(dirname "$0")" || exit 1
for run in $(python3 campaign.py list); do
  if [ -f "runs/$run/session.json" ] && [ -f "runs/$run/archive.json" ]; then
    echo "[$(date +%H:%M:%S)] $run déjà fait"
    continue
  fi
  echo "[$(date +%H:%M:%S)] $run prepare"
  python3 campaign.py prepare "$run" > /dev/null 2> "runs/$run/prepare.err"
  echo "[$(date +%H:%M:%S)] $run session"
  timeout 600 python3 session.py "$run" > "runs/$run/session.log" 2>&1
  python3 campaign.py archive "$run" > /dev/null 2> "runs/$run/archive.err"
  python3 - "$run" <<'PY'
import json, pathlib, sys
run = sys.argv[1]
d = pathlib.Path("runs") / run
try:
    s = json.loads((d / "session.json").read_text())
    end = json.loads((d / "end.json").read_text())
    created = s["created"]
    print(f"[done] {run} created={created} dialogue={s['dialogue']} exit={end['exit_code']}")
except Exception as error:  # noqa: BLE001 - a broken run is reported, not fatal
    print(f"[done] {run} session illisible : {error}")
PY
done
echo "[$(date +%H:%M:%S)] campagne terminée"
