---
name: harness_dispatch_and_forgery
description: How the Research Harness dispatches tool calls, validates memory reads and rejects forged calls (pinned source 2f1ebcf)
evidence:
  - type: file
    path: packages/exploration-poc/src/cli.ts
    sha256: e2093a57719228e26929fcd7f9eda7afab9e9c99c484029249bdc0f4117e06e3
  - type: file
    path: packages/exploration-poc/src/explore.ts
    sha256: a4b1a3dfb0396c78be30858ab0d43b9a15c9f42b08cd211e8e93f45f17b0c002
  - type: file
    path: packages/exploration-poc/src/mask.ts
    sha256: 5a8d0a9b0ad8ca23fed84d6c9405ce2a78356bf65ad67ce3befde62ff067062c
---

# Harness dispatch, memory validation and forged-call rejection (at 2f1ebcf)

This Knowledge summarises the dispatch path of the Research Harness as pinned at
source revision `2f1ebcf`. Every claim below was verified against the cited
files at that revision; the evidence contract refuses the whole entry if any
cited file changes.

## CLI entry and run contract (`packages/exploration-poc/src/cli.ts`)

The CLI takes exactly one positional question plus options; a question is
mandatory (`A research question is required`, cli.ts:89) and the workspace must
resolve to a single project directory. One run per output file: `acquireLock`
refuses a second concurrent run with `Run already active for …` (cli.ts:39).
The only provider is Mistral; the API key comes from the `MISTRAL_API_KEY`
environment variable or the config file, never from a config file inside the
worktree (cli.ts:97). The harness answers one objective and never writes Tours.

## Model node and observation masking (`packages/exploration-poc/src/explore.ts`, `src/mask.ts`)

Every model reply is produced through
`complete(maskObservations(messages, config.context.keepToolResults, spilled))`
(explore.ts:148): old tool results are masked before the model sees the next
turn. In `mask.ts`, results below `MASK_MIN_BYTES = 2000` (mask.ts:3) always
stay verbatim; of the larger, older ones, only the last `keep` (default 8) tool
results are preserved (mask.ts:8) and the rest are replaced by a one-line stub
carrying the byte size, a 300-character head and a `readScratch` pointer when
the full result was spilled to scratch (mask.ts:16).

## Dispatch chain (`src/explore.ts` — one if/else chain per tool call)

Tool results are matched in a single chain inside the loop, in this order:
`readScratch` pages a previously spilled result by `resultId` and `offset`
(explore.ts:248); the plain primitives `list`, `search`, `read`, `git`
(explore.ts:302-308); then `memory_list` and `memory_unusable`; then the
sandbox branch handling `code`, `function_try` and `memory_run`
(explore.ts:345). Each branch type-checks its arguments; an unmatched name
falls through to the catch-all `throw new Error('Unknown tool or invalid
arguments')` (explore.ts:435), which reaches the model as a tool error — this
is how forged or misspelled tool calls are rejected without ending the loop.

## Memory validation and forged `memory_run` (`src/memory.ts`, `src/explore.ts`)

Stored Memory Functions are validated, never trusted raw: the catalogue is
parsed against a zod `entrySchema` (`memory.ts:32`, applied on read at
memory.ts:200) and names must satisfy `validateCanonicalName` (memory.ts:144).
On `memory_run(id)`: an id not present in the catalogue throws `Unknown script`
(explore.ts:337); parameters must be a plain non-array object or the call
throws `Invalid parameters` (explore.ts:340). Executed code always runs in the
QuickJS sandbox under the run's remaining time; when the stored revision
differs from the current one the result carries an explicit `staleness` signal,
and a strict-mode execution with invalid citations is returned as structured
repair feedback instead of its output.

## Forged-call handling and guards

Forged calls surface as explicit per-call errors, not silent fallbacks. Two
consecutive identical failures attach a `repeated_failure_guard` note and two
identical successful results attach a `repeated_call_guard` note
(explore.ts:442-468), so the model cannot loop unnoticed.
