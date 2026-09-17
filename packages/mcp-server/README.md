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

## Installation and local validation

```bash
npm install
npm run build
npm test
```

Run the server locally:

```bash
node dist/src/cli.js --workspace-root /path/to/workspace
```

The `--workspace-root` argument is required. One server instance handles
exactly one workspace root, and every operation is confined to it: real paths
are resolved before any read or write, symlinks that escape the root are
rejected, and the server performs no network access.

The package exposes the `codetour-mcp` binary (available after `npm install`
or `npm link`).

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

```bash
npm run typecheck   # type-check only
npm run build       # compile to dist/
npm test            # build + integration tests over the stdio MCP seam
```

Integration tests launch the server as an MCP client would, over `stdio`,
against temporary workspaces and temporary Git repositories.
