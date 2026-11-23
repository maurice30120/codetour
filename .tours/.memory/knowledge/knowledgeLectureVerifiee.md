---
name: knowledgeLectureVerifiee
description: La lecture d’une Knowledge vérifie chaque preuve (fichier et symbole : chemin confiné, lien symbolique, SHA-256) avant de renvoyer le corps.
evidence:
  - type: file
    path: packages/knowledge/src/knowledge.ts
    sha256: 606d568f5d6a2bd4055c53be8b7828e0dbb76ea024630b54952661faec46bf90
  - type: file
    path: packages/mcp-server/src/knowledge.ts
    sha256: 2e1a81c2d3b9eb53ce4746487baaa722066a5172edbc4d9c7f1c83bb7d558ebe
---
`verifyKnowledge` (packages/knowledge/src/knowledge.ts) vérifie TOUTES les preuves `file` et `symbol` d’une entrée : chemin relatif non absolu, confiné au workspace, sans lien symbolique sortant, et empreinte SHA-256 identique aux octets. Au premier échec, l’entrée est refusée avec une raison (`file_missing`, `path_outside_workspace`, `symlink_escape`, `file_hash_mismatch`) sans corps. Le prompt MCP n’expose que le catalogue (nom, description et révision) via `knowledgeCatalogueProjection` (packages/mcp-server/src/knowledge.ts).