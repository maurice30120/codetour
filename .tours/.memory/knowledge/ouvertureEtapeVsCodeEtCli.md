---
name: ouvertureEtapeVsCodeEtCli
description: VS Code ouvre une étape via getStepFileUri/showDocument; la CLI calcule un ReadonlyStepContext en lecture seule dans stepContext.ts.
evidence:
  - type: file
    path: src/player/index.ts
    sha256: 07ac007b49a3508ff0e489c0d0a55c790b14a6675540358bd8c74523cf444134
  - type: file
    path: src/cli/stepContext.ts
    sha256: 30983d56e7a3d3c60d7b0131bff9950eabb2d461b689f5f94472c45456e22486
  - type: file
    path: src/cli/tourResolution.ts
    sha256: 5d581cb06d3152830d3fddd548b175ede535bdbeb71fce7bfdc13dfbb88f09f6
---
VS Code: `renderCurrentStep` dans `src/player/index.ts` résout l'URI (diff, `getStepFileUri`), la ligne (`line`, `selection`, ou `pattern` en regex multiligne) puis `showDocument`/`showDiff`. CLI: `resolveReadonlyStepContext` (`src/cli/stepContext.ts`) renvoie diff, code, directory, unavailable ou none, avec 5 lignes de contexte autour de l'ancre. Sélection CLI: `resolveTourSelection` (`src/cli/tourResolution.ts`).