# Verify Knowledge entries at MCP discovery and report invalid contracts for fixing

ADR 0040 exposed `knowledge_list` as metadata-only discovery: the catalogue
projection disclosed that a stale or unreadable entry could still appear, and
validation happened only when `knowledge_read` returned `valid`. In the
consolidation flow of spec #223 this hides two facts at the moment they matter:
an agent selects on unverified metadata and pays a read before learning the
entry is refused, and an entry whose static contract is broken (malformed
frontmatter, unsupported proof, a declared name that contradicts the file
stem) was skipped by discovery without any signal — nothing ever surfaced it
for fixing. The decision here reverses that tradeoff for the MCP surface:
**discovery serves only valid Knowledge contracts, and invalid ones are
reported for fixing instead of being hidden or silently trusted.**

**Verification at discovery.** `knowledge_list` and the `prompts/get` Knowledge
projection classify every catalogue file through the same library read as
`knowledge_read` — the run's single source of truth for parsing, hashing and
verification; no second parser and no duplicated rule. Only verified entries
populate the `entries` metadata rows; everything else is returned under a new
`invalid` field as one `{ name, reason }` row per failing entry, with the
file stem as the name when the contract does not declare a servable one.

**The report cannot leak.** An `invalid` row carries the name (or stem) and
the machine-readable reason only. No body content, no cited path and no hash
value ever reaches the report, so a diagnostic row obeys the same refusal
rules as the read it mirrors. The page shape stays metadata-only: discovery
output still never contains a body.

**The whole broken set stays visible.** The `invalid` list is reported in
full regardless of `query`, `offset` and `limit`; pagination and filtering
apply only to the verified entries, and `total`/`truncated` keep describing
the verified matches. `status: "empty"` means no verified entry matches — a
catalogue that holds only invalid entries is reported as empty with its
invalid rows, and the projection says so explicitly instead of claiming an
absent catalogue.

**Cost, stated.** Verification at discovery scales with the catalogue size
and repeats on every listing and every prompt composition. The work is
bounded by the list limits, offline, deterministic and local (realpath, stat,
read, SHA-256) — no model, no network, no API key. The previous design chose
cheap discovery; this decision accepts the local hashing cost because a served
contract that lies about its own validity is worse than a few milliseconds of
hashing in the consolidation flow.

**Original scope.** The MCP surface only (`tools/call` and `prompts/get`);
the native CLI initially kept its non-verifying `list`. Validation of the
effect on real Copilot generations remains to be established, as for every
served-guidance change.

**Update — native CLI discovery (ticket #260).** `codetour knowledge list` now
verifies each catalogue entry with the same read gate. Its `entries` contain
only verified names and descriptions; `invalid` reports every refused entry by
name and reason, independent of the query. Neither list exposes bodies, cited
paths or evidence hashes. Exit 3 still means no verified entry matched, even
when invalid entries are reported; exit 0 means at least one verified match.
