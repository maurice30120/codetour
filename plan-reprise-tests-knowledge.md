# Plan de reprise — tests Knowledge sur Pi

Document de passation pour une session neuve. Tout ce qui suit a été constaté dans le workspace
`/Users/dhuyet/Documents/POC/CodeTOUR+Economiser`, pas déduit. Le contexte détaillé vit dans
`rapport-campagne-knowledge-pi-20261127.md` (racine) et les tickets `.scratch/tool-call-reads/` du
dépôt TokenEconomizer.

## But de la session

Clore le contrôle du ticket 04 : mesurer, documenter et statuer sur les deux essais de contrôle
lancés après l'implémentation du déclencheur « un appel d'outil qui nomme un fichier reçoit sa
carte ».

## État constaté

| Élément | État |
| --- | --- |
| Implémentation (tickets 01–03) | faite dans TokenEconomizer, commits `38658d8` et `6c89c54`, `Status: implemented` dans les trois tickets |
| Nouveau déclencheur | **prouvé en direct** : `knowledge-A/repos/*/pi/events.jsonl` porte deux événements `"trigger": "tool"`, `"tool": "bash"`, `"signal": "codetour/src/store/actions.ts"`, `"when": "after_call"` (cartes `760717b0`, `4e892c3f`) |
| Contrôle `A-off` | complet : `exit 0`, dialogue VS Code répondu, Tour de 6 étapes, registre `off-A` = 28 186 entrée / 4 481 sortie / 327 168 cache / 19 requêtes |
| Contrôle `A-knowledge` | **utilisable** : Tour de 7 étapes créé, dernier message `stopReason: stop`, registre `knowledge-A` = 22 239 / 3 785 / 368 512 / 23 requêtes. Le pilote l'a tué **après** la fin du travail (`exit -15`, `ok: false`, `dialog: false`) |
| Mesure du contrôle | **pas encore produite** : `control.py` est écrit, aucun `control.json` n'existe |
| Ticket 04 | `Status: ready-for-agent` |
| CodeTour | **modifié, non commité** : trois fichiers et un nouveau module implémentent `--internal-validate-tour` (point 4 de la rétrospective) ; `check:fast` et la suite complète restent à passer |
| Builds installés | le build local est en avance : `codetour/dist/cli.js` = `3c1186de` (contient `internal-validate-tour`), le CLI global `~/.nvm/…/node_modules/codetour/dist/cli.js` = `45449ae2` (**sans** le module). `launcher.json` du plugin Pi vaut `{"command": "codetour", "args": []}` : les sessions résolvent donc le CLI **périmé** par le PATH. L'extension, elle, est identique des deux côtés (`a80ea248`) |
| Git | TokenEconomizer à `6c89c54` avec 2 commits locaux ; pointeur du sous-module encore sur `a75d574` ; `AGENTS.md` racine modifié (pointeur de navigation du point 1 de la rétrospective) ; **rien n'est commité côté parent** |

## Étapes

### 1. Vérifier que l'implémentation tient

```sh
cd /Users/dhuyet/Documents/POC/CodeTOUR+Economiser
git status --short --branch && git -C TokenEconomizer status --short --branch
git -C TokenEconomizer log --oneline -3
cd TokenEconomizer && ../.tokeneconomizer-venv/bin/python -m pytest tests -q
../.tokeneconomizer-venv/bin/python -m pytest tests/test_knowledge_tool_files.py tests/test_knowledge_read.py -q
../.tokeneconomizer-venv/bin/python scripts/dead_code.py
```

Côté CodeTour, l'arbre porte du travail non commité (le nouveau `--internal-validate-tour`, ses
tests et un export) : ce n'est pas un contrôle de sanité, c'est la validation de ce travail.

```sh
cd /Users/dhuyet/Documents/POC/CodeTOUR+Economiser/codetour && npm run check:fast && npm test
cd /Users/dhuyet/Documents/POC/CodeTOUR+Economiser && ./install-local.sh --pi
codetour --internal-validate-tour 2>&1 | head -3   # doit répondre, pas « unknown option »
```

Critère de sortie (CodeTour) : `check:fast` à 58 tests, suite complète à `0`, et le CLI résolu par les
sessions contient le nouveau module — comparer `sha256` de `codetour/dist/cli.js` et de
`$(which codetour)` : ils doivent être égaux avant tout essai, sinon la session Pi tourne sur
l'ancien binaire sans que rien ne le signale.

Critère de sortie (TokenEconomizer) : suite complète verte **avec l'interpréteur du venv** (le Python système n'a pas
`tree_sitter_language_pack` et produit de faux négatifs), `dead_code.py` sans nouvelle définition
`unreferenced`, `check:fast` à 58 tests. Si un test échoue, s'arrêter là : la mesure du contrôle
n'aurait pas de sens sur une base rouge.

### 2. Produire la mesure du contrôle

```sh
cd /Users/dhuyet/Documents/POC/CodeTOUR+Economiser
python3 .campaigns/knowledge-pi-20261127/control.py > .campaigns/knowledge-pi-20261127/control.json
```

Contrôle manuel du fait central, à faire avant de lire le JSON :

```sh
grep -c '"trigger": "tool"' .campaigns/knowledge-pi-20261127/knowledge-A/repos/*/pi/events.jsonl   # attendu : 2
grep -c '"trigger": "tool"' .campaigns/knowledge-pi-20261127/off-A/repos/*/pi/events.jsonl         # attendu : 0
```

Critère de sortie : le JSON contient les deux bras, les injections du bras Knowledge avec leur
outil et la commande qui les a causées, et les totaux de tokens des deux bras à côté de ceux des
paires du 27 novembre. Si `control.py` échoue, corriger le script plutôt que le contourner : il lit
les mêmes artefacts que `measure.py`.

