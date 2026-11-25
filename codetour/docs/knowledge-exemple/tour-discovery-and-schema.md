# Tour discovery and the schema

**Claim.** Tour discovery includes the .tours directory; schema.json requires title and steps, with a description for each step.

**Injected text.** Tour discovery includes the .tours directory; schema.json requires title and steps, with a description for each step.

| Field | Value |
| --- | --- |
| id | `18de2197d9324a7e85e9f792afa18e2b` |
| state | `CANDIDATE` (fire 0/0) |
| revision | 2 |
| source | `codetour/schema.json` |
| detector | scope `tour_artifacts`, confirm `(?:\.tours/|schema\.json)` |
| proof | `codetour/schema.json` — sha256 `7ca23055230e7df030dcb9f6b86e88d01e2194a969f821bacc41863e3fabece5`<br>`codetour/src/core/tourDiscovery.ts` — sha256 `38af746ea60d4f81b240e96bc9f4904293c16d104b47997bf0959af79a4c96b3` |
| provenance | manual code review of `codetour/schema.json`, `codetour/src/core/tourDiscovery.ts` |
| previous record | session `01a20de7-73da-7097-bab5-3205d9344ccf`, path `codetour/schema.json` |

> The proof hashes were taken on 24 November 2026. The files have changed since (`drift: true`), so this card would be re-proven or left out before any injection.
