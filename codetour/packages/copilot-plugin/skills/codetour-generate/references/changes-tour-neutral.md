# Neutral Changes Tour module

Path: `type=changes` with `reviewMode=neutral` — what the CLI applies when the
field is omitted, and the mode to use when the user asked for no review.

Read this module before exploring when the request is a neutral Changes Tour,
and keep it read while you write. It adds the comparison and the route of this
path to the shared rules of the parent `../SKILL.md`, which state the refs every
Changes Tour carries.

## Fix the comparison first

A Changes Tour describes exactly one comparison, and it is decided before
exploring: `baseRef`, `headRef` and `includeUncommittedChanges`, as the shared
rules state them. When the user names a branch or a tag as the base, resolve the
merge-base first (`git merge-base <base> <headRef>`) and pass the SHA you
deliberately chose: `baseRef` is never left to default by omission. When the
request does not say whether the local changes belong to the comparison, choose
and state the `includeUncommittedChanges` value.

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

`<cli>` is the CodeTour CLI `../SKILL.md` defines. Its Git checks resolve the
comparison and its validation refuses a proposal whose refs are missing or
abbreviated; a refusal is the shared result handling, never a reason to relax
the refs. Then read the result and hand the Tour over as `../SKILL.md` states.
