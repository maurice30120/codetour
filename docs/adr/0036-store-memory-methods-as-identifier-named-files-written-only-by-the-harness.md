# Store Memory Methods as identifier-named files written only by the harness

A Memory Method is one flat file `methods/<name>.md` beside `functions/` in `.tours/.memory/`, with `name` and `description` frontmatter. Its name follows the Memory Function rule (a valid TypeScript identifier) and must equal the file name, instead of the kebab-case `SKILL.md` directory first proposed. Methods are not meant to be loaded by external agent-skill tooling, and sharing the naming rule keeps one convention across the catalogue.

The consolidator only proposes a method as text; the harness validates it deterministically (no LLM) and is the sole writer, so the model never gets filesystem write access. A name conflict is rejected outright and methods are never updated or replaced in v1, so a stale or wrong method cannot be silently overwritten. The cost is that fixing a method needs a manual edit or deletion until a later decision revisits this.
