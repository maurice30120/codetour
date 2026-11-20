# CodeTour for Pi (experimental)

A **thin, installable Pi package** for CodeTour. The plugin registers the existing CodeTour MCP server for the current session and provides the `/codetour` command. It does **not** require CodeGraph, Tree-sitter, a second MCP adapter, or changes to `.tour` files.

## Prerequisites

- Pi with built-in MCP support (`pi >= 0.99`); keep Pi's built-in `mcp` extension enabled.
- A working CodeTour standalone launcher on `PATH` (`codetour mcp --help`), built from the repository's **beta** branch, or an absolute path supplied via `CODETOUR_PI_EXECUTABLE`.
- Run Pi inside the workspace in which you want the Tour created.

## Install from the beta checkout

```sh
# From the CodeTour repository root, on beta or a branch based on beta:
pi install ./packages/pi-plugin

# For a temporary smoke test instead of persistent installation:
pi -e ./packages/pi-plugin/index.mjs
```

Pi reads the package's `pi.extensions` manifest. No global `.pi/` changes are committed to this repository.

For a CodeTour launcher outside `PATH`, set an absolute executable path before starting Pi:

```sh
export CODETOUR_PI_EXECUTABLE="/absolute/path/to/codetour-distribution/codetour"
pi
```

The environment value is one executable path, **not** a shell command with arguments. On Windows use the appropriate runnable launcher; Windows/Pi runtime behavior remains to be smoke-tested.

Inside Pi, type `/mcp` and inspect the `codetour` server (the shell command `pi mcp list` does **not** load extension registrations). A manually configured `codetour` server in Pi's `mcp.json` takes precedence.

## Commands

- `/codetour`: choose **Project Tour** or **Changes Tour**, then neutral/critical for Changes.
- `/codetour generate project`: generate a Project Tour.
- `/codetour generate project explique l'authentification`: same, with the user's scope.
- `/codetour generate changes neutral`: describe changes without review findings.
- `/codetour generate changes critical vérifie la sécurité`: critical Changes Tour with the user's scope.

The command asks for missing choices in interactive mode; cancelling does nothing. Without an interactive UI it asks the agent to clarify missing choices rather than silently selecting a mode. Viewing existing Tours stays with the CodeTour CLI (`codetour`): this MVP slash command concerns generation.

The generated user message tells Pi to call `mcp__codetour__get_generation_prompt` **first**, and follow the server-owned instructions before calling the creation tool. This avoids a second prompt implementation. The plugin exposes three generation tools directly and keeps the other CodeTour MCP tools accessible through Pi's native codemode mechanism. The model can also use the CodeTour MCP directly without the slash command.

## Troubleshooting / boundaries

- If `/mcp` shows a connection error, first run `codetour mcp --help` and check `PATH` or `CODETOUR_PI_EXECUTABLE`. The server runs with `--workspace-root` set to Pi's current session workspace; it does not run a shell.
- When Pi reports duplicate servers, inspect user/project `mcp.json`; existing user configuration has precedence over this plugin.
- If a requested generation fails, the command must not claim a Tour was created. Creation is confirmed only by the CodeTour MCP result.
- This is **not** a port of the Copilot-only run-state/agentStop hook. It does not guarantee a consolidation continuation or Copilot-specific usage metrics.
- CodeGraph integration and Knowledge symbol-proof implementation are separate issues (#230 and #233).

## Tests

```sh
node --test packages/pi-plugin/test.mjs
```

The tests use a mock Pi extension host. A **real Pi + CodeTour MCP smoke test** is required before release: launch Pi in a disposable workspace, confirm `/mcp`, invoke `/codetour generate project`, verify `.tours/project.tour`, and repeat with `changes critical` in a Git worktree. This PR is not evidence that those end-to-end runs passed.
