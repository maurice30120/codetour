# codetour-mcp

A local MCP (Model Context Protocol) server that lets an AI agent create
[CodeTour](https://github.com/microsoft/codetour) tours deterministically.
The agent analyzes the code and writes the explanations; the server validates
the proposal, applies the Git and security rules, and atomically replaces the
reserved tour file.

Two specialized tools are exposed:

- `create_project_tour` — a **Project Tour** that explains a codebase as a
  whole, written to `.tours/project.tour`.
- `create_changes_tour` — a **Changes Tour** that explains the committed
  changes on a branch since it diverged from a base ref, written to
  `.tours/changes.tour`.

Both outputs are compatible with the general CodeTour schema, within a
deliberately stricter V1 subset: explanatory Markdown and workspace-internal
locations only. CodeTour `commands`, root-level `when` expressions, external
`uri` steps, and active Markdown schemes (`command:`, `file:`, `vscode:`,
`vscode-insiders:`, `javascript:`) are rejected.

## Requirements

- Node.js >= 18
- Git (only for `create_changes_tour`)

## Démarrage rapide

Depuis la racine du dépôt, installez les dépendances du serveur MCP et vérifiez
le package :

```bash
cd packages/mcp-server
npm install
npm test
```

`npm test` compile le package et exécute toute la suite de tests. Vous pouvez
ensuite démarrer le serveur pour un workspace :

```bash
node dist/src/cli.js --workspace-root /path/to/workspace
```

Le processus utilise MCP sur `stdio`. Il attend donc silencieusement les
requêtes d'un client MCP. Utilisez `Ctrl+C` pour l'arrêter lorsqu'il est lancé
manuellement.

L'argument `--workspace-root` est obligatoire. Une instance du serveur traite
exactement un workspace et toutes les opérations y sont confinées : les chemins
réels sont résolus avant toute lecture ou écriture, les liens symboliques qui
sortent de la racine sont refusés et le serveur n'effectue aucun accès réseau.

Le package expose le binaire `codetour-mcp`, disponible après `npm install` ou
`npm link`. Pour rendre ce binaire accessible globalement pendant le
développement local :

```bash
npm link
codetour-mcp --workspace-root /path/to/workspace
```

Configurez enfin votre client MCP avec la commande et le workspace à utiliser,
comme dans l'exemple ci-dessous. Une fois connecté, le client découvre
automatiquement `create_project_tour` et `create_changes_tour`.

## MCP client configuration

```json
{
  "mcpServers": {
    "codetour": {
      "command": "node",
      "args": ["/path/to/codetour/packages/mcp-server/dist/src/cli.js", "--workspace-root", "/path/to/workspace"]
    }
  }
}
```

The transport is `stdio` only.

### Configuration dans Codex

Après le build, enregistrez le serveur auprès de Codex en remplaçant les deux
chemins par des chemins absolus :

```bash
codex mcp add codetour -- \
  node /path/to/codetour/packages/mcp-server/dist/src/cli.js \
  --workspace-root /path/to/workspace
```

Il n'est pas nécessaire de conserver un processus lancé manuellement : Codex
démarre le serveur `stdio` automatiquement. Vérifiez la configuration avec :

```bash
codex mcp get codetour
```

Redémarrez ensuite l'application Codex ou son extension IDE pour qu'elle charge
le nouveau serveur. Dans une session Codex, `/mcp` permet de vérifier que le
serveur est connecté.

Pour générer le tour général du projet, demandez par exemple :

```text
Analyse ce dépôt, puis utilise l'outil MCP codetour.create_project_tour pour
générer un Project Tour. Présente le but du projet, ses points d'entrée, ses
composants importants et ses principaux flux d'exécution. Utilise des ancres
stables dans les fichiers lorsque c'est possible.
```

Le résultat est écrit dans `.tours/project.tour`.

Pour documenter les changements de la branche courante :

```text
Analyse les changements commités de cette branche depuis sa branche de base,
puis utilise codetour.create_changes_tour pour créer un Changes Tour. Détermine
la référence de base et utilise le SHA complet du HEAD actuel. N'inclus pas les
modifications non commitées.
```

Le résultat est écrit dans `.tours/changes.tour`.

## Tools

### `create_project_tour`

| Argument      | Type     | Required | Description                                             |
| ------------- | -------- | -------- | ------------------------------------------------------- |
| `title`       | string   | no       | Defaults to `Project Overview`.                         |
| `description` | string   | no       | Optional tour description.                              |
| `steps`       | object[] | yes      | Non-empty list of steps (see below).                    |

A good Project Tour covers the project's purpose, its main entry points, its
important components, and its main execution flows.

### `create_changes_tour`

| Argument             | Type     | Required | Description                                                   |
| -------------------- | -------- | -------- | ------------------------------------------------------------- |
| `baseRef`             | string   | yes      | Git ref the branch diverged from.                             |
| `headRef`             | string   | yes      | Full 40-character SHA of the analyzed commit; must equal the current `HEAD`. |
| `includeUncommittedChanges` | boolean  | no       | Include uncommitted changes explicitly (default `false`).     |
| `title`              | string   | no       | Defaults to `Changes on <branch>`.                            |
| `description`        | string   | no       | Optional description; provenance is always appended.          |
| `steps`              | object[] | yes      | Non-empty list of steps (see below).                          |

A good Changes Tour covers the intent of the changes, the major
modifications, their impact, and the relevant tests.

### Steps

| Field         | Type   | Description                                                                  |
| ------------- | ------ | ---------------------------------------------------------------------------- |
| `title`       | string | Optional step title.                                                         |
| `description` | string | Required Markdown explanation.                                               |
| `file`        | string | Workspace-relative path; at most one of `file`/`directory` per step.         |
| `directory`   | string | Workspace-relative path; at most one of `file`/`directory` per step.         |
| `line`        | number | 1-based line; only valid with `file`, mutually exclusive with `pattern`.     |
| `pattern`     | string | Regular expression matching exactly one occurrence; only valid with `file`.  |
| `selection`   | object | `{ start: {line, character}, end: {line, character} }`, 1-based; only valid with `file`. |

Steps without any locator are allowed (general context, deleted files).
Every anchor is validated against the real workspace state. All validation
errors are aggregated and reported in a single response; the previous tour
file is preserved on failure.

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
| `GIT_REPOSITORY_REQUIRED`  | `create_changes_tour` was called outside a Git repository.     |
| `STALE_HEAD`               | `headRef` does not match the current `HEAD`.                      |
| `INVALID_BASE_REF`         | The merge-base between `baseRef` and `headRef` cannot be computed. |
| `NO_CHANGES`               | No committed changes between the merge-base and `headRef`; the previous tour file is preserved. |
| `SCHEMA_VALIDATION_FAILED` | Internal: the generated tour did not validate against the CodeTour schema. |
| `OUTPUT_PATH_ESCAPES_WORKSPACE` | The output directory resolves outside the workspace root. |

Non-blocking warnings:

| Code                            | Meaning                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `STEP_LIMIT_EXCEEDED`           | The tour has more than fifteen steps.                                    |
| `NO_CHANGED_FILE_ANCHOR`        | No step anchors a file modified by the changes.                          |
| `UNCOMMITTED_CHANGES_EXCLUDED`  | Staged, unstaged or untracked changes were excluded (default).           |
| `UNCOMMITTED_CHANGES_INCLUDED`  | Uncommitted changes were included; the tour describes a non-reproducible local state. |

## Git reference policies

- A Project Tour has no CodeTour `ref`, so it stays usable as the project
  evolves.
- A reproducible Changes Tour records the exact analyzed head SHA as its
  `ref`, and generation fails with `STALE_HEAD` if `HEAD` changed since the
  analysis. Uncommitted changes are excluded by default (with a warning).
- With `includeUncommittedChanges: true`, the Changes Tour has no `ref` and warns
  that it describes a non-reproducible local state.

The reserved tour files (`.tours/project.tour` and `.tours/changes.tour`) are
always replaced after a complete, successful validation, via an atomic
rename. They are excluded from the dirty-workspace detection so a previous
generation does not warn about itself.

## Development

Install the package dependencies once:

```bash
cd packages/mcp-server
npm install
```

### Run all tests

From `packages/mcp-server/`:

```bash
npm test
```

The test command first compiles the package, then runs the complete Node.js
test suite from `dist/test/`. A successful run currently reports 69 passing
tests.

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
node --test dist/test/integration/changes-tour.test.js
node --test dist/test/integration/project-tour.test.js
node --test dist/test/integration/security.test.js
node --test dist/test/integration/cli.test.js
node --test dist/test/integration/packaged-binary.test.js
node --test dist/test/unit/validation.test.js
```

You can also filter tests in a file by name:

```bash
node --test --test-name-pattern="STALE_HEAD" \
  dist/test/integration/changes-tour.test.js
```

### What the tests exercise

- Project Tour and Changes Tour calls through the public MCP `stdio` seam;
- Tour Anchor, schema and V1 security validation;
- Git merge-base, stale `HEAD`, dirty-workspace and deletion-only scenarios;
- atomic replacement and preservation of an existing Tour after failures;
- CLI argument validation;
- `npm pack`, local installation of the archive, execution of the installed
  `codetour-mcp` binary, and invocation of both public MCP tools.

Integration tests create isolated temporary workspaces and Git repositories
and remove them after each scenario. The packaging smoke test stays local and
does not publish anything to npm.
