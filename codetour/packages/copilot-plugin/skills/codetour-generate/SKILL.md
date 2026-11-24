---
name: codetour-generate
description: Generate a CodeTour Project Tour or Changes Tour through the shared CodeTour MCP server. Use when the user asks to explain, tour or onboard onto a codebase, or to review the branch's changes, with CodeTour.
user-invocable: true
---

# CodeTour generation entry point

This plugin is the primary CodeTour path for Copilot. The Tour instructions are
**not** copied here. They live once in the shared CodeTour MCP server and are
served per run by `prompts/get` (`generate_project_tour`). This skill only boots
a generation; it never restates a Tour method, never duplicates the
decomposition steps and never prescribes a second anchor or verification pass.

1. Resolve the user's choices before exploring the project. Honor choices
   already explicit in the command or in natural language: "review my branch
   critically" means `changes` and `critical`, with no questions to repeat.
   If the type is missing, use `ask_user` with two choices: **Project Tour**
   (architecture, structure and execution paths) or **Changes Tour** (explain
   and review the branch's changes). For a Changes Tour only, if the review
   mode is missing, use a second `ask_user` with **neutral** (factual
   explanation) or **critical** (explanation plus review findings). Present
   labels in the user's language. If a required choice is cancelled,
   declined or unresolved, stop without generating; never silently default.
   Project Tours have no review mode.
   Once resolved, call the extension tool `codetour_prepare_generation` with
   `type`, `reviewMode` for changes only, and the user's actual `request`
   (without command syntax, empty for a standard Tour). Search for that exact
   tool name if deferred. It resolves the workspace, creates the guarded
   `runId` and returns the shared MCP prompt: follow it exactly, keeping that
   `runId` for creation. If a generation prompt is already
   supplied, follow it directly instead of preparing another run. If the
   adapter tool fails, report its error and stop.
2. Only if the adapter tool is absent, use the MCP prompt
   directly: call `prompts/get` `generate_project_tour` with the user's actual
   request as `request` (without the command prefix) and the orientation
   phrase as `brief`, then follow the returned prompt exactly. This is the same
   plugin workflow, not a separate method. If `prompts/get` is not callable,
   use `get_generation_prompt` (step 5).
   **Changes Tour**: use the review mode already resolved in step 1.
   Call `prompts/get` `generate_changes_tour`
   with that `reviewMode`, the user's request and the `runId`, and follow the
   returned prompt. Project Tours never ask for a review mode.
   Also gather the PR/MR context first: `gh` (GitHub) or `glab` (GitLab) if
   installed, or the link the user gave. With no context, say so and never
   invent a title or goal.
3. Create the Tour with the CodeTour MCP `create_project_tour` (or
   `create_changes_tour`) tool — never by
   writing `.tour` JSON by hand and never by answering in prose. Create with the `runId` from the served prompt when one is given.
5. Hosts often give the agent no way to call `prompts/get` (only the adapter
   can). Then call the CodeTour tool `get_generation_prompt` (Copilot:
   `codetour-get_generation_prompt`) with `type` (`project` or `changes`),
   `reviewMode`, the user's request and any `runId`: it returns the same prompt,
   to follow exactly. Copilot may defer CodeTour tools: search for the
   `codetour-` prefix with the tool search before concluding they are missing.
   Once `get_generation_prompt` has returned, the contract is complete: your
   next tool call is the creation tool (`create_project_tour` or
   `create_changes_tour`) with the exact parameters (and `runId`, if one was
   given) that the prompt states. Do not search for tools again, do not call
   `get_generation_prompt` a second time and do not invent fallback calls; the
   creation tools you already resolved stay valid for the
   whole run.
   `runId` is optional: `get_generation_prompt` serves none (only the
   `/codetour` adapter creates one). Without one, omit `runId` from every call;
   never pass an empty string.
   Conclude a prompt is unavailable only after that call explicitly fails;
   if so, the creation tools alone carry the contract and may be used directly
   (omit `runId`). Still apply the language, review-mode rules.
6. Only if no CodeTour **tool** is found after that search, say so and stop:
   check `copilot mcp list` first and recommend a reinstall only if `codetour`
   is not listed; then give the repair command `codetour --install copilot` and point at
   `copilot mcp list`. A text answer is not a Tour.
