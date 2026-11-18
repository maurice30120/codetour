# REPORT — spec #219 trial: parcours A (direct MCP) vs parcours B (harness with Knowledge)

Trial recorded by ticket **#222** (parent spec **#219**). Parcours A was produced
and recorded by ticket **#221** and is **referenced here, never rerun**; parcours B
attempt 1 (failed on the missing credential) is recorded in §3.3 and kept for
traceability; attempt 2 — this re-run, after the user supplied the harness
credential — is the parcours B result below. All timestamps UTC, wall-clock.

**Conclusion: both parcours now have a measured duration — in THIS trial,
parcours A is the fastest.** Attempt 2 completed end to end in **≈ 242.6 s**
(request receipt → first MCP `status: "created"`): ≈ **43.5 s** of pre-run
preparation (worktrees, Knowledge copy, connectivity re-check), a **34.0 s**
harness model loop (11 model calls, 8 tool calls), then ≈ **164.5 s** of
host-agent work (anchor re-verification against both revisions and three MCP
validation cycles) before Tour creation. Against parcours A's ≈ **109 s**,
parcours B is **slower by ≈ 133.6 s (≈ 2.2× A)**. No generality claim and no
attribution of the difference to Knowledge alone is made: one trial, one attempt
per parcours, Copilot-side tokens absent, and B's total is dominated by
host-agent authoring time, not by the harness loop.

## 1. Frozen conditions (identical for both parcours, from `frozen-request.md`)

| Condition | Value |
| --- | --- |
| Request (verbatim, EN) | "How does the Research Harness dispatch tool calls, validate memories and reject forged calls in this repository? The Tour should walk the CLI entry point, the explore model node, tool dispatch, forged-call rejection and the observation masking applied to tool results." |
| Source snapshot | commit `2f1ebcf` (`2f1ebcf28a7e3ab8a3fbb6d2bbb5b7e82fb4f099`) |
| Order of passage | A first (direct MCP), then B (harness); one attempt each |
| Isolation | A: worktree `/tmp/spec-219-wt/t221` (`poc/spec219-parcours-a/`); B: dedicated worktree `/tmp/spec-219-wt/run-b-snapshot` at `2f1ebcf` (detached), created with `git worktree add /tmp/spec-219-wt/run-b-snapshot 2f1ebcf --detach` |
| Tour target | one Project Tour explaining the harness tool-dispatch / memory-validation path, created through the CodeTour MCP `create_project_tour` |
| Metrics rule | record the ACTUAL model, parameters and order; missing values are recorded as **absent**, never zero |

## 2. Parcours A — reference result (recorded by #221, not rerun here)

Parcours A **completed** in ≈ **109 s** (request receipt → first MCP
`status: "created"`), producing one usable 6-step Tour
(`poc/spec219-parcours-a/tours/project.tour`), with one minor quality defect
(step 2 lumps `--temperature` under the budget flags) and three recorded
deviations (Copilot stand-in = Mistral Vibe subagent; MCP root on the main
checkout; pre-briefed subagent). Copilot-side and host-side token usage:
**absent**. Full details: `poc/spec219-parcours-a/RECORDING.md` (protocol in
`PROTOCOL.md`, runbook in `RUNBOOK.md`).

Parcours A used **no Knowledge, no harness**: direct agent exploration with the
CodeTour MCP only.

## 3. Parcours B — what actually happened

### 3.1 Knowledge preparation (measured separately: **119 s wall-clock**)

