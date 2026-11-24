# CodeTour Copilot plugin

This directory is the versioned **Agent Plugins 1.0** source of the CodeTour
integration for GitHub Copilot CLI. It is embedded in the standalone CodeTour
CLI and installed by:

```sh
codetour --install copilot
```

`copilot plugin install packages/copilot-plugin` installs the same directory
directly (the installed CLI supports local direct installs, with a deprecation
warning). `copilot plugin uninstall codetour` removes it.

## Contents

| Path | Role |
| --- | --- |
| `plugin.json` | Agent Plugins 1.0 manifest (`$schema`, name, version, metadata). |
| `mcp.json` | Declares the **existing** `codetour mcp` stdio server. It is the single MCP registration for a plugin session. |
| `skills/codetour-generate/SKILL.md` | Minimal generation entry point that defers to the MCP prompt. |
| `com.github.copilot/hooks/hooks.json` | Copilot `agentStop` hook declaration. |
| `com.github.copilot/hooks/agent-stop.mjs` | Usage metrics hook; it never blocks Tour completion. |
| `com.github.copilot/lib/run-log.mjs` | Run-state format shared by the adapter and the hook. |

## The served prompt is the only Tour method

The plugin does not carry Tour instructions. The adapter calls
`prompts/get` `generate_project_tour` (or `generate_changes_tour`) with the
user's request, the orientation phrase and the run identity, then sends the
composed message unchanged. An unreachable server or an empty prompt is a
visible failure; there is no fallback prompt.

## One CodeTour MCP server

`mcp.json` declares `codetour mcp --workspace-root ${COPILOT_SESSION_CWD}`,
launched from the `codetour` on `PATH`. The extension no longer joins an MCP
server, and `codetour --install copilot` removes a `codetour` entry that an
older release wrote into `~/.copilot/mcp-config.json`. A same-named entry that
this CLI did not write is preserved and reported: remove it yourself if it
would duplicate the plugin's server.

## Run state and the agentStop hook

The hook records available usage metrics and lets the agent stop after Tour creation. CodeTour memory is temporarily unavailable while Knowledge moves to TokenEconomizer; existing knowledge is not migrated.

## Pre-launch report

Every generation reports its integration before the first agent request
(ADR 0043), as `session.log` info lines:

```text
CodeTour pre-launch: adapter /…/extensions/codetour/adapter.mjs (installed)
CodeTour pre-launch: launcher node /…/dist/cli.js mcp --workspace-root /real/workspace
CodeTour pre-launch: workspace /real/workspace
CodeTour pre-launch: extension /…/.copilot/extensions/codetour (adapter.mjs, extension.mjs, run-log.mjs)
CodeTour pre-launch: plugin v0.1.2 at /…/installed-plugins/_direct/codetour-plugin-…; MCP launcher node /…/dist/cli.js mcp --workspace-root ${COPILOT_SESSION_CWD} (build v0.1.2)
CodeTour pre-launch: user mcp-config /…/.copilot/mcp-config.json: no extra CodeTour server
```

One problem is reported at error level, never as a stop — the report tells
the truth and starting the run stays the user's:

- the CodeTour plugin is not installed in the Copilot home (no
  `config.json` entry, no `CODETOUR_COPILOT_PLUGIN_DIR`): run
  `codetour --install copilot` from the build that should serve;
- the plugin's launcher does not exist on disk (a moved or deleted
  checkout): sessions would get no CodeTour tools;
- the plugin's launcher points at another build (`plugin.json` version
  differs from the package.json beside the launched CLI): a stale or
  foreign build serves the session — the trial case of a personal plugin
  left pointing at another checkout;
- the user `mcp-config.json` also declares a `codetour` MCP server: the
  session would load the CodeTour tools twice;
- more than one CodeTour extension directory exists under the extensions
  root.

The same facts are recorded in the run state's `metrics.integration`
launcher, workspace, adapter origin, extension files, plugin version and
launcher build, user config declaration and `problems` - so the trial
record per runId shows which integration was actually loaded. The scan is
offline (no `copilot` invocation, no network) and reads exactly the paths
the installer writes; `COPILOT_HOME` relocates it,
`CODETOUR_COPILOT_EXTENSIONS_DIR`, `CODETOUR_COPILOT_MCP_CONFIG` and
`CODETOUR_COPILOT_PLUGIN_DIR` override single surfaces.

## Requirements

- GitHub Copilot CLI 1.0.106 or later (verified with 1.0.106; the bundled
  runtime reports 1.0.114). The plugin relies on `${COPILOT_SESSION_CWD}` and
  `${PLUGIN_ROOT}` expansion and on the `agentStop` hook contract.
- `codetour` on `PATH` for a direct `copilot plugin install` of this source
  (the CLI-managed install generates an absolute launcher).
- Node on `PATH` for the hook command (`node "${PLUGIN_ROOT}/…"`).
- Hooks enabled in Copilot. If hooks are disabled or the plugin is not loaded,
  no guard runs: run state and MCP results still report the truth, and no
  consolidation is implied.
- macOS and Linux path handling uses Node APIs and has been exercised with
  spaces in both the installed plugin path and the workspace path. Windows was
  not executed in this environment; the hook uses `exec`-free Node APIs and the
  declaration quotes `${PLUGIN_ROOT}`, but Windows remains unverified.
