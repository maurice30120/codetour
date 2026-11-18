# codetour-knowledge

The single deterministic source of the Knowledge contract used by CodeTour:

- `parseKnowledge(source, fileName)` — restricted frontmatter grammar, never touches the workspace.
- `fileProofHash(bytes)` — deterministic SHA-256 of cited bytes.
- `verifyKnowledge(entry, root)` — every declared `file` proof must stay inside the
  workspace, avoid symlink escapes and match its SHA-256 before the body is returned.
- `loadKnowledgeLibrary(root, directory)` — `catalog()`, `list(query)` and `read(name)`
  over `<workspace>/.tours/.memory/knowledge`.
- `hashWorkspaceFile(root, path)` — the same confinement rules for preparing evidence.
- `validateCanonicalName(name)` — the shared identifier rule for Memory Methods and
  Knowledge entries.

The package reads and hashes files only: no model, no network, no API key. The
packaged `codetour knowledge` CLI and the historical Research Harness both consume
this package, so the contract exists once. See ADR 0039.
