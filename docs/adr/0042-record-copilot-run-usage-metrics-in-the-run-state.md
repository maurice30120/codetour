# Record CodeTour run usage metrics in the run state as plugin-side observability

Spec #223's trial (`.scratch` trial log, 19 November 2026) measured Copilot
generation runs by hand: the session usage records were summed per time
window, the phases were separated manually with CodeTour MCP success times,
and the three briefs differed too much for the numbers to say anything about
Knowledge economies. The decision is to automate exactly that record where the
data lives, and to scope it honestly:

- one additive, optional `metrics` object in the Run State, written **only by
  the plugin side** (the adapter and the agentStop guard);
- the Run State version stays 1: the field is additive, both run-log twins
  (adapter/hook JavaScript and MCP TypeScript) validate the guarded fields as
  before and preserve `metrics` verbatim;
- the guard's decision logic is untouched — metrics never block, never close a
  run, and never claim the two authenticated outcomes that remain the MCP's
  alone.

**Preparation belongs to the adapter.** Only the adapter knows the command
start, the served-prompt composition time and the moment the host accepted
`session.send`. The run state is created with those stamps and gains `sentAt`
after a successful send. Token accounting for the preparation phase is not
reliably attributable, so no token figure is recorded for it.

Amended 2026-11-19: `/codetour` can first send an agent-driven choice dialogue.
A single-use `dialogueId`, retained in the adapter's process and bound to the
session and workspace, carries that start time into the eventual preparation
tool call. Only a successful served prompt creates a Run State, whose `at`
and preparation `commandAt` include the dialogue's start so its model usage
does not land in the preceding run's window. Cancelled dialogues create no
run; a later generation without their identifier cannot inherit their time.
A tool result does not claim `sentAt`, which remains specific to a successful
`session.send`.

**Usage belongs to the agentStop guard.** Copilot CLI 1.0.114 writes
`~/.copilot/session-state/<sessionId>/events.jsonl` (`COPILOT_HOME` relocates
the base directory, `CODETOUR_COPILOT_SESSION_STATE_DIR` overrides the whole
path): `session.start` carries the Copilot version, the selected model context
and the Git branch/head commit; `session.usage_record` carries one token
figure set per model call (`inputTokens` including cached reads,
`outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`,
`duration`); `tool.execution_complete` names the finished tool. At every stop
that matches a Generation Run of this session, the guard recomputes a snapshot
(never an accumulation, the newest wins): model, Copilot version, project
state, completed CodeTour tool calls, totals, and windows — generation until
the last observed Tour creation, consolidation afterwards. The window is
bounded by the next run of the same session, so two runs sharing a session
cannot claim each other's records.

**Unobservability is explicit data.** A missing, unreadable or malformed
events file, a `CODETOUR_COPILOT_SESSION_STATE_DIR` pointing elsewhere, or a
production stream without `session.usage_record` yields an
`observed:false` snapshot with a reason, not an omission and not an error.
Recorded totals stop at the last observed stop, so tokens produced while the
final user reply is composed land in the next snapshot if another stop
occurs. The session events format is Copilot-internal and may change: the
source string pins the format that was read.

**Consequences.** A run state is now comparable per runId for model, project
state, calls, tokens and cache with preparation, generation and consolidation
separated, which is what the trial logbook lacked to test the Knowledge
economy hypothesis on equal briefs. The record says what was observed, never
what an economy was proved. A session-time stop still marks `updatedAt`, and
the hook stays inert on storage damage. Hosts without hooks produce no
metrics; that absence is a real state, in line with ADR 0041's "no false
guarantee".
