# Spécification — Intégration d'agent Pi

**Statut :** prête pour implémentation · **Sources :** ADR 0041 (plugin Agent
Plugins 1.0 Copilot), ADR 0042 (métriques d'usage du run), ADR 0044
(vérification Knowledge à la découverte), ADR 0045 (listes Knowledge dans le
run-state), spec `agent-integrations-copilot-codex.md` · **Base :** PR #82 et
le portage Copilot sont des références, pas des implémentations à fusionner.

## Baseline à préserver

Le serveur MCP partagé fournit `create_project_tour`, `create_changes_tour`,
`get_generation_prompt`, les quatre outils Knowledge et les prompts
`generate_project_tour` / `generate_changes_tour`. Les adaptateurs transmettent
les demandes à CodeTour et ne génèrent pas eux-mêmes les étapes. Une génération
passe par un run identifié (`runId`), un Tour créé par le MCP, puis une clôture
de consolidation. La méthode de Tour vit une seule fois dans le serveur MCP.

Rien de ce contrat ne change pour Pi : l'intégration Pi est un second hôte du
même serveur, du même prompt servi et du même format de run-state.

## Contrat commun des adaptateurs

L'entrée Pi respecte le contrat existant de `src/cli/agentIntegrations.ts` :

```typescript
interface AgentIntegration {
  id: "pi";
  displayName: "Pi coding agent";
  detect(): Promise<DetectionResult>;
  status(): Promise<InstallationStatus>;
  install(): Promise<void>;
  uninstall(): Promise<void>;
}
```

`detect()` exécute `pi --version`. `status()` compare les fichiers gérés et
l'entrée `packages` du `settings.json` utilisateur. `install()` écrit les
fichiers embarqués puis déclare le paquet ; `uninstall()` retire la
déclaration avant de supprimer les fichiers qu'il a écrits, et ne touche jamais
un paquet tiers. Une installation correcte n'est pas réécrite ; une
installation différente est remplacée et les fichiers remplacés sont signalés.

## Package Pi

L'intégration est un **package Pi** versionné, source unique de vérité :

```text
packages/pi-plugin/
├── package.json                     # manifeste Pi (pi.extensions, pi.skills)
├── extensions/codetour.ts           # serveur MCP, garde, /codetour, clôture
├── lib/run-log.ts                   # lecture/écriture du run-state partagé
├── skills/codetour-generate/SKILL.md
└── README.md
```

`package.json` déclare `pi.extensions` et `pi.skills` explicitement (pas de
découverte conventionnelle), `@earendil-works/pi-coding-agent` et `typebox` en
`peerDependencies` avec `"*"`, et aucun paquet hôte en `dependencies`.

Le paquet est embarqué dans le CLI autonome par
`scripts/embed-pi-plugin.js` → `src/cli/pi-plugin.generated.ts`, exactement
comme le plugin Copilot. `codetour --install pi` n'a donc besoin ni du dépôt
Git ni du réseau.

## Serveur MCP

L'extension enregistre un seul serveur pour la session, au `session_start`,
avec le chemin réel de `ctx.cwd` :

```typescript
pi.registerMcpServer("codetour", {
  command,                                  // CLI absolu qui a installé
  args: [script, "mcp", "--workspace-root", realCwd],
  description: "CodeTour: guided code tours and verified Knowledge.",
  exposure: "deferred",
});
```

`deferred` parce que six outils ne justifient pas une déclaration permanente au
modèle, et que `tool_search` les trouve par leur description. Un `mcp.json` de
l'utilisateur qui déclare déjà `codetour` gagne : l'extension ne remplace pas
une configuration explicite et `/mcp` montre l'entrée surchargée.

Aucune copie du serveur, aucune génération propre : l'extension ne fait que
déclarer le serveur et lire son run-state.

## Skill de génération

`skills/codetour-generate/SKILL.md` est l'aiguillage, pas la méthode. Il est
réécrit pour Pi sur trois points seulement :

- les outils sont nommés `mcp__codetour__create_project_tour`,
  `mcp__codetour__knowledge_list`, etc. ;
- la résolution des choix manquants passe par la commande `/codetour` (dialogue
  `ctx.ui.select`) ou par le dialogue naturel ; Pi n'a pas d'outil `ask_user` ;
- la réparation recommandée est `codetour --install pi`, pas `--install
  copilot`.

Le corps reste : résoudre les choix sans défaut silencieux, suivre le prompt
servi, créer par l'outil MCP, consolider obligatoirement, ne jamais écrire de
`.tour` à la main, s'arrêter en le disant si aucun outil CodeTour n'existe.

## Commande `/codetour`

`pi.registerCommand("codetour", …)` reproduit l'entrée contrôlée Copilot :

1. `ctx.ui.select` : **Project Tour** ou **Changes Tour** ; pour un Changes
   Tour, second `select` : **neutral** ou **critical**. Aucun défaut ; une
   annulation arrête sans générer.
2. Résolution du workspace (`ctx.cwd`, realpath) ; échec explicite si
   inutilisable.
3. Génération d'un `runId`, écriture atomique du run-state
   `.tours/.log/codetour-run-<runId>.json` **avant** toute requête.
4. Livraison de l'invocation de skill `/skill:codetour-generate type=…
   [reviewMode=…] runId=<id> [request=…]` par `pi.sendUserMessage`. L'agent
   demande lui-même le prompt servi au serveur MCP et suit la méthode.

Pi expose les **outils** MCP mais pas les **prompts** MCP : aucun hôte ne peut
appeler `prompts/get`. Le prompt servi est donc obtenu par l'outil
`get_generation_prompt`, qui renvoie exactement le même texte que celui récupéré
par l'adaptateur Copilot. La commande ne compose aucun prompt et ne fait aucune
analyse.

5. Annulation d'un choix, workspace inutilisable, écriture du run-state
   impossible ou livraison refusée : rien n'est généré ; un run-state déjà écrit
   est retiré et la commande se termine en erreur visible, sans analyse, sans
   prompt de secours.

## Garde de consolidation

L'équivalent de l'`agentStop` Copilot est le handler `agent_before_settle` dans
le processus Pi. Le hook n'est pas un sous-processus : pas de `node` requis sur
`PATH`, pas de contrat de timeout, mêmes garanties observables.

- Il ne lit que le run-state, jamais le texte de l'assistant.
- Il est inerte pour une conversation ordinaire, une autre session ou un autre
  workspace, un run expiré, illisible ou corrompu, un Tour non créé, ou toute
  clôture déjà présente (`created`, `completed_zero`, `partial`, `failed`,
  `skipped`).
- Pour un seul run incomplet il propose **au plus une** continuation : il
  marque `continuationUsed` sous verrou inter-processus, puis renvoie
  `{ entries: [...event.entries, { type: "custom_message", customType:
  "codetour-consolidation", content, display: false }], continue: true }`.
- Un run sans identité (`runId` absent, skill ou appel MCP direct) n'a pas de
  run-state : la garde est inerte et aucune garantie n'est revendiquée.

## Bloc `knowledge` du run-state (ADR 0045)

Le serveur MCP est le seul écrivain. `knowledge_list` et `knowledge_read`
acceptent un `runId` optionnel (jamais une chaîne vide) ; quand il est fourni et
valide, la vérification déjà effectuée par la découverte (ADR 0044) est
enregistrée :

```json
"knowledge": {
  "version": 1,
  "observed": true,
  "at": "2026-11-20T…Z",
  "listings": 2,
  "valid": ["billing-retry", "auth-refresh"],
  "validTotal": 9,
  "complete": false,
  "invalid": [{ "name": "stale-auth", "reason": "proof hash mismatch" }],
  "used": ["billing-retry"]
}
```

Règles :

- **Union pour les valides**, **dernier résultat pour les invalides** (toujours
  renvoyés en entier, ADR 0044) ; `complete:true` seulement si un listing non
  tronqué a couvert tout le catalogue.
- `used` = noms des entrées dont `knowledge_read` a renvoyé un corps
  `status: "valid"`, dédoublonnés. Un appel refusé n'est pas un usage.
- Aucun second scan, aucun hachage supplémentaire : on enregistre ce que la
  découverte a déjà vérifié. Un run qui ne liste jamais n'a pas de bloc.
- Le bloc est optionnel et additif : `isRunState` accepte son absence, un
  lecteur qui l'ignore ne change pas de comportement, et le serveur MCP ne
  l'utilise jamais dans une décision (même règle qu'ADR 0042). Le champ
  `updatedAt`/`at` n'entre pas dans la déduplication d'affichage.

## Affichage de clôture

Une ligne stable en fin de run, sur les deux hôtes, avec le même texte :

```text
CodeTour run <runId> "<title>" (.tours/<tour>.tour) — Knowledge 9 valid / 1 invalid, 2 used (billing-retry, auth-refresh)
```

Le chrome utilisateur reste en anglais (ADR 0015) ; la ligne est identique sur
les deux hôtes.

- Pi : `ctx.ui.notify` au moment où la garde examiné le run (fin de run).
- Copilot : la clause est ajoutée à la ligne `stderr` déjà produite par
  `usageReport()` dans `agent-stop.mjs` — aucun nouveau canal, aucune influence
  sur la décision `{}` / `{"decision":"block"}`.
- Un détail multi-lignes n'est ouvert que pour les entrées **invalides**, avec
  leur raison, toujours complet. Les valides sont plafonnées à **10 noms**
  affichés puis `… et N autres` ; le run-state garde la liste entière.
- `observed:false` (aucun listing) omet la clause Knowledge au lieu d'afficher
  des zéros.

## Installation

```sh
codetour --install         # tous les hôtes compatibles de cette machine
codetour --install pi      # un seul agent (strict : son prérequis manquant échoue)
codetour --uninstall       # retire tout ce que ce CLI a installé
codetour --agents          # état de chaque intégration
```

### Installation par lot

`--install` sans valeur (ou `all`) installe **tous les agents compatibles** :
présents sur la machine et dont le prérequis d'installation est satisfait. Un
hôte absent est `skipped` avec sa raison, jamais une erreur ; un agent en échec
est signalé et rend le code de sortie non nul **sans arrêter les autres**. Nommer
un agent explicitly (`--install pi`) est une instruction : son prérequis manquant
est alors un échec, pas un saut.

Récapitulatif affiché dans tous les cas :

```text
Agent integrations:
  copilot: installed
  pi: already-installed
  vscode: skipped (No CodeTour .vsix was found …)
```

`CODETOUR_DISABLE_AGENTS=vscode,pi` exclut des agents du lot (CI, compte partagé,
machine servie par un autre build) ; un agent nommé explicitement l'ignore.
`--uninstall` sans valeur retire chaque intégration que ce CLI voit installée,
sans exiger la présence du CLI de l'agent (les fichiers et déclarations sont
supprimables sans lui).

`scripts/install-local.sh` (checkout) et `scripts/install-latest.sh` /
`install-latest.ps1` (release) appellent cette commande : le premier échoue si
un agent échoue, les seconds avertissent et poursuivent car leur objet reste
l'extension VS Code, et ils rappellent la commande à lancer quand le CLI
`codetour` n'est pas sur `PATH`.

- `<agent-dir>` = `PI_CODING_AGENT_DIR` ou `~/.pi/agent`.
- Répertoire géré : `<agent-dir>/packages/codetour-plugin/`
  (`CODETOUR_PI_PLUGIN_DIR` pour les tests et les dispositions inhabituelles).
- La déclaration est un chemin absolu dans `packages[]`, jamais un glob, pour
  que le paquet soit reconnu à l'identique par Pi et par `status()`.
- Un paquet tiers portant la même identité n'est jamais supprimé : il est
  signalé.
- L'installation n'écrit aucun serveur MCP dans `mcp.json` : la déclaration
  appartient à l'extension, donc à une seule source.

## Prérequis d'exécution

Le serveur `codetour` est enregistré par l'extension mais **connecté par le MCP
intégré de Pi**. Un `settings.json` qui le désactive
(`"extensions": ["-builtin:mcp"]`) laisse l'enregistrement sans connexion et Pi
signale `MCP server "codetour" is registered, but no loaded extension connects
MCP servers`. Le diagnostic se fait dans la session avec `/mcp` (le serveur et
sa source « extension » y figurent) ; `pi mcp list` ne peut pas le montrer, car
les commandes shell ne chargent pas les extensions. Vérifié sur Pi 1.5.2 :
`-e builtin:mcp -e ./packages/pi-plugin` + `tool_search` renvoie les sept outils
`mcp__codetour__*`.

## Vérification

- `test/pi-plugin-install.test.mjs` — installation dans un `PI_CODING_AGENT_DIR`
  temporaire (chemin avec espaces), déclaration écrite une fois, reinstall
  idempotent, uninstall retirant seulement la déclaration et les fichiers gérés.
- `test/pi-extension.test.mjs` — câblage réel de l'extension sans processus Pi :
  un serveur `codetour` enregistré sur `ctx.cwd`, choix annulé sans run-state,
  choix explicites produisant `runId` + invocation de skill, garde inerte avant
  Tour puis une seule continuation, ligne de clôture et détail des invalides
  imprimés une fois.
- `test/pi-guard.test.mjs` — garde inerte sur conversation ordinaire, Tour non
  créé, clôture présente, run expiré ; une seule continuation avec
  `continuationUsed` ; second appel inerte.
- `test/pi-run-state.test.mjs` — bloc `knowledge` : union des valides, dernier
  état des invalides, `used` dédoublonné, absence tolérée, fichier ancien
  toujours valide.
- `packages/mcp-server` — tests unitaires de `recordKnowledgeListing` /
  `recordKnowledgeRead`, et vérification que `knowledge_list` sans `runId`
  n'écrit rien.
- Test de parité : `src/cli/piPlugin.test.ts` échoue si
  `pi-plugin.generated.ts` diverge de `packages/pi-plugin/`.

## Hors périmètre

- Aucun portage des métriques de tokens Pi dans le run-state (ADR 0042 reste
  Copilot) : la ligne de clôture Pi n'affiche que Knowledge.
- Aucun nouveau scan du catalogue, aucune détection de dérive. La photo est
  celle du dernier listing réellement exécuté.
- Aucun changement de l'outillage VSCode, du serveur MCP, des prompts servis
  au-delà du `runId` optionnel, ni du plugin Copilot hormis la clause
  d'affichage.
