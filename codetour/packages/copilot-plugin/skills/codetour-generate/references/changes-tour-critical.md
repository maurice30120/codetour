# Critical Changes Tour module

Path: `type=changes` with `reviewMode=critical`.

Read this module **and the review pack it names before exploring**, and keep
both read while you write. A mode that reached you only at the CLI call would
be too late: the CLI validates a finished proposal, it never reviews one.

The comparison, the refs and the envelope of this Tour are the shared ones of
`../SKILL.md`; this module adds the review on top, on exactly the comparison the
Tour describes.

## The review pack

- `codetour-adaptation.md` — the method: the two axes, the step integration and
  the honesty rules of a critical Tour. It is the authoritative instruction set,
  and it is read in full.
- `upstream-code-review.md` — the upstream skill the adaptation is based on,
  kept verbatim.
- `upstream-LICENSE.txt` — that skill's MIT license, kept verbatim beside it.

Attribution: the critical mode adapts Matt Pocock's `code-review` skill, MIT
licensed. The upstream text and its license travel with this module; neither is
dropped, summarised in place of reading, or replaced.

## The two axes

The method the pack defines, and the only labels a finding carries:

- **Standards:** — documented repository rules first (`AGENTS.md`,
  `CONTRIBUTING.md`, `CONTEXT.md`, `docs/`), a documented rule overriding the
  upstream smell baseline. Each finding is a demonstrated violation, with the
  rule and the offending code quoted, or a risk / code smell, explicitly
  presented as heuristic. What a tool already guarantees is never recycled as a
  finding.
- **Spec:** — only when a source is found: the user's own indication, an issue
  reference in the commit messages, a spec under `docs/`, `specs/` or
  `.scratch/`. Every finding quotes the requirement it uses. No source means no
  Spec axis: the Tour states
  `Spec axis not evaluated: no spec source was found.`, and no requirement is
  ever invented.

## Compare, review, integrate

- Review exactly the comparison the shared rules fix, from the merge-base of
  `baseRef` to the full 40-character `headRef`, and read the changed source and
  its tests before judging anything. The CLI's Git checks, validation,
  snapshots and anchor verification remain the authority: when your analysis
  and the command disagree, the command wins.
- Every step keeps its factual explanation of the change. Attach each finding
  inside the description of the step whose anchor locates the motivating code,
  labeled with its axis and quoting its rule or requirement. No extra step per
  suspicion, and the two axes are never merged or reranked.
- Findings anchor at lines that exist in the analysed commit, so the CLI can
  verify them.
- Never invent defects, requirements, specs or test results. A test inferred
  from reading the change is described as inferred; a passing or failing test is
  reported only if you observed the run. With no established defect, say so
  plainly: the Tour stays a useful factual explanation.

## Proposal

````json
{
  "title": "Review of feature/payments",
  "description": "What the branch changes, and what the review establishes.",
  "fileName": "review-changes.tour",
  "baseRef": "9f1c2d3e4b5a60718293a4b5c6d7e8f9012345ab",
  "headRef": "4a7d6f2c1b0e9d8c7b6a5f4e3d2c1b0a99887766",
  "includeUncommittedChanges": false,
  "reviewMode": "critical",
  "steps": [
    { "title": "Overview", "description": "**Diagram — Change map**\n\n```mermaid\nflowchart LR\n  Route --> Service --> Store\n```" },
    { "title": "The new route", "description": "What the route accepts and returns.\n\n**Standards:** `AGENTS.md` requires every route to be registered in the manifest; this one is not.", "file": "src/payments/route.ts", "pattern": "export async function pay" }
  ]
}
````

## Create

From the workspace root:

```sh
<cli> create-changes-tour --workspace <dir> --proposal -
```

`<cli>` is the CodeTour CLI `../SKILL.md` defines. Read the result and hand the
Tour over as `../SKILL.md` states; a refusal on the refs is never a reason to
drop the review or to relax the comparison.
