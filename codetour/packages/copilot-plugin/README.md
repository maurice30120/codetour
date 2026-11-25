# CodeTour Copilot plugin

This directory is the versioned **Agent Plugins 1.0** source of the CodeTour
integration for GitHub Copilot CLI. It is embedded in the standalone CodeTour
CLI and installed by:

```sh
codetour --install copilot
```

`copilot plugin install packages/copilot-plugin` installs the same directory
directly (the installed CLI supports local direct installs, with a deprecation
warning). `copilot plugin uninstall codetour` removes it.

## Contents

| Path | Role |
| --- | --- |
| `plugin.json` | Agent Plugins 1.0 manifest (`$schema`, name, version, metadata). |
| `skills/codetour-generate/SKILL.md` | The generation entry point: the CLI creation commands, the proposal shape and the failure handling. |
| `com.github.copilot/hooks/hooks.json` | Copilot `agentStop` hook declaration. |
| `com.github.copilot/hooks/agent-stop.mjs` | End-of-response summary: the created Tours and one token reading. It never blocks. |
| `com.github.copilot/lib/run-log.mjs` | The creation-journal and session-transcript readers the hook uses. |
| `skills/codetour-generate/references/` | Mermaid guidance and the critical-review pack a `critical` Changes Tour follows: the CodeTour adaptation, the verbatim upstream skill and its MIT license. |

The plugin declares no MCP server: generation is the CLI's work, and the hook
only reads what the CLI wrote (ADR 0057).

## Generation

`/codetour-generate`, or a plain request to explain the codebase or review the
branch, follows
[`skills/codetour-generate/SKILL.md`](skills/codetour-generate/SKILL.md): it
resolves the Tour type, the review mode (Changes Tours only) and the orientation
phrase, explores the workspace, then hands a JSON proposal to the installed CLI
from the workspace root:

```sh
codetour create-project-tour --workspace "<absolute workspace root>" < proposal.json
codetour create-changes-tour --workspace "<absolute workspace root>" < proposal.json
```

The CLI validates the proposal, writes the Tour atomically and answers with one
JSON document on standard output: `ok: true` with the absolute `tourPath`, or
`ok: false` with `code`, `message` and the `issues` to correct. Nothing needs to
be installed beside the CLI and no repository checkout is involved.

## The agentStop summary

The hook is purely informative. It reads two files it does not own and writes
one marker:

- the **creation journal** the CLI appends to after a successful write,
  `<workspace>/.tours/.log/creations/<createdAtMs>-<pid>-<rand>.json`, whose
  record carries the workspace, the absolute Tour path, the title, the kind, the
  creation time and the session identity of the creating process;
- the **session transcript** the Copilot CLI names in the hook payload
  (`transcriptPath`, the session's `events.jsonl`), for the response boundary
  and the token figures.

A Tour is reported only when its attribution is established: the payload
`sessionId` matches the record's session identity (a record without one, or
with another agent's host, is never attributed), the canonical workspace is the
payload `cwd`, and the record was created inside the current response —
between the last `user.message` and the stop. All attributed Tours are printed
with their absolute path, oldest first.

One token reading follows, for the response as a whole and never per Tour:

```text
CodeTour: 2 Tours created in this response
CodeTour: "Flux de facturation" — /workspace/.tours/billing.tour
CodeTour: "Revue critique des changements" — /workspace/.tours/review.tour
CodeTour: tokens 38,608 in (of which 18,818 cached reads, 19,784 cached writes), 23 out
```

- `inputTokens` already contains the cache reads and writes, so cache is shown
  as a part of the input total and is never added to it; `reasoningTokens` is a
  subset of the output.
- Figures the session never recorded are omitted; a window with no usage record
  says `tokens unavailable (…)`, never zero.
- A fallback boundary (no `user.message` in the transcript, the resumed-session
  case) labels the whole reading `(approximate)`.
- One reading per response: the hook writes
  `<workspace>/.tours/.log/creations/.reported/<sessionId>-<responseStartMs>`
  and stays silent on a second stop of the same response.

No creation identified means no output at all. The hook always exits 0 and
always answers `{}`: it never blocks, never asks for a continuation and never
calls a model. It cannot fail a creation — a journal it cannot read is a
diagnostic, and an unavailable token figure only shortens the summary.

## Requirements

- GitHub Copilot CLI 1.0.106 or later (verified with 1.0.114). The plugin relies
  on `${PLUGIN_ROOT}` expansion and on the `agentStop` hook payload
  (`sessionId`, `timestamp`, `cwd`, `transcriptPath`, `stopReason`,
  `stop_hook_active`).
- `codetour` on `PATH`: the skill runs the installed CLI from the workspace
  root, and no launcher is recorded in the plugin.
- Node on `PATH` for the hook command (`node "${PLUGIN_ROOT}/…"`).
- Session usage records in the transcript: without them the summary reports the
  tokens as unavailable.

### Verified limits

- The hook writes to stderr, as the previous hook did. On Copilot CLI 1.0.114
  stderr is not shown in prompt mode (`-p`) and the only honoured `agentStop`
  output is `{}` or a block decision, which would cost a model turn; the
  interactive TUI could not be exercised during recon. The summary is therefore
  produced on every stop but is not proven visible in every mode.
- `agentStop` is not guaranteed once per response (a `task_complete` stop adds
  one); the response marker is what keeps the reading single.
- The session events format is Copilot-internal, so every figure degrades to
  "unavailable" instead of failing the stop.
- macOS and Linux path handling uses Node APIs and has been exercised with
  spaces in the installed plugin path and the workspace path. Windows was not
  executed in this environment; the hook uses `exec`-free Node APIs and the
  declaration quotes `${PLUGIN_ROOT}`, but Windows remains unverified.
