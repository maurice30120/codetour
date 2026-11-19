# Copilot CLI adapter and plugin (experimental)

`/codetour` opens a numbered selection with **Generate** first: `1. Generate`, `2. Read`. Generate offers `1. Project Tour`, `2. Changes Tour`. A Changes Tour asks `1. Neutral`, `2. Critical` before the extension sends any analysis request to the agent. The adapter uses the host's selection dialog for these menus and maps the answer by its position, so the offered order stays the single source of truth. Cancelling any choice ends the command without generating a Tour. Project Tours never ask for a review mode.

Explicit invocations skip the choices already supplied:

```text
/codetour generate project
/codetour generate changes neutral
/codetour generate changes critical
/codetour My Existing Tour --renderer terminal
```

A first word after `generate` that is not exactly `project` or `changes` is the start of the orientation phrase. The adapter does not guess at typos: it opens the type menu and keeps the remaining text verbatim as the orientation, so `/codetour generate change the login flow` asks for the type and then generates with the orientation `change the login flow`. A phrase after an explicit valid type is transmitted verbatim, even when the sentence names a type later. `/codetour "generate"` still reads a Tour with that title, and `/codetour generate` without a type asks for the type interactively.

Existing title and renderer invocations still select and open a Tour using the standalone CLI, which owns selection through its resolution contract (`--internal-resolve-tour`): a requested title resolves by exact title or file name, and resolution errors (not found or ambiguous title, empty workspace) reach the user exactly as the CLI reports them. Without a title, a workspace holding a single Tour resolves directly; only several discovered Tours elicit a candidate choice before the same CLI resolution. `generate` is now a command word; quote an existing title that starts with it, for example `/codetour "generate"`. Bare `read` remains a Tour title. The default renderer is the terminal; `--renderer html` selects the HTML reader explicitly. If the host lacks interactive elicitation, supply an explicit generation command or an existing Tour title.

## Install

`codetour --install copilot` installs two surfaces from the running CLI revision, with no checkout and no network:

- the **extension** in `~/.copilot/extensions/codetour/` (`CODETOUR_COPILOT_EXTENSIONS_DIR` overrides; `COPILOT_HOME` relocates the user directory);
- the **Agent Plugins 1.0 plugin** from `packages/copilot-plugin/`, either through `copilot plugin install` (production) or into `CODETOUR_COPILOT_PLUGIN_DIR` (tests and managed layouts).

The adapter files and the plugin are embedded in the CLI bundle, so the install works offline. A failed install restores the previous adapter files and managed plugin files. `codetour --uninstall copilot` removes the plugin first, then only the files this CLI owns; edited adapter or plugin files are reported and preserved. The standalone `codetour-knowledge` skill is retired and never installed: an install or uninstall removes a `~/.copilot/skills/codetour-knowledge/` directory an older CLI wrote, so no second CodeTour guidance coexists with the plugin.

