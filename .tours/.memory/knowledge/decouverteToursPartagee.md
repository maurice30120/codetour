---
name: decouverteToursPartagee
description: VS Code et la CLI découvrent les Tours via la même discoverToursFromRoot (emplacements, .memory ignoré, fichiers invalides ignorés, filtre when).
evidence:
  - type: file
    path: src/core/tourDiscovery.ts
    sha256: 38af746ea60d4f81b240e96bc9f4904293c16d104b47997bf0959af79a4c96b3
  - type: file
    path: src/store/provider.ts
    sha256: 31ee4884306c1313fd9bf434b256a5751757c9b7a2051f4d72c1b685a032c099
---
`src/core/tourDiscovery.ts` définit `MAIN_TOUR_FILES` et `SUB_TOUR_DIRECTORIES` et `discoverToursFromRoot`, qui lit récursivement les dossiers (en ignorant `.memory`), ignore silencieusement les fichiers illisibles ou invalides, place les sous-Tours avant les fichiers principaux. `visibleTours` trie par titre et filtre par `when` (jexl). VS Code (`src/store/provider.ts`) et la CLI (`discover` dans `src/cli/index.ts`) fournissent chacun leur `TourFilesystem`; l'id est l'URI pour VS Code et une URL de fichier pour la CLI.