| Field | Value |
| --- | --- |
| Attempt/order | preparation strictly before the run request; measured from the first read of the pinned sources for the entry to the entry file saved (`11:54:56Z` → `11:56:55Z`) |
| Entries prepared | **1** (limit was 1–2): `harness_dispatch_and_forgery` |
| Catalogue | `<snapshot>/.tours/.memory/knowledge/` — the fixed `knowledge` catalogue of the snapshot's memory root (created new; nothing at `2f1ebcf` seeded it) |
| Name rule | `harness_dispatch_and_forgery` = valid TypeScript identifier = file name (frontmatter `name` equal to file name) |
| Evidence contract | three `file` proofs, SHA-256 of the cited bytes **at `2f1ebcf`**: `packages/exploration-poc/src/cli.ts` (`e2093a57…`), `…/src/explore.ts` (`a4b1a3df…`), `…/src/mask.ts` (`5a8d0a9b…`) |
| Content taught | CLI run contract; the model node wrapped in `maskObservations` (explore.ts:148); the single dispatch chain (readScratch → primitives → `memory_list`/`memory_unusable` → sandbox branch); forged-call rejections (`Unknown script` :337, `Invalid parameters` :340, catch-all `Unknown tool or invalid arguments` :435); memory validation (zod `entrySchema` memory.ts:32, `validateCanonicalName` :144); observation masking (`MASK_MIN_BYTES = 2000` mask.ts:3, last-8 verbatim, stub with 300-char head) — every line reference verified in the snapshot before writing |
| Forced reading? | **No.** The trial request (§1) was used verbatim and does not mention Knowledge; the harness instructions only *list* availability (name + description) |
| Archived copy | `poc/spec219-trial/knowledge/harness_dispatch_and_forgery.md` (canonical location is the snapshot worktree, which is disposable) |

### 3.2 Local connectivity check before the run (spec connectivity check)

Requirement: validate contract and reading **without a model and without an API
key**. The #220 read path in the CLI (`codetour-research --knowledge "Lis …"`)
answers an explicit question with a model call, and a model call needs the API
key, so the check drove the **#220 validation seam in-process** instead
(`parseKnowledge`, `verifyKnowledge`, `loadKnowledgeLibrary`, `knowledgeDirectory`
from `packages/exploration-poc/src/knowledge.ts`), with `node` running the
package's TypeScript sources directly.

Command (the report's exact, verified invocation):

```sh
node poc/spec219-trial/check-knowledge.mjs   # from the t222 worktree
```

The script checks, and its saved output confirms
(`poc/spec219-trial/connectivity-check-output.txt`):

- **contract valid** — `parseKnowledge` accepts the entry; `verifyKnowledge` accepts it against the snapshot workspace;
- **discovery lists name + description only** — `catalog()` returns exactly `{name, description}` keys, no body, no evidence;
- **`memory_read` returns the validated body** — `read('harness_dispatch_and_forgery')` → `status: "valid"`, 3465-char Markdown body, body carries no evidence hashes;
- **deliberate negative checks return `invalid` without leaking the body** — (a) a forged SHA-256 is refused as `file_hash_mismatch`, (b) a throwaway workspace with a **tmp-modified** cited file (`mask.ts` + 1 trailing line, both other cited files intact) is refused as `file_hash_mismatch`; both sanitized results contain no body marker, no path, no hash;
- **stale entries never block ordinary search** — on the partly-stale throwaway catalogue, `catalog()` still yields cleaned metadata and `list()` answers queries.

Honest outcome: **PASS (14/14)**. Red→green note: the first script run FAILED on
a defect in the check's own fixture (the throwaway tmp workspace lacked two of
the three cited files, so the first failing proof was `file_missing` instead of
the intended `file_hash_mismatch`); the fixture was fixed to reproduce the
intended condition and the check then passed. The harness code under test was
not modified. Since this is a single pre-run check driven in-process, the
in-loop trace (`knowledge_read` `read`/`refused` events) was **not** exercised
end-to-end by this check; see §3.4 for what the run actually produced.
Re-run (attempt 2, §3.5): the same **14/14** on the fresh rerun-b worktree
(fresh detached snapshot `/tmp/spec-219-wt/run-b-snapshot2`), saved as
`poc/spec219-trial/connectivity-check-output-b2.txt`.

### 3.3 Parcours B attempt 1 (recorded at #222; failed, never retried)

