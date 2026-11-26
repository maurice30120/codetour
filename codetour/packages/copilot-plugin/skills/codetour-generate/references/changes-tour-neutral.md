# Neutral Changes Tour module

Path: `type=changes` with `reviewMode=neutral` — what the CLI applies when the
field is omitted, and the mode to use when the user asked for no review.

Read this module before exploring when the request is a neutral Changes Tour,
and keep it read while you write. It adds the comparison, the route and the
creation command of this path to the shared rules of `SKILL.md` and repeats none
of them.

## Fix the comparison first

A Changes Tour describes exactly one comparison, and it is decided before
exploring:

- `baseRef` — what the change is read against. When the user names a branch or
  a tag, resolve the merge-base first (`git merge-base <base> <headRef>`) and
  pass the SHA you deliberately chose. The field is mandatory: never let it
  default by omission.
- `headRef` — the commit analysed, as its full 40-character SHA
  (`git rev-parse HEAD` for the current checkout). An abbreviated SHA is
  refused, and so is a missing one.
- `includeUncommittedChanges` — `false` unless the local changes are part of
  the comparison; state which one you chose when the request does not say.

When the user gave no context, `gh pr view --json title,body,baseRefName,url`
or the `glab` equivalent describes the pull request; say what you used, and
never invent a title, a goal or a finding.

## Explore the comparison

- Read the diff from the merge-base to `headRef`, then the affected source and
  the affected tests. A diff alone does not explain a change.
- Group related changes into one review path anchored at the changed lines,
  rather than one step per file.
- Report test coverage factually: describe a test as executed only if you saw
  it run, and never claim a result you did not observe.
- Ground every claim in the version the comparison selects, as the shared rules
  require: with uncommitted changes excluded, the committed files at `headRef`
  and the merge-base, never the working tree.

A neutral Changes Tour states facts — what the change does, how, and with what
effect. It never judges, advises or reports findings: that is the critical
path's work.

## Proposal

The shared envelope plus the four Changes Tour fields:

````json
{
  "title": "Changes on feature/payments",
  "description": "What the branch changes, and how.",
  "fileName": "changes.tour",
  "baseRef": "9f1c2d3e4b5a60718293a4b5c6d7e8f9012345ab",
  "headRef": "4a7d6f2c1b0e9d8c7b6a5f4e3d2c1b0a99887766",
  "includeUncommittedChanges": false,
  "reviewMode": "neutral",
  "steps": [
    { "title": "Overview", "description": "**Diagram — Change map**\n\n```mermaid\nflowchart LR\n  Route --> Service --> Store\n```" },
    { "title": "The new route", "description": "What the route accepts and returns.", "file": "src/payments/route.ts", "pattern": "export async function pay" }
  ]
}
````

## Create

From the workspace root:

```sh
<cli> create-changes-tour --workspace <dir> --proposal -
```

`<cli>` is the CodeTour CLI `SKILL.md` defines. Its Git checks resolve the
comparison and its validation refuses a proposal whose refs are missing or
abbreviated; a refusal is the shared result handling, never a reason to relax
the refs. Then read the result and hand the Tour over as `SKILL.md` states.
