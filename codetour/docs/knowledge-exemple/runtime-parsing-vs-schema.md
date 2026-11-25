# Runtime parsing versus authoring schema

**Claim.** Runtime Tour parsing uses the Zod schemas in src/store/tourSchema.ts, where a missing step description defaults to an empty string; schema.json is used for authoring and requires a description.

**Injected text.** Runtime Tour parsing uses the Zod schemas in src/store/tourSchema.ts, where a missing step description defaults to an empty string; schema.json is used for authoring and requires a description.

| Field | Value |
| --- | --- |
| id | `ddf2d37aa8d84e2680b817a2fb7e6d69` |
| state | `CANDIDATE` (fire 0/0) |
| revision | 2 |
| source | `codetour/src/store/tourSchema.ts` |
| detector | scope `tourSchema|TourFileSchema|CodeTourStepSchema|loadTour`, confirm `(tourSchema|TourFileSchema|CodeTourStepSchema|looseObject|loadTour)` |
| proof | `codetour/src/store/tourSchema.ts` — sha256 `c830368efa0241d0dab8d19b897e5e6145b409594079f534839fe1c974ff6945`<br>`codetour/schema.json` — sha256 `7ca23055230e7df030dcb9f6b86e88d01e2194a969f821bacc41863e3fabece5` |
| provenance | manual code review of `codetour/src/store/tourSchema.ts`, `codetour/schema.json` |
| previous record | session `01a20deb-b58a-75ae-97b8-daa67bf9983c`, path `codetour/src/store/tourSchema.ts` |

> The proof hashes were taken on 24 November 2026. The files have changed since (`drift: true`), so this card would be re-proven or left out before any injection.
