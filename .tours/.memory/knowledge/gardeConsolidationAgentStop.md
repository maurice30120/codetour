---
name: gardeConsolidationAgentStop
description: Le hook agentStop du plugin Copilot bloque au plus une fois un run dont le Tour est créé sans consolidation, avec le runId de l’adaptateur.
evidence:
  - type: file
    path: .github/extensions/codetour/adapter.mjs
    sha256: fb45169ec228bb1dd94f4a9e6eb64077b3fdbf95663fbabe9ad1bd5d239c2f67
  - type: file
    path: packages/copilot-plugin/com.github.copilot/hooks/agent-stop.mjs
    sha256: 9bedbf6b3edc885d938b71be74b4ac5482df8205342330821205084dae7af08a
  - type: file
    path: packages/copilot-plugin/com.github.copilot/lib/run-log.mjs
    sha256: efc68e0a17d4a13b8165dea259ec126ebaaaf9f2a6cb15508d364a20086b4417
---
L’adaptateur (.github/extensions/codetour/adapter.mjs) crée un `runId` par `randomUUID()`, le passe au prompt MCP et écrit un état de run sous `.tours/.log` (run-log.mjs). Le hook `agent-stop.mjs` ne bloque que si `tourCreated` est vrai, qu’aucune consolidation n’est enregistrée et que `continuationUsed` est faux ; il le marque avant de bloquer, donc une seule continuation par arrêt. La raison demande `knowledge_save` (zéro, une ou plusieurs entrées) ou `knowledge_close_run` skipped.