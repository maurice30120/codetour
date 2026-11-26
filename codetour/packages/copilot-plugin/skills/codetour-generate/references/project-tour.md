# Project Tour module

Path: `type=project`. A Project Tour has no review mode.

Read this module before exploring when the request is a Project Tour, and keep
it read while you write. It adds the route, the proposal and the creation
command of this path to the shared rules of `SKILL.md` — orientation, language,
workspace, proposal envelope, anchors, Mermaid, CLI result — and repeats none
of them.

## Explore

Follow one coherent route from the project's purpose and entry points through
its key components and how they collaborate:

1. Say what the project is for: its manifest, its README, the overview it
   documents. One paragraph, in the user's language.
2. Find where execution starts — the manifest entry, the main executable
   module, the registered route or command.
3. Follow that start in the code: entry point, dispatch, the two or three
   components that carry the behavior, the boundary where results leave the
   project. Read those modules, not only their names.
4. Choose representative files rather than listing every module: one step per
   turn of the route, each anchored at the code that justifies it.

A library, a command line, an extension and a service are each read along their
own execution path; nothing constrains the route beyond the project itself. A
Project Tour explains: it never reviews, judges or reports defects.

## Proposal

The document is the shared envelope of `SKILL.md` and nothing more: the
comparison of a Changes Tour and the review mode belong to that path.

Open with a locator-free orientation step — what the project is, how the route
runs — carrying at least one Mermaid diagram; then one anchored step per turn
of the route, in the order a reader should walk them.

````json
{
  "title": "Payment flow",
  "description": "How a payment travels from the client to the ledger.",
  "fileName": "payment.tour",
  "steps": [
    { "title": "Overview", "description": "**Diagram — Context view**\n\n```mermaid\nflowchart LR\n  Client -->|\"pays (HTTPS)\"| API\n  API --> Ledger\n```" },
    { "title": "Entry point", "description": "The HTTP route that accepts a payment.", "file": "src/server.ts", "pattern": "export function createServer" },
    { "title": "Ledger write", "description": "Where the payment becomes an entry.", "file": "src/ledger.ts", "pattern": "export async function record" }
  ]
}
````

## Create

From the workspace root:

```sh
<cli> create-project-tour --workspace <dir> --proposal -
```

`<cli>` is the CodeTour CLI `SKILL.md` defines. The document travels on
standard input, or in a file passed to `--proposal`. Read the result and hand
the created Tour over exactly as `SKILL.md` states.
