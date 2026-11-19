---
name: progressionLectureVsCodeSeulement
description: La progression est dans globalState (codetour:progress) côté VS Code, écrite en quittant une étape; la CLI n'en persiste aucune.
evidence:
  - type: file
    path: src/store/storage.ts
    sha256: ea0ab1ab41babd8c0b2cef456eac62eb0e9697f70d84fa76c695606f0ba45f38
  - type: file
    path: src/store/actions.ts
    sha256: 8a00540b11561613e570ce174479d8f8708ab944b9c7923871bf28886eb2a352
---
`src/store/storage.ts` conserve `[idTour, étapes]` dans `context.globalState` sous `codetour:progress`. `progress.update()` est appelé par `moveCurrentCodeTourForward` (`src/store/actions.ts`) et `finishTour` (`src/player/commands.ts`). Le lecteur CLI (`src/cli`) n'écrit aucune progression.
