# CodeTour Pi plugin

This directory is the versioned **Pi package** source of the CodeTour
integration for the Pi coding agent. It is embedded in the standalone CodeTour
CLI and installed by:

```sh
codetour --install pi
```

A plain `pi install ./packages/pi-plugin` installs the same directory directly;
`pi remove ./packages/pi-plugin` removes it. The managed install writes
`launcher.json` so the session uses the CLI that performed the installation
instead of whatever `codetour` happens to be on `PATH`.

## Contents

| Path | Role |
| --- | --- |
| `package.json` | Pi package manifest (`pi.extensions`, `pi.skills`, peer dependency on the host). |
| `extensions/codetour.ts` | `/codetour` (generate or read a Tour) and the end-of-response report: the Tours the response created, then its token reading. |
| `lib/journal.mjs` | Reads the creation journal and attributes a creation to a response; the token reading and the summary lines. |
| `lib/reader.mjs` | The end-of-generation opening dialogue: the real interactive reader (terminal) or the Tour at its active step (VS Code). |
| `skills/codetour-generate/SKILL.md` | The generation entry point: the agent explores the workspace and creates the Tour with the CLI. |

## No MCP server, no checkout

The package needs neither an MCP server nor a CodeTour repository. The skill
explores the workspace the session is in and calls the installed CodeTour CLI
from the workspace root:

```sh
codetour create-project-tour --workspace . --proposal -
codetour create-changes-tour --workspace . --proposal -
```

The proposal is one JSON document on standard input (or in a file passed to
`--proposal`); the result is one JSON document on standard output, with exit
code `0` for a created Tour, `1` for a rejected proposal and `2` for a usage or
IO failure. A rejected proposal lists the `issues` to correct and writes
nothing.

The extension passes the CLI it knows as the skill argument
`codetour-cli=["<command>","<args>"…]` (the recorded launcher, minus the retired
`mcp` subcommand); without that argument the skill uses `codetour` from `PATH`.

## `/codetour`

`/codetour` opens the native Pi menu **Générer / Lire**. **Lire** lists the
workspace Tours and plays the selected Tour in Pi's terminal. Press `q` to
return to Pi. Use `/codetour read "Tour title"` to open a Tour directly.

**Générer** collects the choices (Project Tour, or Changes Tour with a neutral
or critical review), then delivers
`/skill:codetour-generate type=… [reviewMode=…] [codetour-cli=…] [request=…]`
to the agent. No run state is written and no server is registered: the agent
creates the Tour itself with the CLI. A cancelled choice starts nothing.

## The end-of-response report

When a response settles (`agent_settled`), the extension reads
`<workspace>/.tours/.log/creations/` — the journal the CLI writes after every
successful creation — and reports, once per response:

- one line per Tour created **by this response**: title and path;
- one token reading for the response: `input`, `output`, `cache`, with
  `(approximate)` when the scope is not exact and `unavailable` when the host
  reports nothing.

The report never blocks, never asks for a continuation, never calls a model and
never changes the exit status. It has nothing to say when no creation is
attributed, and it prints at most one token reading per response.

Attribution requires the same canonical workspace, the same session identity
(the CLI's `PI_SESSION_ID` equals `ctx.sessionManager.getSessionId()`), and a
creation record not older than the response's `agent_start`. A creation without
a session identity is never reported; an unreadable or foreign journal entry is
ignored.

Verified limits of this surface (Pi 1.6.0):

- **The report is visible in the interactive TUI only.** It goes through
  `ctx.ui.notify`; in `-p` and `--mode json` the host gives extensions a no-op
  UI context (`ctx.hasUI === false`), and no extension API writes to stdout. The
  creation itself is unaffected.
- **Pi has no response identity.** There is no `PI_RESPONSE_ID`, and the
  extension context carries no run id, so the response boundary is the
  `agent_start` timestamp compared with each record's `at`. `responseId` stays
  `null` in the journal; the extension never invents one.
- **Only creations made through the agent's shell tool are attributable.**
  `pi.exec()` does not export `PI_SESSION_ID`, so a child spawned by the
  extension has no session identity — the skill must run the creation command
  through its shell tool.
- **Sub-agent sessions are not attributable**: the sub-agent's shell exports the
  sub-agent's `PI_SESSION_ID`, while the parent hook sees the parent session, so
  the report stays silent instead of attributing the creation to the wrong
  session.
- Token figures come from the `Usage` of the assistant messages of the response
  (`agent_end`); some providers report all-zero usage, which is shown as
  unavailable, never as zero. `input` already excludes the cache, so `cache`
  (`cacheRead + cacheWrite`) is never added twice.

## The opening dialogue

When a Tour is attributed to the response, the extension reports it and then
asks the user how to open it — never a step list or a summary in the Tour's
place:

- **Terminal** — the real interactive reader, spawned at once from the managed
  launcher (the `launcher.json` CLI, not whatever `codetour` happens to be on
  `PATH`): `codetour --internal-tour "<tour path>"` (or the default reading path
  on the recorded title). The spawn inherits the session's terminal — never a
  PTY or an independent window — the extension waits for the reading to end,
  then the terminal is back with the session. A non-interactive session or a
  failed spawn degrades to the documented hand-over command, never a crash.
- **VS Code** — the managed launcher executes
  `--internal-open-vscode "<tour path>"` at the workspace root: the
  Open-in-VS Code contract of ticket #244, the Tour at its active step. The
  decision lives once in the CLI's `openInVscode` module; a failure is reported
  with a manual command.

The ask is once per created Tour; a declined ask hands over nothing and leaves
no substitute text.

## Requirements

- A Pi version that supports package manifests with `pi.skills` and
  `pi.extensions`, `registerCommand`, `agent_start` / `agent_end` /
  `agent_settled`, and `ctx.ui.notify`.
- The CodeTour CLI: the managed install records its absolute path in
  `launcher.json` and passes it to the skill; a direct `pi install` of this
  source expects `codetour` on `PATH`.
- No Node subprocess and no extra hook runtime: everything runs inside Pi. The
  CLI is run by the agent's shell tool, as part of the generation it performs.
