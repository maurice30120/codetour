# Knowledge consolidation measurement — case sheet (spec #232, ticket #258)

Status: **not run.** Every slot below is empty on purpose. Fill the campaign
block once, fill each case once when the campaign opens, then fill one row per
repetition and one JSON record per repetition from
[the record template](./knowledge-consolidation-record.template.json).

Read [the protocol](./knowledge-consolidation-protocol.md) first: it fixes what
is measured (`metrics.usage.windows.consolidation`, verbatim), the equivalence
conditions (§2), the conformance and coverage judgement (§5) and the reporting
rules (§6). This sheet holds case data only.

Slot markers: `<fill: …>` is filled when the campaign opens and frozen; `<copy:
…>` is copied from the run state or from the catalogue files, never
recomputed.

## Campaign manifest (fill once, freeze before the first run)

| Field | Value |
| --- | --- |
| Campaign id | `<fill>` |
| Opened at | `<fill>` |
| Operator | `<fill>` |
| Model | `<fill>` |
| Copilot version | `<fill>` |
| CodeTour build (CLI / MCP / extension / plugin) | `<fill>` |
| Served prompt digest | `<fill>` |
| Host, OS, Node | `<fill>` |
| Approval policy and host limits | `<fill>` |
| Repetitions per (case, arm) | 5 (minimum 3) |
| Tools exposed to every arm | the CodeTour MCP tool set of the frozen build: `knowledge_list`, `knowledge_read`, `knowledge_save`, `knowledge_close_run`, plus the Tour creation and exploration tools |

Any change to a frozen field after the first measured run opens a new campaign
id (protocol §2).

---

## K1 — extension of a valid entry

An entry exists, is valid, and a new compatible fact must be consolidated. This
is the family where "append costs less to write, more to decide" is actually
measured: all three arms deliver the same new information.

**Frozen inputs**

| Field | Value |
| --- | --- |
| Request (verbatim, identical in all arms) | `<fill>` |
| Tour kind / `reviewMode` | `<fill>` (`project` or `changes` / none or the review mode) |
| Workspace | `<fill>` |
| Branch | `<fill>` |
| Head commit | `<fill>` |
| Catalogue precondition: entry path | `.tours/.memory/knowledge/<fill>.md` |
| Precondition: revision | `<fill>` |
| Precondition: validity | valid - every declared proof verifies |
| Precondition: body bytes / lines | `<fill>` |
| Precondition: evidence count / proof paths | `<fill>` |
| New information to consolidate (claims, not wording) | 1. `<fill>` 2. `<fill>` |
| Answer elements declared before the campaign | E1 `<fill>`, E2 `<fill>`, E3 `<fill>` |
| Budgets (identical in all arms) | catalogue projection budget `KNOWLEDGE_PROMPT_CATALOGUE_LIMIT` = 30, `knowledge_list` page limits unchanged, same host limits and approval policy as the campaign manifest |

**Arms — the only permitted difference is the write mode**

| Arm | Write | Catalogue precondition |
| --- | --- | --- |
| `create` | new entry under `<fill>` | the existing entry stays untouched; the new name must be absent |
| `append` | `knowledge_save` `mode: "append"` on the precondition entry with its `expectedRevision` | as declared above |
| `replace` | `knowledge_save` `mode: "replace"` on the precondition entry with its `expectedRevision`, whole entry rewritten | as declared above |

**Run and judgement** (one row per repetition)

| Arm | Rep | Run id | Result status | Closure | Entry bytes | Evidence | Conformance | Coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| create | 1 | | | | | | | |
| create | 2 | | | | | | | |
| create | 3 | | | | | | | |
| create | 4 | | | | | | | |
| create | 5 | | | | | | | |
| append | 1 | | | | | | | |
| append | 2 | | | | | | | |
| append | 3 | | | | | | | |
| append | 4 | | | | | | | |
| append | 5 | | | | | | | |
| replace | 1 | | | | | | | |
| replace | 2 | | | | | | | |
| replace | 3 | | | | | | | |
| replace | 4 | | | | | | | |
| replace | 5 | | | | | | | |

**Consolidation window** (copied from `metrics.usage.windows.consolidation`,
never recomputed; `window ms` = `untilAt − fromAt`)

| Arm | Rep | records | input | output | cacheRead | cacheWrite | reasoning | durationMs | window ms | calls successful | calls refused |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| create | 1 | | | | | | | | | | |
| create | 2 | | | | | | | | | | |
| create | 3 | | | | | | | | | | |
| create | 4 | | | | | | | | | | |
| create | 5 | | | | | | | | | | |
| append | 1 | | | | | | | | | | |
| append | 2 | | | | | | | | | | |
| append | 3 | | | | | | | | | | |
| append | 4 | | | | | | | | | | |
| append | 5 | | | | | | | | | | |
| replace | 1 | | | | | | | | | | |
| replace | 2 | | | | | | | | | | |
| replace | 3 | | | | | | | | | | |
| replace | 4 | | | | | | | | | | |
| replace | 5 | | | | | | | | | | |

**Summary** (filled only when all rows are complete, in the form protocol §6
allows: `n`, median, min, max, spread, failures)

