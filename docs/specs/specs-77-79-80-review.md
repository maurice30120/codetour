# Integration review: specs 77, 79 and 80

Reviewed on 2026-10-30 with the `code-review` skill, independently along
the Standards and Spec axes. Fixed comparison:
`git diff 17166ee...aa37007`; the base is the common reader/distribution
foundation before these three specs were implemented.

## Standards

No documented-standard violations or actionable heuristic smells were found.
Sources included `AGENTS.md`, the agent workflow documents, `CONTEXT.md`,
`GLOSSARY.md` and the relevant ADRs. Repository rules took precedence over
the skill's smell baseline.

The reviewer separately identified two defects in the audio smoke harness:

- **P2:** catching every `pgrep` error could report successful cleanup when
  process inspection was denied. Only exit status 1 establishes no matches.
- **P3:** the completion test retained its 30-second deadline after success;
  clear the deadline and release the engine on failure.

## Spec

Three P2 implementation gaps were established:

- **Quoted code fences:** spec 79 requires “Bloc de code” instead of source.
  A fenced block inside a Markdown blockquote was spoken as code text.
- **Voice activation during navigation:** spec 79 prohibits narration of
  stale or failed renders. Pressing V during an asynchronous transition used
  the requested step before its successful display.
- **Unreadable workspace:** spec 77 requires a missing or unreadable workspace
  to fail before the protocol starts. An execute-only directory could complete
  the MCP handshake.

No scope creep was found. Real Windows and fresh-machine acceptance evidence
remain separate from these code findings.

## Resolution

All five defects were fixed on `feature/specs-review-fixes` and integrated:

- `0b5b11e` — `fix(narration): narrate only committed steps and blockquoted code`
  resolves both spec 79 gaps: blockquote prefixes are stripped before fence
  matching, and enabling the voice during an asynchronous navigation defers
  narration until the requested step's render succeeds, so a step that fails
  validation is never spoken.
- `5ecf381` — `fix(mcp): an unreadable workspace fails before the handshake`
  resolves the spec 77 gap: startup now probes readability and actual
  enumeration, and a regression test drives the real CLI with an
  execute-only workspace.
- `b120d20` — `fix(test): only pgrep exit 1 proves no surviving voice; clear
  smoke deadlines` resolves both harness defects.

Each fix carries its regression test (`prepareText`, `readerNarration`,
mcp-server `cli`). The full suite on the integration branch after the merge
passes: 272 root tests (266 pass, 6 skipped platform-specific), 78
description-renderer tests, 163 mcp-server tests, 12 standalone-artifact
tests and 12 Copilot adapter tests. The real-host Copilot probe of the
immediate send mode remains to be repeated interactively; the adapter
contract is covered by `test/copilot-adapter.test.mjs`.

Initial findings: Standards 0; Spec 3. Additional validation-harness defects: 2.
All resolved.
