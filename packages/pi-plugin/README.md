# CodeTour Pi plugin

This directory is the versioned **Pi package** source of the CodeTour
integration for the Pi coding agent. It is embedded in the standalone CodeTour
CLI and installed by:

```sh
codetour --install pi
```

A plain `pi install ./packages/pi-plugin` installs the same directory directly;
`pi remove ./packages/pi-plugin` removes it. The managed install writes
`launcher.json` so the session starts the CLI that performed the installation
instead of whatever `codetour` happens to be on `PATH`.

## Contents

| Path | Role |
| --- | --- |
| `package.json` | Pi package manifest (`pi.extensions`, `pi.skills`, peer dependency on the host). |
| `extensions/codetour.ts` | Registers the shared `codetour mcp` server **on demand** for `/codetour`, releases it after the run, and hosts the bounded consolidation guard. |
| `lib/run-log.mjs` | The run-state contract this package reads and the only fields it writes. |
| `lib/guard.mjs` | The guard decision and the closing line. |
| `lib/reader.mjs` | The end-of-generation opening dialogue: the real interactive reader (terminal) or the Tour at its active step (VS Code). |
| `skills/codetour-generate/SKILL.md` | Minimal generation entry point that defers to the served MCP prompt. |

## On-demand CodeTour MCP

The Pi extension does **not** register the CodeTour MCP server at session
startup. Ordinary conversations do not get CodeTour tool definitions or a
CodeTour server summary. The explicit `/codetour` command registers the
existing server for the current workspace after the user has selected the Tour
kind and review mode:

```text
codetour mcp --workspace-root <real workspace>
```

The extension waits for Pi's built-in MCP host to connect the server (up to ten
seconds), then starts the skill. Exposure remains `deferred`: even during a
generation, the seven CodeTour tools are discovered through tool search, not
declared to the model up front. After the run finishes, fails, or is aborted,
the extension unregisters **only its own** MCP registration. Previously loaded
tool definitions may still appear in a conversation's history; unregistration
cannot erase historical context or restore spent tokens.

A user or project `mcp.json` entry named `codetour` takes precedence. When
its tools are already connected, the extension reuses them and never removes
that external registration. The extension never writes a global MCP config.

`/mcp` may therefore show no CodeTour server before `/codetour`, or after
a run has finished. This is expected. If Pi's built-in MCP support is disabled
or replaced, `/codetour` refuses to start and reports how to restore it.

Invoke `/codetour` to start the on-demand flow. Invoking the skill directly
without a configured CodeTour server does not register MCP on its own.

## `/codetour`

`/codetour` opens the native Pi menu **Générer / Lire**. **Lire** lists the
workspace Tours and plays the selected Tour in Pi's terminal. Press `q` to
return to Pi. Use `/codetour read "Tour title"` to open a Tour directly.
Reading uses the installed CLI and works with MCP disconnected.

**Générer** opens a native menu for Project and Changes Tours.

`/codetour` first collects the requested choices, then connects the shared
MCP server on demand. It waits until at least one `mcp__codetour__*` tool is
listed by `pi.getAllTools()` before creating the run state or invoking the skill.
If a server cannot connect within the bounded wait, the extension unregisters
its attempted registration and reports the two likely causes: built-in MCP
support is disabled or replaced, or connection startup failed/timed out.
Repair: enable the built-in support with `pi config` (Built-in → mcp) or remove
`-builtin:mcp` from settings, then `/reload`. On a subsequent `/codetour`,
`/mcp` should show `codetour` connected during generation, and tool search
should discover its seven tools. A refused command creates no run state.


After the native choices, the command creates a run identity, writes `.tours/.log/codetour-run-<runId>.json`, then
delivers `/skill:codetour-generate type=… [reviewMode=…] runId=… [request=…]`.
The agent asks the MCP for the served prompt and creates the Tour itself.

Pi exposes MCP **tools** but not MCP **prompts**, so the served prompt is
obtained with `get_generation_prompt` rather than `prompts/get`. The prompt text
is the same one the Copilot adapter fetches.

