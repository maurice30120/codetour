#!/bin/bash
# Runs the knowledge_injection benchmark (.benchmark-20261127-injection) once the
# main 20261127 benchmark (creation + blind evaluation) is fully finished.
# Both benchmarks share the TokenEconomizer state dir, so this waits for slot-12.
set -u

ORIG=/Users/dhuyet/Documents/POC/CodeTOUR+Economiser/.benchmark-20261127
BENCH=/Users/dhuyet/Documents/POC/CodeTOUR+Economiser/.benchmark-20261127-injection
LOG="$BENCH/logs/runner.out"
mkdir -p "$BENCH/logs"

exec >>"$LOG" 2>&1
echo "=== injection benchmark runner started $(date) ==="

echo "waiting for the main benchmark (12 evals recorded, no bench.py running)..."
while true; do
  if [ -f "$ORIG/eval/slot-12.json" ] && ! pgrep -f "bench.py" >/dev/null 2>&1; then
    echo "main benchmark done ($(date)); grace period 120s for late folds..."
    sleep 120
    if [ -f "$ORIG/eval/slot-12.json" ] && ! pgrep -f "bench.py" >/dev/null 2>&1; then
      break
    fi
  fi
  sleep 60
done

echo "=== creation runs $(date) ==="
cd "$BENCH"
python3 bench.py status
for id in $(python3 -c "import json; print(' '.join(e['id'] for e in json.load(open('plan.json'))['runs']))"); do
  echo "--- run $id $(date) ---"
  python3 bench.py run "$id" 2>&1 | tail -8
done
python3 bench.py status

echo "=== evaluations $(date) ==="
count=$(python3 -c "import json; print(len(json.load(open('plan.json'))['runs']))")
for n in $(seq 1 "$count"); do
  echo "--- eval $n $(date) ---"
  python3 bench.py eval "$n" 2>&1 | tail -4
done
python3 bench.py status
echo "=== injection benchmark finished $(date) ==="
