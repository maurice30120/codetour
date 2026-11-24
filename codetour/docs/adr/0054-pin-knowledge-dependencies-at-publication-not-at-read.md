> Historical decision: superseded by [spec #304](https://github.com/maurice30120/codetour/issues/304), which removes CodeTour memory without migration.

# Pin a Knowledge Dependency at publication from the catalogue, not at read from a declared digest

A Composed Knowledge Entry must record which daughter Knowledge Entries its synthesis rests on, and that record has to make a later daughter change detectable. We decide the **file** `dependencies` list carries each daughter's Knowledge name and the SHA-256 of her complete Markdown bytes (ADR 0053), while the **write proposal** carries the names alone: the agent names the daughters, the engine resolves each file from the catalogue, verifies her whole contract and pins her digest itself, inside the same catalogue lock as the publication (ADR 0050). The alternative — the agent declares the digests it read, as `append`/`replace` do for the entry being rewritten — was rejected because it buys a guarantee the engine cannot verify anyway: the agent may copy any revision the catalogue published without reading a body, and it costs a refusal (`revision_conflict`) that a single-pass consolidation run cannot act on. This keeps one rule for the whole write surface: the model names what it references, the engine hashes the bytes.

## Considered options

- **Engine-pinned at publication (chosen).** One rule, uniform with `evidence`, where the agent cites a `path` and the engine computes the digest. No digest ever crosses the model boundary.
- **Agent-declared, like `append`/`replace`'s `expectedRevision`.** Detects a daughter modified between the agent's read and the write — the only case that silently pins a synthesis to text nobody read — but only as a *declaration* the engine cannot check, and it adds a refusal no remediation can resolve inside one run.
- **Validity only, no digest in the dependency.** Rejected upstream in the spec: it is dynamic assembly, where the mother never notices a daughter changed.

## Consequences

- The pin follows the **published** state, not the **read** state. A daughter modified between the agent's read and the publication is pinned in her new version, and the mother can be born describing text that no longer exists. The write still cannot produce a dead-on-arrival mother, because the engine verifies each daughter's whole contract before pinning. This limit is recorded in the spec (§13) rather than mitigated: without a digest from the model there is nothing to compare.
- The write surface accepts no digest for a dependency. A proposal supplying one is a proposal with an unknown field, refused like any other.
- The refusal vocabulary has no `dependency_revision_conflict`: the engine cannot contradict itself, so the only dependency refusals left are absence, an invalid contract, a cycle and a bound.
