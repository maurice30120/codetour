# One discovery routine for both surfaces

**Claim.** Tour discovery is shared by the VS Code provider and standalone CLI: both call discoverToursFromRoot in src/core/tourDiscovery.ts, which searches the main Tour paths and Tour directories.

**Injected text.** Tour discovery is shared by the VS Code provider and standalone CLI: both call discoverToursFromRoot in src/core/tourDiscovery.ts, which searches the main Tour paths and Tour directories.

| Field | Value |
| --- | --- |
| id | `56fe20012fa04becb88ed2a88e1b7799` |
| state | `CANDIDATE` (fire 0/0) |
| revision | 2 |
| source | `codetour/src/core/tourDiscovery.ts` |
| detector | scope `tourDiscovery\.ts|discoverTours|tourDirectories`, confirm `(MAIN_TOUR_FILES|SUB_TOUR_DIRECTORIES|discoverToursFromRoot|tourDirectories|tourDiscovery)` |
| proof | `codetour/src/core/tourDiscovery.ts` — sha256 `38af746ea60d4f81b240e96bc9f4904293c16d104b47997bf0959af79a4c96b3`<br>`codetour/src/store/provider.ts` — sha256 `31ee4884306c1313fd9bf434b256a5751757c9b7a2051f4d72c1b685a032c099`<br>`codetour/src/cli/index.ts` — sha256 `aa662d9ca6849641b9c5828053c8ae5336ab910afbe09cd5d90c7c1beee01393` |
| provenance | manual code review of `codetour/src/core/tourDiscovery.ts`, `codetour/src/store/provider.ts`, `codetour/src/cli/index.ts` |
| previous record | session `01a20deb-b58a-75ae-97b8-daa67bf9983c`, path `codetour/src/core/tourDiscovery.ts` |

> The proof hashes were taken on 24 November 2026. The files have changed since (`drift: true`), so this card would be re-proven or left out before any injection.
