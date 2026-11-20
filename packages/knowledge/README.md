# codetour-knowledge

The single deterministic source of the Knowledge contract used by CodeTour:

- `parseKnowledge(source, fileName)` — restricted frontmatter grammar, never touches the workspace.
- `fileProofHash(bytes)` — deterministic SHA-256 of cited bytes.
- `knowledgeRevision(bytes)` — the Knowledge Revision: the SHA-256 of an entry
  file's complete bytes, as an opaque token. It is computed without validating
  the contract, so an entry whose evidence no longer verifies still has one, and
  `catalog()`, `list(query)` and `read(name)` expose it (ADR 0048).
- `verifyKnowledge(entry, root)` — every declared `file` proof must stay inside the
  workspace, avoid symlink escapes and match its SHA-256 before the body is returned.
- `loadKnowledgeLibrary(root, directory)` — `catalog()`, `list(query)` and `read(name)`
  over `<workspace>/.tours/.memory/knowledge`.
- `hashWorkspaceFile(root, path)` — the same confinement rules for preparing evidence.
- `saveKnowledgeProposal(root, proposal)` — validate a whole proposal, compute or
  verify every SHA-256 proof, then publish
  `{status:"saved"|"replaced"|"no-op"|"conflict"|"invalid"}`. A `saved` or `replaced`
  result carries advisory `warnings`: one `insufficient_backing` row per published
  entry whose evidence cites fewer than two distinct files, so a thin backing is
  reported instead of passing silently.
  Nothing is written unless every entry is valid; in `create` mode an existing
  `<name>.md` refuses the whole proposal, and in `replace` mode the named entry
  must already exist and still carry the revision the caller read.
- `serializeKnowledgeEntry(entry)` — the exact catalogue grammar, body preserved verbatim.
- `validateCanonicalName(name)` — the shared identifier rule for Memory Methods and
  Knowledge entries.

A proposal is `{"entries":[{name, description, body, evidence:[{path, sha256?}]}]}`.
The name is a canonical identifier, the description is one non-empty line, the body
is Markdown kept byte-for-byte, and evidence cites at least one workspace-relative
file. A missing `sha256` is computed from the bytes; a declared one is verified and
normalized. Every entry is validated before the first byte is staged, so an invalid
entry, a duplicate name or an existing entry refuses the whole proposal: no partial
publication, no overwrite, and no staging file left behind.

A proposal may carry a `mode` (ADR 0049): `create` (default) publishes new entries,
`replace` rewrites one existing entry in full — description, body and evidence —
against the `expectedRevision` its entry declares, on a valid and on an invalid entry
alike. A missing, wrong or stale revision is a `conflict` with reason
`revision_conflict` and leaves the file untouched; a name that does not exist is
`unknown_entry`, because a rewrite is not an upsert. Both modes run their whole
critical section — entry re-read, revision comparison, evidence stability re-check,
staging file and publication — under one catalogue lock
(`.tours/.memory/knowledge/.catalogue.lock`); `create` publishes by exclusive link,
`replace` by atomic rename, and readers take no lock. `origin` is never an input key:
the engine alone records that a file proof substitutes a symbol proof it could not
resolve.

The package reads, hashes and writes these files only: no model, no network, no API
key. The packaged `codetour knowledge` CLI and the historical Research Harness both
consume this package, so the contract exists once. See ADR 0039.

The historical `skills/codetour-knowledge` skill is retired: the CodeTour
Agent Plugins 1.0 plugin composes this contract into its served generation
prompt (`knowledge_list`, `knowledge_read`, `knowledge_save`,
`knowledge_close_run`), so every host receives the same method from the MCP
server instead of a second, CLI-first skill.
