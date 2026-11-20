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
- `knowledge_save` writes `created`, `appended`, `replaced` or
  `completed_zero`, or `failed` for conflict/invalid/internal failure.
  `knowledge_close_run` writes `skipped`. The closure accumulates the names it
  published in `created[]` and the names it appended to or rewrote in
  `changed[]`. Each save is all-or-nothing, but a run can make several save
  calls: when one call created or modified entries and another was refused, the
  closure is `partial` and keeps the names that were actually published. A
  creation is never erased by a later zero or skip closure.
- The hook returns `{}` for ordinary conversations, other sessions or
  workspaces, `stop_hook_active`, a run without a created Tour, any existing
  closure, an expired or unreadable state, or a storage failure. It returns
  `{"decision":"block","reason":"…"}` at most once per run, after marking
  `continuationUsed` under a cross-process lock.
- Files are pruned after seven days by the next generation; Knowledge is never
  touched by pruning. The hook ignores runs older than 24 hours.

## Run usage metrics

The run state carries one additive, optional `metrics` object (ADR 0042):

```json
"metrics": {
  "version": 1,
  "preparation": {
    "commandAt": "2026-11-19T11:26:19.259Z",
    "promptTool": "generate_project_tour",
    "promptComposeMs": 87,
    "sentAt": "2026-11-19T11:26:21.004Z"
  },
  "usage": {
    "source": "copilot-session-events-v1",
    "observed": true,
    "observedAt": "2026-11-19T11:28:22.000Z",
    "file": "/Users/…/.copilot/session-state/<sessionId>/events.jsonl",
    "copilotVersion": "1.0.114",
    "model": "claude-sonnet-5.5",
    "projectState": {"branch": "spec-223-integration", "headCommit": "9ef3…"},
    "totals": {"records": 2, "durationMs": 4800, "inputTokens": 489549, "outputTokens": 430, "cacheReadTokens": 427051, "cacheWriteTokens": 62478, "reasoningTokens": 0},
    "calls": {"successful": {"create_project_tour": 1, "knowledge_save": 1}, "refused": {}},
    "windows": {
      "generation": {"fromAt": "…", "untilAt": "…", "records": 1, "durationMs": 4000, "inputTokens": 364887, "outputTokens": 123, "cacheReadTokens": 305382, "cacheWriteTokens": 59489, "reasoningTokens": 0},
      "consolidation": {"fromAt": "…", "untilAt": "…", "records": 1, "durationMs": 800, "inputTokens": 124662, "outputTokens": 307, "cacheReadTokens": 121669, "cacheWriteTokens": 2989, "reasoningTokens": 0},
      "boundaryObserved": true
    }
  }
}
```

- The adapter writes the preparation facts only it knows: the command start,
  the served prompt that composed the request and how long the composition
  took, and the send stamp after the host accepted the prompt. No token figure
  is claimed for that phase.
- At every stop that matches a run of this session, the hook recomputes the
  snapshot from Copilot's own session usage records
  (~/.copilot/session-state/<sessionId>/events.jsonl on 1.0.114): model,
  Copilot version, branch and head commit, CodeTour tool calls and token
  totals. A CodeTour tool execution is one `tool.execution_start` naming the
  tool joined with one `tool.execution_complete` carrying the same
  `toolCallId`; `calls` separates the successful results from the refusals
  (`success:false`). `inputTokens` include the cached reads exactly as the
  session reports them. The generation window ends at the last successful
  Tour creation; what follows is the consolidation window. A second run of
  the same session bounds the first run's window, so two runs never claim
  each other's records.
- The snapshot is a recomputation, never an accumulation: the newest one
  replaces the previous. Totals stop at the last observed stop, so a final
  user reply composed after the last stop lands in the next snapshot when one
  occurs.
- Metrics are observability, never a guarded outcome: they never feed the
  continuation decision and are never written by the MCP. A missing,
  unreadable or unparseable session events file, or a host without hooks,
  records `observed:false` with a reason — or nothing at all — and changes no
  decision.
- `CODETOUR_COPILOT_SESSION_STATE_DIR` overrides the session-state root for
  tests and relocated layouts; `COPILOT_HOME` relocates the base directory.
- The format of Copilot's session events is Copilot-internal and may change
  between CLI versions; the `source` field names the layout the snapshot was
  read with.

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
