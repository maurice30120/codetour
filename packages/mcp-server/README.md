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

Mermaid diagrams are optional and validated before either tool writes a Tour.
The MCP server reuses the exact fence rules and locked Mermaid implementation
from `codetour-description-renderer`, so the Tour Generator and playback apply
the same contract. Validation is local and offline.

## Requirements

- Node.js >= 18
- Git (only for `create_changes_tour`)

## Quick start

From the repository root, first install the shared renderer, then the MCP
server dependencies, and verify both packages:

```bash
cd packages/description-renderer
npm install
npm run build
cd ../mcp-server
npm install
npm test
```

`npm test` compiles the package and runs the full test suite. You can then start
the server from a workspace:

```bash
cd /path/to/workspace
node /path/to/codetour/packages/mcp-server/dist/src/cli.js
```

The process uses MCP over `stdio`, so it waits silently for requests from an
MCP client. Use `Ctrl+C` to stop it when it is started manually.

The process working directory is the workspace. A server instance handles
exactly that workspace and confines all operations to it: real paths are
resolved before any read or write, symbolic links that leave the root are
rejected, and the server performs no network access.

The package exposes the `codetour-mcp` binary, available after `npm install` or
`npm link`. To make this binary available globally during local development:

```bash
npm link
cd /path/to/workspace
codetour-mcp
```

Finally, configure your MCP client with the command and working directory as in
the example below. Once connected, the client automatically discovers
`create_project_tour` and `create_changes_tour`.

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

### Codex configuration

The VS Code extension provides the `CodeTour: Configure MCP for Codex` and
`CodeTour: Repair MCP Configuration for Codex` commands. The first installs the
global configuration when it is missing; the second replaces stale
configuration, especially after an extension update.

For a development build that is not installed as a VSIX, the manual equivalent
is:

```bash
codex mcp add codetour -- \
  node /path/to/codetour/dist/mcp-server.js
```

You do not need to keep a process running manually: Codex starts the `stdio`
server automatically. Check the configuration with:

```bash
codex mcp get codetour
```

New Codex tasks start the server in their own working directory, so one global
configuration covers every project.

To generate the general project Tour, ask for example:

```text
Analyze this repository, then use the codetour.create_project_tour MCP tool to
generate a Project Tour. Present the project's purpose, entry points, important
components, and main execution flows. Start with a step anchored to the root
directory to explain its organization, then introduce important directories
before detailing files. Use stable file anchors whenever possible.
```

To scope the Project Tour to a subdirectory, name it explicitly in the request.
The first step must then use that path in its `directory` field, relative to the
workspace root.

The result is written to `.tours/project.tour`.

To document the current branch's changes:

```text
Analyze this branch's committed changes since its base branch, then use
codetour.create_changes_tour to create a Changes Tour. Determine the base ref
and use the full SHA of the current HEAD. Do not include uncommitted changes.
```

The result is written to `.tours/changes.tour`.

## Tools

### `create_project_tour`

| Argument      | Type     | Required | Description                                             |
| ------------- | -------- | -------- | ------------------------------------------------------- |
| `title`       | string   | no       | Defaults to `Project Overview`.                         |
| `description` | string   | no       | Optional tour description.                              |
| `steps`       | object[] | yes      | Non-empty list of steps (see below).                    |

A good Project Tour covers the project's purpose, its main entry points, its
important components, and its main execution flows. When the project has a
meaningful directory structure, it begins with a directory-anchored overview.
For a Project Tour scoped to a subdirectory, the first step anchors that exact
workspace-relative directory. Other important directories should be introduced
before their individual files.

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
| `directory`   | string | Workspace-relative path; use for structural overview steps and at most one of `file`/`directory` per step. |
| `line`        | number | 1-based line; only valid with `file`, mutually exclusive with `pattern`.     |
| `pattern`     | string | Regular expression matching exactly one occurrence; only valid with `file`.  |
| `selection`   | object | `{ start: {line, character}, end: {line, character} }`, 1-based; only valid with `file`. |

Steps without any locator are allowed (general context, deleted files).
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