A cancelled choice stops the command with no run state. An unconnected MCP
server refuses the command after the choices but before creating any run state,
with the diagnostic and repair steps above. A failed workspace resolution, a failed state write or a refused
delivery removes the state and reports the error; no fallback prompt exists.

## The guard

The Pi equivalent of Copilot's `agentStop` hook is the `agent_before_settle`
handler, in process instead of a subprocess. It reads the run state only:

- inert for an ordinary conversation, another session or workspace, an expired,
  unreadable or corrupt state, a run without a created Tour, or any existing
  closure (`created`, `appended`, `replaced`, `completed_zero`, `partial`,
  `failed`, `skipped`);
- for one incomplete run it marks `continuationUsed` under the cross-process
  lock and returns one `custom_message` entry with `continue: true`;
- it never writes Tour or Knowledge content and never infers a closure from
  assistant text.

A session that bypasses `/codetour` (direct skill use, direct MCP calls) creates
no run state and is therefore unguarded; the MCP results still tell the truth.

## The opening dialogue

When a run closes (the consolidation was assessed), the guard reports the
closing line and then asks the user how to open the created Tour — never a
step list or a summary in the Tour's place:

- **Terminal** — the real interactive reader, spawned at once from the
  managed launcher (the `launcher.json` CLI, not whatever `codetour` happens
  to be on `PATH`): `codetour --internal-tour "<tour path>"` (or the default
  reading path on the recorded title). The spawn inherits the session's
  terminal — always the Playback Surface, never a PTY or an independent
  window — the extension waits for the reading to end, then the terminal is
  back with the session. A non-interactive session or a failed spawn degrades
  to the documented hand-over command, never a crash (ticket #242, review
  fix F2).
- **VS Code** — the managed launcher executes `--internal-open-vscode "<tour path>"` at the
  workspace root: the Open-in-VS Code contract of ticket #244, the Tour at its
  active step (the first one right after generation). The decision lives once
  in the CLI's `openInVscode` module (canonical workspace and the
  VS Code-absent case); a failure is reported with a
  manual command. During reading, pressing `o` in the terminal reader performs
  the same opening at the currently displayed Step.

The ask is once per run; a declined ask hands over nothing and leaves no
substitute text.

## Knowledge observability

The MCP server records the Knowledge sets the run's own discovery verified in an
additive `knowledge` block of the run state (ADR 0045), written when
`knowledge_list` / `knowledge_read` carry the run identity. The guard reads it
and prints one closing line at the end of the run:

```text
CodeTour run 3f2a… "Onboarding API" (.tours/onboarding.tour) — Knowledge 9 valid / 1 invalid, 2 used (billing-retry, auth-refresh)
```

Invalid entries are always listed in full, one line each with their reason; the
inline list of used names is capped at ten and the run state keeps them all. A
run that never listed the catalogue has no block and no Knowledge clause: the
absence means "not measured", never "zero".

## Requirements

- A Pi version that supports `registerMcpServer`, `registerCommand`,
  `agent_before_settle` with `continue: true`, `getAllTools()`, and package
  manifests.
- **Pi's built-in MCP support must be enabled.** On-demand registrations are
  connected by it; a settings file that disables it
  (`"extensions": ["-builtin:mcp"]`, or `-builtin:mcp` in a project override),
  or an installed extension that replaces it (such as `pi-mcp-adapter`),
  leaves the `codetour` server registered but unconnected, and Pi reports
  `MCP server "codetour" is registered, but no loaded extension connects MCP
  servers`. Generation refuses to start in that case; the diagnostic and its
  repair are stated once, in [`/codetour`](#codetour) above. `pi mcp list`
  cannot confirm a connection, because shell commands do not load extensions.
- `codetour` on `PATH` for a direct `pi install` of this source (the managed
  install writes an absolute launcher).
- No Node subprocess and no extra hook runtime: everything runs inside Pi.
