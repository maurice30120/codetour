# Problèmes rencontrés et plan de correction

## Contexte

Un Project Tour a été généré pour expliquer le fonctionnement de CodeTour, avec un accent sur la génération et le rendu des diagrammes Mermaid.

La génération finale a réussi et a produit un tour de 10 étapes dans `.tours/project.tour`. Ce document décrit les difficultés rencontrées pendant cette opération et le plan précis pour rendre le processus plus robuste. Aucun correctif de code n'est inclus dans ce document.

## Problèmes rencontrés

### 1. Ancres `pattern` refusées par le serveur MCP

Le serveur MCP valide chaque ancre contre le contenu réel du workspace. Deux ancres ont été refusées :

- l'ancre de `discoverTours` dans `src/store/provider.ts` ;
- l'ancre de `renderMermaidDiagram` dans `packages/description-renderer/src/render.ts` lors d'une première tentative.

La cause était une différence entre le motif regex proposé et la forme exacte reconnue par le validateur. Le serveur exige qu'un motif corresponde à exactement une occurrence. Une proposition invalide ne remplace pas l'ancien fichier, ce qui a correctement protégé le tour existant.

L'ancre de `discoverTours` a continué à être refusée malgré une signature visible dans la recherche. Pour terminer le tour sans ancre fragile, cette étape secondaire a été retirée de la proposition finale.

### 2. Première exécution du build interrompue par l'environnement

La première exécution de `npm run build` s'est arrêtée avec le code 130 après le build du renderer et du serveur MCP. Elle n'a pas fourni d'erreur de compilation exploitable.

Le build a été relancé avec une exécution adaptée et a réussi jusqu'au bout :

- build de `packages/description-renderer` ;
- build de `packages/mcp-server` ;
- compilation webpack de l'extension ;
- préparation du runtime `resvg`.

Il s'agissait donc d'une interruption d'exécution, pas d'un défaut identifié dans le code ou dans le tour généré.

### 3. Risque de dépendance entre validation et rendu

Mermaid est validé lors de la génération par le serveur MCP, puis rendu plus tard par l'extension. Le projet prévoit déjà un moteur partagé, mais cette double étape reste un point de vigilance : une divergence de version, de configuration ou de règles pourrait accepter un diagramme à la génération et le faire échouer à la lecture.

Le tour final explique ce partage, mais le plan ci-dessous propose de le protéger explicitement par des tests de contrat.

## Plan précis de correction

### Étape 1 - Rendre la préparation des ancres déterministe

**Objectif :** éviter les refus dus à des motifs approximatifs.

1. Lire la signature exacte depuis le fichier ciblé, sans la reconstruire de mémoire.
2. Vérifier le nombre d'occurrences du motif dans le fichier.
3. Utiliser en priorité un motif stable et unique.
4. Utiliser une ligne explicite uniquement lorsque le motif stable ne peut pas être rendu unique.
5. Éviter de supprimer une étape simplement parce qu'une ancre est difficile à écrire ; documenter plutôt le choix de l'ancre de repli.

**Validation attendue :** chaque ancre du tour est acceptée par le validateur et correspond à une seule cible réelle.

### Étape 2 - Ajouter une vérification locale avant l'appel MCP

**Objectif :** détecter immédiatement les motifs invalides.

1. Parcourir les étapes proposées avant l'appel à `create_project_tour`.
2. Pour chaque étape avec `file` et `pattern`, compter les correspondances dans le fichier.
3. Signaler localement les cas `0 occurrence` et `plusieurs occurrences`.
4. Afficher le fichier, le motif et le nombre trouvé dans le message d'erreur.
5. Ne soumettre au serveur MCP que les propositions qui passent cette vérification.

**Validation attendue :** une ancre incorrecte est détectée avant l'écriture ou l'appel de génération, avec un message actionnable.

### Étape 3 - Tester les ancres représentatives du tour

**Objectif :** couvrir les types de cibles utilisés par les Project Tours.

Ajouter ou vérifier des tests pour :

- une cible de type `directory` ;
- un fichier avec un motif unique ;
- un motif absent ;
- un motif ambigu ;
- une ligne explicite utilisée comme solution de repli.

**Validation attendue :** le validateur conserve un comportement strict et ses erreurs indiquent clairement la cause.

### Étape 4 - Garantir le contrat Mermaid génération/lecture

**Objectif :** vérifier que ce qui est accepté par MCP est lisible par l'extension.

1. Maintenir une liste commune des types Mermaid autorisés.
2. Valider les mêmes limites des deux côtés : légende, taille maximale de 20 KB et trois diagrammes maximum par description.
3. Tester chaque type accepté : `flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `classDiagram` et `erDiagram`.
4. Vérifier que la validation MCP et le rendu player utilisent la même version verrouillée de Mermaid.
5. Tester un diagramme invalide et confirmer que le texte alternatif et l'avertissement sont affichés sans exposer la source Mermaid.

**Validation attendue :** tout diagramme accepté par MCP est rendu par le player, sauf erreur de rendu explicitement signalée.

### Étape 5 - Vérifier le comportement de persistance

**Objectif :** préserver un tour valide lorsqu'une nouvelle génération échoue.

1. Générer un tour valide de référence.
2. Soumettre une proposition avec une ancre invalide ou une source Mermaid invalide.
3. Vérifier que l'opération retourne toutes les erreurs détectées.
4. Vérifier que `.tours/project.tour` contient toujours l'ancien tour valide.
5. Soumettre ensuite une proposition valide et vérifier le remplacement atomique.

**Validation attendue :** aucune proposition partiellement invalide ne laisse un fichier `.tour` incomplet.

### Étape 6 - Stabiliser la validation du build

**Objectif :** distinguer les interruptions d'environnement des erreurs du projet.

1. Exécuter `npm run build` dans un terminal standard.
2. En cas d'arrêt sans erreur de compilation, relever le code de sortie et la dernière étape exécutée.
3. Relancer dans un environnement non interrompu avant d'ouvrir une investigation de code.
4. Conserver dans le rapport les sorties des étapes renderer, MCP, webpack et resvg.
5. Ne traiter comme régression que les erreurs reproductibles après un second lancement.

**Validation attendue :** deux exécutions consécutives terminent avec succès, ou toute défaillance restante est reproductible et localisée.

## Critères d'acceptation

- Les Project Tours générés ne contiennent que des ancres validées et uniques.
- Les erreurs de motif indiquent le fichier, le motif et la cause.
- Les cinq types Mermaid autorisés sont couverts par des tests de validation et de rendu.
- Une erreur Mermaid n'efface pas un tour existant valide.
- Les sources Mermaid sont remplacées par des images PNG en mémoire pendant la lecture.
- Le build complet passe après génération du tour.
- Le fichier de documentation est le seul livrable ajouté par ce plan ; aucune modification de code n'est demandée ici.

## Résultat actuel

Le Project Tour final a été créé avec succès après correction de la proposition d'ancres. Les diagrammes Mermaid ont été validés par le serveur MCP, et le build complet a réussi lors de la seconde exécution.
