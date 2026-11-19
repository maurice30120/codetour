# codetour-knowledge

The single deterministic source of the Knowledge contract used by CodeTour:

- `parseKnowledge(source, fileName)` — restricted frontmatter grammar, never touches the workspace.
- `fileProofHash(bytes)` — deterministic SHA-256 of cited bytes.
- `verifyKnowledge(entry, root)` — every declared `file` proof must stay inside the
  workspace, avoid symlink escapes and match its SHA-256 before the body is returned.
- `loadKnowledgeLibrary(root, directory)` — `catalog()`, `list(query)` and `read(name)`
  over `<workspace>/.tours/.memory/knowledge`.
- `hashWorkspaceFile(root, path)` — the same confinement rules for preparing evidence.
- `saveKnowledgeProposal(root, proposal)` — validate a whole proposal, compute or
  verify every SHA-256 proof, then publish `{status:"saved"|"no-op"|"conflict"|"invalid"}`.
  Nothing is written unless every entry is valid and no `<name>.md` exists.
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

The package reads, hashes and writes these files only: no model, no network, no API
key. The packaged `codetour knowledge` CLI and the historical Research Harness both
consume this package, so the contract exists once. See ADR 0039.

`skills/codetour-knowledge/SKILL.md` is the native Copilot skill that composes
this contract with the CodeTour MCP. It is the readable source of truth; its
text is embedded into the root CLI bundle by `node scripts/embed-knowledge-skill.js`
so `codetour --install copilot` can install it without a checkout. Edit the
Markdown, regenerate, and commit both copies.
