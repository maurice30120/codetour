# codetour-mcp

A local MCP (Model Context Protocol) server that lets an AI agent create
[CodeTour](https://github.com/microsoft/codetour) tours deterministically.
The agent analyzes the code and writes the explanations; the server validates
the proposal, applies the Git and security rules, and atomically replaces the
reserved tour file.

## Features

- **Project Tour generation** — explain a codebase as a whole: its purpose,
  main entry points, important components, and main execution flows. The tour
  is written to `.tours/project.tour` and has no Git ref, so it stays usable
  as the project evolves.
- **Changes Tour generation** — explain the committed changes on a branch
  since it diverged from a base ref: the intent of the changes, the major
  modifications, their impact, and the relevant tests. The tour is written to
  `.tours/changes.tour` and records the resolved merge-base SHA in `baseRef`
  and the exact analyzed head SHA in `ref`. File steps automatically use
  `display: "diff"` to show removed and added lines in VS Code's native diff
  editor. Added files have an empty left side; renamed files record the old
  path in `baseFile`. Deleted files are explained by steps without a locator.
  Uncommitted changes are excluded by default and reported as a warning.
  When `includeUncommittedChanges: true` actually includes local changes, the
  entire tour opens current files and omits the Git comparison metadata.
  On a clean workspace, that option still produces a reproducible Git diff.
- **Strict validation** — every proposal is checked against a deliberately
  stricter subset of the CodeTour schema: explanatory Markdown and
  workspace-internal locations only. CodeTour `commands`, root-level `when`
  expressions, external `uri` steps, and active Markdown schemes (`command:`,
  `file:`, `vscode:`, `vscode-insiders:`, `javascript:`) are rejected, and
  anchors are validated against the analyzed HEAD for committed-only Changes
  Tours, or the real workspace state for Project Tours and included local work. All validation
  issues are aggregated into a single response, and the previous tour file is
  preserved on any failure.
- **Workspace confinement** — one server instance is confined to one
  configured workspace root. Calls may select a directory below that root
  with `workspacePath`. Real paths are resolved before any read or write, symlinks
  that escape the root are rejected, and the server performs no network
  access.
- **Atomic persistence** — the reserved tour file is only replaced after a
  complete, successful validation, via an atomic rename. It is excluded from
  the dirty-workspace detection so a previous generation does not warn about
  itself.

## Requirements

- Node.js >= 18
- Git (only for Changes Tours)

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

The `--workspace-root` argument is required. The package exposes the
`codetour-mcp` binary (available after `npm install` or `npm link`).

## MCP client configuration

```json
{
  "mcpServers": {
    "codetour": {
      "command": "node",
      "args": [
        "/path/to/codetour/packages/mcp-server/dist/src/cli.js",
        "--workspace-root",
        "/path/to/workspace"
      ]
    }
  }
}
```

The transport is `stdio` only.

Both tools accept an optional `workspacePath`, relative to the configured
`--workspace-root`. Use it when the workspace contains several projects or
Git repositories, for example `"workspacePath": "my-project"`. Step anchors
and the generated `.tours/` file are relative to the selected directory; the
returned output path is relative to the configured root. The selection applies
only to that call. Absolute paths, missing directories and paths or symlinks
escaping the configured workspace are rejected without replacing a tour.

## Development

```bash
npm run typecheck   # type-check only
npm run build       # compile to dist/
npm test            # build + integration tests over the stdio MCP seam
```

Integration tests launch the server as an MCP client would, over `stdio`,
against temporary workspaces and temporary Git repositories.

## Reading a Changes Tour in GitHub Copilot / VS Code

Ask Copilot to create a Changes Tour with a base Git reference and the full SHA
of the current HEAD, then start `.tours/changes.tour` from the CodeTour view.
File steps open the native diff editor with deletions on the left and additions
on the right (red and green with the standard theme). Comments and selections
target the right side, and **CodeTour: Resume Tour** reopens the comparison.

Steps without `display` retain their existing behavior. `view` still focuses
VS Code views and does not select a diff mode. If the commit pair or a required
file cannot be resolved, a diff step opens the current file. If that file is
also missing, its explanation remains available and the tour can continue.
Exporting a diff tour embeds the HEAD snapshot and removes its Git diff
metadata, so the exported tour can be read without the repository.
