# RECORDING — parcours A (direct agent + CodeTour MCP), spec #219

Filled once, after the single attempt. Template: `RECORDING-TEMPLATE.md`.
Protocol: `PROTOCOL.md`. Runbook: `RUNBOOK.md`. All timestamps UTC.

## 1. Identification

| Field | Value |
| --- | --- |
| Ticket / spec | #221 (parent #219) — frozen request re-read verbatim at the attempt's start |
| Repository / commit | `/Users/dhuyet/Documents/POC/codetour` worktree `/tmp/spec-219-wt/t221`, branch `feature/spec-219/t221-parcours-a`, snapshot at commit `2f1ebcf` |
| Direct agent identity | `direct agent = Mistral Vibe subagent (stand-in for VS Code Copilot)` — the underlying subagent model is not exposed by this environment and is **never claimed to be Copilot** |
| Deviations from the protocol | see §5 — three recorded deviations, no silent fixes |

## 2. Timing

| Field | Value |
| --- | --- |
| start (request receipt) | `2026-11-18T10:44:03Z` — re-read of `/tmp/spec-219-notes/frozen-request.md` captured on a wall-clock immediately before exploration |
| finish (first MCP `status: "created"`) | `2026-11-18T10:45:52.285Z` (session-journal response entry for the real `create_project_tour` call) |
| elapsed (finish − start) | **≈ 109 s** |

Intermediate events (from the session journal): first dry-run proposal rejected
`INVALID_PROPOSAL` at `10:45:15.420Z` (mutually exclusive `line`+`pattern`,
unescaped regex groups); corrected proposal validated at `10:45:33.351Z`
(`status:"validated"`); real call returned `created` at `10:45:52.285Z`.

## 3. Tour artifact

| Field | Value |
| --- | --- |
| file name in `.tours/` | `.tours/project.tour` in the MCP server workspace root (the main checkout at `2f1ebcf`); archived in the worktree at `poc/spec219-parcours-a/tours/project.tour` |
| step count | 6 (orientation + 5 anchored steps) |
| opens / parses as JSON | yes — `JSON.parse` on the archived copy; `$schema` `https://aka.ms/codetour-schema` present |
| anchors resolve at the pinned commit | yes — all 5 patterns verified `grep -c = 1` against the `2f1ebcf` worktree: `Refuses a second run` (cli.ts), `complete\\(maskObservations` (explore.ts), `else if \\(codeMode` (explore.ts), `export const MASK_MIN_BYTES = 2000` (mask.ts), `throw new Error\\('Unknown script'\\)` (explore.ts) |
| Mermaid diagrams validated by MCP | yes — one Context-view flowchart in the orientation step; no Mermaid errors reported by the server |
| MCP structural validation | `dryRun:true` proposal rejected once (`INVALID_PROPOSAL`, see §5), second proposal `status:"validated"`, real call `status:"created"` with zero warnings |

## 4. Coverage of the request

| Requested topic | Presented as step |
| --- | --- |
| CLI entry point | yes — “CLI entry point — arguments, budgets and the output-file lock” (cli.ts, `acquireLock`) |
| explore model node | yes — “Explore loop — the model node” (explore.ts `complete(maskObservations(...))`) |
| tool dispatch | yes — “Dispatch chain — every tool call is matched exactly once” (readScratch → list/search/read/git → codeMode branch → catch-all) |
| forged-call rejection | yes — “Forged calls are named, not hidden” (`Unknown script`, `Invalid parameters`, allow-list catch-all) |
| observation masking of tool results | yes — “Observation masking — old tool results become stubs” (mask.ts, `keepToolResults`, 300-char head stub) |

## 5. Quality findings (human review)

- **Minor (step 2 wording):** the CLI step lumps `--temperature` under “budget
  flags”; in `cli.ts` it is parsed as a model parameter and validated to [0,1],
  separate from the budget nibble (`--tokens/--duration-ms/--iterations/--calls`).
  Recorded as a defect; the tour stays frozen at creation.
- **Considered omission (not a defect):** no Containers diagram — the tour
  scope is the single harness path; the Context view alone satisfied the C4
  guidance, and the orientation step carries the required Mermaid caption.
- **Deviation 1 (environment):** VS Code Copilot is unavailable here; the run
  used the pre-registered stand-in identity (Vibe subagent), so conditions
  differ from a true Copilot-hosted session (no Copilot UI, no Copilot-side
  request bookkeeping).
- **Deviation 2 (workspace):** the MCP server's configured root is the main
  checkout, so the file was briefly written to the main checkout's `.tours/`
  and immediately copied into this worktree and deleted there — the
  “worktree IS the isolated workspace” rule is restored post-hoc, not
  enforced by the server itself.
- **Deviation 3 (pre-briefing):** the subagent had already read the repo as
  part of exploring for this ticket before the timed window; the 109 s
  measures request → creation, not cold first-contact with the codebase.

## 6. Result

| Field | Value |
| --- | --- |
| status | **completed** (Tour created and MCP-validated on the real call, on the 1st real attempt; 3rd proposal overall due to one rejected dry-run) |
| usable artifact | yes — `poc/spec219-parcours-a/tours/project.tour` (6 steps, anchors resolve at `2f1ebcf`) |

## 7. Token metrics

| Metric | Value |
| --- | --- |
| Copilot-side usage | **absent** — no Copilot SDK/agent usage telemetry is available to a Vibe subagent; recorded as absent, never zero |
| Host-agent usage | **absent** for the same reason (the host exposes no per-run token accounting to this subagent) |
