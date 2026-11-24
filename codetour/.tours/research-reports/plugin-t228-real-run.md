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

## 5. Real `/codetour generate project <demand>` dispatch under an interactive PTY (19/11/2026)

Section 4 recorded the honest limitation of prompt mode (`copilot -p`) on CLI
1.0.106. This section closes it on the installed CLI **1.0.114** (the host now
reports 1.0.114; the platform behaviour is what matters, and it is recorded as
observed). `copilot --help` documents `-i, --interactive <prompt>`: "Start
interactive mode and automatically execute this prompt". That is the entry
point that actually dispatches an extension slash command.

### Dispositif

Temporary `COPILOT_HOME` and a project path with spaces; plugin, extension and
skill installed from the current build:

```sh
COPILOT_HOME="$TMP/copilot home with spaces" \
CODETOUR_CLI="$REPO/dist/cli.js" \
node dist/cli.js --install copilot
```

The `.tours/` directory was empty before the run. The adapter resolves the CLI
from `CODETOUR_CLI` (set here); a temporary PATH shim `codetour -> node
dist/cli.js` mirrors a real installation for the skill's CLI calls.

The session is driven through a Python `pty` (no shell, bounded to 180 s,
Enter sent once at +4 s and once at +20 s so an onboarding screen cannot mask
the command):

```sh
python3 drive.py "$TMP" 180
# argv: copilot -i "/codetour generate project Explique la fonction double et sa valeur de retour." \
#       --experimental --allow-all --disable-client-telemetry
```

`--trust-folder` is rejected with `-i` (`the argument '--interactive <prompt>'
cannot be used with '--trust-folder'`), so it was removed; the temp project is
trusted for the run by `--allow-all`.

### Observed (definitive run)

- **The command is dispatched.** The extension loaded and the adapter ran: it
  wrote `<workspace>/.tours/.log/codetour-run-0e73b815-….json` at **+4.7 s**,
  before any model/tool activity. That file can only be written after
  `prompts/get` resolved (the adapter writes it immediately before
  `session.send`), so the hard invariant `prompts/get → run state →
  session.send` is observed on the real host, not only on the fake host.
- **The request is the user's demand, not the command.** The run state records
  `"request": "Explique la fonction double et sa valeur de retour."` — the
  command/type prefix is gone, as the code-review fix requires. (An earlier
  attempt with the stale embedded adapter recorded the raw `generate project …`
  command, which is how the stale embedding was caught; see "Build defect".)
- **A Tour is created.** At **+29.8 s** the agent called
  `codetour-create_project_tour` with the served `runId`
  (`0e73b815-050d-429f-9367-b46c58b0e28d`) and the MCP returned
  `Created Project Tour at .tours/project.tour with 4 step(s).`
- **The closure is server-written.** The agent then called
  `codetour-knowledge_save` with `entries: []` and the same `runId`; the MCP
  persisted `consolidation: {status:"completed_zero", created:[], outcome:"completed_zero"}`.
- **The hook is inert on a closed run.** The `agentStop` hook ran at the end of
  the turn (`stop_hook_active:false`) and returned `{}`.
- The session TUI stays open after the turn, so the driver terminated it at the
  180 s bound; all artefacts above were already on disk.

Session events confirm the order: `skill(codetour-knowledge)` →
`bash codetour knowledge list` (`status:"empty"`) → `view src/math.ts` →
`codetour-create_project_tour` (one `INVALID_PROPOSAL` with an absolute
`workspacePath`, corrected to `"."`) → `codetour-knowledge_save` → `hook.end {}`.

### Build defect found and fixed

The first PTY attempt installed the adapter from `src/cli/copilot-extension.generated.ts`,
which was stale: the WIP commit edited `.github/extensions/codetour/adapter.mjs`
but had not regenerated the embedded module. `npm run build` does **not**
regenerate the embeddings; `node scripts/embed-copilot-extension.js` and
`node scripts/embed-copilot-plugin.js` must be run after editing those sources,
and the compiled tests (`agentIntegrations.test.ts`, `copilotPlugin.test.ts`)
fail when they diverge. The final build regenerates both modules. The first
attempt is still valid evidence that the host dispatches the command (it
created a Tour and a `completed_zero` closure); the definitive attempt above
additionally proves the new `request` extraction.

### Intermediate attempt (honest record)

With the regenerated adapter but before the PATH shim, the adapter ran and
recorded the stripped request, but the agent loaded the personal
`codetour-knowledge` skill and its `codetour knowledge list --workspace "$PWD"`
resolved to an old `codetour` on `PATH`, which exited
`CodeTour: Unknown option: --workspace`. The agent then correctly refused to
invent a Tour (`Aucun tour n'a été créé`). That is an environment blocker, not
an adapter failure: the run state already existed, and the adapter path was
unchanged. Adding the PATH shim produced the successful definitive run above.

### Cleanup and final state

`node dist/cli.js --uninstall copilot` removed the plugin, the personal skill
and the extension from the temporary home. `copilot plugin list` and `copilot
mcp list` show no CodeTour entry; the extension and skill directories are gone.
The developer's real `~/.copilot` was never used: every command ran with a
temporary `COPILOT_HOME`. The temp home and project were deleted after the
evidence was recorded here.

### Residual limitation

The entry point is interactive: an automated run needs a PTY and a heuristic
end-of-turn (the process does not exit by itself). `-p` still does not dispatch
extension commands, so a CI-style guarded generation remains impossible
without a PTY driver. The criterion "controlled entry point on a real host" is
therefore **met**, with the platform-limited automation caveat stated here
rather than hidden.
