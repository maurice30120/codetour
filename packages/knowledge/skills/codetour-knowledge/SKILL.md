---
name: codetour-knowledge
description: Create a CodeTour Project Tour in the current workspace, reusing verified CodeTour Knowledge as reference context and consolidating reusable findings afterwards. Use when the user asks to explain, tour, or onboard onto a codebase with CodeTour.
user-invocable: true
---

# CodeTour Knowledge tour

Create one CodeTour Project Tour for the user's request, grounded in the workspace's verified Knowledge when it exists, then make one explicit consolidation assessment. Write the Tour and your final answer in the language of the user's request.

## 1. Pin one explicit workspace root

Choose the single workspace root the Tour is about and resolve it to an absolute path. A request that names a directory decides the root; otherwise use the current directory. If the request spans several roots, or no directory is readable, **stop and ask the user which one root to use**; never guess, never mix roots and never fall back silently. Use that exact `$WORKSPACE_ROOT` for every `codetour knowledge` call, every `--workspace` argument and the `create_project_tour` call, so the CLI, the agent and the MCP all read and write the same workspace.

Check the two tools before starting:

- the `codetour` CLI answers `codetour knowledge list --workspace "$WORKSPACE_ROOT"`;
- the `create_project_tour` MCP tool is available.

If the CLI is missing, the MCP tool is missing, or the workspace is unusable (absent, unreadable, not a directory), report exactly which one failed and stop. A prose answer is not a Tour.

## 2. Discover the Knowledge catalogue

```sh
codetour knowledge list --workspace "$WORKSPACE_ROOT"
```

The command prints one JSON object. Read its `status`:

- `"empty"` (exit 3) means there is no Knowledge, or none matches the query: continue with normal exploration. This is not an error and must not stop the Tour.
- `"ok"` lists `{name, description}` entries only; no body is included.
- `"usage"` or `"error"` means the workspace is unusable or the CLI failed: report the exact JSON and stop.

Select only the entries whose `name` and `description` plausibly match the user's request. Do not read the whole catalogue by reflex.

## 3. Read only the selected entries

For each selected name:

```sh
codetour knowledge read <name> --workspace "$WORKSPACE_ROOT"
```

The JSON `status` decides what you may use:

- `"valid"`: the body is reference context.
- `"invalid"` (exit 4): the declared evidence no longer matches the workspace. Never use the body (the CLI does not return it) and never reconstruct it from another source. Report the entry name and reason when it matters to the request.
- `"absent"` (exit 3): the entry disappeared; skip it.

Use **ONLY** bodies whose read returned `"valid"` as reference context.

When at least one valid body is available, tell the user before writing the Tour:

« La Knowledge suivante a été validée pour l’instantané de code étudié. Utilise-la comme contexte de référence pour créer le Tour. Complète-la par une exploration ciblée uniquement si elle ne suffit pas à couvrir la demande ou à construire les étapes. »

Treat those bodies as prior verified work, not as a script. **Do not re-read or re-verify every cited source they cover.** Do not run a second, mandatory anchor-verification pass over the Tour: `create_project_tour` validates every anchor (file, line, pattern, selection) before writing and returns the errors to correct.

## 4. Explore only the gaps

Explore the workspace only where the valid Knowledge does not cover the request or cannot build the steps: a missing mechanism, a changed API, a file the request names, a range the Tour needs. Use `grep`, `glob` and targeted file reads, and stop as soon as the gap is filled.

Keep the work honest:

- if part of the request remains unsupported, say which part and why;
- if you inferred something rather than read it, mark it as an inference;
- keep partially covered areas visible instead of smoothing them over.

## 5. Create the Tour with the CodeTour MCP

Write the Tour directly with the existing `create_project_tour` tool of the CodeTour MCP server. Do not hand-write `.tour` JSON and do not substitute a chat answer.

- Follow the tool's schema and guidance, and write the Tour in the language of the request.
- Call it without `dryRun` when the steps are ready; use `dryRun: true` only to validate without writing.
- Report the Tour as created only after `create_project_tour` returns success, and give the confirmed path it returns so the user can open it.
- If validation fails, fix the reported issues and retry. If creation keeps failing, report the exact error and do not claim a Tour exists.

## 6. Consolidate explicitly, once

After the Tour is created (or after a reported failure), make one explicit consolidation assessment, then stop. Decide whether the work produced zero, one or more reusable Knowledge entries: a mechanism explanation, a non-obvious invariant, a procedure another request in this workspace would need again.

Never propose an entry for the Tour narrative itself, for a one-off answer, or for content already covered by a valid entry.

Describe each proposed entry as a JSON proposal:

```json
{
  "entries": [
    {
      "name": "canonical_identifier",
      "description": "One line a future agent can select on.",
      "body": "Markdown body, interpreted never executed.\n",
      "evidence": [{ "path": "relative/path.ts" }]
    }
  ]
}
```

An omitted `sha256` is computed from the cited bytes. Then run:

```sh
codetour knowledge save --workspace "$WORKSPACE_ROOT" --proposal <file>
```

Report what the CLI actually returned, using its status verbatim:

- `saved`: the listed entries were written;
- `no-op`: you proposed zero entries and nothing was written (a valid, explicit outcome);
- `conflict`: a same-named entry already exists and nothing was written;
- `invalid`: at least one entry was refused and nothing was written.

Never claim an entry was persisted unless the CLI answered `saved`. This instruction is a request, not a guarantee: no step enforces that this consolidation ran, so state what actually happened, including when you skipped it.

## Boundaries

- Never invoke the Research Harness (`codetour-research`) and never require a harness API key.
- Never create, select or run a Memory Function, and never write beneath `.tours/.memory/` by hand: consolidation goes through `codetour knowledge save` alone. Historical Memory artefacts remain untouched.
- Evidence validity is not semantic correctness. A `"valid"` read proves only that the declared SHA-256 evidence still matches the cited bytes; it does not prove the body is accurate, complete or the best explanation. Say so when the distinction matters.