### 3. Statuer sur l'anomalie du dialogue manquant

`A-off` a reçu le dialogue d'ouverture, `A-knowledge` non. Le Tour, lui, est bien à la racine
(`.tours/`), donc ce n'est pas le cas « CLI lancée depuis `codetour/` ». Comparer, sans relancer de
session :

- l'entrée du journal de création (`.tours/.log/creations/`) du Tour `A-knowledge` : son
  `sessionId` et son `workspace` ;
- l'identifiant de la session Pi (`knowledge-A/repos/*/pi/sessions/01a21c29-…json`) ;
- les dernières lignes de `runs/A-knowledge/terminal.raw` après l'heure de création, échappements
  ANSI retirés.

Critère de sortie : une phrase qui dit pourquoi le dialogue n'a pas eu lieu, ou « cause non
établie » avec les trois valeurs comparées. Ne pas relancer la session pour cette question seule :
elle sort du périmètre du ticket 04.

### 4. Écrire le résultat

- Ajouter au rapport une section « Contrôle du 27 novembre après implémentation » : les deux bras,
  les injections du chemin shell avec la commande qui les a déclenchées, les totaux de tokens, et
  la phrase qui dit si la comparaison est utilisable.
- Mettre le ticket 04 à `Status: resolved`, cocher ses critères, et ajouter un `## Comments` daté
  avec le chiffre qui prouve le déclenchement sur `bash`.
- Mettre à jour les points 1 et 4 de la rétrospective du rapport : le pointeur d'`AGENTS.md` est appliqué
  (build et tests depuis `codetour/`, génération des Tours depuis la racine) et
  `codetour --internal-validate-tour` existe — une fois la suite CodeTour verte.

### 5. Ne pas rejouer les essais sans nécessité

Les deux bras sont complets : tour créé, tour de conversation refermé, repli TE enregistré. Un
`TOKENECONOMIZER_HOME` neuf est un bras **vide** : les cartes viennent des amorçages W1/W2, donc
relancer dans un état neuf mesure « aucune Knowledge » et ne prouve rien. Si un rejeu devient
indispensable :

```sh
cp .campaigns/knowledge-pi-20261127/prompts/A-knowledge.txt .campaigns/knowledge-pi-20261127/prompts/A-knowledge2.txt
CAMPAIGN_THINKING=off python3 .campaigns/knowledge-pi-20261127/drive.py A-knowledge2 knowledge vscode knowledge-A
```

Le quatrième argument est l'état TE : réutiliser `knowledge-A` pour garder les cartes, jamais un
`knowledge-A2` vierge. Vérifier d'abord comment `control.py` choisit la session d'un état qui en
contient deux, sinon la mesure mélangera les deux passages. Un rejeu consomme des appels modèle
facturables : demander l'autorisation avant, elle n'a été donnée que pour la campagne initiale.

### 6. Commit

Rien n'est commité. Ne pas commiter sans demande explicite. Le jour où elle vient : TokenEconomizer
d'abord, puis le pointeur du sous-module dans le parent avec `AGENTS.md`. Jamais de publication
vers `microsoft/TokenEconomizer`.

## Pièges mesurés, à ne pas réapprendre

| Piège | Ce qu'il faut faire |
| --- | --- |
| `--thinking high` ou `medium` sur `mistral/deepseek-v4-1-flash-1017` | refus du fournisseur (400, code `3051`) ; le pilote reste en `off` par défaut (`CAMPAIGN_THINKING`) |
| Session Pi laissée sur le dialogue « Ouvrir maintenant ? » | elle bloque indéfiniment ; `drive.py` répond aux deux dialogues puis sort, et tue la session au bout de 30 s si `ctrl+d` ne suffit pas |
| Attendre un essai sur la sortie du PTY | `process.output` rend la page dès qu'un octet est en tampon ; surveiller `runs/<essai>/end.json` et la date de `terminal.raw` |
| Lire `terminal.raw` au `grep` | retirer d'abord les séquences ANSI, sinon une seule commande renvoie ~500 Ko |
| État Knowledge à la main | `te microskills` donne déjà `ACTIVE`, `rev`, `proof=valid`, sources et evidence ; les injections vivent dans `events.jsonl`, pas dans `ledger.jsonl` (dont `injected_chars` ne couvre que les faits natifs) |
| Chemins des Tours | ceux de 02, 04, 05 et 07 sont sous `codetour/.tours/` avec des chemins relatifs au sous-dépôt : normaliser le préfixe `codetour/` avant de comparer |
| Suite TE lancée avec `python3` | toujours `./.tokeneconomizer-venv/bin/python` |
| CLI résolu par la session | `launcher.json` du plugin Pi ne fixe pas de chemin : vérifier l'empreinte du `codetour` du PATH contre `codetour/dist/cli.js` avant de conclure quoi que ce soit sur le CLI |

## Artefacts

- Harnais : `.campaigns/knowledge-pi-20261127/` (`drive.py`, `run.py`, `measure.py`, `control.py`,
  `prompts/`, `runs/`, `sessions/`, états TE `knowledge/`, `off/`, `knowledge-A/`, `off-A/`).
- Tours des dix essais et des deux contrôles : `.tours/` à la racine et `codetour/.tours/`.
- Rapport : `rapport-campagne-knowledge-pi-20261127.md`.
- Tickets : `TokenEconomizer/.scratch/tool-call-reads/issues/`.
- `.campaigns/` n'est pas suivi par git ; rien de ce dossier n'est publié.
