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
