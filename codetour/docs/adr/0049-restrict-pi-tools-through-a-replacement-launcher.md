# ADR 0049 — Restrict Pi's tools through a replacement launcher

Date: 2026-11-20 · Status: accepted · Spec: #246

## Context

ADR 0048 puts `Pi` in the agent catalogue, and Pi is the only catalogue entry
that can be verified to exercise the whole ACP configuration surface
(`configOptions`, `session/set_config_option`, `config_option_update`,
`authentication required`). It is therefore both a user-facing agent and the
manual smoke target of that decision.

A Tour Step Conversation is read-only by construction (ADR 0013): the client
announces only `fs/read_text_file`, refuses `fs/write_text_file` and every
`terminal/*` request, grants permission only to read-like tool kinds, and
verifies the tool kinds actually executed. That enforcement works on requests
the **client** mediates.

Pi escapes it. `pi-acp` (0.0.31) spawns `pi --mode rpc --no-themes` with no tool
restriction (`/opt/homebrew/lib/node_modules/pi-acp/dist/index.js:133-141`),
offers no argument passthrough and reads no `PI_*` variable for tools; `pi`
itself carries `read`, `bash`, `edit` and `write`. A Pi conversation could
therefore write files and run shell commands that CodeTour's refusals never see
— exactly the capability ADR 0013 removed from the other agents by asking
Copilot for `--available-tools` and pinning read-only modes for Codex and
Claude Code.

Pi's `modes` are no help either: `session/new` returns thinking levels
(`off, minimal, low, medium, high, xhigh`) as `availableModes`
(`dist/index.js:2504-2521`), so there is no read-only mode to pin. The read-only
guarantee has to come from the tool surface, not from a mode name.

## Decision

**Pi runs behind a replacement `pi` launcher shipped by CodeTour, and a Pi that
cannot be launched behind it is reported as a connection error.**

- The launched command is a CodeTour-provided executable that appends the tool
  allowlist to `pi --mode rpc`, wired through `PI_ACP_PI_COMMAND` — the only
  injection point `pi-acp` offers, since it resolves the `pi` command from that
  variable and fixes the argument list itself. The allowlist is the minimum a
  guided code question needs: reading and searching. No `bash`, no `edit`, no
  `write`.
- The launcher is part of the ACP agent machinery, not a user setting: it is
  versioned with the extension and started like the other entries. Nothing is
  written into the reader's `~/.pi` configuration.
- If the launcher cannot be provided on a platform (no executable shim, an
  unexpected layout), the Pi profile reports `connection error` and stays
  unselected. **Degrading to an unrestricted Pi is never an option**; a widened
  tool surface needs a new ADR superseding this one.
- The launcher is an ordinary ACP entry for everything else: it is probed like
  the others (ADR 0048), appears in the agent selector, and disappears from the
  catalogue if its command is missing.

## Considered options

- **Shipping Pi unmodified** was rejected: it silently widens the executed-tool
  surface beyond what ADR 0013 guarantees, and no client-side refusal can see a
  shell started inside the agent.
- **Relying on Pi's own configuration** (`~/.pi/agent/settings.json`) was
  rejected: a Tour Step Conversation must not rewrite the reader's agent
  configuration, and per-conversation policy cannot live in a global file.
- **Deferring Pi until `pi-acp` grows a tool allowlist** was the honest fallback
  and stays the exit condition; it was not chosen because the launcher reaches
  the same guarantee today, with one small process wrapper.
- **Treating Pi's thinking levels as modes** was rejected: they name reasoning
  effort, not permissions, and reading them as policy would repeat the mistake
  ADR 0013 warns about — trusting a label instead of the executed tools.

## Consequences

- The catalogue stops being pure data: one entry carries a launch shim. The
  shim is the only executable CodeTour ships for an agent, and its removal
  condition is explicit — the day `pi-acp` accepts a tool allowlist, the shim
  goes away and the entry becomes a plain `command`/`args` pair again.
- Pi's mode policy is `useDefaultMode` (the agent's current mode is accepted and
  tracked for drift, like Copilot), because the read-only property is carried by
  the allowlist rather than by a mode.
- A Pi without `pi-acp` installed, or without credentials, is a well-reported
  state and never a silent fallback to a less restricted launch.
