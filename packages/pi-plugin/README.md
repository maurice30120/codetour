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
| `extensions/codetour.ts` | Declares the **existing** `codetour mcp` server, starts a controlled generation from `/codetour`, and hosts the bounded consolidation guard. |
| `lib/run-log.mjs` | The run-state contract this package reads and the only fields it writes. |
| `lib/guard.mjs` | The guard decision and the closing line. |
| `lib/reader.mjs` | The end-of-generation opening dialogue: the real interactive reader (terminal) or the Tour at its active step (VS Code). |
| `skills/codetour-generate/SKILL.md` | Minimal generation entry point that defers to the served MCP prompt. |

## One CodeTour MCP server

The extension calls `pi.registerMcpServer("codetour", …)` on `session_start`
with the real path of `ctx.cwd`:

```text
codetour mcp --workspace-root <real workspace>
```

Exposure is `deferred`: the six CodeTour tools are found with tool search
instead of being declared on every request. A user `mcp.json` entry named
`codetour` takes precedence, and `/mcp` shows the overridden registration. The
extension never declares its own server in a file, so a session can never load
two copies of the tools.

## `/codetour`

`/codetour` collects the two generation choices with `ctx.ui.select`, creates a
run identity, writes `.tours/.log/codetour-run-<runId>.json`, then delivers
`/skill:codetour-generate type=… [reviewMode=…] runId=… [request=…]`. The agent
asks the MCP for the served prompt and creates the Tour itself.

Pi exposes MCP **tools** but not MCP **prompts**, so the served prompt is
obtained with `get_generation_prompt` rather than `prompts/get`. The prompt text
is the same one the Copilot adapter fetches.

A cancelled choice stops the command with no run state. A failed workspace
resolution, a failed state write or a refused delivery removes the state and
reports the error; no fallback prompt exists.

## The guard

The Pi equivalent of Copilot's `agentStop` hook is the `agent_before_settle`
handler, in process instead of a subprocess. It reads the run state only:

- inert for an ordinary conversation, another session or workspace, an expired,
  unreadable or corrupt state, a run without a created Tour, or any existing
  closure (`created`, `completed_zero`, `partial`, `failed`, `skipped`);
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
  `agent_before_settle` with `continue: true`, and package manifests.
- `codetour` on `PATH` for a direct `pi install` of this source (the managed
  install writes an absolute launcher).
- No Node subprocess and no extra hook runtime: everything runs inside Pi.
