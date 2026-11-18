# PROTOCOL — spec #219 parcours A (frozen before the attempt)

Pre-registered bundle. Everything below was fixed **before** the single timed
attempt and is not edited afterwards. Deviations observed during the run are
recorded in `RECORDING.md`, never here.

## Frozen request (verbatim, from /tmp/spec-219-notes/frozen-request.md)

> Request (verbatim, EN): How does the Research Harness dispatch tool calls,
> validate memories and reject forged calls in this repository? The Tour should
> walk the CLI entry point, the explore model node, tool dispatch, forged-call
> rejection and the observation masking applied to tool results.

- Repository: `/Users/dhuyet/Documents/POC/codetour` (fork maurice30120/codetour)
- Pinned source commit: `2f1ebcf` (`spec-219-integration` == `origin/spec-174-integration`)
- Tour target: a Project Tour (`.tour`) explaining the harness tool-dispatch /
  memory-validation path above, created through the CodeTour MCP
  `create_project_tour` tool.
- Order of passage: A first (direct, this run), then B (harness delegating to
  the Research Harness), each exactly once, in isolated workspaces.

## Conditions frozen before the attempt

| Condition | Value |
| --- | --- |
| Workflow | Parcours A: direct agent + CodeTour MCP, **no Knowledge**, no Research Harness delegation |
| Source snapshot | commit `2f1ebcf` on branch `feature/spec-219/t221-parcours-a` (worktree) |
| Direct agent identity | Vibe subagent standing in for VS Code Copilot (`"direct agent = Mistral Vibe subagent (stand-in for VS Code Copilot)"`); the underlying subagent model is not exposed and is never claimed to be Copilot |
| Allowed tools during the attempt | ordinary file reads (`read_file`), `grep`/`ls` via `bash`, and the two CodeTour MCP calls (`dryRun`, then real). No research skill, no harness subprocess, no memory reads |
| Start point | wall-clock timestamp taken immediately **before** the first exploration call after the request is (re-)read |
| Finish point | first MCP response with `status: "created"`, or first fatal blocker |
| Attempts | exactly one direct attempt; retries after a failed MCP call are part of the same attempt and are counted |

## Evaluation criteria (human review of the created Tour)

1. **Opens** — the `.tour` file parses as JSON, matches the CodeTour schema
   (`schema.json`), and every file anchor resolves against the pinned commit.
2. **Covers the request** — the five requested topics appear as steps:
   CLI entry point, explore model node, tool dispatch, forged-call rejection,
   observation masking of tool results.
3. **Accuracy** — each explanation is checked against the actual code at the
   pinned commit; wrong claims, wrong anchors and invented facts count as
   defects and are reported in `RECORDING.md`.

## Honest-recording rules (binding)

- A missing prerequisite is a **recorded blocker**, never a result.
- Token metrics: Copilot-side usage is unavailable in this environment; the
  absence is recorded as *absent*, never as zero.
- Retries, validation rounds, and out-of-band knowledge (briefing notes read at
  session start) are stated explicitly, never hidden.
- If no Tour is usable at the finish point, status is recorded as failed and
  the real blocker is named; a usable Tour is never fabricated.
