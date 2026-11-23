# codetour-mcp

A local MCP (Model Context Protocol) server that lets an AI agent create
[CodeTour](https://github.com/microsoft/codetour) tours deterministically.
The agent analyzes the code and writes the explanations; the server validates
the proposal, applies the Git and security rules, and atomically replaces the
reserved tour file.

Two specialized Tour creation tools are exposed, next to the four Knowledge
tools of spec #223:

- `create_project_tour` — a **Project Tour** that explains a codebase as a
  whole, written to `.tours/project.tour`.
- `create_changes_tour` — a **Changes Tour** that explains the committed
  changes on a branch since it diverged from a base ref, written to
  `.tours/changes.tour`.
- `knowledge_list`, `knowledge_read`, `knowledge_save`,
  `knowledge_close_run` — discovery, verified reading, deterministic
  consolidation and an explicit skip closure over the workspace Knowledge
  catalogue under `.tours/.memory/knowledge/`.

Both outputs are compatible with the general CodeTour schema, within a
deliberately stricter V1 subset: explanatory Markdown and workspace-internal
locations only. CodeTour `commands`, root-level `when` expressions, external
`uri` steps, and active Markdown schemes (`command:`, `file:`, `vscode:`,
`vscode-insiders:`, `javascript:`) are rejected.

Mermaid diagrams are optional and validated before either tool writes a Tour.
The MCP server reuses the exact fence rules and locked Mermaid implementation
from `codetour-description-renderer`, so the Tour Generator and playback apply
the same contract. Validation is local and offline.

## Requirements

- Node.js >= 18
- Git (only for `create_changes_tour`)

## Quick start

From the repository root, build the two shared packages first, then install
the MCP server dependencies and verify the package:

```bash
cd packages/description-renderer
npm install
npm run build
cd ../knowledge
npm install
npm run build
cd ../mcp-server
npm install
npm test
```

`npm test` compiles the package and runs the full test suite. You can then
start the server from a workspace:

```bash
cd /path/to/workspace
node /path/to/codetour/packages/mcp-server/dist/src/main.js
```

The process speaks MCP over `stdio` and silently waits for requests from an
MCP client. Use `Ctrl+C` to stop it when started manually.

The process working directory is the workspace. One server instance handles
exactly this workspace and every operation stays confined to it: real paths
are resolved before any read or write, symlinks that escape the root are
rejected, and the server performs no network access.

The package exposes the `codetour-mcp` binary, available after `npm install`
or `npm link`. To make this binary globally available during local
development:

```bash
npm link
cd /path/to/workspace
codetour-mcp
```

The server serves exactly one workspace: the process working directory. When
your MCP client cannot control the working directory of the launched process,
pass the workspace explicitly instead:

```bash
codetour-mcp --workspace-root /path/to/workspace
```

The standalone CodeTour distribution exposes the same server through its
packaged launcher, without a global Node.js installation:

```bash
/path/to/codetour-distribution/codetour mcp [--workspace-root /path/to/workspace]
```

See the [standalone distribution guide](../../docs/standalone-distribution.md)
for the packaged-launcher client configuration shape.

Finally, configure your MCP client with the command and its working directory,
as in the example below. Once connected, the client automatically discovers
`create_project_tour`, `create_changes_tour`, `knowledge_list`,
`knowledge_read`, `knowledge_save` and `knowledge_close_run`.

## MCP client configuration

```json
{
  "mcpServers": {
    "codetour": {
      "command": "node",
      "args": ["/path/to/codetour/packages/mcp-server/dist/src/main.js"],
      "cwd": "/path/to/workspace"
    }
  }
}
```

The transport is `stdio` only.

Both tools accept an optional `workspacePath`, relative to the workspace root
(the process working directory, or the directory passed to
`--workspace-root`). Use it when the workspace contains several
projects or Git repositories, for example `"workspacePath": "my-project"`.
Step anchors and the generated `.tours/` file are relative to that directory
for this call; the returned path stays relative to the configured root.
Absolute paths, missing directories, and paths escaping the root are
rejected.

### Codex configuration

The VS Code extension provides the `CodeTour IA: Configure MCP for Codex` and
`CodeTour IA: Repair MCP Configuration for Codex` commands. The first one
installs the global configuration when missing; the second replaces an
outdated configuration, notably after an extension update.

For a development build not installed from a VSIX, the manual equivalent is:

```bash
codex mcp add codetour -- \
  node /path/to/codetour/dist/mcp-server.js
```

No manually started process needs to be kept around: Codex starts the `stdio`
server automatically. Verify the configuration with:

```bash
codex mcp get codetour
```

New Codex tasks start the server in their own working directory, so a single
global configuration covers all projects.

To generate the general project tour, ask for example:

```text
Analyze this repository, then use the codetour.create_project_tour MCP tool to
generate a Project Tour. Present the project's purpose, its entry points, its
important components and its main execution flows. Start with an unanchored
orientation step that maps the system context and its real execution or storage
boundaries, then descend into the relevant directories and files. Use stable
anchors in files whenever possible.
```

To scope the Project Tour to a subdirectory, name it explicitly in the request.
The first step must then use that path in its `directory` field, relative to
the workspace root.

The result is written to `.tours/project.tour`.

To document the changes of the current branch:

```text
Analyze the committed changes of this branch since its base branch, then use
codetour.create_changes_tour to create a Changes Tour. Determine the base
reference and use the full SHA of the current HEAD. Do not include uncommitted
modifications.
```

The result is written to `.tours/changes.tour`.

## Tools

### `create_project_tour`

| Argument      | Type     | Required | Description                                             |
| ------------- | -------- | -------- | ------------------------------------------------------- |
| `title`       | string   | no       | Defaults to `Project Overview`.                         |
| `description` | string   | no       | Optional tour description.                              |
| `steps`       | object[] | yes      | Non-empty list of steps (see below).                    |
| `workspacePath` | string | no       | Optional directory relative to the workspace root; anchors and the generated `.tours` file resolve inside it for this call. |

A good Project Tour covers the project's purpose, its main entry points, its
important components, and its main execution flows. Its first step is an
explicitly titled orientation step without a `file` or `directory` locator. The
description starts with two or three sentences explaining what the system does
and for whom, followed by `**Diagram — Vue contexte**` and a Mermaid `flowchart`
of actors, the system, and external systems. Every relationship names an
interaction and its mechanism. Include a second `flowchart`, captioned
`**Diagram — Conteneurs**`, only when the code establishes more than one real
execution or storage boundary, then map each zone to workspace directories with
relative Markdown links.

The full C4 wording — the actor, system, external system, and container
definitions, the boundary evidence rules, and the diagram conventions — lives
only in the `create_project_tour` tool description, which is the authoritative
guidance given to the agent; this README deliberately does not duplicate it. The
server backs that guidance with advisory warnings
(`ORIENTATION_STEP_MISSING_OVERVIEW`, `ORIENTATION_STEP_DIAGRAM_TOO_LARGE`) when
the first step is not a locator-free orientation step or its first diagram
exceeds the recommended node count. The following steps descend into the
relevant directories and files.

### `create_changes_tour`

| Argument             | Type     | Required | Description                                                   |
| -------------------- | -------- | -------- | ------------------------------------------------------------- |
| `baseRef`             | string   | yes      | Git ref the branch diverged from.                             |
| `headRef`             | string   | yes      | Full 40-character SHA of the analyzed commit; must equal the current `HEAD`. |
| `includeUncommittedChanges` | boolean  | no       | Include uncommitted changes explicitly (default `false`).     |
| `reviewMode`         | string   | no       | `"neutral"` (default) or `"critical"`; for `"critical"` read the `codetour://review/critical-instructions` resource before writing the steps. Not persisted in the tour file. |
| `title`              | string   | no       | Defaults to `Changes on <branch>`.                            |
| `description`        | string   | no       | Optional description; provenance is always appended.          |
| `steps`              | object[] | yes      | Non-empty list of steps (see below).                          |
| `workspacePath`      | string   | no       | Optional directory relative to the workspace root; anchors and the generated `.tours` file resolve inside it for this call. |

A good Changes Tour covers the intent of the changes, the major
modifications, their impact, and the relevant tests.

The server also exposes one resource, `codetour://review/critical-instructions`,
which serves the critical review skill pack (the CodeTour adaptation of Matt
Pocock's `code-review` skill, the upstream text verbatim, its source revision,
and the MIT license). An agent generating a critical Changes Tour must read it
before writing any step; see [the critical review skill
documentation](../../docs/critical-review-skill.md) for provenance, licensing,
contents, and limits. Omitting `reviewMode` keeps the neutral, factual
behavior; the server never asks a conversational question, so direct callers
always get the neutral default.

A committed-only Changes Tour is reproducible: the resolved merge-base SHA is
persisted in `baseRef` and the analyzed head SHA in `ref`. File steps are
automatically marked with `display: "diff"` so VS Code opens the Git diff
between the two commits; added files have an empty left side, and renamed files
record the original path in `baseFile`. At least one step must anchor a file
that the comparison modified and that still exists in the analyzed snapshot;
the server rejects a proposal without one (`MISSING_CHANGED_FILE_ANCHOR`).
Deleted files must be explained by steps without a locator, and a
deletion-only branch is exempt because it has no anchorable changed file.
When `includeUncommittedChanges: true` actually includes local changes,
anchors are checked against the current workspace, the tour has no `ref`, and
file steps open the current files.

### Steps

| Field         | Type   | Description                                                                  |
| ------------- | ------ | ---------------------------------------------------------------------------- |
| `title`       | string | Optional step title.                                                         |
| `description` | string | Required Markdown explanation.                                               |
| `file`        | string | Workspace-relative path; at most one of `file`/`directory` per step.         |
| `directory`   | string | Workspace-relative path; use for structural overview steps and at most one of `file`/`directory` per step. |
| `line`        | number | 1-based line; only valid with `file`, mutually exclusive with `pattern`.     |
| `pattern`     | string | Regular expression matching exactly one occurrence; only valid with `file`. Prefer a short literal substring copied from the file, escaping regex metacharacters when present. |
| `selection`   | object | `{ start: {line, character}, end: {line, character} }`, 1-based; only valid with `file`. |
| `baseFile`    | string | Workspace-relative path of the file at `baseRef` when it was renamed; `file` is the path at `ref`. Requires `file`. |
| `display`     | string | `"diff"`: open the Git diff between `baseRef` and `ref`. Requires `file`. |

Steps without any locator are allowed (general context, deleted files).
Every anchor is validated against the real workspace state. All validation
errors are aggregated and reported in a single response; the previous tour
file is preserved on failure.

### Mermaid diagrams

Use Mermaid sparingly: include a diagram only when it materially clarifies a
relationship or flow. A diagram must use a bare fence with `mermaid` as its
info string. The nearest non-blank line before that fence must be a visible caption matching
`**Diagram — …**` (an em dash, with one or more descriptive characters). Blank
lines between the caption and fence are allowed; other Markdown content breaks
the caption association.

The exact allowlist is `flowchart`, `sequenceDiagram`, `stateDiagram-v2`,
`classDiagram`, and `erDiagram`. Each individual description (the Tour
description and each step description are separate descriptions) accepts at
most three Mermaid fences, and each source is at most 20 KiB measured as UTF-8
bytes. Mermaid syntax is parsed locally using the same locked version as
playback. A malformed caption, unsupported kind, oversized source, invalid
syntax, or fourth-and-later fence rejects the complete tool call.

Diagram issues use paths such as
`steps[1].description.mermaid[0].source`; the path identifies the description,
fence index, and failing field. Every issue also reports the fence's starting
line and column. All descriptions are checked in one call, and no Tour file is
written when any diagram or ordinary Tour validation fails.

### Knowledge tools

The server exposes the same Knowledge contract as the native
`codetour knowledge` CLI, from the shared `codetour-knowledge` package: no
format, hash or conflict rule is reimplemented here. The catalogue is the
fixed location `<workspace>/.tours/.memory/knowledge/`; all four tools accept
the optional `workspacePath` (a directory relative to the configured workspace
root, resolved with the same confinement as the Tour tools) and always stay
inside the workspace.

#### `knowledge_list`

| Argument        | Type   | Required | Description                                                      |
| --------------- | ------ | -------- | ----------------------------------------------------------------- |
| `workspacePath` | string | no       | Directory relative to the configured workspace root.              |
| `query`         | string | no       | Literal, case-insensitive substring of a name or description.     |
| `limit`         | number | no       | Page size, 1–200; defaults to 50.                                 |
| `offset`        | number | no       | Number of matching entries to skip; defaults to 0.                |

Returns metadata only — `entries: [{name, description, revision,
daughterNames?, daughtersOmitted?}]` — never a body, evidence, a cited path or a
hash. `revision` is the entry file's Knowledge Revision, an opaque token that
stays identical while the file is unchanged and moves with any modified byte
(ADR 0053). Only verified contracts are listed: discovery runs the same evidence
verification as `knowledge_read` (ADR 0044). A Composed Knowledge Entry — one
whose frontmatter declares `dependencies` — adds its daughters' names, in
declared order, and never their revisions, proofs or bodies; the row names at
most three of them, and `daughtersOmitted` states how many it left out, so a
long declaration never produces a long catalogue row. Each daughter keeps her own
row. Every catalogue entry that fails validation is returned under `invalid:
[{name, reason, revision?, via?}]` — the file stem when no servable name is
declared, the revision whenever the entry file itself was readable, so a repair
write can be conditioned on it, and `via`, the faulty daughter of the refusing
level when the reason describes a dependency step — listed in full regardless of
the query, so it can be fixed or removed instead of being hidden.
The name is the identifier. `total` is the
number of matches in the whole filtered catalogue, and `truncated` is true only
when matching entries remain after this page
(`offset + entries.length < total`), so paging is explicit and the last page is
complete. A missing or
empty catalogue (or a query with no match) is a normal `status: "empty"`
result with HTTP-style success semantics (`isError` false), not an error.

#### `knowledge_read`

| Argument        | Type   | Required | Description                              |
| --------------- | ------ | -------- | ---------------------------------------- |
| `name`          | string | yes      | Name (identifier) of the entry to read.   |
| `workspacePath` | string | no       | Directory relative to the workspace root. |

Returns `status: "valid"` with the Markdown `body`, its `evidence` and the
entry's `revision` only when **every** declared `file` proof verifies: the cited
path stays inside the workspace, no symbolic link escapes it, and each file's
bytes hash to the declared SHA-256. A Composed Knowledge Entry verifies more: each
declared daughter's file must still hash to the pinned revision and her own whole
contract must hold, transitively, within the composition and node bounds — and
her body is still never served with her mother's. `revision` is the root-level Knowledge
Revision of the entry file (ADR 0053): a write can be conditioned on it, so a
file that changed since the read is refused instead of silently overwritten.
Otherwise it returns `status: "invalid"` with one machine-readable reason, the
`revision` whenever the entry file was readable, and no body, no cited path and
no hash value:

| Reason                    | Meaning                                                        |
| ------------------------- | -------------------------------------------------------------- |
| `file_hash_mismatch`      | The cited bytes no longer match the declared SHA-256.          |
| `file_missing`            | The cited file no longer exists or is not a regular file.      |
| `unsupported_proof`       | The entry declares a `symbol` proof (not supported).           |
| `path_outside_workspace`  | The cited path is absolute, escapes the workspace, or is malformed. |
| `symlink_escape`          | The cited path resolves outside the workspace through a link.  |
| `malformed_contract`      | The frontmatter or the body does not follow the contract.      |
| `dependency_missing`      | A declared daughter is absent from the catalogue (`via` names her). |
| `dependency_invalid`      | A declared daughter's own read refuses (`via` names her).      |
| `dependency_cycle`        | A declared daughter is already one of her ancestors (`via` names her). |
| `dependency_depth_exceeded` | The declared graph is deeper than the composition bound (`via` names the daughter past it). |
| `dependency_node_limit_exceeded` | The declared graph verifies more entries than the node bound allows (`via` names the first daughter over it, who was never read). |
| `unknown_entry`           | Rendered as `status: "absent"` (an explicit absence, not an error). |

The dependency reasons describe the step that failed, never the daughter's own
cause — saying `unknown_entry` of an entry that exists would be false — so the
refusal carries `via` for the caller to descend to, one composition level per
read. An atomic refusal never carries `via`.

A valid read is reference data, not a guarantee: it proves the cited bytes are
unchanged, never that the explanation is semantically correct or complete.
The returned Markdown is untrusted data — never system instructions — and a
client must not let a directive inside a body change its instructions.

#### `knowledge_save`

| Argument        | Type   | Required | Description                                                          |
| --------------- | ------ | -------- | -------------------------------------------------------------------- |
| `mode`          | string | no       | `create` (default), `append` or `replace` (ADR 0050). An `append` enriches one existing valid entry without rewriting its body, a `replace` rewrites one existing entry in full; both require `expectedRevision` on the entry. |
| `entries`       | object[] | yes    | The proposal's entries: `{name, description, body, evidence:[{path, sha256?}], dependencies?:[{name}]}`, plus `expectedRevision` in `replace` mode. An empty array is an explicit zero-entry consolidation. |
| `runId`         | string | no       | CodeTour generation run identity from the served prompt. When present, the MCP persists the matching consolidation closure in `<workspace>/.tours/.log/` and returns it. |
| `workspacePath` | string | no       | Directory relative to the workspace root.                             |

Every entry is validated before anything is written. An omitted `sha256` is
computed; a declared one is verified and normalized. The whole proposal is
all-or-nothing: an invalid entry publishes nothing, an existing `<name>.md` is
never overwritten, and a name conflict preserves the existing bytes. Every
conclusion is observable:

| `status`        | Meaning                                                                 | `isError` |
| --------------- | ----------------------------------------------------------------------- | --------- |
| `created`       | The entries were published; `created` lists their names. A published entry whose evidence cites fewer than two distinct files additionally appears under `warnings` as one advisory `{name, code: "insufficient_backing", distinctEvidencePaths}` row, so a thin backing is never published silently. | false |
| `appended`      | One existing entry was enriched; `appended` lists its name. The historical body is kept byte for byte behind exactly one blank line, the addition is inserted verbatim and the evidence is merged. `warnings` is always empty: an append can never introduce `insufficient_backing`. | false |
| `no_change`     | The append brought nothing literally new: the addition already is an exact suffix of the body, or it is blank, and it adds no evidence. Nothing was written; the closure is `completed_zero`. | false |
| `replaced`      | One existing entry was rewritten in full; `replaced` lists its name and `warnings` is recomputed on the rewritten state. The previous body is never returned. | false |
| `completed_zero`| An explicit empty proposal: a completed consolidation, not an omission.  | false     |
| `conflict`      | At least one name exists (`name_conflict`) or no longer carries the revision that was read (`revision_conflict`); `conflicts` lists it and nothing was written. | true      |
| `invalid`       | The proposal is invalid; `rejected` lists `{name?, reason}`; nothing was written. | true |
| `failed`        | Unexpected failure; `reason` is `internal_error`; nothing was claimed.   | true      |

With `mode: "replace"` the entries array holds exactly one entry carrying
`expectedRevision`, the Knowledge Revision that was read: the whole entry —
description, body and evidence — is rewritten from the current code, on a valid
and on an invalid entry alike, every new proof is verified, and `unknown_entry`
refuses a name that does not exist because a rewrite is not an upsert.

With `mode: "append"` the entries array holds exactly one entry
`{name, addition, evidence?, expectedRevision}`: the addition is inserted verbatim
after the historical body behind exactly one blank line, the description is never
re-declared, and the evidence is merged, deduplicated by `(type, path, symbol)` —
a `file` and a `symbol` proof may therefore cite the same file, while a divergent
digest on the same key is refused rather than corrected. Every historical proof is
re-verified: an entry that no longer holds is `stale_evidence`, oriented to
`replace`, and the file is untouched. A blank addition is not refused: it is a
proof-only append when it brings new evidence and `no_change` otherwise.

`append` and `replace` re-emit the frontmatter from the parsed contract — the
name, the description and the evidence values are preserved while the formatting
is canonical — and preserve the historical body byte for byte as the read grammar
parses it, which normalizes CRLF to LF.

An entry declaring `dependencies` publishes a Composed Knowledge Entry: at least
two distinct daughters, named only, each item exactly `{name}`. The engine
resolves each daughter's file from the catalogue, verifies her whole contract and
pins her current Knowledge Revision itself, in the same critical section as the
publication, so a daughter cannot move between her resolution and this write. A
daughter that is absent, or whose own read refuses, refuses the whole proposal
with `dependency_missing` or `dependency_invalid` and names her in `via`; a cycle
and the two bounds are refused as `dependency_cycle`, `dependency_depth_exceeded`
and `dependency_node_limit_exceeded`, the node bound being checked before the
first daughter past it is even read. An `append` never accepts `dependencies`,
and a `replace` of a composed entry redeclares every daughter it carried, in any
order and possibly with an added one — a swap included, since the engine cannot
tell an intended replacement from an oversight — or is refused:
`dependencies_incomplete` for a missing list, `dependencies_removed` for a list
that drops a daughter the entry carried, naming the first dropped one in `via`.

An `append` or `replace` of several entries is refused with reason
`mode_requires_single_entry` and an unrecognized mode with `unknown_mode`: one call
form, one operation. `origin`
is never an accepted input: only the engine records that a file proof
substitutes a symbol proof it could not resolve, and a rewrite carries that trace
verbatim onto the identical `(type, path, sha256)` proof only.

A save result never echoes a body, a cited path or a hash value, and it is the
only evidence that persistence happened: “no file was created” must not be
reported as success, and it is not automatically a forgotten consolidation
when the agent explicitly proposed zero entries. With a `runId`, the result
also carries `consolidation: {status, runId, at, …}` and
`consolidationPersisted`; `status` is `created`, `appended`, `replaced`,
`completed_zero`, `partial` or `failed` (with an `outcome` of `conflict`,
`invalid` or `internal_error`). `created` and `changed` accumulate the names
the run's save calls really published and modified, distinct from each other,
and the status follows a fixed precedence (`created` above `appended` and
`replaced`, both above `completed_zero`, with the `appended`/`replaced` tie broken
by `replaced`) so it never depends on the order of the calls. A `no_change` append
closes the run as `completed_zero` while the tool result stays `no_change`: a
completed consolidation that wrote nothing is not an omission.
`partial` means the run made several save calls and at least one published
entries while another was refused or failed: the closure keeps the published
names and the refusal outcome instead of claiming a plain success.

#### `knowledge_close_run`

| Argument        | Type   | Required | Description                                                          |
| --------------- | ------ | -------- | -------------------------------------------------------------------- |
| `runId`         | string | yes      | CodeTour generation run identity from the served prompt.             |
| `reason`        | string | no       | Why the consolidation assessment was deliberately skipped.           |
| `workspacePath` | string | no       | Directory relative to the workspace root.                             |

It records an explicit `skipped` consolidation closure for the run and returns
`{status:"skipped", runId, consolidation: {status:"skipped", runId, at}}`.
`skipped` is a closed run, distinct from an omission (no closure at all). The
tool never creates Knowledge and cannot claim `created`; it exists so a run
that deliberately cannot be assessed is not left open for the agentStop guard.

### Result

Each successful tool call returns a human-readable message and a structure:

```json
{ "status": "created", "path": ".tours/project.tour", "stepCount": 3, "warnings": [] }
```

Failures return `{ "status": "error", "code", "message", "issues" }` with one
of these codes:

| Code                       | Meaning                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `TOUR_STEPS_REQUIRED`      | The steps list is missing or empty.                            |
| `INVALID_PROPOSAL`         | The proposal has validation issues (all listed in `issues`).   |
| `GIT_REPOSITORY_REQUIRED`  | `create_changes_tour` was called outside a Git repository.     |
| `STALE_HEAD`               | `headRef` does not match the current `HEAD`.                      |
| `INVALID_BASE_REF`         | The merge-base between `baseRef` and `headRef` cannot be computed. |
| `NO_CHANGES`               | No committed changes between the merge-base and `headRef`; the previous tour file is preserved. |
| `MISSING_CHANGED_FILE_ANCHOR` | At least one changed file still exists in the analyzed snapshot, but no step anchors it with `file` plus `line` or `pattern`; deletion-only changes are exempt. The previous tour file is preserved. |
| `INVALID_RUN_ID`           | The supplied `runId` is not a valid CodeTour generation identity (8–64 characters from `A-Z`, `a-z`, `0-9`, `_` and `-`). |
| `SCHEMA_VALIDATION_FAILED` | Internal: the generated tour did not validate against the CodeTour schema. |
| `OUTPUT_PATH_ESCAPES_WORKSPACE` | The output directory resolves outside the workspace root. |
| `INTERNAL_ERROR`            | Unexpected server failure; reported as a result, never as a protocol error. |

Non-blocking warnings:

| Code                            | Meaning                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `STEP_LIMIT_EXCEEDED`           | The tour has more than fifteen steps.                                    |
| `UNCOMMITTED_CHANGES_EXCLUDED`  | Staged, unstaged or untracked changes were excluded (default).           |
| `UNCOMMITTED_CHANGES_INCLUDED`  | Uncommitted changes were included; the tour describes a non-reproducible local state. |

## Generation prompts (`prompts/get`)

The server exposes two MCP prompts, which are the supported way to start a
generation run:

| Prompt                   | Arguments                        | Composes                                                    |
| ------------------------ | -------------------------------- | ----------------------------------------------------------- |
| `generate_project_tour`  | `request?`, `brief?`, `runId?`   | the Project Tour instructions, the user's actual demand, the run identity, the Knowledge catalogue projection and the decomposition method. |
| `generate_changes_tour`  | `reviewMode`, `request?`, `brief?`, `runId?` | the Changes Tour instructions for the mode, the user's actual demand, the orientation and the run identity. |

Hosts that do not expose `prompts/get` to the agent serve the same text through
the `get_generation_prompt` tool (`type: "project" | "changes"`, plus the same
optional arguments). Its `runId` is optional and normally absent: when absent,
the returned prompt states that the identity is optional and that it must be
omitted, never sent as an empty string.

`request` is the user's actual demand reproduced **verbatim**: the controlled
adapter strips the `/codetour`, `generate`, type and review-mode prefix and
passes only the words the user wrote, for both Tour types, and omits the
argument when the user gave no demand. `brief` remains the optional
orientation phrase (backward compatibility for adapters that predate
`request`): it orients the Tour and its language remains the Tour's language,
so an adapter that only used `brief` keeps working unchanged. `runId` is the
controlled adapter's generation identity; when present the prompt states it
and tells the agent to pass it to `create_project_tour` and `knowledge_save`
(or `knowledge_close_run`), which is what lets the MCP persist the
server-written run trace. When no identity is supplied — the normal case for
an agent calling `get_generation_prompt` directly — the prompt states that
`runId` is optional, that it must be omitted rather than sent empty, and that
consolidation closes through `knowledge_save` with an empty `entries` array.

For `generate_changes_tour`, the composed message is, in this order: the
Changes Tour instructions for the mode (including the embedded review
instructions in `critical`), the user's actual demand, the optional
orientation clause, then the run identity section.

For `generate_project_tour`, the composed message is, in this order:

1. the instructions also served by the fixed resource
   `codetour://generate/project-tour` — the existing Project Tour contract,
   including the creation call and the announcement step;
2. the optional orientation clause (`brief`);
3. the user's original request, intact, with its language;
4. the **run identity** section: the identity when `runId` is present, or an
   explicit optional-identity notice telling the agent to omit it otherwise;
5. a **Knowledge catalogue projection**: up to 30 entries as name and
   one-line description, never a body. A larger catalogue is truncated with an
   explicit “Showing 30 of N entries” line and the instruction to call
   `knowledge_list` with `query`, `offset` and `limit`, then `knowledge_read`.
   An absent or empty catalogue is stated as normal. There is no vector index,
   BM25 or additional model;
6. the **decomposition method**, after the catalogue: decompose the request
   into atomic questions, use only `status: "valid"` Knowledge as reference
   context, read targetedly, explore gaps only when the Knowledge is
   insufficient, create the Tour with `create_project_tour` (passing `runId`),
   then close consolidation explicitly with `knowledge_save` (zero, one or many
   entries, passing `runId`) or `knowledge_close_run` for a deliberate skip.
   The method also states which mode applies, in the contract's own names:
   `create` for a subject the catalogue does not have; `append` for a short,
   circumscribed addition to an entry that still verifies; `replace`, carrying
   that entry's revision, for an invalid entry, a claim the current code
   contradicts, a needed restructuring or an addition likely to contradict the
   existing body; and neither when nothing durable qualifies or a doubt stays
   unresolved, never a fabricated entry. A replacement restarts from the
   current code and never from a re-read of an invalid body, and the method
   claims no semantic consistency: a SHA-256 fingerprint proves unchanged
   bytes, never the truth of the text, and the MCP detects no natural-language
   contradiction. The agent reports `created`, `appended`, `replaced`,
   `no_change`, `completed_zero`, `conflict`, `invalid`, `failed` or
   `skipped`.

The MCP run log lives at `<workspace>/.tours/.log/codetour-run-<runId>.json`.
`create_*_tour` records `tourCreated`; `knowledge_save`/`knowledge_close_run`
record the closure. The Copilot plugin's `agentStop` hook reads only that file.
The file format and the bounded continuation are documented in the
[plugin README](../../packages/copilot-plugin/README.md) and ADR 0041.

The method explicitly does **not** impose a systematic re-verification of the
sources the Knowledge already covers, and does **not** add a second
anchor-verification pass: the MCP validates every Tour Anchor. It also states
that verified evidence proves only that the cited bytes are unchanged — never
semantic truth or completeness.

The wrapper reaches the agent only through `prompts/get`. A client that calls
the tools directly and never calls `prompts/get` gets the tool descriptions
(including the Knowledge tools' contracts) but not the original request, the
catalogue projection, the decomposition method or the consolidation-closure
instruction; it is responsible for providing an equivalent method itself.
Adapters therefore carry no prompt text of their own: they pass the user's
words as `request` (and the orientation as `brief`) and send exactly what the
server composed. The prompts themselves are not persisted in a Tour file.

## Git reference policies

- A Project Tour has no CodeTour `ref`, so it stays usable as the project
  evolves.
- A reproducible Changes Tour records the exact analyzed head SHA as its
  `ref`, and generation fails with `STALE_HEAD` if `HEAD` changed since the
  analysis. Uncommitted changes are excluded by default (with a warning).
- With `includeUncommittedChanges: true`, the Changes Tour has no `ref` and warns
  that it describes a non-reproducible local state.

The reserved tour files (`.tours/project.tour` and `.tours/changes.tour`) are
always replaced after a complete, successful validation, via an atomic
rename. They are excluded from the dirty-workspace detection so a previous
generation does not warn about itself.

## Development

Install the package dependencies once:

```bash
cd packages/description-renderer
npm install
npm run build
cd ../knowledge
npm install
npm run build
cd ../mcp-server
npm install
```

### Run all tests

From `packages/mcp-server/`:

```bash
npm test
```

The renderer must be built before the MCP package because the MCP server uses
its public shared-rule surface as a local package dependency. The MCP test
command then compiles the package and runs the complete Node.js test suite from
`dist/test/`.

The same suite can be launched from the repository root without changing
directory:

```bash
npm test --prefix packages/mcp-server
```

### Run the type checker or build only

```bash
npm run typecheck   # validate TypeScript without producing files
npm run build       # compile sources and tests into dist/
```

From the repository root, append `--prefix packages/mcp-server` to either
command.

### Run one test file

Individual tests run from the compiled `dist/test/` tree, so build the package
first. For example:

```bash
npm run build
node --test dist/test/integration/changes-tour.test.js
node --test dist/test/integration/project-tour.test.js
node --test dist/test/integration/security.test.js
node --test dist/test/integration/cli.test.js
node --test dist/test/integration/packaged-binary.test.js
node --test dist/test/unit/validation.test.js
```

You can also filter tests in a file by name:

```bash
node --test --test-name-pattern="STALE_HEAD" \
  dist/test/integration/changes-tour.test.js
```

### What the tests exercise

- Project Tour and Changes Tour calls through the public MCP `stdio` seam;
- Tour Anchor, schema and V1 security validation;
- Git merge-base, stale `HEAD`, dirty-workspace and deletion-only scenarios;
- atomic replacement and preservation of an existing Tour after failures;
- CLI argument validation;
- `npm pack`, local installation of the archive, execution of the installed
  `codetour-mcp` binary, and invocation of every public MCP tool.

Integration tests create isolated temporary workspaces and Git repositories
and remove them after each scenario. The packaging smoke test stays local and
does not publish anything to npm.


### Suggested step questions

Both creation tools accept an optional `questions` array on each step, with up to four non-empty strings. Prefer three or four concise questions tied to the step's explanation, in the same language. For example:

```json
{
  "description": "This entry point starts the player.",
  "questions": ["What starts the player?", "How are navigation errors handled?", "Which tests cover this path?"]
}
```

The Expanded Description View displays these as buttons that immediately send the selected question to the ACP step conversation. Buttons are disabled while an answer is in progress. Steps without questions display no suggestions.