The plugin requires GitHub Copilot CLI **1.0.106 or later**. On that version the local Agent Plugins 1.0 directory is accepted (`plugin.json` with `https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, root `mcp.json`, `com.github.copilot/` components, `skills/<name>/SKILL.md`), `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` are expanded, and `${COPILOT_SESSION_CWD}` is expanded in MCP `args`. `copilot plugin install <dir>` is still a direct/local install and prints a deprecation warning; no marketplace is involved. `copilot plugin list`, `copilot mcp list` and `copilot skill list` are the inspection surfaces.

`copilot plugin install packages/copilot-plugin` is also supported directly. That portable copy declares `codetour mcp` on `PATH`; the CLI-managed install generates an absolute launcher (the exact Node runtime and `dist/cli.js`, or the native executable) so a session does not depend on `PATH`. `CODETOUR_COPILOT_PLUGIN_DIR` writes the same managed files without invoking Copilot.

Start `copilot --experimental` in a trusted Git worktree, with extension mode set to Load Only or Load & Augment. GitHub's extension API remains experimental.

## One CodeTour MCP server

The plugin's root `mcp.json` is the single MCP declaration:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "codetour": {
      "type": "stdio",
      "command": "codetour",
      "args": ["mcp", "--workspace-root", "${COPILOT_SESSION_CWD}"]
    }
  }
}
```

The installed copy replaces the command with the verified absolute launcher and keeps the same args. The server is the existing standalone `codetour mcp` implementation; every distribution compiles the same tools (`create_project_tour`, `create_changes_tour`, `knowledge_list`, `knowledge_read`, `knowledge_save`, `knowledge_close_run`).

The extension no longer calls `joinSession({mcpServers})`: it joins with its command only. The install removes only the legacy `codetour` entry that an older CodeTour release wrote into `~/.copilot/mcp-config.json` (the exact entry it wrote or the documented `codetour mcp` launcher). A foreign same-named entry is preserved and reported, because this CLI cannot prove it owns it. On a real session, `copilot mcp list` shows one `codetour` server under Plugin servers and an inspected process listing shows one `dist/cli.js mcp --workspace-root <session cwd>` process.

## Generation wrapper invariant

For every generation, after the choices and before sending the request, the adapter asks for the Tour orientation: a free-text input where cancelling stops the run, an empty answer keeps the standard Tour, and a phrase orients it (the phrase sets the language the Tour is written in). A phrase already given in the command — `/codetour generate project montre-moi le rendu Mermaid` — is used as is and never asked again; a host without elicitation must receive it that way or the generation stops with an explicit error.

The adapter then:

1. resolves exactly one workspace: the session directory passed to the adapter, `realpath`-resolved once. A missing, unreadable or non-directory workspace stops the command before any prompt or agent request;
2. creates one `runId`, then calls `prompts/get` `generate_project_tour` (or `generate_changes_tour`) over a single minimal stdio client, passing the complete original slash-command request as `request`, the orientation phrase as `brief`, and the `runId`;
3. writes `<workspace>/.tours/.log/codetour-run-<runId>.json` atomically;
4. calls `session.send` in immediate mode with exactly what the server composed.

An unreachable server, a timeout or an empty prompt is an explicit error that names the `codetour` MCP server and the `codetour --install copilot` repair. There is **no fallback prompt**, no mode change and no analysis in that case; no run state is written. A failed `session.send` removes the run state again.

The run state is created with the preparation metrics the adapter alone knows (ADR 0042): the command start, the served prompt tool, the composition duration and the send stamp after the host accepted the prompt. These stamps make the preparation phase observable without claiming any token figure; the usage windows are recorded from the Copilot session events at stop time.

## Pre-launch report

Before the first agent request, every generation reports the integration it would use (ADR 0043): the running adapter file, the launcher the CLI calls resolve to, the resolved workspace, the installed extension files, the installed plugin (version, cache path, MCP launcher and the build version beside the launcher script) and the user `mcp-config.json` declaration. The scan is offline and reads exactly the paths the installer writes, with the same `COPILOT_HOME` and `CODETOUR_COPILOT_*` overrides.

Problems are reported at error level and never stop the run: a plugin that is not installed in this home, a launcher that does not exist, a launcher pointing at a different build (the staleness/foreign-checkout case), a second `codetour` MCP server declared in the user config, or duplicate CodeTour extension directories. The same facts are recorded in the run state's `metrics.integration`, so the per-`runId` trial record shows which integration was actually loaded.

The server composes the served generation instructions, the original request, the orientation phrase, the run identity, a bounded Knowledge catalogue projection and the decomposition method. Critical Changes Tours also carry the complete shared review skill pack. The adapter holds no Tour prose of its own. It never announces a Tour creation or a persistence it has not observed: only the MCP tool results in the conversation report those outcomes, and the agentStop guard reads the server-written trace.

## Run state and consolidation

One JSON file per run, keyed by `runId` and scoped to one workspace and one session:

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
  "consolidation": {
    "status": "completed_zero",
    "runId": "…",
    "at": "…",
    "created": [],
    "outcome": "completed_zero"
  },
  "continuationUsed": false,
  "metrics": {
    "version": 1,
    "preparation": {
      "commandAt": "2026-11-19T…Z",
      "promptTool": "generate_project_tour",
      "promptComposeMs": 87,
      "sentAt": "2026-11-19T…Z"
    },
    "usage": {"source": "copilot-session-events-v1", "observed": true, "observedAt": "2026-11-19T…Z", "model": "…", "projectState": {"branch": "…", "headCommit": "…"}, "totals": {"records": 2, "durationMs": 4800, "inputTokens": 489549, "outputTokens": 430, "cacheReadTokens": 427051, "cacheWriteTokens": 62478, "reasoningTokens": 0}, "calls": {"successful": {"create_project_tour": 1, "knowledge_save": 1}, "refused": {}}, "windows": {"generation": {"fromAt": "…", "untilAt": "…", "records": 1, "durationMs": 4000, "inputTokens": 364887, "outputTokens": 123, "cacheReadTokens": 305382, "cacheWriteTokens": 59489, "reasoningTokens": 0, "calls": {"successful": {"create_project_tour": 1}, "refused": {}}}, "consolidation": {"fromAt": "…", "untilAt": "…", "records": 1, "durationMs": 800, "inputTokens": 124662, "outputTokens": 307, "cacheReadTokens": 121669, "cacheWriteTokens": 2989, "reasoningTokens": 0, "calls": {"successful": {"knowledge_save": 1}, "refused": {}}}, "boundaryObserved": true}}
  }
}
```

The adapter writes the file; `create_project_tour` / `create_changes_tour` set `tourCreated`; `knowledge_save` with the `runId` writes `created`, `completed_zero` or `failed` (with `outcome` `conflict`, `invalid` or `internal_error`); `knowledge_close_run` writes an explicit `skipped`. All updates are atomic read-modify-write operations under a cross-process lock. A run that bypasses the wrapper has no state and is unguarded. Pruning removes states older than seven days on the next generation and never touches Knowledge; the hook ignores runs older than 24 hours.

The optional `metrics` block is plugin-side observability (ADR 0042): the adapter stamps the preparation facts it alone knows, and the agentStop guard summarizes the Copilot session usage records at every stop — model, Copilot version, project state, CodeTour tool calls (successful results and refusals joined start/completion by `toolCallId`), tokens and cache split into a generation window (until the last successful Tour creation) and a consolidation window, bounded by the next run of the same session. `inputTokens` include the cached reads exactly as the session reports them; the snapshot is a recomputation, never an accumulation, and totals stop at the last observed stop. Metrics never feed the guard and are never written by the MCP: an unobservable session events file records `observed:false` with a reason instead of failing a run.

## The agentStop guard

`com.github.copilot/hooks/hooks.json` declares one `agentStop` command:

```json
{
  "version": 1,
  "hooks": {
    "agentStop": [
      {
        "type": "command",
        "command": "node \"${PLUGIN_ROOT}/com.github.copilot/hooks/agent-stop.mjs\"",
        "timeoutSec": 10
      }
    ]
  }
}
```

The script is deterministic: no LLM, no network, no Tour or Knowledge write. It reads the run state and returns `{}` (stop allowed) or `{"decision":"block","reason":"…"}` (one continuation). It is inert when:

- the conversation is not a CodeTour run for this session **and** resolved workspace;
- `stop_hook_active` is true (this stop already follows a hook block);
- the run already used its continuation;
- no Tour was created (nothing to consolidate);
- any consolidation closure exists, including `completed_zero`, `failed`, `partial` or `skipped`;
- the state is expired, corrupt, unreadable or the run log is unavailable, or the continuation cannot be marked. Storage failures are diagnostics on stderr, never a block.

For one incomplete run — Tour created, no closure, continuation unused — it marks `continuationUsed` under the cross-process lock and then returns exactly one block asking for `knowledge_save` (zero or more entries) or `knowledge_close_run` for a deliberate skip. If two hook invocations race, only one observes the unmarked state and blocks. Two concurrent runs have separate state files; one stop blocks for at most one run.

If hooks are disabled, the plugin is not loaded or the session bypasses the wrapper, **no guard runs**. The run state and the MCP results still report the actual outcome; the absence of a guard is a real state, not a failure to hide.

## Verification

Automated:

```sh
node --test test/copilot-adapter.test.mjs test/copilot-hook.test.mjs \
  test/copilot-plugin-install.test.mjs