| Field | Value |
| --- | --- |
| Harness revision | `3a6d157` (t222 worktree = `spec-219-integration` tip, including #220 `--knowledge` and #221 parcours A artifacts) |
| Source revision (workspace) | `2f1ebcf` (`run-b-snapshot`, detached) |
| Model / parameters | **none reached** — no model was constructed and no model/temperature/order is recorded as used; the run would have used the configured default `mistral-small-latest` (had the key existed). Recorded as absent, not zero |
| Invocation (verbatim, from the t222 worktree) | `node packages/exploration-poc/src/cli.ts --workspace /tmp/spec-219-wt/run-b-snapshot --output-file /tmp/spec-219-wt/run-b-snapshot/poc-output.json --code --knowledge "How does the Research Harness dispatch tool calls, validate memories and reject forged calls in this repository? The Tour should walk the CLI entry point, the explore model node, tool dispatch, forged-call rejection and the observation masking applied to tool results."` |
| Order | the frozen request was re-read immediately before launch; single attempt, tracking deliberate: `--code --knowledge`, never `--memory`, no seeding, no consolidation flags |
| Start | `11:57:49Z` (wall-clock, recorded immediately before the process launched) |
| End | `11:57:58Z` (process terminal, exit code 1) — wall-clock attempt window ≈ **9 s**; the run is a failure, so this is a time-to-blocker, **not** a creation duration |
| Status | **failed** — real reason: `MISTRAL_API_KEY is required` (the Mistral provider is the only model the harness supports, the key is required before any call; `packages/exploration-poc/src/mistral.ts:8`, reached at `cli.ts` model construction) |
| Evidence | CLI exit code 1 and failure JSON archived at `poc/spec219-trial/parcours-b-attempt-1.json` (kept for traceability): `{"status":"failed","error":"MISTRAL_API_KEY is required", … ,"modelCalls":0,"toolCalls":0,"callTrace":[]}`, `usageAvailable: false` |
| Progress trace | **none** — no `<output-file>.progress` was ever created beyond its empty truncation write; the failure happened before the explore loop (and before the `--code` QuickJS sandbox preflight), so no `plan`/`step`/`end` events exist |
| Knowledge states in the run trace | **absent — not reached**: no `memory_list` discovery, no read, no refusal (the model was never called, so Knowledge was never offered) |
| Token metrics (harness) | **absent** — `usageAvailable: false`, zero model calls; absence recorded as absent |
| Token metrics (Copilot side) | **absent** — see §5 |
| Tour created | **No.** No `create_project_tour` call was made, neither dry-run nor real: there was no result to assemble |
| Retries | none — per protocol the missing-credential failure is not retried |

### 3.4 Blockers (failures of setup, recorded as blockers — never as results)

1. **Missing harness credential.** `MISTRAL_API_KEY` is absent from the environment (only an unrelated `VIBE_APP_SERVER_BIN` path matches "mistral" in `env`) and from the workspace config (the snapshot has no `.tours/config.json`; the main checkout's config carries no `apiKey`). The prescribed invocation reads only env/config, so the single attempt could never reach a model call. **Noted, not silent-fixed:** a macOS keychain item with account `MISTRAL_API_KEY` **exists** on this machine (46 chars, value never printed), and the historical wrapper `.tours/codetour-research` reads exactly that account — but that wrapper hard-codes `--code --memory`, which is forbidden for a Knowledge run (`--memory` and `--knowledge` are mutually exclusive), so it cannot serve parcours B either. Passing the keychain value to the direct CLI would have deviated from the frozen invocation and injected a secret into a test process; this is left as the documented, obvious unblock for any future B attempt, not as part of this single trial. *Attempt 2 (§3.5) is exactly that unblock, performed after the user explicitly authorized using the keychain item for this re-run.*
2. **VS Code Copilot unavailable** — the adapted skill could not be *loaded and invoked in Copilot* (ticket #222's first AC). The adaptation exists as a file, and the Knowledge protocol (steps 3.1–3.5) was applied by an agent following it verbatim for the parcours B attempt, but no Copilot-hosted invocation was performed; Copilot-side accounting therefore stays absent for both parcours.
3. **No CodeTour MCP call in parcours B** — MCP availability was proven during parcours A, but B never reached the Tour-creation stage, so its MCP leg (dry-run then write) is unverified **in this run**. *Resolved by attempt 2 (§3.6: two dry-run cycles, then the write, first `status: "created"`).*
4. **No token telemetry anywhere** in this environment (Copilot side or harness side) — §5. *Resolved for the harness side by attempt 2: measured `usageAvailable: true` (70,517 / 4,446 tokens, §5); the Copilot side stays absent.*
5. The parcours A workspace produced by #221 did not rerun here; comparability of its timing is inherited from its own recording, including its three deviations (§2).

### 3.5 Attempt 2 — the supplied-credential re-run (this branch; one attempt, never retried)

Attempt 2 follows attempt 1 after the user supplied the missing harness
credential. Same protocol, one attempt, no retries; harness revision `e503add`
(branch `feature/spec-219/rerun-b`, tip of `spec-219-integration`, including
#220 `--knowledge` and #221 parcours A artifacts), source revision unchanged:
`2f1ebcf` — a fresh detached worktree `/tmp/spec-219-wt/run-b-snapshot2`
(`git worktree add /tmp/spec-219-wt/run-b-snapshot2 2f1ebcf --detach`), holding
**no parcours A artifacts**; the Knowledge entry was copied back verbatim from
`poc/spec219-trial/knowledge/` into the snapshot's `.tours/.memory/knowledge/`.
Knowledge preparation time is **not** re-measured and **not** counted here: the
119 s of §3.1 stays the recorded prep figure, referenced from attempt 1.

> **Distinct from the separate reprise run:** an earlier, independent reprise of
> parcours B is recorded in `poc/spec219-trial/REPRISE-2026-11-18.md` (run
> `a7443b5e-…`, status `partial` / `repeated_tool_failure`, 19 model calls,
> 52 tool calls, no structured result, no Tour, `knowledge_available` seen but
> never read, traces in a disposable temp directory). It is **not** the attempt
> recorded here: attempt 2 has its own run identity `49a4cdfa-…`, its own
> isolated snapshot `/tmp/spec-219-wt/run-b-snapshot2` and the end-to-end
> protocol above (one attempt, completion, Tour creation). Both reprises are
> single attempts; this report's verdict rests on attempt 2 only, with the
> reprise's partial run kept as recorded history, not aggregated.

| Field | Value |
| --- | --- |
| Harness revision | `e503add` (`feature/spec-219/rerun-b` = `spec-219-integration` tip: #220 + #221 + #222 merged) |
| Source revision (workspace) | `2f1ebcf` (`run-b-snapshot2`, detached, clean; Knowledge entry inside) |
| Credential | `MISTRAL_API_KEY` from the macOS keychain (service `ai.mistral.vibe`), read in the **same shell command that launched the run**; verified only by byte length (45), never printed or stored |
| Invocation (verbatim) | `node packages/exploration-poc/src/cli.ts --workspace /tmp/spec-219-wt/run-b-snapshot2 --code --knowledge --output-file /tmp/spec-219-wt/run-b-snapshot2/poc-output.json "<frozen request>"` — launched from the **main checkout** (node 26 runs the TS sources directly), env-var credential injected, `--memory` absent |
| Order | the frozen request was re-read immediately before launch; single attempt, tracking deliberate: `--code --knowledge`, never `--memory` |
| Frozen invocation | `promptSha256: 070963b5…` — **identical in attempt 1 and attempt 2** (`070963b54514e851a27cc9785468b58bff8616a0ca25d3e786450535c661cb64` in both archived outputs) |
| Harness launch | `12:48:01.846Z` (wall-clock, recorded in-band immediately before the process exec) |
| Model loop end | `12:48:36.451Z` (`run_end` trace event, exit 0) — harness run ≈ **34.6 s** (`durationMs: 34012`) |
| Status | **complete** — final summary line in the archived terminal output: `{ "status": "complete", "runId": "49a4cdfa-4fb9-4037-937c-637c5e153365", "tokens": { "input": 70517, "output": 4446, "usageAvailable": true }, "durationMs": 34012, "modelCalls": 11, "toolCalls": 8, … }` |
| Output JSON | archived at `poc/spec219-trial/parcours-b-output.json` (34,028-byte final report; `status: "complete"`, `callTrace` 21 events) |
| Knowledge states in the run trace | **available AND read — never refused:** seq 0 `knowledge_available` (entry `harness_dispatch_and_forgery`, `status: "available"`, 12:48:02.445Z), seq 13 `memory_list` discovery (name + description only), seq 15 `memory_read` → type `knowledge_read`, **`status: "read"`** (verified in 5 ms, then worked from the validated body) |

Run B was **not forced** to read the Knowledge: the request is verbatim §1 —
the model itself chose discovery then the read, inside the `--knowledge` mode
(#220 requirement preserved). No forged call was issued in attempt 2 either:
all 8 dispatched calls (one `list`, four `search`, `memory_list`, `memory_read`,
one further `search`) passed through the observed chain, and the trace shows
zero rejections (`memoryReuses`, `functionTries`, `memoryQueryRejects`: 0 —
metrics archivable, and here **trivially zero**, which the metrics rule says to
distinguish from absence: these are real zeros from `usageAvailable: true`).

### 3.6 Tour creation (MCP) and total timing — attempt 2

| Moment (UTC) | Time | Δ from T0 (receipt `12:47:18.3Z`) |
| --- | --- | --- |
| T0 — request receipt | `12:47:18.3Z` | 0 s |
| T1 — harness launch | `12:48:01.8Z` | + 43.5 s (worktrees, Knowledge copy, connectivity re-check — prep **not** counted as Knowledge prep) |
| T2 — model loop end | `12:48:36.5Z` | + 78.1 s (harness run ≈ 34.6 s; 11 model calls, 8 tool calls) |
| T3 — first MCP `status: "created"` | `12:51:21.0Z` | **+ 242.6 s — total elapsed: ≈ 242.6 s** |

Creation path: authored from the run's validated output, then **dryRun first**
(one rejected cycle: an unescaped-regex INVALID_PROPOSAL pattern; one validated
cycle that itself flagged the missing locator-free orientation step when the
first proposal carried the overview text only at tour level), then the real
call — first `status: "created"` at `12:51:20.989Z`, 7 steps, **zero warnings**.
The written `.tours/project.tour` was immediately copied to
`poc/spec219-trial/tours-b/project.tour` (this branch) and the server-side copy
deleted — **same recorded deviation as parcours A** (MCP root on the main
checkout; main checkout left clean, `git status` clean). Host-agent share of
the total: ≈ **208 s** (≈ 43.5 pre-run + ≈ 164.5 post-run authoring,
verification and MCP cycles) vs the harness's 34.6 s — kept visible so no
comparison attribute is hidden.

### 3.7 Quality check of the created Tour (attempt 2, honest defects noted)

- **Anchors**: 6 pattern anchors; the CodeTour MCP validated all of them
  against the MCP root (main checkout at `e503add`) during dryRun + creation —
  **zero warnings** at `status: "created"`.
- Re-verified independently at the **source revision `2f1ebcf`**: every pattern
  matches exactly once in the snapshot for the 5 anchors that exist there
  (`explore.ts`, `mask.ts`, `memory.ts` are byte-identical at `2f1ebcf` and
  `e503add`).
- **Known asymmetry (recorded, not hidden):** the 6th anchor — `cli.ts`
  exclusive-mode throw — exists only in the harness revision `e503add`.
  `2f1ebcf` predates the `--knowledge` CLI flag, so the step's anchored line
  cannot exist at the studied snapshot; the step describes the harness CLI
  itself (attempt 2's actual binary-in-play), which is the honest framing.
- **Step-4 enumeration check:** the tour states run B dispatched "one `list`,
  four `search`, `memory_list`, `memory_read`" — the trace confirms exactly
  8 calls, matching. No defect found in the enumeration.
- Both Mermaid captions and the zone map validated server-side; tour opens
  as a 7-step CodeTour with the first step locator-free.

## 4. Rule applied to the comparison (spec #219 decision rule)

- Parcours A: completed, ≈ 109 s, 1 usable Tour (1 minor defect).
- Parcours B: attempt 1 failed at the credential blocker (kept, §3.3); attempt 2
  completed, ≈ 242.6 s, 1 usable Tour (`poc/spec219-trial/tours-b/project.tour`).
- Rule: *if a run or its duration is missing → conclusion INDETERMINATE; no
  speed claim; report the one usable artifact and state the other failure.*
  Both a run and a duration now exist, so the rule no longer applies: report
  both durations, the difference, and the winner of THIS trial.
- **Measured in THIS trial: A ≈ 109 s vs B ≈ 242.6 s — parcours A is the
  fastest (B slower by ≈ 133.6 s, ≈ 2.2× A).** No generality claim follows;
  B's total is dominated by host-agent authoring time (≈ 164.5 s post-run +
  ≈ 43.5 s pre-run), while the harness model loop itself lasted 34.0 s and the
  Knowledge read inside it 5 ms.
- No attribution of the difference to Knowledge alone: the trial compares
  complete workflows (host agent + harness + MCP), and Knowledge preparation
  time (119 s) is reported separately and never inside a run duration.
- Copilot-side tokens remain absent for both parcours (§5); the attribution
  gap is therefore unmeasurable, and none is inferred.
- Single-trial limit: **one attempt per parcours**; no statistical or general
  performance claim can follow from this trial, and none is made.

## 5. Token accounting (Copilot vs harness, distinguished)

| Metric | Parcours A | Parcours B |
| --- | --- | --- |
| Copilot-side usage (host agent) | **absent** (no Copilot SDK telemetry available to the stand-in agent) | **absent** (no Copilot-hosted session at all; both attempts were driven by an agent following the adapted skill) |
| Harness-side usage | **not applicable** (no harness ran) | **attempt 1**: absent — `usageAvailable: false`, `modelCalls: 0`; **attempt 2 (measured)**: `usageAvailable: true` — **70,517 input / 4,446 output tokens**, 11 model calls, 8 tool calls (`poc/spec219-trial/parcours-b-output.json` → `metrics`) |
| Mermaid/tour-related diagnostics | recorded in #221's RECORDING | attempt 2: dryRun cycle 1 INVALID_PROPOSAL (unescaped regex patterns), cycle 2 validated with 1 orientation warning, final created with 0 warnings (§3.6) |

All absent values are recorded as **absent, never zero**; no token-saving
comparison is possible or claimed. The harness-side attempt 2 numbers are the
first **measured** token figures of this trial (usageAvailable: true), but they
cover the harness loop only — never the Copilot/host side.

## 6. Prerequisites and verified commands (exactly what was run and observed)

| Step | Command (from the t222 worktree unless noted) | Verified outcome |
| --- | --- | --- |
| Worktree | `cd /Users/dhuyet/Documents/POC/codetour && git worktree add /tmp/spec-219-wt/t222 -b feature/spec-219/t222-harness-run-b spec-219-integration` | branch at tip `3a6d157` |
| Snapshot worktree | `git worktree add /tmp/spec-219-wt/run-b-snapshot 2f1ebcf --detach` | detached at `2f1ebcf28a7e…`, clean before the run |
| Node / npm | `node -v`; `npm -v` | v26.13.1 / 11.20.0 |
| Dependencies | `npm install --no-audit --no-fund` then `npm --prefix packages/exploration-poc install --no-audit --no-fund` | both completed (fresh-worktree deps, including the `file:../exploration-sandbox` sibling) |
| Sibling builds for checks | `npm --prefix packages/description-renderer run build`; `npm --prefix packages/mcp-server install` + manual staging + `npx webpack --mode production` + `node scripts/prepare-resvg-runtime.js`; `npm --prefix packages/exploration-sandbox install` | dists + `dist/cli.js` produced; sandbox QuickJS suite loadable — after this setup `npm run check:fast` is green (§7; vanilla `npm run build` still trips on the pre-existing mcp-server test-file type errors) |
| Credential check | `env \| grep -i mistral`; key tests on `.tours/config.json` and `.env.local`; `security find-generic-password -a MISTRAL_API_KEY -w \| wc -c` | env: absent · configs: no key · keychain item: **exists** (46 chars, never printed, **not used** — see blocker §3.4.1) |
| Knowledge prep | `shasum -a 256 packages/exploration-poc/src/{cli,explore,mask}.ts` in the snapshot; write `…/.tours/.memory/knowledge/harness_dispatch_and_forgery.md` | 3 hashes pinned at `2f1ebcf`; file written; prep time 119 s |
| Connectivity check (no model) | `node poc/spec219-trial/check-knowledge.mjs` | **PASS 14/14** (`connectivity-check-output.txt`) |
| Parcours B run (single attempt) | `node packages/exploration-poc/src/cli.ts --workspace /tmp/spec-219-wt/run-b-snapshot --output-file /tmp/spec-219-wt/run-b-snapshot/poc-output.json --code --knowledge "<frozen request>"` | exit 1; `{"status":"failed","error":"MISTRAL_API_KEY is required",…}`; no progress events; no Tour |
| Tests | `npm --prefix packages/exploration-poc test` | recorded below (§7) |
| Repo checks | `npm run check:fast` | recorded below (§7) |

Not performed because the run ended earlier: sandbox preflight timing, model
call, trace inspection, MCP dry-run/creation. These are **missing**, not failed
in themselves. All of them WERE performed in attempt 2 (§3.5–§3.7):

| Step (attempt 2 — this re-run, branch `feature/spec-219/rerun-b` at `e503add`) | Command | Verified outcome |
| --- | --- | --- |
| Worktree (re-run) | `git worktree add /tmp/spec-219-wt/rerun-b -b feature/spec-219/rerun-b spec-219-integration`; `npm ci --no-audit --no-fund` | branch at tip `e503add`; deps installed |
| Snapshot (attempt 2) | `git worktree add /tmp/spec-219-wt/run-b-snapshot2 2f1ebcf --detach`; copy `poc/spec219-trial/knowledge/harness_dispatch_and_forgery.md` → `<snapshot>/.tours/.memory/knowledge/` | detached clean at `2f1ebcf`; Knowledge entry in place (prep NOT re-measured) |
| Credential (attempt 2) | `KEY=$(security find-generic-password -s ai.mistral.vibe -a MISTRAL_API_KEY -w)` in the launcher shell; `wc -c` → 45 | nonzero length verified only; value never printed, never written to a file |
| Connectivity re-check (no model) | `WORKTREE=/tmp/spec-219-wt/rerun-b SNAPSHOT=/tmp/spec-219-wt/run-b-snapshot2 node poc/spec219-trial/check-knowledge.mjs` | **PASS 14/14** (`connectivity-check-output-b2.txt`) |
| Parcours B run (attempt 2, single attempt) | `MISTRAL_API_KEY="$KEY" node packages/exploration-poc/src/cli.ts --workspace /tmp/spec-219-wt/run-b-snapshot2 --code --knowledge --output-file /tmp/spec-219-wt/run-b-snapshot2/poc-output.json "<frozen request>"` (from the main checkout) | exit 0 at `12:48:36.451Z`; `status: "complete"`; 11 model calls / 8 tool calls; 70,517/4,446 tokens; `usageAvailable: true` (§3.5) |
| Tour creation (MCP) | `create_project_tour` dryRun (2 cycles: 1 × INVALID_PROPOSAL, 1 × validated+warning) then write | first `status: "created"` at `12:51:20.989Z`; 7 steps, 0 warnings (§3.6) |
| Quality check | 6 pattern anchors re-matched against `2f1ebcf` | 5/6 unique at the snapshot; `cli.ts` anchor exists only at `e503add` (§3.7) |

## 7. Regression checks run for this ticket (fresh worktree, real exit statuses)

| Command | Result |
| --- | --- |
| `npm --prefix packages/exploration-poc test` | **exit 0 — 261 tests, 261 pass, 0 fail** (includes all #220 Knowledge-mode tests — e.g. "a `--code --knowledge` CLI run keeps search tools and code, reads only a validated Knowledge", "the CLI refuses `--memory` and `--knowledge` together, before any model call" — plus the historical Memory Function suite) |
| `npm run check:fast` (tsc test typecheck + copilot-adapter + poc typecheck + poc tests) | **exit 0 — all green** (copilot-adapter 36 pass / 0 fail; poc 261 pass / 0 fail) |

Re-run (attempt 2, fresh worktree `/tmp/spec-219-wt/rerun-b`, branch
`feature/spec-219/rerun-b` at `e503add`, **same commands, same exit statuses**):

| Command (re-run) | Result |
| --- | --- |
| `npm run check:fast` after the recorded fresh-worktree setup | **exit 0 — all green**: copilot-adapter **36 pass / 0 fail**; poc typecheck clean; poc **261 pass / 0 fail** (log archived: `poc/spec219-trial/check-fast-rerun-b.log`) |
| Fresh-worktree setup order, recorded for any future re-run | `npm ci` (root) → `npm --prefix packages/description-renderer run build` → `npm --prefix packages/mcp-server install` → `npx tsc -p packages/mcp-server/tsconfig.json` (emits `dist/src` *.d.ts despite the pre-existing test-file errors — required by the ROOT typecheck's `codetour-mcp` path mapping) → `node scripts/stage-mcp-renderer.js` → `npx webpack --mode production` → `node scripts/prepare-resvg-runtime.js` → `npm --prefix packages/exploration-poc install` (pulls the pinned `@langchain/langgraph`/`pino`/`rotating-file-stream` devDeps + the `file:../exploration-sandbox` sibling) → `npm --prefix packages/exploration-sandbox install` (gives the sandbox its own `quickjs-emscripten`) |

Same environment caveat as attempt 1 applies unchanged: the vanilla
`npm run build` still trips on the pre-existing mcp-server test-file type
errors at this tip (outside this re-run's scope, not fixed, not masked).
The re-run adds one concrete repro of that caveat's mitigation: root
`tsconfig.test.json` resolves `codetour-mcp` through
`packages/mcp-server/dist/src/cli`, so the manual `tsc` emit is **required**
for `check:fast` on a fresh worktree — attempt 1's recording listed the same
hand-steps without spelling out this dependency.

Environment caveat recorded honestly: on this fresh worktree the vanilla
`npm run build` fails **at the integration tip, before any `#222` change**:
`packages/mcp-server`'s `tsc -p tsconfig.json` (include: src + test) reports
implicit-any errors in pre-existing test files (`test/integration/security.test.ts`,
`test/integration/packaged-binary.test.ts`, last touched by #82 on 2026-11-02),
which aborts the build chain before webpack. The required artifacts were
produced by completing the same build steps by hand (tsc dist output is emitted
despite the test-file errors → `npm --prefix packages/mcp-server install` →
`node scripts/stage-mcp-renderer.js` → `npx webpack --mode production` →
`node scripts/prepare-resvg-runtime.js`), and `check:fast` then passed end to
end. The underlying mcp-server test-file typechecking failure is pre-existing
tip breakage, outside #222's scope, and is **not fixed or masked** here.


## 8. Artifacts

| Artifact | Path |
| --- | --- |
| Adapted skill (Knowledge mode, step 3) | `packages/exploration-poc/skills/codetour-research/SKILL.md` |
| Knowledge entry (archived copy) | `poc/spec219-trial/knowledge/harness_dispatch_and_forgery.md` |
| Connectivity checker + saved output | `poc/spec219-trial/check-knowledge.mjs`, `poc/spec219-trial/connectivity-check-output.txt` |
| Parcours B attempt-1 failure JSON (traceability) | `poc/spec219-trial/parcours-b-attempt-1.json` |
| Parcours B attempt-2 run output (real run) | `poc/spec219-trial/parcours-b-output.json` |
| Parcours B attempt-2 connectivity re-check | `poc/spec219-trial/connectivity-check-output-b2.txt` |
| Parcours B attempt-2 Tour | `poc/spec219-trial/tours-b/project.tour` |
| Parcours B attempt-2 `check:fast` log | `poc/spec219-trial/check-fast-rerun-b.log` |
| Parcours A recording (reference) | `poc/spec219-parcours-a/RECORDING.md` (+ `PROTOCOL.md`, `RUNBOOK.md`, `tours/project.tour`) |

## 9. Attribution limits (binding for any reader of this report)

- One trial, one attempt per parcours (B attempt 2 is the re-run after the
  credential blocker was unblocked by the user; it is still exactly one
  attempt), one machine, no Copilot.
- This trial cannot establish that prepared Knowledge speeds up Tour creation.
  In attempt 2 the Knowledge WAS available, was discovered, and **was read**
  (available → read, never refused, §3.5) — but the read cost 5 ms inside a
  34.0 s loop, so no speed effect of Knowledge is measurable here; the
  remaining ≈ 208 s of attempt 2's total is host-agent work, unmodelled.
- The attempt-1 blocker was infrastructure (credential), not a measured
  property of the Knowledge workflow; attempt 2 removes that blocker by
  supplying the credential, not by changing any harness or Knowledge code.
- Knowledge preparation time (119 s) is amortized nowhere in this report; any
  amortization claim would require measurable reuse, which was not attempted.
- The tour's step-2 anchor exists only at the harness revision (`e503add`),
  not at the studied snapshot `2f1ebcf` (§3.7): the trial's two revisions
  (harness vs source) are kept distinct everywhere in this report.
