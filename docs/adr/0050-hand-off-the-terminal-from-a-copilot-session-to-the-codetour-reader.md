# ADR 0050: Hand off the terminal from a Copilot session to the CodeTour reader

* Status: experimental (spike, ticket #243, spec #239)
* Date: 2026-01
* Supersedes: nothing
* Superseded by: nothing

## Context

Ticket #243 asks for a feasibility spike: can a Copilot CLI session, running
in the user's terminal, transfer the control of that terminal to the terminal
reader (the Playback Surface delivered by ticket #241) and get it back safely?
The hope behind the ticket was an interactive panel: if the Copilot CLI's
extension API exposed a panel or view a session could hand to CodeTour, the
reader could live inside the agent session.

## Evidence: the Copilot CLI exposes no interactive panel

The CodeTour extension files the CLI installs for Copilot
(`COPILOT_EXTENSION_FILES` in `src/cli/copilot-extension.generated.ts`) are
`adapter.mjs`, `extension.mjs` and `run-log.mjs`. They declare a stdio MCP
server (`codeTourMcpServer`), an agentStop hook and run-state bookkeeping;
the sources contain no panel, canvas, tab or view surface the session could
hand over. Nothing named `panel`, `canvas`, `tab`, `view` (as a UI API) or
`ui(` appears anywhere in them. The Copilot CLI's own Canvas and internal
tabs are not declared to extensions and must not be presumed public API.

**Consequence: removing the Copilot launcher stays blocked** — without an
in-session Playback Surface, the readable tour must reach the user's terminal
by another route (this handoff) or not at all; the launcher, which opens the
Reading module, cannot be retired.

## Decision

Prototype an explicit, experimental handoff, in the SAME terminal, with no
PTY and no independent terminal window:

1. The session suspends its stdio ownership and mints a single-use ownership
   token (`TerminalSession.suspend`).
2. The reader of ticket #241 runs through the CLI entry with inherited
   stdin/stdout — it reads the session's own terminal (inherited fds, hidden
   window). Reading is always the full Tour, never a summary.
3. Whatever the reader's outcome — a completed Tour, an interrupted reading
   (non-zero exit or kill by signal), a failure to start — the session is
   resumed exactly once with the same token and its cooked terminal state is
   reaffirmed (`resume` + `restoreTerminalState` under `finally`).

The composition lives in `src/cli/ttyHandoff.ts`
(`handOffTtyToTourReader`), exposed through the opt-in CLI flag
`--experimental-tty-handoff <tour-file> [workspace-root]` in `src/cli/index.ts`.
The standard reading path of `--internal-tour` and of the default reader is
untouched.

## Defined behaviours

* **TTY absent or not interactive** — the handoff is refused with an explicit
  reason (`not interactive (no TTY)`); nothing is suspended, no process is
  started, and the launcher Copilot stays blocked in that case.
* **Inactive reading** — an interrupted reader (signal or crash) still
  returns the terminal to the session exactly once; the interruption is
  reported through the result's `interrupted` flag and `reason`, never thrown
  across the seam.
* **Return to the session** — resume happens exactly once, with the token
  minted by the very suspend that opened the handoff; a stale token is
  refused instead of silently re-attaching.

## Limits

* The prototype is a spike: the flag is undocumented on purpose, and no
  product surface (MCP server, Tour files, generation) consumes it.
* The transfer is only proven in-process, at the seam, with fakes standing in
  for both the session and the child process. A manual protocol run inside a
  live Copilot CLI session remains to be recorded before this ADR can move
  from experimental.
* The lease is process-level: the Copilot session's own TUI must release its
  stdio listeners while the reader runs; the spike models that release
  through the `TerminalSession` seam, and a live run must confirm the real
  session can detach and re-attach cleanly.