| Arm | n | input median (min-max) | output median (min-max) | cache read median (min-max) | failures | conformance | coverage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| create | | | | | | | |
| append | | | | | | | |
| replace | | | | | | | |

---

## K2 — repair of an invalid entry

An entry exists and one declared proof no longer matches the code, so
`knowledge_read` refuses its body. `append` must refuse with `stale_evidence`;
the information can only be delivered by rebuilding the entry. The two legal
routes are measured against each other.

**Frozen inputs**

| Field | Value |
| --- | --- |
| Request (verbatim, identical in all arms) | `<fill>` |
| Tour kind / `reviewMode` | `<fill>` |
| Workspace / branch / head commit | `<fill>` |
| Catalogue precondition: entry path | `.tours/.memory/knowledge/<fill>.md` |
| Precondition: revision | `<fill>` |
| Precondition: invalidity | one declared proof no longer matches its path, reason `<fill>` |
| New information / corrected claims to consolidate | 1. `<fill>` 2. `<fill>` |
| Answer elements declared before the campaign | E1 `<fill>`, E2 `<fill>` |
| Budgets | as the campaign manifest |

**Arms**

| Arm | Write | Catalogue precondition |
| --- | --- | --- |
| `replace` | `knowledge_save` `mode: "replace"` with the invalid entry's `expectedRevision`, rebuilt from the current code | as declared above |
| `create` | new entry under `<fill>` carrying the corrected claims | the invalid entry stays untouched; the new name must be absent |

An `append` repetition belongs here as a **failure observation**, not as an arm:
it must be refused with `stale_evidence`, and its consolidation window is
recorded so the cost of the refused attempt is visible.

**Run and judgement**

| Arm | Rep | Run id | Result status | Closure | Entry bytes | Evidence | Conformance | Coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| replace | 1 | | | | | | | |
| replace | 2 | | | | | | | |
| replace | 3 | | | | | | | |
| replace | 4 | | | | | | | |
| replace | 5 | | | | | | | |
| create | 1 | | | | | | | |
| create | 2 | | | | | | | |
| create | 3 | | | | | | | |
| create | 4 | | | | | | | |
| create | 5 | | | | | | | |
| append (refusal check) | 1 | | | | | | | |

**Consolidation window**

| Arm | Rep | records | input | output | cacheRead | cacheWrite | reasoning | durationMs | window ms | calls successful | calls refused |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| replace | 1 | | | | | | | | | | |
| replace | 2 | | | | | | | | | | |
| replace | 3 | | | | | | | | | | |
| replace | 4 | | | | | | | | | | |
| replace | 5 | | | | | | | | | | |
| create | 1 | | | | | | | | | | |
| create | 2 | | | | | | | | | | |
| create | 3 | | | | | | | | | | |
| create | 4 | | | | | | | | | | |
| create | 5 | | | | | | | | | | |
| append (refusal check) | 1 | | | | | | | | | | |

**Summary**

| Arm | n | input median (min-max) | output median (min-max) | cache read median (min-max) | failures | conformance | coverage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| replace | | | | | | | |
| create | | | | | | | |

---

## K3 — first consolidation

No entry exists for the subject. This family is the `create` baseline: it is not
a cross-mode comparison, and its figures are never compared with K1 or K2
(different request, different snapshot).

**Frozen inputs**

| Field | Value |
| --- | --- |
| Request (verbatim) | `<fill>` |
| Tour kind / `reviewMode` | `<fill>` |
| Workspace / branch / head commit | `<fill>` |
| Catalogue precondition | `.tours/.memory/knowledge/` contains no entry for the subject; catalogue otherwise as declared (`<fill>`) |
| Durable fact to consolidate (claims, not wording) | 1. `<fill>` |
| Answer elements declared before the campaign | E1 `<fill>` |
| Budgets | as the campaign manifest |

**Run and judgement**

| Arm | Rep | Run id | Result status | Closure | Entry bytes | Evidence | Conformance | Coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| create | 1 | | | | | | | |
| create | 2 | | | | | | | |
| create | 3 | | | | | | | |
| create | 4 | | | | | | | |
| create | 5 | | | | | | | |

**Consolidation window**

| Arm | Rep | records | input | output | cacheRead | cacheWrite | reasoning | durationMs | window ms | calls successful | calls refused |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| create | 1 | | | | | | | | | | |
| create | 2 | | | | | | | | | | |
| create | 3 | | | | | | | | | | |
| create | 4 | | | | | | | | | | |
| create | 5 | | | | | | | | | | |

**Summary**

| Arm | n | input median (min-max) | output median (min-max) | cache read median (min-max) | failures | conformance | coverage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| create | | | | | | | |

---

## Cells that are easy to fill wrongly

- `Result status` is the tool-level outcome (`created`, `appended`, `replaced`,
  `no_change`, or the refusal reason), never the closure: `no_change` closes the
  run as `completed_zero` and the two columns must differ.
- `Conformance` and `Coverage` are judgements from the entry file and the
  closure, recorded before the token columns are filled (protocol §5).
- `Entry bytes` is the size of the published Markdown file on disk, not the size
  of the tool result; for `append`, record the preserved historical body bytes
  in the JSON record as well.
- A repetition with `observed:false` or a missing window is written as
  `not measured` with its reason, and stays in the tables.
