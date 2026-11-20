# Knowledge consolidation measurement protocol (spec #232, ticket #258)

Status: **protocol only, campaign not run.** No figure in this document is a
measurement: the protocol produces evidence, it promises nothing. Spec #232
makes `append` an explicit counterpart of `replace` because a short addition is
supposed to cost fewer tokens than a full rewrite, but a short addition can also
cost more to *decide* than to *write*. Until the campaign described here has run
and been recorded, no doc, guidance text or release note claims an economy or a
regression for any mode.

Fixtures: [case sheet](./knowledge-consolidation-case-sheet.md),
[record template](./knowledge-consolidation-record.template.json).

The figures this protocol reads are the Run Usage Metrics of ADR 0042,
documented in `docs/copilot-cli-adapter.md` ("Run state and consolidation").
This ticket adds no instrumentation and changes no token accounting: it records
what is already written, from the one place that writes it.

## 1. What is measured, and where the numbers come from

One **Generation Run** (`runId`) is the measurement unit. The measured window is
exactly `metrics.usage.windows.consolidation` of that run's Run State,
`<workspace>/.tours/.log/codetour-run-<runId>.json`.

- The window starts at the last successful Tour creation (`create_project_tour`
  or `create_changes_tour`) and ends at the stop that wrote the snapshot, or at
  the next run of the same session, whichever comes first.
- Because it starts at that boundary, the window holds **both the decision and
  the write**: every model call and every tool call the agent made after
  creating the Tour — `knowledge_list`, `knowledge_read`, the exploration reads
  it needed to choose, and `knowledge_save`. "Append costs less to write but
  more to decide" is therefore visible inside one window, not across two.
- Work done before the boundary lands in `windows.generation`, outside this
  measurement, and is never added to a consolidation figure.

The single source of truth is the Run Usage Metrics record: the agentStop guard
computes the snapshot, the MCP server preserves `metrics` verbatim and never
computes it, and one format is pinned across both run-log twins.

| Concern | File |
| --- | --- |
| Snapshot computation (`summarizeRunUsage`) | `.github/extensions/codetour/run-log.mjs`, synced to `packages/copilot-plugin/com.github.copilot/lib/run-log.mjs` |
| Guard that records `metrics.usage` at each stop | `packages/copilot-plugin/com.github.copilot/hooks/agent-stop.mjs` |
| Server that preserves `metrics` verbatim | `packages/mcp-server/src/run-log.ts` |

A record copies these fields verbatim from the run state and recomputes none of
them: `fromAt`, `untilAt`, `records` (the number of model-call usage records in
the window), `durationMs`, `inputTokens`, `outputTokens`, `cacheReadTokens`,
`cacheWriteTokens`, `reasoningTokens`, and `calls` (`successful` / `refused` per
tool). Only completed tool calls appear there, so a call interrupted by a killed
run is missing from `calls` while its tokens may already be counted; a run that
ended abnormally is recorded as a failure, not as a cheap consolidation.

**Forbidden.** Recounting tokens from the Copilot session events file
(`events.jsonl`), from the served prompt text, from character counts or from any
other source; summing the generation and consolidation windows; adding
preparation tokens; adding an instrumented counter anywhere. A second count
would be a second truth, and the protocol exists to have one.

`durationMs` (the sum of the per-call durations the session reports) and the
window length `untilAt − fromAt` are different figures. Both are recorded;
neither is substituted for the other.

If `metrics.usage` is absent or reports `observed:false`, the repetition is
recorded as **not measured** with its reason — never as zero, never as an
estimate, never dropped from the result set.

## 2. Equivalence conditions

A comparison is allowed only between repetitions that satisfy all of the
following. Any difference makes the pair **not comparable**, and the pair is
reported as not comparable rather than as a result.

1. **Same request.** Identical request text, same Tour kind (`project` /
   `changes`), same `reviewMode`. The request is frozen when the campaign opens
   and copied verbatim into every record.
2. **Same workspace snapshot.** Same `headCommit`, clean working tree
   (`git status --porcelain` empty before and after the run), same source bytes.
   The catalogue precondition (`.tours/.memory/knowledge/`) belongs to the case:
   identical entry file bytes, identical revisions, identical validity for every
   repetition of an arm, restored before each run.
