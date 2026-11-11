# 01: Détection automatique du type de Tour (Changes vs Project)

**What to build:** Le serveur MCP détermine automatiquement si une demande de Tour est un **Changes Tour** (diff/PR) ou un **Project Tour** (découverte) basé sur les paramètres de la requête. La détection utilise une logique simple : présence de `baseRef` ET `headRef` = Changes Tour → approche C, sinon = Project Tour → approche D.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] La détection identifie correctement un Changes Tour quand `baseRef` et `headRef` sont présents
- [ ] La détection identifie correctement un Project Tour quand `baseRef` et/ou `headRef` sont absents
- [ ] La détection fonctionne avec les paramètres `workspacePath` seul
- [ ] La détection est implémentée dans le serveur MCP (`server.ts`)
- [ ] Des tests unitaires valident la logique de détection
- [ ] La rétro-compatibilité est maintenue avec les appels existants
