# Essai réel Copilot/MCP — skill natif `codetour-knowledge` (#226)

Date : 2026-11-19. Objectif : vérifier qu'un agent Copilot, guidé par le skill
installé, lit une Knowledge validée puis crée un Project Tour avec le MCP
CodeTour, sans Research Harness ni Memory Function.

## Dispositif

Projet temporaire isolé (`codetour-copilot-trial.3OahTR`), aucune écriture dans la
configuration réelle `~/.copilot` :

- `.github/skills/codetour-knowledge/SKILL.md` — copie du skill du dépôt
  (portée projet, pas d'installation personnelle) ;
- `.github/mcp.json` — serveur `codetour` local lançant le CLI construit de ce
  worktree (`node dist/cli.js mcp`) ;
- `src/dispatch.ts` — code de l'essai ;
- Knowledge `dispatch_flow` créée avec
  `node dist/cli.js knowledge save --workspace <ws> --proposal proposal.json`
  (résultat observé : `{"status":"saved",...,"saved":["dispatch_flow"]}`).

## Première tentative — bloquée, comportement honnête

Commande :

```sh
copilot -p "Use the codetour-knowledge skill in this workspace: create a Project Tour explaining src/dispatch.ts, then perform the consolidation step and report what the CLI returned." \
  --trust-folder --allow-all-tools --disable-client-telemetry
```

Observé : le skill est chargé, `codetour-create_project_tour` est découvert, mais
le premier `codetour` du `PATH` est une ancienne installation n'exposant pas
`knowledge` ; le repli vers `/opt/homebrew/bin/codetour` est refusé faute
d'approbation interactive. L'agent s'arrête, déclare qu'aucun Tour n'existe et
qu'aucune consolidation n'a eu lieu : pas de faux succès. Blocage consigné :
résolution du CLI sur le `PATH` + approbation non interactive.

## Seconde tentative — parcours complet

Même espace de travail, avec un répertoire temporaire en tête de `PATH`
contenant un lanceur `codetour` exécutant `node <worktree>/dist/cli.js`, et
`--allow-all` :

```sh
PATH="<shim>:$PATH" copilot -p "Use the codetour-knowledge skill in this workspace. Create a Project Tour explaining src/dispatch.ts, then perform the consolidation step and report the CLI status it returned." \
  --trust-folder --allow-all --disable-client-telemetry
```

Sortie observée (extraits) :

- `skill(codetour-knowledge)` puis `Search tools create_project_tour` →
  `codetour-create_project_tour` ;
- `codetour knowledge list --workspace "$PWD"` puis
  `codetour knowledge read dispatch_flow --workspace "$PWD"` ;
- premier appel `create_project_tour` refusé par le MCP (`INVALID_PROPOSAL`,
  `steps[0].directory: must be a string`), corrigé et relancé : « Created Project
  Tour at .tours/project.tour with 2 step(s). » ;
- consolidation : proposition vide (l'entrée existante couvre déjà le
  réutilisable), `codetour knowledge save` renvoie `no-op`, et l'agent le
  rapporte tel quel ;
- l'agent ajoute que la lecture `valid` ne prouve pas la justesse sémantique.

Fichiers observés après la session :

```
.tours/.memory/knowledge/dispatch_flow.md
.tours/project.tour
```

Le Tour créé (2 étapes, en français) part de la Knowledge lue, ancre
`src/dispatch.ts` avec `pattern: "export function dispatch"`, et marque une
inférence (« aucun appelant n'existe dans ce fichier »). La validation
structurelle est celle du MCP : elle établit que les ancres existent, pas que
l'explication est sémantiquement exacte.

Mesures observées (non des seuils) : 15,23 AI Credits, 19 s, 252,5 k tokens
dont 213,2 k en cache ; `COPILOT_EXIT=0`.

## Limites

- L'essai est unique et le modèle a produit un Tour court sur un fichier trivial.
- L'écriture de la proposition de consolidation a utilisé le répertoire de
  session de Copilot (`~/.copilot/session-state/...`), pas la configuration.
- Le garde-fou de consolidation reste une instruction : rien n'empêche un agent
  de l'omettre ; le `no-op` observé n'est pas une garantie générale.
- La validité des preuves (`sha256` conformes) reste distincte de la justesse
  sémantique et de la complétude.

## Complément du 19/11/2026 — deuxième session, réutilisation et ouverture réelle

Le constat de la revue était juste : l'essai initial créait la Knowledge **avant**
la session, puis un seul Tour, et ne consignait pas l'ouverture du Tour. Ce
complément rejoue le parcours avec **deux sessions Copilot distinctes** sur le
même espace de travail et ouvre les deux Tours avec le lecteur du CLI.

Dispositif : même espace `codetour-copilot-trial.3OahTR`, même Knowledge
`dispatch_flow` (créée hors session par `codetour knowledge save`). Le `PATH`
d'une session est préfixé par un lanceur temporaire `codetour` qui exécute le
`dist/cli.js` construit de ce dépôt : c'est la correction du blocage « ancien
`codetour` du PATH » observé lors de la première tentative. `COPILOT_HOME`
temporaire, aucune écriture dans `~/.copilot`.

### Session 2 (réelle, indépendante)

```sh
PATH="<shim>:$PATH" COPILOT_HOME="<temp>" copilot -p "Use the codetour-knowledge skill in this workspace. A previous independent session already saved a validated Knowledge entry here. Run codetour knowledge list / read dispatch_flow … create a Project Tour named 'Reuse de dispatch_flow' with fileName 'second-session' … then perform the mandatory consolidation step and report every CLI and MCP status verbatim." \
  --trust-folder --allow-all --disable-client-telemetry
```

Sortie observée (statuts verbatim) :

- `codetour knowledge list` → `{"status":"ok",…,"entries":[{"name":"dispatch_flow","description":"How a tool call is dispatched"}]}` ;
- `codetour knowledge read dispatch_flow` → `status:"valid"`, corps
  `## Dispatch\n\n\`dispatch\` returns the tool name it receives; it does not execute the tool.`,
  preuve `src/dispatch.ts` / `b83a6afd…c33ff` ;
- deux refus MCP utiles (`INVALID_PROPOSAL` : diagramme Mermaid invalide et
  `workspacePath` absolu, puis `pattern` sans correspondance), corrigés et
  relancés ;
- création finale : `{"status":"created","title":"Reuse de dispatch_flow","path":".tours/second-session.tour","stepCount":3,"warnings":[]}` ;
- consolidation : `{"status":"no-op","workspace":"…","entries":[]}`.

La session 2 a donc **relu la Knowledge validée de la session 1** et l'a citée
explicitement dans une étape (« Ce Tour réutilise la Knowledge `dispatch_flow`,
validée par la session précédente »). Coût observé : 0,53 AI Credit, 43 s,
209,4 k tokens dont 187,9 k en cache.

### Ouverture réelle des Tours

Les deux Tours ont été ouverts par le lecteur HTML du CLI construit, sans
navigateur (`CODETOUR_TEST_HTML_OUTPUT` écrit la page et n'ouvre rien) :

```sh
codetour --internal-resolve-tour "Tour de src/dispatch.ts"
CODETOUR_TEST_HTML_OUTPUT=... node dist/cli.js --internal-tour-id <id> --renderer html
codetour --internal-resolve-tour "Reuse de dispatch_flow"
CODETOUR_TEST_HTML_OUTPUT=... node dist/cli.js --internal-tour-id <id> --renderer html
```

- `tour.html` : titre `Tour de src/dispatch.ts`, ancre `src/dispatch.ts`, 18 462 octets ;
- `second-session.html` : titre `Reuse de dispatch_flow`, ancre `src/dispatch.ts`
  (7 occurrences), 15 573 octets ;
- les deux fichiers `.tour` coexistent : `.tours/project.tour` (session 1) et
  `.tours/second-session.tour` (session 2), sans écrasement.

### Complément déterministe (sans modèle)

Le même parcours en deux générations est aussi prouvé sans modèle ni réseau par
`dist/test/cli/knowledgeTourParcours.test.js`, test « a second generation reuses
the Knowledge validated by the first and opens its Tour » : génération 1
(`knowledge save` + `create_project_tour`), puis génération 2 dans de nouveaux
processus (`list`, `read` valid, second `create_project_tour`), ouverture du
second Tour par le lecteur HTML, et chargement des deux Tours par `loadTour`.
Ce test est la preuve reproductible ; l'essai réel ci-dessus en est la
démonstration sur l'hôte Copilot.

### Limites honnêtes

- La Knowledge de cet essai est créée hors session par le CLI, puis relue par
  deux sessions : la réutilisation de session à session est démontrée, mais pas
  la création de Knowledge *par* la session 1 puis sa relecture par la session 2
  (la session 1 a répondu `no-op`) ; le test déterministe, lui, couvre la
  création par la génération 1 puis la relecture par la génération 2.
- La session 2 a de nouveau chargé le skill personnel `codetour-knowledge` et
  utilisé le CLI pour la lecture ; elle a créé le Tour par le MCP. C'est le
  parcours prescrit par ce ticket, pas le wrapper gardé `/codetour generate`.
- Modèle et coûts sont ceux de l'essai, pas des seuils.
