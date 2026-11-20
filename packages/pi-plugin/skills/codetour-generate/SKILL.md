---
name: codetour-generate
description: Generate a CodeTour Project Tour or Changes Tour through the shared CodeTour MCP server. Use when the user asks to explain, tour or onboard onto a codebase, or to review the branch's changes, with CodeTour.
---

# CodeTour generation entry point

This skill is the Pi entry point of the CodeTour package. The Tour instructions
are **not** copied here: they live once in the shared CodeTour MCP server and
are served per run by `get_generation_prompt`. This skill only boots a
generation; it never restates a Tour method, never duplicates the decomposition
steps and never prescribes a second anchor or verification pass.

The CodeTour tools are declared by the `codetour` MCP server. In Pi they are
named `mcp__codetour__<tool>`: `mcp__codetour__get_generation_prompt`,
`mcp__codetour__create_project_tour`, `mcp__codetour__create_changes_tour`,
`mcp__codetour__knowledge_list`, `mcp__codetour__knowledge_read`,
`mcp__codetour__knowledge_save`, `mcp__codetour__knowledge_close_run`. Use tool
search if they are not declared, and search for the `codetour` server name
before concluding they are missing.

1. Resolve the user's choices before exploring the project. Honor choices
   already explicit in the command or in natural language: "review my branch
   critically" means `changes` and `critical`, with no questions to repeat.
   The `/codetour` command normally supplies them as `type=…`, `reviewMode=…`,
   `runId=…` and `request=…` arguments; those arguments are authoritative and
   are not command syntax to quote back. If the type is still missing, ask the
   user with a short question offering **Project Tour** (architecture,
   structure and execution paths) or **Changes Tour** (explain and review the
   branch's changes). For a Changes Tour only, if the review mode is missing,
   ask once for **neutral** (factual explanation) or **critical** (explanation
   plus review findings). Present labels in the user's language. If a required
   choice is cancelled, declined or unresolved, stop without generating; never
   silently default. Project Tours have no review mode.
2. If a `runId` was given, keep it for every call of this run and never invent
   another one. If none was given, omit `runId` from every call and never pass
   an empty string.
3. Call `mcp__codetour__get_generation_prompt` with `type` (`project` or
   `changes`), `reviewMode` for changes only, the user's actual `request` (the
   `request=` argument without the command syntax, empty for a standard Tour)
   and the `runId` when you have one. Follow the returned prompt exactly. If
   that call explicitly fails, the creation tools alone carry the contract: use
   them directly with the same choices, the same `runId` and the language,
   review-mode and consolidation rules below.
4. Create the Tour with `mcp__codetour__create_project_tour` (or
   `mcp__codetour__create_changes_tour`) — never by writing `.tour` JSON by hand
   and never by answering in prose. Pass the `runId` when you have one.
5. After the Tour, the consolidation step is mandatory: call
   `mcp__codetour__knowledge_save` with zero, one or more entries, or
   `mcp__codetour__knowledge_close_run` if the run is deliberately skipped. Save
   only durable facts (verified invariants, architecture, conventions), never
   details specific to this tour. With zero entries, state why nothing durable
   qualified. Report only what the MCP returned.
6. Pass the same `runId` to `mcp__codetour__knowledge_list` and
   `mcp__codetour__knowledge_read` when you use them: the MCP then records the
   verified catalogue and the entries this run actually read. Never re-read
   every cited source, and never verify an anchor a second time: the MCP
   already validates both.
7. Only if no CodeTour tool is found after that search, say so and stop. The
   CodeTour server is registered by the package's extension, so diagnose it in
   the session: `/mcp` must list `codetour` with the extension as its source
   (`pi mcp list` cannot show it, because shell commands do not load
   extensions). If Pi reports that no loaded extension connects MCP servers,
   the built-in MCP support is disabled: re-enable it with `pi config`
   (Built-in → mcp) or drop `-builtin:mcp` from the settings. Recommend a
   reinstall only if `/mcp` shows no `codetour` server at all, with the repair
   command `codetour --install pi`. A text answer is not a Tour.
