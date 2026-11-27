# Protocole de test — Benchmark 20261127-injection (points d'injection du knowledge)

Même protocole que `.benchmark-20261127/` (voir son PROTOCOL.md), sur **une seule
variable** : l'endroit où le knowledge est injecté. C'est une sous-variante du groupe C
(knowledge `on`, microskills `off`), **comptée séparément** du benchmark principal.

## Ce que mesure le benchmark

| Groupe | Knowledge | Microskills | knowledge_injection |
|---|---|---|---|
| C-startup | on | off | `startup` (injection au SessionStart) |
| C-tools | on | off | `tools` (injection sur les appels d'outils) |
| C-both | on | off | `both` (les deux) |

- **Plan gelé** : 3 cycles ; chaque cycle est une permutation aléatoire de
  C-startup, C-tools, C-both (9 runs au total). Seed fixe : `20261127` → plan
  reproductible à l'identique.
- **Conditions initiales identiques au benchmark principal** : `state/te-state`
  (snapshot TE) et `state/knowledge-template.json` (connaissance seedée) sont des
  **copies du benchmark 20261127** — même code (commit `c248a4ab`), même prompt,
  même modèle (`mistral/deepseek-v4-1-flash-1017:high`), même rubrique d'évaluation.
- **Un run** = une session `pi -p` neuve dans un worktree détaché sous
  `/private/tmp/codetour-bench-20261127-injection/runs/`, timeout 1500 s.
- **Vérification de l'injection** : chaque run enregistre une `injection_probe`
  (bytes injectés, hash, nb de cartes knowledge) dans `configs/<id>.json`. **Limites
  constatées** : la probe ne teste que le point `startup` (jamais `tools`), et elle
  a mesuré 0 byte même quand la session réelle a reçu le knowledge (exécution du
  2026-11-27). La vérification fiable est le **scan post-run des transcripts** de la
  session réelle (voir section dédiée ci-dessous).
- **Évaluation** : identique au benchmark principal — à l'aveugle, id masqué, ordre
  mélangé (seed + 1), critères `exactitude_technique`, `exhaustivite`, `absence_erreurs`
  sur 10, note globale = moyenne.

## Fichiers produits

```
plan.json            plan gelé (3 cycles × 3 variantes)
env/versions.json    versions (dont base_benchmark = .benchmark-20261127)
state/te-state       snapshot TE copié du benchmark principal (restauré avant chaque run)
state/knowledge-template.json   connaissance seedée (copie du benchmark principal)
configs/<id>.json    config demandée/effective + injection_probe par run
runs/<id>.json       enregistrement complet par run
tours/<id>.tour      copie du tour créé par run
logs/<id>.log        stdout/stderr ; logs/probe-<run>.jsonl : transcript probe
eval-plan.json       ordre d'évaluation masqué (slot → run id)
eval/slot-XX.json    scores par évaluation
runner.sh            lancement séquentiel complet (attente + runs + évals)
logs/runner.out      journal du lancement séquentiel
```

## Prérequis

Identiques au benchmark principal (workspace, CLI `te`, hook `te-hook` pour l'hôte `pi`,
CLI `pi`, Python 3 stdlib). Les copies de `state/te-state` et
`state/knowledge-template.json` doivent être présentes (elles le sont dans le dépôt).

## Commandes

```bash
cd .benchmark-20261127-injection

python3 bench.py setup     # gèle versions, écrit plan.json, crée les 9 worktrees
python3 bench.py run <id>  # un run de création mesuré (ex : benchmark-C-startup-01)
python3 bench.py eval <n>  # une évaluation à l'aveugle (n = 1..9, ordre mélangé)
python3 bench.py status    # état des runs et des évals enregistrés
```

## Rejouer le benchmark complet

1. **Réinitialiser** l'espace de travail :
   ```bash
   git -C /Users/dhuyet/Documents/POC/CodeTOUR+Economiser worktree list
   git -C /Users/dhuyet/Documents/POC/CodeTOUR+Economiser worktree remove --force /private/tmp/codetour-bench-20261127-injection/runs/run-*   # (un par un, adapter)
   rm -f plan.json eval-plan.json
   rm -rf runs configs tours logs eval metrics
   ```
2. **Setup** : `python3 bench.py setup` (régénère le même plan — seed fixe — et les worktrees).
   Si `state/te-state` ou `state/knowledge-template.json` manquent, les recopier depuis
   `.benchmark-20261127/state/` avant.
3. **Runs** (séquentiels, dans l'ordre du plan) :
   ```bash
   for id in $(python3 -c "import json; print(' '.join(e['id'] for e in json.load(open('plan.json'))['runs']))"); do
     python3 bench.py run "$id" 2>&1 | tail -4
   done
   ```
4. **Évals** (à l'aveugle) :
   ```bash
   for n in $(seq 1 9); do python3 bench.py eval "$n" 2>&1 | tail -2; done
   ```
5. `python3 bench.py status`, puis comparer les moyennes par variante
   (startup / tools / both) sur les 3 cycles : qualité (note globale et critères),
   coût, durée, et bytes injectés (`injection_probe`).

### Alternative : `runner.sh`

`runner.sh` fait tout séquentiellement, **en attendant d'abord la fin du benchmark
principal** (12 évals enregistrés et aucun `bench.py` actif), avec 120 s de grâce pour
les folds TE :

```bash
./runner.sh   # journal : logs/runner.out
```

## Vérification post-run de l'injection (transcripts)

La probe officielle ne couvrant que le point `startup` (et s'étant révélée
inopérante en pratique), la livraison réelle se vérifie **après le run**, dans le
fichier `.jsonl` de la session `pi` (chemin `session_file` dans `runs/<id>.json`) :

- injection `startup` : le bloc `<tokeneconomizer> # Knowledge from earlier
  sessions …` est présent dans le premier message utilisateur (~1050 B) ;
- injection `tools` : des messages `custom_message` de type `tokeneconomizer`
  (contenu commençant par `# Knowledge from earlier sessions`, 400–750 B) suivent
  les `toolResult`, autour des appels d'outils.

Comptage attendu sur l'exécution du 2026-11-27 (9 sessions) : C-startup = 1 bloc
startup ; C-tools = 2 injections tools par run ; C-both = startup + injections
tools. Un run `knowledge=on` sans **aucune** occurrence est un run invalide pour sa
variante : le harnais doit le faire échouer au lieu de l'enregistrer comme
`success` (voir anomalies et garde-fous).

## Anomalies connues (exécution du 2026-11-27)

- **`benchmark-C-both-01` n'a reçu aucun knowledge** (probe à 0 byte et transcript
  vide : ni startup ni tools). Premier run du benchmark, enregistré `success` alors
  qu'il vaut en réalité pour un run « knowledge off ». À exclure ou à signaler dans
  les comparaisons de variantes (sa note 7,7 tire C-both vers le bas).
- **3 évals sur 9 ont perdu leur score au parsing** (slots 04, 08, 09 — la regex à
  accolades casse sur le JSON du juge). Les scores ont été récupérés depuis les
  transcripts des sessions d'évaluation (`reparsed_from_session: true`), **sans
  réévaluation**, comme pour le benchmark principal.

## Biais connu : le juge

- **Même modèle que le générateur, une seule passe** : un modèle note bien son propre
  travail, et aucune seconde opinion n'est recueillie.
- **Le juge reçoit lui-même l'injection TE testée** : la session d'évaluation hérite
  de la configuration TE du dernier run (C-startup-03 : `knowledge=on`,
  `knowledge_injection=startup`). Le juge voit donc les cartes de knowledge qu'on
  évalue — il corrige le tour avec la solution sous les yeux.
- Conséquence : les comparaisons entre variantes restent valides (biais identique),
  mais les notes absolues ne sont pas comparables à celles du benchmark principal,
  dont le juge recevait le manuel microskills et non le knowledge.
- À corriger avant de conclure : neutraliser TE pendant les évals (désactiver le hook
  pour les sessions juge), et idéalement utiliser un juge différent du modèle
  générateur.

## Garde-fous

- **Ne jamais lancer ce benchmark pendant que le benchmark principal tourne** : les deux
  partagent le même état TE (`~/.tokeneconomizer/repos/codetour-10c5c88374`) ; chaque
  `run` efface et restaure cet état, un parallélisme fausserait les deux.
- Comparaison valide uniquement si les conditions initiales restent celles du benchmark
  principal : ne pas régénérer `state/te-state` ni `knowledge-template.json` soi-même.
- Les 3 variantes partent du même groupe C : knowledge `on`, microskills `off` ; seule
  `knowledge_injection` change. Les résultats sont à comparer entre variantes, et avec
  le groupe C du benchmark principal (injection `both`, compté là-bas séparément).
- Un run `knowledge=on` dont la vérification post-run (scan des transcripts) ne montre
  **aucune** livraison est invalide pour sa variante : le harnais doit le faire
  échouer, pas l'enregistrer `success` (a manqué `C-both-01` le 2026-11-27).
- Parser les scores d'éval avec le décodeur JSON complet + `reparse` du benchmark
  principal, pas avec la regex à accolades (3 évals sur 9 perdues le 2026-11-27).
