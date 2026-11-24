# Protocole de test — CodeTour IA + TokenEconomizer (intégration locale)

Périmètre : branche `spec-304-integration` — CodeTour ne porte plus de mémoire ; Knowledge est
délégué à TokenEconomizer (TE), activable séparément et désactivé par défaut.

Tout se fait dans un terminal, depuis la racine du workspace :

```sh
cd /Users/dhuyet/Documents/POC/CodeTOUR+Economiser
```

Les deux dépôts doivent rester à leur emplacement actuel : les plugins installés pointent dessus
en dur.

---

## Étape 0 — Prérequis et état des lieux

| Outil | Attendu | Vérification |
| --- | --- | --- |
| node / npm | 24.x / 12.x (voir `volta` dans `codetour/package.json`) | `node -v && npm -v` |
| python3 | ≥ 3.10 | `python3 -V` |
| pi | ≥ 1.6.0, authentifié | `pi --version` |
| copilot | CLI installée | `copilot --version` |
| git | présent | `git --version` |

Contrôle d'état avant toute chose :

```sh
git status --short --branch
git -C TokenEconomizer status --short --branch
pi list
copilot plugin list --json
```

**Point de vigilance relevé le 2026-11-24** : `pi list` peut montrer TokenEconomizer **deux fois**
(`git:github.com/microsoft/TokenEconomizer` *et* le chemin local). Le plugin local est celui que
`install-local.sh` gère ; le doublon git charge une seconde copie du plugin. À supprimer avant de
tester, sinon les résultats de mémoire/Knowledge ne sont pas attribuables :

```sh
pi remove git:github.com/microsoft/TokenEconomizer
```

Critère de sortie de l'étape : une seule entrée TE par hôte, worktrees `wt-*/` absents des
chemins de plugins.

---

## Étape 1 — Installation

```sh
./install-local.sh              # Pi + Copilot CLI
./install-local.sh --pi         # Pi seulement
./install-local.sh --copilot    # Copilot seulement
```

Ce que le script fait, dans cet ordre (à vérifier dans la sortie) :

1. contrôle `node`, `npm`, puis `pi` / `copilot` selon la cible ;
2. refuse un marketplace Copilot `tokeneconomizer` provenant d'un autre chemin ;
3. crée `./.tokeneconomizer-venv` (marqueur `.local-install-owned`) et y installe TE en `-e` ;
4. vérifie le parseur tree-sitter : `get_parser("python")` doit répondre sans traceback ;
5. `npm ci` si `node_modules` manque, puis `embed:copilot-plugin`, `embed:pi-plugin`, `build` ;
6. `node codetour/dist/cli.js --install pi|copilot`, `pi install ./TokenEconomizer`,
   `copilot plugin marketplace add ./TokenEconomizer`, `copilot plugin install tokeneconomizer@tokeneconomizer`.

Attendu : la dernière ligne est `Installation complete.`

Échecs fréquents et lecture :

| Message | Cause | Correction |
| --- | --- | --- |
| `refusing to modify existing unowned environment` | venv existant sans marqueur | inspecter puis supprimer `.tokeneconomizer-venv` |
| `Copilot already has a tokeneconomizer marketplace from another source` | marketplace pointant ailleurs | `copilot plugin marketplace list --json` |
| `Tree-sitter parser verification failed` | deps Python KO | relancer `./.tokeneconomizer-venv/bin/python -m pip install -e ./TokenEconomizer` |
| `build did not produce .../dist/cli.js` | build TS cassé | voir la sortie webpack |

À relancer **après chaque modification de source** : rien n'est rechargé à chaud.

---

## Étape 2 — Vérifications post-installation (statique, aucune session)

```sh
node codetour/dist/cli.js --agents
node codetour/dist/cli.js --doctor
./.tokeneconomizer-venv/bin/te --cwd "$PWD/codetour" status
./.tokeneconomizer-venv/bin/te --cwd "$PWD/codetour" config show
copilot plugin list --json
```

Attendu (relevé sur la machine de référence) :

- `--agents` liste `copilot`, `pi`, `vscode` en `installed` ;
- `--doctor` commence par `OK: git …` puis une ligne par hôte, sans warning ;
- `te config show` contient `"knowledge": false` (défaut) ;
- `copilot plugin list --json` montre `tokeneconomizer` avec `"source": "live"` et
  `"installedFrom"` égal au chemin local.

Contrôle du flag Knowledge (il est lu dans `TokenEconomizer/tokeneconomizer/plugin/config.py`,
table `_ENV`, ligne `TE_KNOWLEDGE` → clé `knowledge`) :

```sh
TE_KNOWLEDGE=on ./.tokeneconomizer-venv/bin/te config show | grep knowledge   # true
./.tokeneconomizer-venv/bin/te config show | grep knowledge                   # false
```

