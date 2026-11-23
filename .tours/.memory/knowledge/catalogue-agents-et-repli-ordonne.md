---
name: catalogue-agents-et-repli-ordonne
description: Règle générale : le catalogue d'agents CodeTour est une constante versionnée avec rang explicite (Copilot, Vibe, Pi, Codex, Claude Code) ; le repli automatique ne glisse vers un rang inférieur qu'avant la première réponse, ensuite le même profil est retenté. Exception : un profil non lançable rend undefined et doit être déclaré en erreur de connexion.
evidence:
  - type: file
    path: src/agent/agentCatalogue.ts
    sha256: e740b89bb0363d0c268a87394aa1457617b199aac9db98a8076253e1dac637bf
  - type: file
    path: src/agent/fallbackStepChatAgent.ts
    sha256: 94366b9421b51a21dcd3dbc7f18c01fb6d80a1912051579893c7fff873406136
  - type: file
    path: src/cli/stepChatSupport.ts
    sha256: 060ac942e59282f79027de45b26cfd623f13be91b4aebf6ce6a1ce9e8c547411
  - type: file
    path: src/player/stepChat.ts
    sha256: 0dee489f8ad8a602a5ec14471a35ff5a71853601831723381fa9546db6f90e40
  - type: file
    path: docs/adr/0048-select-the-acp-agent-and-model-explicitly.md
    sha256: cd689602cfcd6299fad3668577615fd62e82da37cb43a0454c19abc98b8d97a3
---
**Règle générale — catalogue et sélection.** `AGENT_CATALOGUE` (`src/agent/agentCatalogue.ts`) est une constante versionnée de cinq Agent Profiles avec un `rank` explicite : Copilot 0, Vibe 1, Pi 2, Codex 3, Claude Code 4. L'ordre du rang décide de la sélection et du repli ; aucune découverte ni registre distant n'intervient. `AgentSelection` (même fichier) porte l'état du panneau : disponibilité classifiée puis sondée, choix explicite du lecteur définitif, mémoire du modèle par profil, et `dispose()` qui n'oublie rien de moins que tout ce qui a été établi.

**Règle générale — glissement du repli.** `AgentSelection.candidates()` n'expose qu'un candidat dès qu'un choix explicite existe ou qu'une conversation a commencé (`hasExplicitSelection()` / `started`) ; sinon il ajoute les autres profils `available` par rang. `createFallbackStepChatResponder` (`src/agent/fallbackStepChatAgent.ts`) applique la même règle côté responder : une fois qu'un profil a répondu (`answered`), les questions suivantes ne s'adressent qu'à lui, et une réponse qui a déjà diffusé du texte ne recolle jamais un autre agent (`streamed`).

**Exception — profil non lançable.** `AgentProfile.entry(cwd)` peut rendre `undefined` : c'est le cas de Pi quand le lanceur restreint ne peut pas être fourni (Windows, échec d'écriture). Un tel profil doit être rapporté comme `connection-error` et jamais démarré sans limite ; `catalogueProfiles()` l'omet simplement de la liste lançable.

**Portée vérifiée.** Lecture des deux modules ci-dessous et de la composition des deux surfaces de production (`src/cli/stepChatSupport.ts` et `src/player/stepChat.ts`, qui composent toutes deux ce responder). Le lecteur terminal ne lance pas la sonde et ne passe pas de `modelFor` : son choix de modèle vaut pour la session ouverte, exception documentée par l'ADR 0052.