```

- fake-host adapter tests pin `prompts/get` → run state → `session.send` ordering, the intact original request and brief, the run identity, no analysis or fallback on missing/unavailable/empty prompt, one resolved workspace, concurrent runs and pruning;
- hook tests cover ordinary conversations, unknown session/workspace, `stop_hook_active`, `completed_zero`, every closure, one block maximum (including three concurrent invocations), two runs, resume, expiry, symlinked paths and storage failures;
- the real plugin test installs `packages/copilot-plugin` into a temporary `COPILOT_HOME` from a path containing spaces, inspects `plugin list`, `mcp list`, `mcp get` and `skill list`, runs the installed hook from a workspace path containing spaces, then uninstalls and checks the final state. It skips only when `copilot` is absent.

Observed on GitHub Copilot CLI 1.0.106 (bundled runtime 1.0.114), macOS, 19 November 2026, with a temporary `COPILOT_HOME`. Windows was not executed here: the hook and launcher use Node APIs without a shell, and both installed and workspace paths containing spaces were exercised on macOS.

- Agent Plugins 1.0 installed and listed; `mcp.json` loaded as a Plugin server; the skill listed; the `agentStop` hook fired on a real session (`hook.start`/`hook.end` with `output:{}` on an ordinary conversation);
- one `codetour` MCP server process for one session, launched with the session workspace path containing spaces, exposing exactly the six CodeTour tools (prefixed `codetour-` in the session tool catalog);
- a resumed real session with an incomplete run: the hook blocked once, the re-entry carried `stop_hook_active:true` and was inert, and the agent called `codetour-knowledge_save` with `entries:[]` and the runId; the MCP persisted `completed_zero` and `copilot` printed "Consolidation completed: no Knowledge entries were created or persisted";
- `copilot -p "/codetour generate …"` does **not** dispatch the extension slash command; the CLI sends the text to the model, which invoked the plugin's `codetour-generate` skill and the MCP prompt instead. That skill path created a real Tour and a Knowledge entry, but it did not create a run state and is therefore unguarded. The adapter's `prompts/get` → state → `session.send` invariant is proven at its fake-host boundary against the compiled CLI; a fully automated real-host `/codetour generate` run remains unverified on this CLI version.

A previous probe of the installed extension API is recorded in [the Copilot generation probe](copilot-generation-probe.md). The API remains experimental.

Primary API references: [GitHub SDK extensions](https://github.com/github/copilot-sdk/blob/main/nodejs/docs/extensions.md), [agent authoring](https://github.com/github/copilot-sdk/blob/main/nodejs/docs/agent-author.md), [Copilot plugin creation](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating), [hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference). The installed CLI's bundled SDK declarations and schemas are the compatibility reference for the recorded probe.