---

## Étape 3 — Tests automatisés

### 3.1 CodeTour (rapide, à lancer avant tout commit)

```sh
cd codetour && npm run check:fast && cd ..
```

Attendu : `tsc --noEmit` silencieux, `58` tests `pass`, `0` fail, ≈ 15 s.

### 3.2 CodeTour (suite complète)

```sh
cd codetour && npm test && cd ..
```

Enchaîne `workspace-identity`, build, compilation des tests, suite compilée, `description-renderer`,
`mcp-server`, puis les tests d'intégration hôte (`copilot-adapter`, `copilot-hook`,
`copilot-plugin-install`, `pi-guard`, `pi-plugin-install`, `pi-extension`, `cli-resolution`,
`pre-commit-hook`). Plusieurs minutes. Critère : code de sortie `0`.

### 3.3 Smoke Pi réel (opt-in, manuel)

```sh
cd codetour
npx tsc -p tsconfig.test.json
CODETOUR_PI_SMOKE=1 node --test dist/test/agent/piAgentSmoke.test.js
```

Exige `pi` **et** `pi-acp` sur le PATH, une session Pi déjà authentifiée, un shell POSIX.
Vérifie la négociation ACP, la surface d'outils effective (`read, grep, find, ls` seulement) et
une vraie question/réponse. Sans la variable, le fichier se saute : c'est normal.

### 3.4 TokenEconomizer

> **Piège à connaître** : la suite doit tourner avec l'interpréteur du venv, pas `python3`.
> Lancée avec le Python système (sans `tree_sitter_language_pack`), elle échoue en faux négatif :
> `ModuleNotFoundError: tree_sitter_language_pack` et `assert proof` à `None` pour `code.js`
> dans `tests/test_knowledge_proof.py`. Ce n'est pas un bug applicatif : `symbol_proof()` retourne
> `None` quand aucun parseur n'est disponible. Avec le venv, le même fichier passe (`6 passed`).

`install-local.sh` installe TE **sans** l'extra `[test]` ; ajouter pytest une fois :

```sh
./.tokeneconomizer-venv/bin/python -m pip install -e "./TokenEconomizer[test]"
```

Ciblé (Knowledge + preuves, ≈ secondes) :

```sh
./.tokeneconomizer-venv/bin/python -m pytest TokenEconomizer/tests/test_knowledge_proof.py \
  TokenEconomizer/tests/test_knowledge_pi.py TokenEconomizer/tests/test_knowledge_copilot.py \
  TokenEconomizer/tests/test_knowledge_workflow.py -q
```

Complet (hors réseau, sans Docker) :

```sh
cd TokenEconomizer && ../.tokeneconomizer-venv/bin/python -m pytest tests experiments/tests -q && cd ..
```

Contrôle complémentaire : le code mort reste dans l'allowlist.

```sh
cd TokenEconomizer && ../.tokeneconomizer-venv/bin/python scripts/dead_code.py && cd ..
```

Attendu : aucune nouvelle définition `unreferenced` hors de `scripts/dead_code_allowlist.txt`.

---

## Étape 4 — Protocole fonctionnel manuel

