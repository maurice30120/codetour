---
name: issuesConsolidationKnowledgeSave
description: knowledge_save renvoie created, completed_zero, conflict, invalid ou failed, et chaque issue est journalisée pour le runId.
evidence:
  - type: file
    path: packages/mcp-server/src/server.ts
    sha256: ea7f380f502f055fc3af4a78be88e995c80828d03548390b6935d836ab29d355
---
`handleKnowledgeSave` (packages/mcp-server/src/server.ts) traduit le résultat de `saveKnowledgeProposal` en statut observable : `created` (noms publiés), `completed_zero` (proposition vide explicite), `conflict` (nom existant, rien écrit), `invalid` (rejets listés, rien écrit) ou `failed` (`internal_error`). Avec un `runId`, `appendConsolidation` journalise l'issue (conflict et invalid en status `failed`). `knowledge_close_run` enregistre `skipped`. Toute clôture rend le hook agentStop inerte.
