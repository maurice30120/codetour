# ADR 0047 — Open the Tour in VS Code through the extension's URI contract

Date: 2026-02-14 · Status: accepted · Tickets: #244 (spec #239)

## Amendment — persistent storage is not a window list

The workspace storage records described below persist after a window closes,
so they cannot establish that its workspace is currently open. The CLI now
asks VS Code to open the canonical workspace before sending the Tour URI in
all cases. It does not infer active windows from these records. The workspace
opening is delegated to VS Code; URI routing, window reuse and readiness
after the settle delay require verification in the real host, particularly
when several windows or profiles are involved. The original detection
discussion below records the earlier decision and its invalid assumption.

CLI-generated links also carry an optional canonical `workspace` parameter.
The extension rejects a link carrying that parameter when the receiving
window does not contain the requested local workspace, with a visible error;
older links without the parameter retain their existing behavior. This guard
prevents opening a same-named Tour in the wrong workspace but does not itself
route the request to the correct window or acknowledge successful playback.

## Context

The terminal Tour reader (spec #93) is the Playback Surface of Pi and the
Copilot CLI. A reading session happens in the agent's own terminal, while a
real Tour player already exists inside VS Code. The reader therefore offers
the **Open-in-VS Code** command (unmodified `o`): open the current Tour at
the **active Step** in VS Code, without ever duplicating a window.

A blind `code <file>` invocation cannot serve: it cannot target the window
holding the Tour's workspace, and it opens Tour/Step files without the
player's context.

## Decision

The opening contract is the **extension URI** the CodeTour extension already
handles (`src/extension.ts` `URIHandler`):

```text
vscode://maurice30120.codetour/openTour?tour=<workspace-relative .tour path>&step=<1-based step>
```

- The Tour identity travels as the Tour file path relative to the canonical
  workspace; the extension matches it by its `.tour` suffix, as its public
  links do. Steps are 1-based in the public-link contract; the reader's
  0-based active Step maps to it.
- The **workspace path is canonicalized** on the CLI side (resolved,
  real-pathed when possible, trailing separators stripped) before any
  comparison — the pure `canonicalWorkspacePath` of
  `src/core/workspacePath.ts`, which the extension's receiver shares.
- The decision logic is pure and tested in-process
  (`planOpenInVsCode`, `src/cli/openInVscode.test.ts`). The three
  open-window cases below are **superseded by the amendment**: the plan no
  longer distinguishes them, it always asks VS Code to open the workspace
  first. They stay as the record of the earlier decision.
  - ~~**workspace already open** → one `code --open-url <uri>` invocation; the
    window is reused;~~
  - ~~**workspace not open** → `code <workspace>` first (VS Code itself reuses
    an existing window or creates one — never a duplicate), then, after a
    settle delay, the Tour URI;~~
  - ~~**several windows on the same workspace** → the URI alone, never a
    folder opening: which window receives it is VS Code's own routing, but
    no window is duplicated and the Tour opens at the active Step;~~
  - **VS Code not reachable** (`code --version` probe, then spawn failures)
    → a defined message the reader surfaces as a nonblocking status-line
    warning (`vscode: …`), cleared by a later successful opening or an
    unimplemented retry, exactly like the narration warning channel it sits
    next to.

## Detection limits (superseded by the amendment)

Whether a workspace is "already open" is observed best-effort by scanning the
VS Code per-window storage records
(`User/workspaceStorage/<hash>/workspace.json`) under the stable root this
CLI ships (`~/Library/Application Support/Code` on macOS,
`%APPDATA%\Code` on Windows, `~/.config/Code` elsewhere):

- the layout of that storage is a VS Code implementation detail that has
  changed across versions and profiles; an unreadable or unexpected record
  degrades to "workspace not observed open";
- remote (SSH, dev container) and web-hosted windows are not listed;
- VS Code Insiders and VSCodium keep their own roots this detector does not
  scan;
- a window opened after the scan is invisible until a later command.

Every one of these limits is safe with respect to the ticket's invariant:
the worst case is opening the folder when it was already open, and
`code <workspace>`-style folder opening never duplicates a window the
workspace is already open in.

## Consequences

- The reader keeps one seam (the view model); the command is a collaborator
  (`OpenInVsCodeInvoker`) like the narration engine and the conversation
  responder, faked in tests, never a PTY and no new rendering surface.
- The receiving `URIHandler` keeps its `tour`/`step` query contract and
  gains one check: a link that carries the optional `workspace` parameter is
  refused with a visible error when the receiving window does not contain
  that workspace. Links without the parameter behave exactly as before, so
  already-published links stay valid.
- The plan's invocations are data; a future launcher (a Store-style deep
  link, an OS-specific opener) replaces the `code` spelling without touching
  the decision logic.
