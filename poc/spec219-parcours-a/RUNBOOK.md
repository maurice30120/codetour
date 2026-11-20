# RUNBOOK — parcours A (direct agent + CodeTour MCP), spec #219

One-shot procedure. Run it exactly once per source snapshot; a second attempt
under the same request invalidates the "single direct attempt" condition.

## Prerequisites

| Prerequisite | Verification | Failure handling |
| --- | --- | --- |
| Worktree at the pinned commit `2f1ebcf` on branch `feature/spec-219/t221-parcours-a` | `git -C /tmp/spec-219-wt/t221 rev-parse --short HEAD` → `2f1ebcf` | recreate the worktree; do not run on a different snapshot |
| CodeTour MCP connector enabled with tool `mcp_codetour.create_project_tour` | `search_tool_functions` best_match "codetour create project tour" returns the tool and connector status is `connected` | if disabled or failing: record the real blocker in `RECORDING.md` and **stop the run there** (missing prerequisite ≠ result) |
| No shared state with parcours B | the worktree is a dedicated `git worktree` (no `.tours/.memory` catalogue is read or written by the direct agent) | if B's traces, results or memory files are readable and used, the run is not direct — abort |
| VS Code Copilot | **NOT available in this environment** — the Vibe subagent is the recorded stand-in (`"direct agent = Mistral Vibe subagent (stand-in for VS Code Copilot)"`); this substitution is a recorded deviation | record, do not silent-fix |

## Exact commands / call sequence

1. **Start timing.** Capture ISO wall-clock immediately after re-reading the
   frozen request above.
2. Explore with ordinary tools only (`read_file`, `grep`, `ls`): the harness
   entry point `packages/exploration-poc/src/cli.ts`, the explore model node
   `packages/exploration-poc/src/explore.ts`, the dispatch chain and the
   masking helper `mask.ts`. Verify every anchor with `grep -n` at the pinned
   commit.
3. **Dry run.** Call `tools.mcp_codetour.create_project_tour` with `dryRun:
   true` and the composed steps. Expect `status: "validated"`; fix reported
   issues and re-run the dry run if not.
4. **Create.** Call the same tool **without** `dryRun` (same steps) — first
   response with `status: "created"` ends the timed phase.
5. **Move the artifact into the isolated worktree.** The MCP server writes the
   file into *its configured workspace root* (the main checkout, while
   parcours B still reads it). Immediately: copy the `.tour` into
   `poc/spec219-parcours-a/tours/` of this worktree, then delete the copy that
   the server left in the main checkout so parcours B cannot see the result.
6. Validate (`RECORDING-TEMPLATE.md` section 3): JSON parse + schema + anchor
   resolution + coverage + accuracy vs the real code.
7. Commit everything on `feature/spec-219/t221-parcours-a`.

## Timing points (what the recording reports)

- `start` — request receipt (re-read of the frozen request, before exploration).
- `finish` — first MCP `create_project_tour` response with `status: "created"`.
- Reported elapsed = finish − start. Post-validation and artifact moving happen
  after `finish` and are reported as validation details, not run time.
