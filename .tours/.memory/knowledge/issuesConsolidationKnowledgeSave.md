---
name: issuesConsolidationKnowledgeSave
description: knowledge_save renvoie created, appended, replaced, no_change, completed_zero, conflict, invalid ou failed selon le mode (create, append, replace), et chaque issue est journalisée pour le runId.
evidence:
  - type: file
    path: packages/mcp-server/src/server.ts
    sha256: 4e2649d3588740afc009b254a91ff5c01a45b645790039749d8df9e2a62969d4
---
`handleKnowledgeSave` (packages/mcp-server/src/server.ts) traduit le résultat de `saveKnowledgeProposal` en statut observable : `created` (noms publiés), `appended` et `replaced` (une entrée enrichie ou réécrite, journalisée sous `changed` et non sous `created`), `no_change` (append qui n'ajoute rien de littéralement nouveau, clôturé `completed_zero`), `completed_zero` (proposition vide explicite), `conflict` (rien écrit : nom déjà pris par un `create`, ou `expectedRevision` périmée par un `replace`, la raison `revision_conflict` distinguant les deux), `invalid` (rejets listés, rien écrit) ou `failed` (`internal_error`). Avec un `runId`, `appendConsolidation` journalise l'issue — `conflict` et `invalid` en status `failed` — et accumule la clôture au fil des appels d'un même run au lieu de l'écraser ; un échec de persistance est signalé sans transformer un `save` réussi en erreur. `knowledge_close_run` enregistre `skipped`. Toute clôture rend le hook agentStop inerte.