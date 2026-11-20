# ADR 0048 — Select the ACP agent and model explicitly, from a probed local catalogue

Date: 2026-11-20 · Status: accepted · Spec: #246 · Supersedes: ADR 0014

## Context

Until now a Tour Step Conversation chose its agent implicitly: ADR 0014 tried
the installed ACP agents in a fixed order and kept the first one that answered,
and the reader had no way to say which agent should answer, or with which
model. That order was also wrong for the reader's expectation — `Vibe` came
first, `Copilot` second — and the choice was invisible: the webview showed no
agent name at all, and the terminal showed the first candidate found on
`PATH`, not the one actually tried.

The Agent Client Protocol the extension already speaks (`@agentclientprotocol/sdk`
1.8.0, ADR 0013) can express both selections: `session/new` returns
`configOptions`, an agent that offers a model announces it as a `select` option
with `category: "model"`, `session/set_config_option` changes it, and
`config_option_update` reports later changes. Nothing in the repository read
any of it before this decision.

## Decision

**The agent answering a Tour Step Conversation is chosen explicitly, from a
ranked local catalogue, and its state of availability is probed before the
reader can send a question.**

### Catalogue

The catalogue is a versioned constant inside CodeTour, in this rank:
`Copilot, Vibe, Pi, Codex, Claude Code`. Rank — never a remote registry, never
a discovery order — decides which agent answers by default. The old
"Vibe then Codex" behaviour disappears: Copilot answers whenever it is really
available. `Pi` enters with its verified entry `pi-acp` (no arguments), and
`Codex`/`Claude Code` are kept because they already work today; no command is
added on speculation.

### Availability

One bounded **Agent Probe** per profile: `initialize` then `session/new`, with
a deadline of 5 seconds, distinct from the 30 seconds a conversation startup is
allowed. The probe yields one of `unknown`, `not installed`, `installed but
unverified`, `authentication required`, `available`, `connection error`.

At panel opening the profiles are probed **sequentially in rank order, and the
probe stops at the first `available`**. Results live for the lifetime of the
panel; a manual refresh is the only automatic-free way to re-probe. Opening the
agent selector probes the profiles that are still `installed but unverified`,
once. A question typed while the initial probe is running waits for it (at most
5 s) instead of starting on an unverified candidate.

A probe's session is disposed as soon as it answers, and only its
`configOptions` and its state are kept: a session sleeping for a panel that may
never ask anything would hold an agent process alive for nothing.

A timeout is a `connection error`, which excludes the profile from automatic
selection but leaves it selectable by hand — a slow start does not prove an
agent is broken.

### Selection

- Nothing survives the panel: neither the chosen agent, nor the chosen model,
  nor any probe result (ADR 0019 keeps conversations in panel memory).
- The chosen **model** is remembered per Agent Profile, for the lifetime of the
  panel, and replayed on every `session/new` of that profile, because model
  identifiers belong to one agent. It is dropped with a visible
  `Agent-managed model` mention if the agent stops offering it.
- Only an option whose `category` is `model` (or whose id is `model` when the
  category is absent) is a model selector. `model_config` and `thought_level`
  are out of scope.
- The agent is the only source of truth for what is displayed: a change counts
  as effective when the agent confirms it, and a later `config_option_update`
  is followed. The reader's choice is a request replayed at the next session,
  never a value forced into the current session.
- The webview enables the two controls only when no answer is streaming. The
  terminal keeps no interactive selection: it displays the **Effective Agent**
  and the effective model, and keeps `CODETOUR_ACP_PROVIDER` /
  `CODETOUR_ACP_COMMAND` as its escape hatches.
- After the first question, an agent is never replaced without the reader
  asking: a dead transport is retried on the same agent, and an explicit
  choice never falls back. Only the initial selection may fall through to the
  next available profile.

### Authentication

CodeTour never authenticates on its own. `authentication required` is read from
the ACP error code of `session/new`, not from message text. The client
advertises `clientCapabilities._meta["terminal-auth"] = true`, and the explicit
`Sign in` action runs the agent's own terminal-auth command in a VS Code
terminal when it provides one, falling back to ACP `authenticate` otherwise —
`pi-acp`'s `authenticate` being a no-op, the terminal command is the only path
that actually connects anything. After that action, only that profile is
re-probed.

### Scope and chrome

No network call in this increment: the official ACP registry is deferred to a
follow-up, and the local catalogue alone satisfies "discovery keeps working
offline". The ACP v1 client is used as is — no protocol bump, no bi-version
adapter. New chrome is English (ADR 0015), including the residual French
activity string in `src/agent/fallbackStepChatAgent.ts`'s failover
message. Tour grounding, read-only policy, cancellation and per-step memory are
untouched.

## Considered options

- **Lazy failover only (ADR 0014 as is)** was rejected: "Copilot preselected"
  cannot be honoured without knowing that Copilot is really connectable, and a
  reader cannot choose an agent nobody ever probed.
- **Probing all profiles in parallel at panel opening** was rejected: five
  agent processes to answer a question that usually needs one.
- **Keeping the probe's session as the conversation session** was rejected:
  the latency saved is not worth an agent process parked for a panel that may
  stay idle.
- **Remembering the selection across panels** (or in `globalState`) was
  rejected for this increment: ADR 0019 keeps everything panel-scoped, and a
  stale remembered agent would need its own invalidation rules.
- **A static model catalogue** was rejected by the spec and by reality: model
  availability depends on the reader's own provider configuration.
- **Querying the ACP registry** was rejected here: it proves neither local
  presence nor connectability, and makes the offline path a second code path.
- **Renaming `provider` only in the UI** was rejected: the domain term is
  Agent Profile (see GLOSSARY.md), and the code follows the vocabulary.

## Consequences

- A new `vscode`-free module owns catalogue, availability, selection and probed
  `configOptions`, above the `StepChatResponder` seam: the conversation store
  (ADR 0031) and the conversation contract stay unchanged, and the responder
  only receives an accessor for the current selection.
- The session layer learns four ACP facts it ignored: the `configOptions` client
  capability, `session/new`'s `configOptions`, `session/set_config_option`, and
  `config_option_update`.
- The terminal stops naming the first candidate found on `PATH` and starts
  naming the effective agent — a display it did not have before.
- The deterministic suite grows seven fake-agent behaviours; the only real-agent
  smoke check is manual, opt-in, and skipped when `pi-acp` is missing or
  answering `authentication required`.
- Model selection is only as good as what agents announce; an agent that
  announces nothing keeps working and says so.
