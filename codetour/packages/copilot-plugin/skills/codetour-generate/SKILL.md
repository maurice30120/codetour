---
name: codetour-generate
description: Generate a CodeTour Project Tour or Changes Tour by handing a JSON proposal to the CodeTour CLI. Use when the user asks to explain, tour or onboard onto a codebase, or to review the branch's changes, with CodeTour.
user-invocable: true
---

# CodeTour generation

This skill creates a real Tour file in the workspace with the `codetour` CLI.
The proposal travels on standard input, the CLI validates it against the
workspace, writes the Tour atomically, and answers with one JSON document. A
Tour is never written by hand and never replaced by prose.

`codetour` on `PATH` is the documented default. When the invocation carries a
`codetour-cli=<absolute invocation>` argument, run that value instead of
`codetour`, with the same arguments; nothing else changes. The reference modules
beside this file spell the CLI `<cli>`, and here `<cli>` is `codetour` unless
that argument says otherwise.

## 1. Resolve the choices

Honor what the user already said: "review my branch critically" means a Changes
Tour with `reviewMode: "critical"`, and nothing is asked twice. Ask only for
what is missing, once per question, and stop without generating if the user
cancels or declines; never silently default.

- **Type** — a **Project Tour** (architecture, structure and execution paths)
  or a **Changes Tour** (explain and review the branch's changes).
- **Review mode** — Changes Tours only: `neutral` (factual explanation) or
  `critical` (explanation plus review findings). Project Tours have none.
- **Orientation and language** — a phrase that orients the Tour ("focus on the
  rendering pipeline") is optional; it also sets the language the Tour is
  written in. Without one, write the Tour in the language of the user's request.

The type and the review mode select the reference module of the path. Read it
**before exploring**, and keep it read while you write: it carries that path's
route, its proposal fields and its creation command, and it completes the shared
rules below without repeating them.

| Path | Module |
| --- | --- |
| **Project Tour** | [references/project-tour.md](references/project-tour.md) |
| **Changes Tour**, `neutral` | [references/changes-tour-neutral.md](references/changes-tour-neutral.md) |
| **Changes Tour**, `critical` | [references/changes-tour-critical.md](references/changes-tour-critical.md) |

Only the critical module carries the review pack of a critical Changes Tour. A
Project Tour and a neutral Changes Tour never open it.

## 2. Work in the workspace root

Every command runs at the workspace root, and `--workspace` receives that root
as an absolute path (`git rev-parse --show-toplevel`, or the directory the user
named). One creation addresses one workspace: every anchor and the Tour file
itself stay inside it.

## 3. Build the proposal

### Mermaid diagrams

When adding a Mermaid diagram, read and follow [the Mermaid reference](references/mermaid.md) before building the proposal.

### Anchors

When adding anchors, read and follow [the anchor reference](references/anchors.md) before submitting the proposal.

One JSON object, with the fields the CLI validates:

- `title` (optional: the CLI defaults a Project Tour to `Project Overview` and
  a Changes Tour to `Changes on <branch>`), `description`, `fileName` (a bare
  name, written under `.tours/`), `steps` (at least one).
- A step carries a `title`, a Markdown `description`, and optionally one anchor:
  `file` with either `line` or `pattern`, `directory`, `selection`
  (`{start: {line, character}, end: {...}}`), `display: "diff"` with
  `baseFile`. A step without an anchor is explanatory, which is what the
  orientation step should be.
- `questions` (at most four short strings) attach the questions the reader
  should answer at that step.

`baseRef` and `headRef` are mandatory for every Changes Tour; `headRef` is the
full 40-character SHA of the analysed HEAD commit, never an abbreviation.
`includeUncommittedChanges` is `false` unless the local changes belong to the
comparison, and `reviewMode` is `neutral` or `critical`. The module of your path
shows the complete document of that path.

Explore the workspace before proposing anything and verify each anchor against
the applicable file version as described in the anchor reference.

With `includeUncommittedChanges` left at `false`, the Tour compares committed
state only: ground every claim in the committed diff and the files at `headRef`,
not the current working tree — dirty or untracked files can contain newer
behavior. From the workspace, read committed files with
`git show <headRef>:./<workspace-relative-path>` and compare with the merge-base
where needed. Never describe an excluded local change as committed, even if it
appears in the current skill or project files.

## 4. Hand the proposal over

Resolve the refs before writing the document — `git rev-parse HEAD` for
`headRef`, `git merge-base <base> HEAD` for a `baseRef` the user named as a
branch:

````sh
codetour create-project-tour --workspace "<absolute workspace root>" <<'JSON'
{"title": "…", "steps": [{"title": "…", "description": "…"}]}
JSON

codetour create-changes-tour --workspace "<absolute workspace root>" <<'JSON'
{
  "title": "Changes on feature/payments",
  "description": "What the branch changes, and what the review establishes.",
  "baseRef": "9f1c2d3e4b5a60718293a4b5c6d7e8f9012345ab",
  "headRef": "4a7d6f2c1b0e9d8c7b6a5f4e3d2c1b0a99887766",
  "includeUncommittedChanges": false,
  "reviewMode": "critical",
  "steps": [{ "title": "…", "description": "…" }]
}
JSON
````

`--proposal <file>` reads the proposal from a file instead of standard input;
both carry the same document.

Exit codes say what happened:

| Code | Meaning |
| --- | --- |
| `0` | the Tour was created; standard output holds the result document |
| `1` | the proposal, its validation or the creation was refused |
| `2` | usage or IO failure: missing or unknown argument, unusable workspace, unreadable proposal, explicit `--help` |

Standard output carries exactly one JSON document whenever a creation is
attempted, and a usage answer (`--help`, exit `2`) leaves it empty. Standard
error carries diagnostics only.

## 5. Handle the result

Success (`{"ok": true, …}`) reports `kind`, `title`, `tourPath` (absolute),
`stepCount` and `warnings`. Report the title and the path to the user, and read
the warnings: they are readability advice, not failures.

Refusal (`{"ok": false, "code": …, "message": …, "issues": [...]}`) wrote
nothing: fix **every** `issues` entry (`path` names the field, `message` says
what is wrong), then resubmit the corrected proposal. Do not retry the same
document and do not lower the Tour's quality to get past a validation.

Exit code `2` means the command line itself was unusable (a missing
`--workspace`, an unknown option, an unreadable proposal file). Report the
diagnostic; do not retry it blindly.

If `codetour` is missing, say so and stop: the generation needs the CLI on
`PATH`, and `codetour --install copilot` reinstalls this plugin when the skill
itself is missing. A text answer is not a Tour.

## 6. Hand the Tour over to a reader

Never replace the created Tour with a step list, an excerpt or a summary. Offer
the real readers, to run at the workspace root:

- Terminal — `codetour "<Tour title>"`, or
  `codetour --internal-tour "<tour path>"` to open the file directly;
- VS Code — `codetour --internal-open-vscode "<tour path>"`, which opens the
  Tour at its first step.

A reading failure is reported with the command to run manually; it never
invalidates the Tour that was created.
