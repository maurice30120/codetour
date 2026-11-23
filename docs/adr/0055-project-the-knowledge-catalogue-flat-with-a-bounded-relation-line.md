# Project the Knowledge catalogue flat, with a bounded relation line for composed entries

A composed Knowledge Entry is invisible in the catalogue: an agent reads a list of names, descriptions and revisions, and nothing says that one entry rests on three others. That is the one thing the projection has to fix, and we decide it without measuring — the flat list gains, on a composed entry's own line, its type and the **names** of its daughters, bounded with an explicit omission marker. Daughters keep their own lines. The alternative presentation — a hierarchy with relations nested under each mother — was rejected because it costs a new format and an indirection for shared daughters to carry exactly the same information, and no measurement exists to show it earns that surface.

## Considered options

- **Flat, enriched with a relation line (chosen).** An extension of the format the agent already parses: one derived field and one name list on a line already served. Nothing can be hidden, because every entry still has its line.
- **Hierarchical presentation.** Same information in a new shape, with compact references to avoid repeating a shared daughter. More surface, unmeasured benefit.
- **Leave the catalogue untouched.** Cheapest to build and the most expensive to use: the graph is invisible, so the agent cannot know a daughter is already covered by a mother it never heard of. The prompt rule "do not read the mother and the daughters by default" becomes inapplicable, since the agent cannot tell there is a mother.

## Consequences

- The decision is recorded as **taken without measurement**, on the criterion of the smallest change to the existing served format. Nothing here promises a token saving, and the hierarchical option returns as a candidate only if a later measurement shows the flat line is insufficient — the measurement no longer blocks anything.
- The number of daughters shown per line is **bounded**, although the contract does not cap dependencies: a fifty-daughter entry must not produce fifty names in the served catalogue, and a truncated projection says so.
- Only names are projected. Bodies, evidence and revisions of daughters stay out of the catalogue, exactly as before: the relation is discoverable without becoming a second read.
- Composition remains derived from the dependency list. No `kind` field enters the frontmatter: the type exists only in the projection.
