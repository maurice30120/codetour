---
name: codetour-generate
description: Generate a CodeTour Project Tour through the shared CodeTour MCP server. Use when the user asks to explain, tour or onboard onto a codebase with CodeTour.
user-invocable: true
---

# CodeTour generation entry point

This plugin is the primary CodeTour path for Copilot. The Tour instructions are
**not** copied here. They live once in the shared CodeTour MCP server and are
served per run by `prompts/get` (`generate_project_tour`). This skill only boots
a generation; it never restates a Tour method, never duplicates the
decomposition steps and never prescribes a second anchor or verification pass.

1. Prefer `/codetour generate project <request>`. The controlled adapter
   resolves one workspace, fetches the composed prompt from the MCP **before**
   contacting the agent, and starts a guarded generation run. Do not
   re-implement that wrapper.
2. If the host does not dispatch `/codetour generate`, use the MCP prompt
   directly: call `prompts/get` `generate_project_tour` with the user's actual
   request as `request` (without the command prefix) and the orientation
   phrase as `brief`, then follow the returned prompt exactly. This is the same
   plugin workflow, not a separate method.
3. Create the Tour with the CodeTour MCP `create_project_tour` tool — never by
   writing `.tour` JSON by hand and never by answering in prose. Create and
   consolidate with the `runId` from the served prompt when one is given.
4. After the Tour, the consolidation step is mandatory: call `knowledge_save`
   with zero, one or more entries, or `knowledge_close_run` if the run is
   deliberately skipped. Report only what the MCP returned.
5. If the MCP server or its prompt is unavailable, say so and stop: give the
   repair command `codetour --install copilot` and point at
   `copilot mcp list`. A text answer is not a Tour.
