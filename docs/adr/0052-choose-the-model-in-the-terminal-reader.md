# ADR 0052 — Choose the model in the terminal reader, among the values the agent announces

Date: 2026-11-20 · Status: accepted · Spec: #246 · Ticket: #266 · Amends: ADR 0048

## Context

ADR 0048 gave every reading surface the ACP model option and decided, in one
sentence, that "the terminal keeps no interactive selection: it displays the
**Effective Agent** and the effective model, and keeps
`CODETOUR_ACP_PROVIDER` / `CODETOUR_ACP_COMMAND` as its escape hatches." That
sentence assumed the terminal had nothing to list, since it never runs the
Agent Probe and `agentCatalogue.modelOptions()` is therefore empty there.

Ticket #266 shows the cost. On Copilot ACP an option announcing `gpt-6-luna`
existed while the reader could only use the configured `gpt-5-mini`, and a
question failed because that model was unavailable. The values are not a
catalogue to be built: an open ACP session announces them in `configOptions`,
which `src/agent/acpModelOptions.ts` already reads and
`session/set_config_option` already applies.

## Decision

**The terminal reader chooses the model of its Tour Step Conversation, and
only the model.**

- The offered values are exactly what the answering agent announces for the
  open session, groups flattened — the same selector the webview lists. The
  reader never probes, never reads a static list, and never offers a value no
  agent announced.
- A free unmodified key, `m`, opens a **model picker** overlay. Its state lives
  in the reading module (`src/cli/reader`, view model and key translation); the
  TermDOM adapter only paints it. The picker owns the keyboard until it closes:
  `↓`/`j` and `↑`/`k` move, `Enter` accepts, `Escape`, `q` or `m` cancel, and no
  reading key fires underneath it. Modified combinations stay unhandled, so
  Ctrl+C still reaches the terminal. `m` is taken only when the responder
  accepts a model change and no answer streams, so one exchange never mixes two
  models.
- A choice is a request, never a forced value. The reader sends it through the
  responder's `selectModel` — the contract ADR 0048 already defined — and
  displays only what the agent confirms. A value the agent did not adopt becomes
  a visible `model: <label> refused` status segment beside the Agent Profile,
  cleared by the next confirmed change; a request that throws shows its message
  the same way.
- An agent that announces no model stays usable with an explicit indication: the
  picker opens and says `agent-managed model`. Before the first handshake it
  says the agent has not announced its models yet, so a preselection is never
  presented as a model state.
- Nothing else changes. The Agent Profile is still chosen by the ranked
  failover (ADR 0048); the read-only policy, the Step grounding, the per-Step
  conversations, the palette and the layout are untouched; and
  `CODETOUR_ACP_PROVIDER` / `CODETOUR_ACP_COMMAND` keep their escape-hatch role.

## What this amends in ADR 0048

Only the clause quoted in the Context above. The terminal still selects no
**agent** — the failover does — and nothing here replaces the environment
escape hatches; the terminal now selects the **model**, by the rules above.
Everything else in ADR 0048 (catalogue, availability, probe, selection and
display rules) stands.

## Considered options

- **Wiring the Agent Probe into the terminal** was rejected: it buys an Agent
  selector this ticket does not ask for, at the cost of agent processes in a
  surface that starts none until a question is asked.
- **Reading the values from `agentCatalogue.modelOptions()`** was rejected: that
  projection comes from the probe, is empty in the terminal, and would
  reintroduce the static list ADR 0048 already discarded.
- **Keeping only `CODETOUR_ACP_*` and documenting them** was rejected: it makes
  the reader leave the Tour to change a model the agent already announced.
- **Persisting the chosen model per Agent Profile across sessions**, as the
  panel does, was rejected for this increment: the terminal can only offer the
  values an open session announced, so a remembered value would have no list to
  preselect from. The Consequences record what that costs.
- **A second selection mechanism** (a full-screen list, a sub-shell, a TUI
  prompt) was rejected: one overlay field in the view model keeps the reading
  interface authoritative and the adapter paint-only, as spec #93 requires.

## Consequences

- The `StepChatResponder` contract gains an optional `model()` accessor: the
  model selector a session announces. Both responders implement it — the open
  `AskSession`'s selector in the ACP responder, the active profile's in the
  failover — and the reader's `ConversationResponder` port gains it as an
  optional member, exactly like `identity()`.
- `ReaderViewModel` gains one field, `picker`, `undefined` while it is closed;
  `readerInput` gains the picker's key branch ahead of ask mode; the status line
  gains the `m model` hint and the `model: …` segment, which sits after the
  Agent Profile and before the exchange count.
- The reading tests drive the picker in-process through the reading interface
  with a fake responder. Nothing new is verified on a real terminal, and the
  real Copilot run that selects `gpt-6-luna` and answers a question about the
  Step stays manual (ticket #266).
- A dead transport relaunches the Agent Profile with the agent's own default
  model, because the terminal keeps no model memory. Replaying the choice on
  the next session of the same Profile is a follow-up, not part of this
  increment. The reader is never lied to about it — it displays the model the
  agent confirms, so the reverted choice appears as the agent's own value —
  but the reader must choose again, and that cost is recorded here rather than
  left implicit.
