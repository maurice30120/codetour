# codetour-tour-generation

Transport-free Tour creation rules for [CodeTour](https://github.com/microsoft/codetour).
The package receives the workspace to create in and a Tour proposal, validates it,
applies the Git, image, Mermaid and workspace-confinement rules, writes the Tour
file atomically, and returns the outcome as a value:

```ts
import { createProjectTour, createChangesTour } from "codetour-tour-generation";

const result = await createProjectTour({ workspaceRoot, proposal });
if (!result.ok) {
  // result.code, result.message, result.issues: nothing was written.
}
```

Design constraints:

- **No transport** — nothing here reads a command line, a stream or a protocol
  message. The CLI subcommands are thin surfaces over this package, so every
  caller applies exactly the same rules.
- **Validation before any write** — a rejected proposal writes no file and leaves
  an existing Tour untouched. Errors are aggregated into one `issues` list so a
  caller can correct its proposal in one cycle.
- **Confinement** — every anchor, image reference and output path stays inside
  the workspace; symlinks escaping it are rejected.
- **Atomic persistence** — the Tour is written to a temporary file in its target
  directory and renamed over the destination, so a reader never observes a
  partial Tour.
- **Creation journal** — after a successful write, one record per created Tour is
  appended under `<workspace>/.tours/.log/creations/` for the agent hooks to
  report. The journal is observability only: a failed journal write never fails a
  creation.

## Entry points

| Entry point                         | Requires Git | Notes                                          |
| ----------------------------------- | ------------ | ---------------------------------------------- |
| `createProjectTour({ workspaceRoot, proposal })` | no | Reserved destination `.tours/project.tour`, no `ref`. |
| `createChangesTour({ workspaceRoot, proposal })` | yes | Merge-base comparison; `headRef` must equal the current HEAD. |

The result is `{ ok: true, kind, tourPath, title, stepCount, warnings }` on
success and `{ ok: false, code, message, issues? }` on refusal.