Chaque fiche se joue dans un projet **de confiance** (dossier approuvé par l'hôte), avec les
plugins locaux. Noter `OK` / `KO` dans la colonne Verdict.

Toujours lancer via le wrapper, jamais `pi`/`copilot` directement — c'est lui qui fournit
`TE_PYTHON` :

```sh
./launch-local.sh pi
./launch-local.sh copilot
./launch-local.sh pi --memory=native|knowledge|both|off|config
```

| # | Objectif | Actions | Attendu | Verdict |
| --- | --- | --- | --- | --- |
| T1 | TE répond dans Pi | lancer Pi, `/te status` | état du dépôt, mécanismes listés, aucune erreur Python | |
| T2 | TE répond dans Copilot | `/tokeneconomizer:status`, répondre **Yes** au script | idem T1, catalogue d'outils lisible | |
| T3 | Catalogue d'outils Copilot | `/tokeneconomizer:toolprune refresh-catalog` | commande réussit ; à refaire après mise à jour de Copilot | |
| T4 | Modes mémoire — `off` | `./launch-local.sh pi --memory=off`, puis `/te config show` | micro-skills et Knowledge désactivés **pour la session**, fichiers de config inchangés | |
| T5 | Modes mémoire — `native` | `--memory=native` | `microskills` actifs, `knowledge` inactif | |
| T6 | Modes mémoire — `knowledge` | `--memory=knowledge` | `knowledge` actif, micro-skills inactifs | |
| T7 | Modèle du menu | `./launch-local.sh pi` sans option dans un vrai terminal | menu 1–5, défaut `config`, choix sans effet sur les réglages enregistrés | |
| T8 | Knowledge désactivé par défaut | session TE sans `TE_KNOWLEDGE` | aucune injection de Knowledge, aucune ligne Knowledge affichée | |
| T9 | CodeTour — Project Tour | dans Pi : `/codetour` puis demande de Project Tour | tour généré, validé par le MCP, étapes ouvertes dans le lecteur | |
| T10 | CodeTour — Changes Tour | `/codetour`, puis « Changes Tour » sur une branche à plusieurs commits | étapes ouvertes sur la comparaison des commits analysés | |
| T11 | Tour réutilisable | ouvrir un `.tour` existant au clavier, naviguer | marqueurs, précédent/suivant, export fonctionnent | |
| T12 | Mémoire CodeTour retirée | chercher commandes/slash knowledge côté CodeTour | aucun outil, aucune commande de consolidation/Knowledge CodeTour | |
| T13 | Identité de workspace | générer un tour puis `te repos` | dépôt identifié de la même façon qu'avant (pas de nouvelle clé) | |
| T14 | Isolation par workspace | même scénario dans un second dépôt | états TE distincts, pas de fait/Knowledge croisé | |
| T15 | Preuve invalidée | créer/mémoriser une Knowledge adossée à un fichier, puis modifier ce fichier hors session, relancer | Knowledge exclue à la vérification, session démarre normalement, l'échec ne bloque rien | |
| T16 | Preuve restaurée | remettre le fichier à la version attestée, relancer | Knowledge redevient injectable, sans contourner le cycle TE | |
| T17 | Lecture partielle | observation tronquée/incomplète | aucune preuve fichier établie, repli traçable | |
| T18 | Panne TE | casser volontairement TE (ex. `TE_PYTHON=/bin/false ./launch-local.sh pi`) | la session continue comme si TE n'était pas installé, une ligne d'avertissement au plus | |
| T19 | Cohabitation | `--memory=both` | micro-skills **et** Knowledge actifs, aucune erreur, budget de contexte respecté | |

Remarques d'exécution :

- T9/T10 consomment des appels modèle : utiliser un modèle/provider économique et un petit dépôt.
- T15–T17 se constatent sur plusieurs sessions : l'injection n'est pas promise à la session
  suivante (cadence TE par défaut : proposition toutes les 3 sessions, jusqu'à 4 propositions).
- T18 est le test le plus important pour l'acceptation : aucune défaillance TE ne doit empêcher
  une session CodeTour.

---

## Étape 5 — Tests négatifs

| Cas | Manipulation | Attendu |
| --- | --- | --- |
| Mauvais interpréteur | `python3 -m pytest TokenEconomizer/tests/test_knowledge_proof.py` | échec `tree_sitter_language_pack` — **faux négatif**, relancer avec le venv |
| Venv absent | `./launch-local.sh pi` sans installation | `Run ./install-local.sh first.` et sortie `1` |
| Venv non possédé | créer `.tokeneconomizer-venv` à la main puis `install-local.sh` | refus explicite, rien n'est modifié |
| Marketplace concurrent | marketplace `tokeneconomizer` pointant vers un autre clone | refus explicite, message d'inspection |
| Plugin désactivé | `copilot plugin disable tokeneconomizer@tokeneconomizer` | TE inactif, CodeTour intact ; réactiver ensuite |
| Hors-ligne | couper le réseau puis lancer une session | aucune erreur bloquante ; seules les fonctions modèle sont indisponibles |

---

## Étape 6 — Retour arrière

```sh
node codetour/dist/cli.js --uninstall all
pi remove ../../Documents/POC/CodeTOUR+Economiser/TokenEconomizer
copilot plugin uninstall tokeneconomizer@tokeneconomizer
copilot plugin marketplace remove tokeneconomizer
rm -rf .tokeneconomizer-venv
```

Vérifier ensuite `pi list`, `copilot plugin list --json` et `node codetour/dist/cli.js --agents`
(plus aucune intégration `installed`). Les données TE restent dans `~/.tokeneconomizer` ; elles ne
sont supprimées que sur demande explicite.

---

## Critères de sortie (go / no-go)

1. `install-local.sh` termine sur `Installation complete.` et `--doctor` ne signale aucun défaut.
2. `npm run check:fast` : 58/58, et `npm test` sort en `0`.
3. Suite TE complète verte **avec l'interpréteur du venv**.
4. T1–T3, T9–T13, T18 verts (bloquants) ; T4–T7, T14–T17, T19 verts ou documentés comme limites.
5. Aucun `KO` non expliqué dans les tableaux ci-dessus ; sinon ticket `ref-304-…` avant merge.
