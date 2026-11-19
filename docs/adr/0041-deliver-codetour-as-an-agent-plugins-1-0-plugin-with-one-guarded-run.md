# Deliver CodeTour as an Agent Plugins 1.0 plugin with one guarded generation run

Spec #223 makes Knowledge native and deterministic (ADR 0039) and exposes it
through the existing CodeTour MCP server (ADR 0040). Ticket #228 delivers the
Copilot surface itself: a versioned **Agent Plugins 1.0** plugin, a single MCP
server declaration, and a bounded `agentStop` guard tied to an explicit
generation run. The decision is to keep the plugin thin and put every
generation and consolidation rule in the shared MCP prompt and tools.

**Verified format.** The installed GitHub Copilot CLI 1.0.106 accepts a local
Agent Plugins 1.0 directory: `plugin.json` with
`https://agent-plugins.org/schemas/1.0.0/plugin.schema.json`, a root `mcp.json`
with `https://agent-plugins.org/schemas/1.0.0/mcp.schema.json`, components under
`com.github.copilot/`, and skills under `skills/<name>/SKILL.md`. It expands
`${PLUGIN_ROOT}` and `${PLUGIN_DATA}`, and it expands `${COPILOT_SESSION_CWD}` in
MCP `args` to the session working directory. The plugin is therefore installed
with `copilot plugin install <dir>` and appears in `copilot plugin list`,
`copilot mcp list` and `copilot skill list`; no marketplace is required.

**One MCP source.** The plugin's `mcp.json` declares the existing
`codetour mcp` server, scoped to `${COPILOT_SESSION_CWD}`. `codetour --install
copilot` installs the plugin with an absolute launcher (the verified CLI that
performed the install) and removes only the `codetour` entry an older release
wrote into `~/.copilot/mcp-config.json`; a foreign same-named entry is preserved
and reported. The extension no longer calls `joinSession({mcpServers})`, so a
plugin session runs exactly one CodeTour server and one copy of every tool. The
plugin's built-in skill is minimal and defers to the served MCP prompt; the
Tour method is not duplicated in the plugin or in the extension.

**Generation wrapper invariant.** `/codetour generate` and the extension's
`codetour_prepare_generation` tool resolve exactly one
workspace (real path, explicit failure when unusable), call `prompts/get`
`generate_project_tour` with the complete original request as `request`, the
orientation as `brief` and a fresh `runId`, and only then deliver the prompt
through `session.send` or the tool result.
An unreachable server, an empty prompt or a provider failure stops the command
with no analysis, no fallback prompt and no run state. The adapter never
announces a Tour creation or a persistence it has not observed; only the MCP's
tool results report those outcomes.

Amended 2026-11-19: missing generation choices are collected by the agent with
`ask_user`, replacing the extension's generation menus. Explicit choices,
including natural-language choices, are kept. This preparatory dialogue can
precede `prompts/get` but performs no generation analysis and creates no Run
State. Once resolved, the agent calls `codetour_prepare_generation` and follows
its returned prompt in the same turn, rather than sending a nested agent
request. Both entry paths share the guarded preparation above. Existing Tour
reader selection remains a host menu.

**Run state and the agentStop guard.** The adapter writes one atomic state file
under `<workspace>/.tours/.log/codetour-run-<runId>.json` before sending.
`create_project_tour` / `create_changes_tour` record `tourCreated`;
`knowledge_save` records `created`, `completed_zero` or `failed`;
`knowledge_close_run` records an explicit `skipped`. The MCP is the only writer
of these authenticated outcomes. The deterministic hook reads only that state:
it is inert for ordinary conversations, other sessions or workspaces,
`stop_hook_active`, a missing Tour, any closure, an expired/corrupt/unreadable
state, and any storage failure. For one incomplete run it returns at most one
`{decision:"block"}` after marking `continuationUsed` under a cross-process
lock. It never writes Tour or Knowledge content and never infers a closure from
assistant text. `partial` is part of the closure vocabulary: each save is
all-or-nothing, but a run whose successive save calls both created entries and
hit a refusal records `partial`, preserving the entries actually published.
(Amended 2026-11-19 after the final code review: the earlier text said the
all-or-nothing save could not produce `partial`; the accumulation across save
calls makes it reachable without weakening the per-call atomicity.)

**Consequences.** An explicit zero-entry `knowledge_save` is a completed
consolidation, not an omission; an absent closure is the only state the hook
asks to close. Runs are pruned after seven days by the next generation without
touching Knowledge, and the hook ignores runs older than 24 hours. A session
that bypasses the wrapper (direct skill or direct MCP calls) creates no run
state and is therefore unguarded: the MCP results still tell the truth, and no
false guarantee is claimed. If hooks are disabled or the plugin is not loaded,
no guard runs; the state and tool results remain observable. The plugin needs a
Copilot CLI that supports Agent Plugins 1.0 and the `agentStop` contract; the
verified version is 1.0.106. The install path with spaces, the real plugin
surface, one server process, an inert ordinary stop and one blocked/resumed
consolidation were observed on that version.
