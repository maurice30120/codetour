# REPORT — spec #219 trial: parcours A (direct MCP) vs parcours B (harness with Knowledge)

Trial recorded by ticket **#222** (parent spec **#219**). Parcours A was produced
and recorded by ticket **#221** and is **referenced here, never rerun**; parcours B
is recorded below from its own single attempt. All timestamps UTC, wall-clock.

**Conclusion up front: the comparison is INDETERMINATE.** Parcours B has no
usable artifact and no run duration: its single attempt failed on the missing
`MISTRAL_API_KEY` before any model call, discovery or Tour creation. The only
usable artifact of this trial is parcours A's Tour. No speed claim is made; the
failure is a recorded environment blocker, not evidence about the value of
prepared Knowledge.

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

### 3.3 Parcours B attempt (single attempt, never retried)

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
| Evidence | CLI exit code 1 and failure JSON archived at `poc/spec219-trial/parcours-b-output.json`: `{"status":"failed","error":"MISTRAL_API_KEY is required", … ,"modelCalls":0,"toolCalls":0,"callTrace":[]}`, `usageAvailable: false` |
| Progress trace | **none** — no `<output-file>.progress` was ever created beyond its empty truncation write; the failure happened before the explore loop (and before the `--code` QuickJS sandbox preflight), so no `plan`/`step`/`end` events exist |
| Knowledge states in the run trace | **absent — not reached**: no `memory_list` discovery, no read, no refusal (the model was never called, so Knowledge was never offered) |
| Token metrics (harness) | **absent** — `usageAvailable: false`, zero model calls; absence recorded as absent |
| Token metrics (Copilot side) | **absent** — see §5 |
| Tour created | **No.** No `create_project_tour` call was made, neither dry-run nor real: there was no result to assemble |
| Retries | none — per protocol the missing-credential failure is not retried |

### 3.4 Blockers (failures of setup, recorded as blockers — never as results)

1. **Missing harness credential.** `MISTRAL_API_KEY` is absent from the environment (only an unrelated `VIBE_APP_SERVER_BIN` path matches "mistral" in `env`) and from the workspace config (the snapshot has no `.tours/config.json`; the main checkout's config carries no `apiKey`). The prescribed invocation reads only env/config, so the single attempt could never reach a model call. **Noted, not silent-fixed:** a macOS keychain item with account `MISTRAL_API_KEY` **exists** on this machine (46 chars, value never printed), and the historical wrapper `.tours/codetour-research` reads exactly that account — but that wrapper hard-codes `--code --memory`, which is forbidden for a Knowledge run (`--memory` and `--knowledge` are mutually exclusive), so it cannot serve parcours B either. Passing the keychain value to the direct CLI would have deviated from the frozen invocation and injected a secret into a test process; this is left as the documented, obvious unblock for any future B attempt, not as part of this single trial.
2. **VS Code Copilot unavailable** — the adapted skill could not be *loaded and invoked in Copilot* (ticket #222's first AC). The adaptation exists as a file, and the Knowledge protocol (steps 3.1–3.5) was applied by an agent following it verbatim for the parcours B attempt, but no Copilot-hosted invocation was performed; Copilot-side accounting therefore stays absent for both parcours.
3. **No CodeTour MCP call in parcours B** — MCP availability was proven during parcours A, but B never reached the Tour-creation stage, so its MCP leg (dry-run then write) is unverified **in this run**.
4. **No token telemetry anywhere** in this environment (Copilot side or harness side) — §5.
5. The parcours A workspace produced by #221 did not rerun here; comparability of its timing is inherited from its own recording, including its three deviations (§2).

## 4. Rule applied to the comparison (spec #219 decision rule)

- Parcours A: completed, ≈ 109 s, 1 usable Tour (1 minor defect).
- Parcours B: failed at the credential blocker; no Tour, no in-run duration.
- Rule: *if a run or its duration is missing → conclusion INDETERMINATE; no
  speed claim; report the one usable artifact and state the other failure.*
- **Therefore: INDETERMINATE.** The single usable artifact is
  `poc/spec219-parcours-a/tours/project.tour` (~109 s, from #221's recording).
- A `complete`-style speed comparison would also have been unable to attribute
  any difference to Knowledge alone: the trial compares complete workflows
  (host agent + harness + MCP), and Knowledge preparation time (119 s) is
  reported separately and never inside a run duration.
- Single-trial limit: **one attempt per parcours**; no statistical or general
  performance claim can follow from this trial, and none is made.

## 5. Token accounting (Copilot vs harness, distinguished)

| Metric | Parcours A | Parcours B |
| --- | --- | --- |
| Copilot-side usage (host agent) | **absent** (no Copilot SDK telemetry available to the stand-in agent) | **absent** (no Copilot-hosted session at all; the attempt was driven by an agent following the adapted skill) |
| Harness-side usage | **not applicable** (no harness ran) | **absent** — `usageAvailable: false`, `modelCalls: 0` (failed before the first model call) |
| Mermaid/tour-related diagnostics | recorded in #221's RECORDING | none (no Tour) |

All absent values are recorded as **absent, never zero**; no token-saving
comparison is possible or claimed.

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
in themselves.

## 7. Regression checks run for this ticket (fresh worktree, real exit statuses)

| Command | Result |
| --- | --- |
| `npm --prefix packages/exploration-poc test` | **exit 0 — 261 tests, 261 pass, 0 fail** (includes all #220 Knowledge-mode tests — e.g. "a `--code --knowledge` CLI run keeps search tools and code, reads only a validated Knowledge", "the CLI refuses `--memory` and `--knowledge` together, before any model call" — plus the historical Memory Function suite) |
| `npm run check:fast` (tsc test typecheck + copilot-adapter + poc typecheck + poc tests) | **exit 0 — all green** (copilot-adapter 36 pass / 0 fail; poc 261 pass / 0 fail) |

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
| Parcours B failure JSON | `poc/spec219-trial/parcours-b-output.json` |
| Parcours A recording (reference) | `poc/spec219-parcours-a/RECORDING.md` (+ `PROTOCOL.md`, `RUNBOOK.md`, `tours/project.tour`) |

## 9. Attribution limits (binding for any reader of this report)

- One trial, one attempt per parcours, one machine, no Copilot, no model in B.
- This trial cannot establish that prepared Knowledge speeds up Tour creation;
  in B the Knowledge was never read, so its supposed contribution was **not
  observed at all** (available ≠ read, and here even availability in-run was
  never traced).
- The B failure is an infrastructure blocker (credential), not a measured
  property of the Knowledge workflow.
- Knowledge preparation time (119 s) is amortized nowhere in this report; any
  amortization claim would require measurable reuse, which was not attempted.
