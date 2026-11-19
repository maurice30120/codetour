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
| `com.github.copilot/hooks/agent-stop.mjs` | Deterministic consolidation guard: one bounded continuation, no LLM, no Knowledge writes. |
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

The controlled adapter writes one file per generation:

```text
<workspace>/.tours/.log/codetour-run-<runId>.json
```

```json
{
  "version": 1,
  "runId": "…",
  "workspace": "/absolute/real/workspace",
  "sessionId": "copilot-session-id",
  "kind": "project",
  "request": "generate project …",
  "at": "2026-11-19T…Z",
  "updatedAt": "2026-11-19T…Z",
  "tourCreated": true,
  "tourPath": ".tours/project.tour",
  "consolidation": {"status": "completed_zero", "runId": "…", "at": "…"},
  "continuationUsed": false
}
```

- The adapter writes the state before `session.send`; a failed send removes it.
- `create_project_tour` / `create_changes_tour` set `tourCreated`.
- `knowledge_save` writes `created` or `completed_zero`, or `failed` for
  conflict/invalid/internal failure. `knowledge_close_run` writes `skipped`.
  Each save is all-or-nothing, but a run can make several save calls: when one
  call created entries and another was refused, the closure is `partial` and
  keeps the names that were actually published. A creation is never erased by
  a later zero or skip closure.
- The hook returns `{}` for ordinary conversations, other sessions or
  workspaces, `stop_hook_active`, a run without a created Tour, any existing
  closure, an expired or unreadable state, or a storage failure. It returns
  `{"decision":"block","reason":"…"}` at most once per run, after marking
  `continuationUsed` under a cross-process lock.
- Files are pruned after seven days by the next generation; Knowledge is never
  touched by pruning. The hook ignores runs older than 24 hours.

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
