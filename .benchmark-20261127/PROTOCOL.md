# Protocole de test — Benchmark 20261127 (groupes A/B/C/D)

Benchmark CodeTour × TokenEconomizer : mesurer l'effet de **knowledge** et **microskills**
sur la qualité et le coût de la génération d'un CodeTour par l'agent Pi, puis évaluer les
tours à l'aveugle.

## Ce que mesure le benchmark

| Groupe | Knowledge | Microskills | knowledge_injection |
|---|---|---|---|
| A | off | off | — |
| B | off | on | — |
| C | on | off | `both` |
| D | on | on | `both` |

- **Plan gelé** : 3 cycles ; chaque cycle est une permutation aléatoire de A, B, C, D
  (12 runs au total). Seed fixe : `20261127` → plan reproductible à l'identique.
- **Code sous test** : le commit enregistré dans `env/versions.json` (`git_commit`),
  monté dans un worktree détaché par run, sous `/private/tmp/codetour-bench-20261127/runs/`.
- **État initial identique** : avant chaque run, l'état TokenEconomizer est restauré depuis
  `state/te-state` (snapshot gelé au setup) et la **connaissance seedée** est copiée depuis
  `state/knowledge-template.json` (même connaissance initiale pour tous les runs).
- **Modèle** : `mistral/deepseek-v4-1-flash-1017:high`, thinking `high`, un run = une
  session `pi -p` neuve (timeout 1500 s).
- **Métriques enregistrées** : statut, durée, tokens (input/output/cache), coût, nb de
  messages/tool calls, résumé du tour (étapes, locators, mermaid), probe d'injection
  (bytes injectés au SessionStart, cartes knowledge), fold TE enregistré ou non.
- **Évaluation** : à l'aveugle — l'évaluateur voit `.tours/project.tour` (identifiant
  masqué) et note sur 10 : `exactitude_technique`, `exhaustivite`, `absence_erreurs`
  (note globale = moyenne). Ordre d'évaluation mélangé (seed + 1), indépendant de
  l'ordre des runs.

## Fichiers produits

```
plan.json            plan gelé (seed, groupes, runs, worktrees)
env/versions.json    versions + commit gelés au setup
state/te-state       snapshot TE initial (restauré avant chaque run)
state/knowledge-template.json   connaissance seedée (identique pour tous les runs)
configs/<id>.json    config demandée/effective + probe d'injection par run
runs/<id>.json       enregistrement complet par run (métriques, tour, statut)
tours/<id>.tour      copie du tour créé par run
logs/<id>.log        stdout/stderr du run ; logs/probe-<run>.jsonl : transcript probe
eval-plan.json       ordre d'évaluation masqué (slot → run id)
eval/slot-XX.json    scores par évaluation
results.md           synthèse des résultats finaux
```

## Prérequis

- Workspace `CodeTOUR+Economiser` (repo codetour + sous-module TokenEconomizer).
- `REPO/.tokeneconomizer-venv/bin/te` (CLI TokenEconomizer) fonctionnel.
- Hook TE installé pour l'hôte `pi` : `REPO/TokenEconomizer/plugin/scripts/te-hook`.
- `pi -p --model mistral/deepseek-v4-1-flash-1017:high` fonctionnel.
- Connaissance seedée présente dans l'état TE (une session d'exploration read-only
  réalisée avant le benchmark). Un seul fichier attendu dans
  `~/.tokeneconomizer/repos/codetour-10c5c88374/pi/mechanisms/knowledge_state/`.
- Python 3 (stdlib uniquement).

Chemins codés en dur dans `bench.py` (`REPO`, `STATE`, `TMPROOT`) : à adapter si on
rejoue ailleurs.

## Commandes

```bash
cd .benchmark-20261127

python3 bench.py setup     # gèle versions, snapshot l'état TE, écrit plan.json, crée les 12 worktrees
python3 bench.py run <id>  # un run de création mesuré (ex : benchmark-D-01)
python3 bench.py eval <n>  # une évaluation à l'aveugle (n = 1..12, dans l'ordre mélangé)
python3 bench.py status    # état des runs et des évals enregistrés
```

## Rejouer le benchmark complet

1. **Vérifier** que l'état TE contient bien la connaissance seedée (voir prérequis) ;
   sinon la recopier depuis `state/knowledge-template.json` :
   ```bash
   KEY=$(python3 -c "import hashlib,os; print('maurice30120__codetour--%s.json' % hashlib.sha256(os.fsencode(os.path.realpath('/Users/dhuyet/Documents/POC/CodeTOUR+Economiser'))).hexdigest())")
   cp state/knowledge-template.json ~/.tokeneconomizer/repos/codetour-10c5c88374/pi/mechanisms/knowledge_state/$KEY
   ```
2. **Réinitialiser** l'espace de travail :
   ```bash
   git -C /Users/dhuyet/Documents/POC/CodeTOUR+Economiser worktree list   # lister les worktrees du bench
   git -C /Users/dhuyet/Documents/POC/CodeTOUR+Economiser worktree remove --force /private/tmp/codetour-bench-20261127/runs/run-*   # (un par un, adapter)
   rm -f plan.json eval-plan.json
   rm -rf runs configs tours logs eval metrics
   ```
3. **Setup** : `python3 bench.py setup` (régénère le même plan — seed fixe — et les worktrees).
4. **Runs** (séquentiels, dans l'ordre du plan) :
   ```bash
   for id in $(python3 -c "import json; print(' '.join(e['id'] for e in json.load(open('plan.json'))['runs']))"); do
     python3 bench.py run "$id" 2>&1 | tail -4
   done
   ```
5. **Évals** (à l'aveugle, ordre mélangé) :
   ```bash
   for n in $(seq 1 12); do python3 bench.py eval "$n" 2>&1 | tail -2; done
   ```
6. `python3 bench.py status`, puis synthétiser avec les mêmes calculs que `results.md`
   (moyennes par groupe sur les 3 cycles).

## Biais connu : le juge

- **Même modèle que le générateur, une seule passe** : un modèle note bien son propre
  travail, et aucune seconde opinion n'est recueillie.
- **Le juge reçoit lui-même l'injection TE** : la session d'évaluation hérite de la
  configuration TE active (`bench.py eval` ne neutralise pas TE). Le dernier run
  (B-03) laisse `microskills=on` — le juge reçoit donc le manuel microskills (~480 B)
  pendant toutes les évals.
- À corriger avant de conclure : neutraliser TE pendant les évals (désactiver le hook
  pour les sessions juge), et idéalement utiliser un juge différent du modèle
  générateur.

## Garde-fous

- **Ne jamais lancer deux benchmarks en parallèle** : ils partagent le même état TE
  (`~/.tokeneconomizer/repos/codetour-10c5c88374`) — chaque `run` efface et restaure
  cet état ; un parallélisme fausserait les runs et les évals.
- `plan.json` est gelé : `setup` refuse de le régénérer tant qu'il existe.
- Un run est « success » seulement si le tour a été créé, exit code 0, sans timeout.
- Les sous-variantes du point d'injection (`startup` / `tools` / `both`) sont couvertes
  par le benchmark dédié `.benchmark-20261127-injection/` (voir son PROTOCOL.md) ;
  ici le groupe C utilise `both`.
