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
   (without command syntax, empty for a standard Tour). If `/codetour` supplied
   a `dialogueId`, pass it unchanged. Search for that exact
   tool name if deferred. It resolves the workspace, creates the guarded
   `runId` and returns the shared MCP prompt: follow it exactly, keeping that
   `runId` for creation and consolidation. If a generation prompt is already
   supplied, follow it directly instead of preparing another run. If the
   adapter tool fails, report its error and stop.
2. Only if the adapter tool is absent, use the MCP prompt directly: call
   `prompts/get` `generate_project_tour` for a Project Tour or
   `generate_changes_tour` for a Changes Tour, with the user's actual request
   as `request` (without the command prefix) and the orientation phrase as
   `brief`. For changes, pass the `reviewMode` already resolved in step 1.
   Preserve a supplied `runId`; omit it if none was given.
   Follow the returned prompt exactly. This is the same plugin workflow,
   not a separate method.
3. Create the Tour with the CodeTour MCP `create_project_tour` (or
   `create_changes_tour`) tool — never by
   writing `.tour` JSON by hand and never by answering in prose. Create and
   consolidate with the `runId` from the served prompt when one is given.
4. After the Tour, the consolidation step is mandatory: call `knowledge_save`
   with zero, one or more entries, or `knowledge_close_run` if the run is
   deliberately skipped. Report only what the MCP returned.
5. If the MCP server or its prompt is unavailable, say so and stop: give the
   repair command `codetour --install copilot` and point at
   `copilot mcp list`. A text answer is not a Tour.
