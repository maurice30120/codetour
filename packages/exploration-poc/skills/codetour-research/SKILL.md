---
name: codetour-research
description: Generate a Project Tour using CodeTour's delegated research harness and its procedural memory.
user-invocable: true
disable-model-invocation: true
---

# CodeTour research

Create a Project Tour for the user's objective. You own the overall decomposition and narrative; the CodeTour research harness answers individual questions, and the existing CodeTour MCP validates and writes the Tour. Keep the requested language for the Tour and your response.

1. Select the target workspace root. In a multi-root workspace, require the user to select one root before running anything. Resolve it to an absolute directory and use that same root for every research call and the MCP call. Check that the terminal, `codetour-research`, and `create_project_tour` are available. If the terminal is denied, the executable is missing, or the CLI reports a missing model key, inaccessible workspace, sandbox, or other preflight error, report the actual failure and stop; do not substitute an unrecorded exploration or claim success.
2. State a brief plan of independent, useful functional questions that together address the objective. Choose their scope from the problem, not a fixed count or one question per file. Delegate each substantial investigation **sequentially** using the installed CLI:

   ```sh
   codetour-research --workspace "$WORKSPACE_ROOT" --code --memory "$QUESTION"
   ```

   Pass the actual absolute root and one question as separate, safely quoted arguments; do not interpolate user text into shell syntax. Wait for each JSON result before starting the next call. Use the same workspace so all calls share `.tours/memory/`. If a result is partial or failed, retain its status and uncertainties; request a targeted follow-up only for a gap that matters, or explain the limitation. Do not repeat a sufficient answer. Direct file reads are allowed for targeted verification; record what was checked and why. Substantial research belongs in the harness.
3. Assemble the answers into a coherent Tour: explain functional relationships and progression, preserve supporting file, line and revision references, and carry forward uncertainty. Do not invent anchors or promote incomplete results to complete evidence. Follow the `create_project_tour` tool's current schema and guidance. First call it with `dryRun: true`; correct reported issues and call it again without `dryRun` to write. Report a `.tour` as created only when the write succeeds, and give its confirmed path so it can be opened in VS Code.
4. Produce a concise diagnostic report alongside the result, for example under `.tours/research-reports/`, correlating a unique Tour identifier and confirmed Tour path with each question identifier and CLI `runId`. For each run, report its status, relevant `callTrace` and `consolidationReport` observations: function identity, actual execution, validation, persistence or refusal, and the observed reason when present. Point to the rotating `.tours/.log/` logs by run ID for details. Record the skill version or file revision, model, elapsed time, observed token counts and `usageAvailable`; label unavailable counters rather than adding an invented total. Avoid recording credentials; free text in logs is not guaranteed secret-free.
5. In that report separate observed facts, inferences and unmeasurable information. Use Copilot tool history to identify direct reads when available; otherwise mark direct research **not measurable**, never zero. Assess delegation separately from Tour quality: substantial research performed mainly outside the harness fails delegation even if a Tour was written. Structural citation validation establishes that lines exist, not that their interpretation is correct; identify semantic review as a separate check. Do not claim learning from a proposed or attempted function: require evidence of persistence and a later `memory_run` execution of the same identity. Include an honest outcome when evidence or telemetry is missing.
