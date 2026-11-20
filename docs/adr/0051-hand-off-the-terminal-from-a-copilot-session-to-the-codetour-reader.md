# ADR 0051: Hand off the terminal from a Copilot session to the CodeTour reader

* Status: experimental (spike, ticket #243, spec #239); amended by ticket #264:
  the same-terminal takeover is not available on Copilot CLI 1.0.114, where the
  extension process has no terminal to lend
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

## Update (ticket #264): the extension process has no terminal to lend

Ticket #264 asks the product surface — the installed extension behind
`/codetour` — to read a Tour in the Copilot session's own terminal. The spike
Decision above was taken before the real host was probed. Probed on GitHub
Copilot CLI 1.0.114, macOS, 20 November 2026:

* **The CLI forks extensions with the RPC pipes on their stdio.**
  `copilot-sdk/docs/extensions.md`: "They run as separate Node.js processes
  that communicate with the CLI over JSON-RPC via stdio"; "Each extension is
  forked as a child process". `docs/agent-author.md`: "stdout is reserved for
  JSON-RPC". The extension's stdin/stdout are the protocol channel, never the
  user's terminal.
* **A probe extension confirms it.** A throwaway user-scoped extension
  installed on that version recorded `process.stdin.isTTY` and
  `process.stdout.isTTY` as `undefined` both in print mode (piped stdout) and
  under a PTY parent (`script -q /dev/null`). Its stdin was the CLI's
  `extension_bootstrap.mjs`, not the terminal. `open("/dev/tty")` is `ENXIO`
  without a PTY parent and succeeds with one, but the host TUI keeps owning
  that terminal's input and painting.
* **The SDK exposes no handover.** `session.d.ts` declares
  `send`/`sendAndWait`/`log`/`abort`/`ui` and events;
  `SessionCapabilities.ui` (`types.d.ts`) is `elicitation`, MCP Apps and
  `canvases` only. Nothing named suspend, terminal or tty exists to release
  the TUI's ownership, and `canvas.d.ts` is a host-rendered panel, not the
  terminal reader.

**Consequence: the extension can neither prove nor obtain the user's
terminal on this host.** The suspend-then-resume lease of the Decision above
cannot be minted by a process that never owned the terminal, so the product
path does not claim it. What the installed adapter does instead (ticket #264):

1. a bare `/codetour` lists the discovered Tours through the CLI
   (`--internal-list-tours`) and elicits one numbered choice through the
   host's selection dialog; generation stays behind `/codetour generate`;
2. the chosen Tour is launched by identity (`--internal-tour-id`) only when
   the extension process itself reports `process.stdin.isTTY &&
   process.stdout.isTTY`; the reader then inherits that terminal
   (`stdio: "inherit"`), the session waits for it, and the adapter reports the
   real exit — info on a clean close, error with the exit code or signal on an
   interruption;
3. without a reported terminal, nothing is spawned and no start is announced:
   one warning names the reason and the exact command to run in the user's own
   shell, `codetour --internal-tour-id "<id>" --renderer terminal`.

The former `Starting CodeTour: …` line announced a detached process that died
with `TermDOM requires an interactive terminal (TTY)`. It is gone from the
no-terminal branch, which is the only branch CLI 1.0.114 reaches.

### Limits of this update

* Same-terminal reading in a live Copilot session remains **impossible** on
  CLI 1.0.114; the user leaves the session to read. The ticket's second
  acceptance criterion (read in the same session, then get the prompt back) is
  therefore not met on this host, and the docs say so.
* The inherited-terminal branch is exercised by tests against a recording CLI
  only. No shipping host passes the guard yet, so its behaviour on a real TUI
  after the reader exits (repaint, cooked mode, pending input) is unverified.
* Choosing a Tour requires host elicitation. A session without it is told to
  name the Tour explicitly, as before.
* The `/dev/tty` route is not a substitute: opening that device does not
  suspend the host TUI's own reading and painting of the same terminal.

The `--experimental-tty-handoff` spike of the Decision above stays where ticket
#243 left it: a documented, undocumented-flag prototype over a Tour *file
path*, not the product read path.

## Limits

* The prototype is a spike: the flag is undocumented on purpose, and no
  product surface (MCP server, Tour files, generation) consumes it. The
  ticket #264 update above is the product behaviour and shares none of its
  code.
* The transfer is only proven in-process, at the seam, with fakes standing in
  for both the session and the child process. A manual protocol run inside a
  live Copilot CLI session remains to be recorded before this ADR can move
  from experimental.
* The lease is process-level: the Copilot session's own TUI must release its
  stdio listeners while the reader runs; the spike models that release
  through the `TerminalSession` seam, and a live run must confirm the real
  session can detach and re-attach cleanly.
