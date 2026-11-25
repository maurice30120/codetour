---
name: codetour-generate
description: Create a CodeTour Project Tour or Changes Tour by exploring the workspace and submitting a JSON proposal to the CodeTour command line. Normally started from the /codetour command.
---

# CodeTour generation

Create exactly one Tour per request by handing a JSON proposal to the CodeTour
command line. The CLI validates the proposal, applies the workspace, Git, image,
Mermaid and confinement rules, and writes the `.tour` file atomically. This
skill never writes a `.tour` file, never edits an existing Tour, never answers
with a step list, an excerpt or a prose summary in place of the Tour, and calls
no tool of a server: the CLI does the work.

## Arguments

The `/codetour` command passes its choices as free-text arguments. They are
authoritative and are not command syntax to quote back.

- `type=project|changes` — the Tour kind.
- `reviewMode=neutral|critical` — Changes Tours only.
- `codetour-cli=[...]` — a JSON array of argv words: the CodeTour CLI installed
  with `codetour --install pi`. Run exactly those words. Without this argument,
  run `codetour` from `PATH`.
- `request=...` — the user's own words; always the last argument.

Resolve what is missing before exploring, and honour what the command or the
natural language already states: "review my branch critically" means `changes`
with `critical`, with no question to repeat.

- Type missing: ask once — **Project Tour** (architecture, structure and
  execution paths) or **Changes Tour** (understand or review the branch's
  changes).
- Changes Tour review mode missing: ask once — **neutral** (factual
  explanation) or **critical** (explanation plus review findings, following the
  method in `references/`).
- Present the labels in the user's language. Never default silently, and stop
  without creating anything when a required choice is cancelled or unresolved.

Project Tours have no review mode.

## The critical review method

A `critical` Changes Tour follows the pack filed in `references/` beside this
file. Read it before exploring, and keep it read while writing:

- `references/codetour-adaptation.md` — the two axes (standards and spec), the
  step integration and the honesty rules of a critical Tour;
- `references/upstream-code-review.md` — the upstream skill the adaptation is
  based on, kept verbatim;
- `references/upstream-LICENSE.txt` — its MIT license, kept verbatim.

Without that reading the mode would only be a word. A `neutral` Changes Tour
and every Project Tour never open the pack.

## Orientation, language and workspace

- **Orientation**: the user's stated goal scopes the Tour. Honour it instead of
  asking again what is already explicit.
- **Language**: write the title, the description and every step in the
  user's language — not the language of the code, of the commit messages or of
  this document.
- **Workspace**: choose it at generation time. Default to the workspace root of
  the session; when the user names another project, pass that directory. Every
  creation takes an explicit `--workspace <dir>`, and nothing is written
  outside it.

## 1. Explore before writing

Read the entry points and the main modules, not just the file names, and base
every statement on the code you read.

- **Project Tour**: follow one coherent route from the project's purpose and
  entry points through its key components and how they collaborate. Anchor each
  claim at the code that justifies it. Choose representative files rather than
  listing every module.
- **Changes Tour**: inspect the actual comparison — the diff from the merge-base
  to `HEAD`, the affected source and the tests. Group related changes into one
  review path anchored at the changed lines. Report test coverage factually and
  never claim a test result you did not observe. When uncommitted changes are
  excluded, ground every claim about the comparison in the committed diff and
  files at `headRef`, not the current working tree: dirty or untracked files can
  contain newer behavior. From the workspace, read committed files with
  `git show <headRef>:./<workspace-relative-path>` and compare with the
  merge-base where needed. Never describe an excluded local change as committed,
  even if it appears in the current skill or project files.

## 2. Build the proposal

### Mermaid diagrams

When adding a Mermaid diagram, read and follow [the Mermaid reference](references/mermaid.md) before building the proposal.

### Anchors

When adding anchors, read and follow [the anchor reference](references/anchors.md) before submitting the proposal.

One JSON document. A Project Tour:

```json
{
  "title": "Payment flow",
  "description": "Markdown summary of the Tour.",
  "fileName": "payment.tour",
  "steps": [
    { "title": "Overview", "description": "**Diagram — Context view**\n\n```mermaid\nflowchart LR\n  Client -->|\"pays (HTTPS)\"| API\n```" },
    { "title": "Entry point", "description": "Markdown explanation.", "file": "src/server.ts", "pattern": "export function createServer" }
  ]
}
```

A Changes Tour is the same document plus:

```json
{
  "baseRef": "<branch, tag or merge-base SHA>",
  "headRef": "<full 40-character HEAD SHA>",
  "includeUncommittedChanges": false,
  "reviewMode": "neutral"
}
```

Step fields: `description` (required, Markdown), `title`, `questions` (at most
four non-empty strings, in the user's language), `file`, `line`, `pattern`,
`selection`, `directory`, `baseFile`, `display`.

The CLI enforces these rules, and a rejected proposal writes nothing:

- a Mermaid fence carries its caption on the nearest non-blank line above it,
  such as `**Diagram — Context view**`;
- at most one locator per step: `file` or `directory`, relative to the
  workspace root;
- `line`, `pattern` and `selection` only with `file`; `line` and `pattern` are
  mutually exclusive;
- `pattern` is a short literal copied from one line and matching exactly once in
  the file — escape regular-expression metacharacters or use a verified `line`;
- `questions` at most four non-empty strings;
- a Changes Tour needs `baseRef` and the full 40-character `headRef` SHA.

Two readability rules are warnings, never refusals: the first step should be a
locator-free orientation step (no `file`, no `directory`) with at least one
Mermaid diagram, and that first diagram should stay small enough to read. The
success document lists them; the Tour is still created.

Optional `fileName` is a bare name (no path separator): the Tour is always
written under `.tours/`, `.tours/project.tour` or `.tours/changes.tour` by
default.

## 3. Create the Tour

Run the command through your shell tool, from the workspace root — the CLI
records the Pi session only when the host exported it to that shell:

```sh
<cli> create-project-tour --workspace . --proposal -
<cli> create-changes-tour --workspace . --proposal -
```

`<cli>` is the `codetour-cli` argument when given, `codetour` otherwise; quote
each argv word so a path with spaces stays one word. Pipe the proposal on
standard input, or write it to a file and pass `--proposal <file>` when the
document is large. Standard output carries exactly one JSON document whenever a
creation is attempted, and a usage answer (`--help`, exit `2`) leaves it empty;
standard error carries diagnostics only.

## 4. Read the result

- Exit `0` with `{"ok":true,"kind","tourPath","title","stepCount","warnings"}`:
  the Tour exists at `tourPath`. Report its title and path in one line and do
  not describe it again.
- Exit `1` with `{"ok":false,"code","message","issues":[{"path","message"}]}`:
  nothing was written. Correct every reported `path`, rebuild the proposal and
  run the command again. Never claim a Tour was created.
- Exit `2`: the command line or the proposal file is unusable — a missing
  `--workspace`, an unreadable proposal file, or an explicit `--help`. Fix the
  invocation instead of retrying blindly; standard output holds no result
  document.
- `warnings` on a success are advisory: mention them in one line at most.

## 5. Hand over to a reader

The extension reports the Tours it attributed to this response and offers
**Terminal** or **VS Code**; do not duplicate that question when it did.
Otherwise offer, to run at the workspace root:

- `codetour "<Tour title>"` for the interactive terminal reader, or
  `codetour --internal-tour "<tour path>"` without a title;
- `codetour --internal-open-vscode "<tour path>"` for VS Code.

Never replace the Tour with a step list, an excerpt or a prose summary.

## When the CLI cannot run

If the command fails because it cannot be found, the CLI is not on `PATH` and no
`codetour-cli` argument was supplied: say so, recommend `codetour --install pi`
to reinstall the integration, and stop. A text answer is not a Tour.