3. **Same tools and same served prompt.** Same CodeTour build and MCP tool
   descriptions, same served prompt (digest recorded), same catalogue
   projection including its metadata budget
   (`KNOWLEDGE_PROMPT_CATALOGUE_LIMIT` in `packages/mcp-server/src/knowledge.ts`),
   same model, same Copilot version, same installed extension/plugin build and
   declared MCP integration (`metrics.integration`, ADR 0043). A truncated
   catalogue listing in one arm and not the other is a different budget, not a
   different mode.
4. **Same budgets.** Nothing changes between arms: the same approval policy (no
   interactive permission dialog inside a measured run — a host round-trip is
   not agent work), the same host turn and time limits, the same declared
   exploration scope, the same `knowledge_list` page limits.
5. **Same repetition count and same environment.** Same machine class, OS, Node
   and Copilot CLI build for the whole campaign, arms interleaved so a
   mid-campaign model or CLI update cannot favour one mode. Such an update opens
   a new campaign id.

Explicitly forbidden comparisons:

- two different requests, even paraphrases, and two different Tour kinds;
- two different workspace snapshots or two different catalogue preconditions;
- two different budgets, models, Copilot versions or CodeTour builds;
- an arm whose consolidation window is missing or `observed:false`;
- an arm whose consolidation work cannot be separated at the boundary (Tour
  created after the deciding exploration), because its decision cost sits in
  the generation window.

**The only permitted difference inside a matched case is the write mode**, along
with the catalogue precondition that mode requires and the case declares.

## 3. Cases and repetitions

The [case sheet](./knowledge-consolidation-case-sheet.md) holds the case
definitions, in three families:

| Family | Situation | Arms |
| --- | --- | --- |
| K1 — extension | a valid entry exists and a new, compatible fact must be consolidated | `create` under a new name, `append`, `replace` |
| K2 — repair | an existing entry is invalid (a declared proof no longer matches) and must be rebuilt | `replace`, `create` under a new name |
| K3 — first consolidation | no entry exists for the subject | `create` |

**Five repetitions per (case, arm), minimum three.** Each repetition is an
independent Generation Run in a fresh Copilot session, starting from the case's
catalogue precondition. Fewer than three comparable repetitions is reported as a
pilot, not as a result.

**Failures stay in the result set.** A refused `knowledge_save`, a missing
Consolidation Closure, an unobservable window, a crashed or interrupted run, a
run whose window cannot be separated: each is recorded with its status and
reason, counted in `n`, and reported apart from the successful repetitions. No
average is ever computed over the successful runs only.

## 4. What each repetition records

One record per repetition, from the
[template](./knowledge-consolidation-record.template.json):

| Block | Content | Source |
| --- | --- | --- |
| `campaign` | campaign id, opening date, operator, model, Copilot version, CodeTour build, prompt digest, budgets, host | frozen at campaign open |
| `case` | case id, arm, repetition, request, Tour kind, `reviewMode`, snapshot, catalogue precondition | case sheet |
| `run` | `runId`, run state path, session id, result status (`created` / `appended` / `replaced` / `no_change` / refusal with its reason), Consolidation Closure, failure | run state and tool result |
| `usageWindow` | consolidation window fields, verbatim (§1) | run state `metrics.usage.windows.consolidation` |
| `entries` | per published entry: name, path, revision, file bytes, body bytes, lines, evidence count, distinct proof paths; for `append`, the preserved historical bytes | the catalogue files on disk, after the run |
| `judgement` | conformance verdict and checks, coverage of the declared answer elements | §5, judged apart from the tokens |

Entry sizes are read from the published Markdown file, not from the tool result
text: the bytes on disk are what a later `knowledge_read` serves. A run that
published nothing (refusal, `no_change`, `completed_zero`) records `entries: []`
and its reason.

## 5. Conformance and coverage, judged apart from the token measurement

A token figure says what a run cost. It says nothing about whether the entry is
correct. The two are recorded in separate blocks and never derived from each
other.

