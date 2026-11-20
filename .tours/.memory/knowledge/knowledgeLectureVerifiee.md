---
name: knowledgeLectureVerifiee
description: La lecture d’une Knowledge vérifie chaque preuve fichier (chemin confiné, lien symbolique, SHA-256) avant de renvoyer le corps.
evidence:
  - type: file
    path: packages/knowledge/src/knowledge.ts
    sha256: ca3ba6819f7d5f1fec61fa8d5635d3d977fda4719373432f7837b8000e557a6a
  - type: file
    path: packages/mcp-server/src/knowledge.ts
    sha256: 6730caf3ce3bc01d19ae561fab6e5194054cb2ddcb5df45c5299761389b02106
---
`verifyKnowledge` (packages/knowledge/src/knowledge.ts) vérifie TOUTES les preuves `file` d’une entrée : chemin relatif non absolu, confiné au workspace, sans lien symbolique sortant, et empreinte SHA-256 identique aux octets. Au premier échec, l’entrée est refusée avec une raison (`file_missing`, `path_outside_workspace`, `symlink_escape`, `file_hash_mismatch`) sans corps. Le prompt MCP n’expose que le catalogue (nom et description) via `knowledgeCatalogueProjection` (packages/mcp-server/src/knowledge.ts).