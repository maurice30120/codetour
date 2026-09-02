# codetour-mcp

A local MCP (Model Context Protocol) server that lets an AI agent create
[CodeTour](https://github.com/microsoft/codetour) tours deterministically. The
agent — the Tour Generator — chooses the Tour's subject, analyzes the relevant
workspace state itself (Git or otherwise), and provides the output file name;
the server only validates the proposal, applies the security rules, and
atomically persists it. The server performs no Git access and never writes a
CodeTour `ref` property.

A single tool is exposed:

- `create_tour` — persists a fully written Tour under `.tours/<fileName>`,
  atomically replacing any existing file with that name.

The output is compatible with the general CodeTour schema, within a
deliberately stricter V1 subset: explanatory Markdown and workspace-internal
locations only. CodeTour `commands`, root-level `when` expressions, external
`uri` steps, a `ref` property, and active Markdown schemes (`command:`, `file:`,
`vscode:`, `vscode-insiders:`, `javascript:`) are rejected.

Mermaid diagrams are optional and validated before the tool writes a Tour. The
MCP server reuses the exact fence rules and locked Mermaid implementation from
`codetour-description-renderer`, so the Tour Generator and playback apply the
same contract. Validation is local and offline.

## Requirements

- Node.js >= 18

## Démarrage rapide

Depuis la racine du dépôt, installez d'abord le renderer partagé, puis les
dépendances du serveur MCP et vérifiez les deux packages :

```bash
cd packages/description-renderer
npm install
npm run build
cd ../mcp-server
npm install
npm test
```

`npm test` compile le package et exécute toute la suite de tests. Vous pouvez
ensuite démarrer le serveur depuis un workspace :

```bash
cd /path/to/workspace
node /path/to/codetour/packages/mcp-server/dist/src/cli.js
```

Le processus utilise MCP sur `stdio`. Il attend donc silencieusement les
requêtes d'un client MCP. Utilisez `Ctrl+C` pour l'arrêter lorsqu'il est lancé
manuellement.

Le répertoire de travail du processus est le workspace. Une instance du serveur
traite exactement ce workspace et toutes les opérations y sont confinées : les chemins
réels sont résolus avant toute lecture ou écriture, les liens symboliques qui
sortent de la racine sont refusés et le serveur n'effectue aucun accès réseau.

Le package expose le binaire `codetour-mcp`, disponible après `npm install` ou
`npm link`. Pour rendre ce binaire accessible globalement pendant le
développement local :

```bash
npm link
cd /path/to/workspace
codetour-mcp
```

Configurez enfin votre client MCP avec la commande et son répertoire de travail,
comme dans l'exemple ci-dessous. Une fois connecté, le client découvre
automatiquement `create_tour`.

## MCP client configuration

```json
{
  "mcpServers": {
    "codetour": {
      "command": "node",
      "args": ["/path/to/codetour/packages/mcp-server/dist/src/cli.js"],
      "cwd": "/path/to/workspace"
    }
  }
}
```

The transport is `stdio` only.

### Configuration dans Codex

L'extension VS Code fournit les commandes `CodeTour: Configure MCP for Codex`
et `CodeTour: Repair MCP Configuration for Codex`. La première installe la
configuration globale lorsqu'elle manque ; la seconde remplace une
configuration obsolète, notamment après une mise à jour de l'extension.

Pour un build de développement non installé en VSIX, l'équivalent manuel est :

```bash
codex mcp add codetour -- \
  node /path/to/codetour/dist/mcp-server.js
```

Il n'est pas nécessaire de conserver un processus lancé manuellement : Codex
démarre le serveur `stdio` automatiquement. Vérifiez la configuration avec :

```bash
codex mcp get codetour
```

Les nouvelles tâches Codex démarrent le serveur dans leur propre répertoire de
travail ; une seule configuration globale couvre donc tous les projets.

Pour générer une visite du projet, demandez par exemple :

```text
Analyse ce dépôt, puis utilise l'outil MCP codetour.create_tour pour générer un
Tour nommé « project.tour ». Choisis un titre, présente le but du projet, ses
points d'entrée, ses composants importants et ses principaux flux d'exécution.
Commence par une étape ancrée sur le dossier racine pour en expliquer
l'organisation, puis présente les dossiers importants avant de détailler les
fichiers. Utilise des ancres stables dans les fichiers lorsque c'est possible.
```

Pour limiter la visite à un sous-dossier, nommez-le explicitement dans la
demande. La première étape doit alors utiliser ce chemin dans son champ
`directory`, relativement à la racine du workspace.

Pour documenter les changements d'une branche, le Tour Generator analyse lui-même
Git (référence de base, HEAD, fichiers modifiés) et décide, le cas échéant, de la
référence à retenir ; le serveur ne le fait pas pour lui :

```text
Analyse les changements commités de cette branche depuis sa branche de base,
puis utilise codetour.create_tour pour créer un Tour nommé « changes.tour » qui
explique l'intention, les modifications principales, leur impact et les tests
pertinents. N'inclus pas les modifications non commitées.
```

Le résultat est écrit sous `.tours/<fileName>`.

## Tools

### `create_tour`

| Argument      | Type     | Required | Description                                             |
| ------------- | -------- | -------- | ------------------------------------------------------- |
| `fileName`    | string   | yes      | Bare file name ending in `.tour`; no path separators, no `.`/`..`, no absolute path. Used as-is under `.tours/`. |
| `title`        | string   | yes      | Non-empty tour title.                                   |
| `description` | string   | no       | Optional tour description.                              |
| `steps`       | object[] | yes      | Non-empty list of steps (see below).                    |

A good Tour covers its subject's purpose, its main entry points, its important
components, and its main execution flows. When the project has a meaningful
directory structure, it begins with a directory-anchored overview. For a Tour
scoped to a subdirectory, the first step anchors that exact workspace-relative
directory. Other important directories should be introduced before their
individual files.

### Steps

| Field         | Type   | Description                                                                  |
| ------------- | ------ | ---------------------------------------------------------------------------- |
| `title`       | string | Optional step title.                                                         |
| `description` | string | Required Markdown explanation.                                               |
| `file`        | string | Workspace-relative path; at most one of `file`/`directory` per step.         |
| `directory`   | string | Workspace-relative path; use for structural overview steps and at most one of `file`/`directory` per step. |
| `line`        | number | 1-based line; only valid with `file`, mutually exclusive with `pattern`.     |
| `pattern`     | string | Regular expression matching exactly one occurrence; only valid with `file`.  |
| `selection`   | object | `{ start: {line, character}, end: {line, character} }`, 1-based; only valid with `file`. |

Steps without any locator are allowed (general context).
Every anchor is validated against the real workspace state. All validation
errors are aggregated and reported in a single response; the previous tour
file is preserved on failure.

### Mermaid diagrams

Use Mermaid sparingly: include a diagram only when it materially clarifies a
relationship or flow. A diagram must use a bare fence with `mermaid` as its
info string. The nearest non-blank line before that fence must be a visible caption matching
`**Diagram — …**` (an em dash, with one or more descriptive characters). Blank
lines between the caption and fence are allowed; other Markdown content breaks
the caption association.

The exact allowlist is `flowchart`, `sequenceDiagram`, `stateDiagram-v2`,
`classDiagram`, and `erDiagram`. Each individual description (the Tour
description and each step description are separate descriptions) accepts at
most three Mermaid fences, and each source is at most 20 KiB measured as UTF-8
bytes. Mermaid syntax is parsed locally using the same locked version as
playback. A malformed caption, unsupported kind, oversized source, invalid
syntax, or fourth-and-later fence rejects the complete tool call.

Diagram issues use paths such as
`steps[1].description.mermaid[0].source`; the path identifies the description,
fence index, and failing field. Every issue also reports the fence's starting
line and column. All descriptions are checked in one call, and no Tour file is
written when any diagram or ordinary Tour validation fails.

### Result

Each successful tool call returns a human-readable message and a structure:

```json
{ "status": "created", "path": ".tours/project.tour", "stepCount": 3, "warnings": [] }
```

Failures return `{ "status": "error", "code", "message", "issues" }` with one
of these codes:

| Code                       | Meaning                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `TOUR_STEPS_REQUIRED`      | The steps list is missing or empty.                            |
| `INVALID_PROPOSAL`         | The proposal has validation issues (all listed in `issues`).   |
| `SCHEMA_VALIDATION_FAILED` | Internal: the generated tour did not validate against the CodeTour schema. |
| `OUTPUT_PATH_ESCAPES_WORKSPACE` | The output directory resolves outside the workspace root. |

Non-blocking warnings:

| Code                            | Meaning                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `STEP_LIMIT_EXCEEDED`           | The tour has more than fifteen steps.                                    |

## Git references

The server performs no Git access and never writes a CodeTour `ref`. When a
reference is relevant (for example a reproducible branch review), the Tour
Generator analyzes Git itself and decides whether and how to record it; the
server only validates and persists the proposal.

## Development

Install the package dependencies once:

```bash
cd packages/description-renderer
npm install
npm run build
cd ../mcp-server
npm install
```

### Run all tests

From `packages/mcp-server/`:

```bash
npm test
```

The renderer must be built before the MCP package because the MCP server uses
its public shared-rule surface as a local package dependency. The MCP test
command then compiles the package and runs the complete Node.js test suite from
`dist/test/`.

The same suite can be launched from the repository root without changing
directory:

```bash
npm test --prefix packages/mcp-server
```

### Run the type checker or build only

```bash
npm run typecheck   # validate TypeScript without producing files
npm run build       # compile sources and tests into dist/
```

From the repository root, append `--prefix packages/mcp-server` to either
command.

### Run one test file

Individual tests run from the compiled `dist/test/` tree, so build the package
first. For example:

```bash
npm run build
node --test dist/test/integration/create-tour.test.js
node --test dist/test/integration/security.test.js
node --test dist/test/integration/cli.test.js
node --test dist/test/integration/packaged-binary.test.js
node --test dist/test/unit/validation.test.js
```

You can also filter tests in a file by name:

```bash
node --test --test-name-pattern="fileName" \
  dist/test/integration/create-tour.test.js
```

### What the tests exercise

- `create_tour` calls through the public MCP `stdio` seam;
- discovery of the single tool and its exact public schema;
- Tour Anchor, schema and V1 security validation;
- `fileName` validation (suffix, separators, `.`/`..`, absolute paths);
- rejection of unknown fields including `ref` and the Git parameters;
- operation outside a Git repository;
- Mermaid validation, the step-limit warning, and atomic replacement with
  preservation of an existing Tour after failures;
- CLI argument validation;
- `npm pack`, local installation of the archive, execution of the installed
  `codetour-mcp` binary, and invocation of `create_tour` (verifying the absence
  of `ref`).

Integration tests create isolated temporary workspaces and remove them after
each scenario. The packaging smoke test stays local and does not publish
anything to npm.