**Conformance** (`conformant` / `non_conformant` / `not_judged`) is judged from
the published entry file, the Consolidation Closure and the code the entry
cites, against the case's declared checks — never from the token figures. The judge receives the entry file, the case sheet and the closure only;
`usageWindow` is filled from the run state afterwards, in the spirit of the
blind evaluator used by the #174 benchmark. A cheap run that produces a worse
entry is a failure of the mode, not a win.

Checks common to every arm: the entry is readable and its contract validates,
every declared proof verifies, the claims are backed by the cited files, the
description names the subject, the closure matches the tool result.

| Arm | Additional checks |
| --- | --- |
| `create` | no entry existed for the name; the creation contract is unchanged; status `created`; closure `created` with the name in `created[]` |
| `append` | the historical body is preserved byte-for-byte (`preservedHistoricalBytes` equals the precondition body), the addition is inserted verbatim behind exactly one blank line, the frontmatter is rewritten only to merge evidence, all historical **and** new proofs verify; status `appended`; closure `appended` with the name in `changed[]` |
| `replace` | the whole entry is rewritten and no historical body is reused, all new proofs verify; status `replaced`; closure `replaced` with the name in `changed[]`; a `replace` textually identical to the previous body is reported, since it paid for a rewrite it did not need |

**Coverage** is judged in the same pass: each case declares, before the
campaign, the short list of claims the consolidation is expected to capture
(claims, not wording), and the judge marks each element `stated` / `absent` /
`contradicted` in the entry. The record keeps `expected`, `stated`, `absent`,
`contradicted` and the ratio of stated answers to expected ones. Coverage is
not conformance: an entry can be conformant and incomplete, or complete and
non-conformant, and both facts are recorded.

## 6. Reporting rules

- Every reported figure carries its `n`, its median, its minimum and maximum,
  and the count of failures. A single number without `n` is not a result.
- Variance is reported as `min`, `max`, `median`, `spread`, and the sample
  standard deviation when `n ≥ 3`. A difference smaller than the observed
  spread is not a difference.
- **No gain is announced before it is measured.** A cost claim, positive or
  negative, may appear only in a results record that names its case ids, its
  `n` and the measured medians, and only when the cheaper arm is at least as
  conformant and at least as covered as the arm it is compared with. Until such
  a record exists, `create`, `append` and `replace` are documented as behaviour,
  never as an economy.
- No aggregate is computed across cases with different requests or snapshots.
  Families K1 and K2 describe different situations and are not pooled.
- Unobservable windows are *not measured*, never zero. Fewer than three
  comparable repetitions is a pilot, not a result.
- A run that was not produced by a real Copilot session, or whose run state was
  edited to fill a gap, invalidates the campaign — the failure mode the #174
  benchmark hit and that its gate protocol now guards against.

## 7. Boundary of this ticket

Documentation and fixtures only: this protocol, the case sheet and the record
template. No instrumentation code, no new counter, no change to the Run State
format or to token accounting. The existing `summarizeRunUsage` snapshot is used
as it is, which is what keeps one source of truth for tokens.

## 8. Procedure for one measured repetition

1. Restore the case's catalogue precondition and check the snapshot: the
   declared `headCommit`, `git status --porcelain` empty, entry file bytes and
   revisions equal to the case sheet.
2. Start a fresh Copilot session in the snapshot workspace, with the campaign's
   frozen CodeTour build, model and `mcp-config.json`.
3. Run the case's frozen request through the normal CodeTour generation path, so
   a Generation Run exists and the served prompt is the documented one.
4. Let the run create its Tour, then consolidate in the case's arm, and finish
   the turn so the agentStop guard records `metrics.usage`.
5. Copy the consolidation window into one record from the template; read the
   entry sizes from the catalogue files on disk; record the tool result status
   and the Consolidation Closure.
6. Judge conformance and coverage per §5, without consulting the token figures.
7. Record failures as failures, then repeat. Aggregate only when the whole
   (case, arm) set is complete, and only in the form §6 allows.

## Campaign status

Not run. No result record exists in this repository, and none of the three modes
carries a cost claim. The campaign opens once the three modes of spec #232 are
available in the CodeTour build under measurement; it is a separate exercise,
run on a frozen build, and its results belong in records produced with the
template above.
