# Ticket #228 — real Copilot CLI observations (19 November 2026)

Environment: GitHub Copilot CLI 1.0.106 (`copilot --version`), bundled runtime
1.0.114, macOS (darwin-arm64), temporary `COPILOT_HOME` for every run. The
developer's real `~/.copilot` was not modified. Worktree:
`/Users/dhuyet/Documents/POC/codetour-wt/spec223-t228`, branch
`feature/spec-223/t228`, build from `npm run build` equivalents.

## 1. Agent Plugins 1.0 surface (no model call)

Commands:

```sh
COPILOT_HOME="$TMP/copilot home" node dist/cli.js --install copilot
COPILOT_HOME="$TMP/copilot home" copilot plugin list
COPILOT_HOME="$TMP/copilot home" copilot mcp list
COPILOT_HOME="$TMP/copilot home" copilot mcp get codetour --json
COPILOT_HOME="$TMP/copilot home" copilot skill list
COPILOT_HOME="$TMP/copilot home" node dist/cli.js --uninstall copilot
```

Observed:

- `copilot plugin list`: `codetour (v0.1.2)`.
- `copilot mcp list`: `Plugin servers: codetour (local)` — one server.
- `copilot mcp get codetour --json`: `source: "plugin"`,
  `sourcePlugin: "codetour"`, the generated absolute launcher
  (`node …/dist/cli.js mcp --workspace-root ${COPILOT_SESSION_CWD}`),
  `cwd: "${PLUGIN_ROOT}"`, and `PLUGIN_ROOT` expanded to the installed cache
  path (which contained spaces).
- `copilot skill list`: `Plugin skills: codetour-generate`.
- `mcp-config.json` did not exist in the temporary home: the plugin is the only
  registration.
- `--uninstall` removed the plugin, the skill and the extension; a second
  `plugin list`/`mcp list` showed no CodeTour entry.

The automated version of this check is `test/copilot-plugin-install.test.mjs`
(it installs from a source path containing spaces and runs the installed hook
from a workspace path containing spaces).

## 2. Real session: one server, plugin tools, inert ordinary hook

Workspace: `.../real-run.IcYiUg/workspace with spaces` (a Git repository with
one `math.js`). Plugin installed in the same temporary home as above.

```sh
cd "$WS"
COPILOT_HOME="$TMP/copilot home" copilot \
  -p "Use the codetour MCP server in this session. Reply with the exact names of the tools it exposes whose name contains create_project_tour, knowledge_save or knowledge_close_run. Do not call any tool; just list the names." \
  -s --allow-all-tools
```

Output:

```text
codetour-create_project_tour
codetour-knowledge_save
codetour-knowledge_close_run
```

Process sampling during the run (`ps -Ao pid=,command=` every 250 ms) found
exactly one matching process:

```text
node /Users/dhuyet/Documents/POC/codetour-wt/spec223-t228/dist/cli.js mcp \
  --workspace-root /private/.../workspace with spaces
```

Session events (`session-state/<id>/events.jsonl`) contained exactly one
`hook.start`/`hook.end` pair:

```json
{"hookType":"agentStop","input":{"sessionId":"…","stopReason":"end_turn","stop_hook_active":false,"cwd":".../workspace with spaces"}}
{"hookType":"agentStop","success":true,"output":{}}
```

Usage: 1 premium request, 21,654 prompt tokens (6,656 cached), 26 output
tokens, 5,441 ms API duration. The session system prompt listed the six
CodeTour tools once (`codetour-create_project_tour`,
`codetour-create_changes_tour`, `codetour-knowledge_list`,
`codetour-knowledge_read`, `codetour-knowledge_save`,
`codetour-knowledge_close_run`) and both skills (`codetour-knowledge` user,
`codetour-generate` plugin).

## 3. Real session: one blocked continuation, then completed_zero

A run state was seeded for the same session and workspace with
`tourCreated: true`, no closure, `runId: run-realhook0123456789`, then the
session was resumed:

```sh
COPILOT_HOME="$TMP/copilot home" copilot -r <session-id> \
  -p "Reply with exactly: RESUMED" -s --allow-all-tools
```

Output:

```text
RESUMED

Consolidation completed: no Knowledge entries were created or persisted.
```

Session hook events:

1. first stop: `output: {"decision":"block","reason":"Finish the CodeTour consolidation for run run-realhook0123456789 … Call knowledge_save with runId …"}`;
2. re-entry: `stop_hook_active: true`, `output: {}`.

The agent called `codetour-knowledge_save` with
`{"entries":[],"runId":"run-realhook0123456789"}`. The final run state:

```json
{
  "tourCreated": true,
  "continuationUsed": true,
  "consolidation": {
    "status": "completed_zero",
    "runId": "run-realhook0123456789",
    "created": [],
    "outcome": "completed_zero"
  }
}
```

Usage for the resumed session: 3 premium requests total across the session
(initial + resume + continuation), 31,143 ms API duration.

This proves the hook is loaded by the real CLI, forces exactly one
continuation, goes inert on `stop_hook_active`, and that only the MCP writes the
closure the hook reads.

## 4. `-p "/codetour generate …"` does not dispatch the extension command

```sh
COPILOT_HOME="$TMP/copilot home" copilot --experimental \
  -p "/codetour generate project Explique le module math et son unique fonction." \
  --allow-all-tools -s
```

Observed: the CLI loaded the extension (`logs/process-*.log` contains
`launch … extensions/codetour/extension.mjs` and `importing extension`), but the
prompt text reached the model as ordinary text. The model invoked the plugin's
`codetour-generate` skill, which called the MCP prompt/tools and produced:

- `.tours/project.tour` with two steps;
- `.tours/.memory/knowledge/math_add_module.md` (valid SHA-256 evidence);
- no `.tours/.log/` run state.

The skill path is therefore functional but **unguarded**: the adapter did not
run, so no `runId`/closure exists. This is the documented limitation of any
direct skill or direct MCP use. The adapter invariant (`prompts/get` → run state
→ `session.send`, no fallback) is covered by the fake-host boundary tests
against the compiled CLI; a fully automated real-host `/codetour generate` run
was not achievable on CLI 1.0.106 without driving the interactive TUI.

## Reproduce

```sh
node --test test/copilot-plugin-install.test.mjs
node --test test/copilot-hook.test.mjs
node --test test/copilot-adapter.test.mjs
```

No Python, no TokenEconomizer checkout, no API key and no marketplace were
used.
