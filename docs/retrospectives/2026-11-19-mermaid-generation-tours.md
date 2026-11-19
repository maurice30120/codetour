# Génération Mermaid dans les Tours : problème et pistes

## Constat

Lors de deux générations de Project Tours avec Copilot CLI, le serveur MCP
CodeTour a refusé une première proposition : le diagramme Mermaid de l'étape
d'orientation contenait des libellés d'arêtes avec des parenthèses non citées.
Dans les deux cas, Copilot a reçu le diagnostic, corrigé le diagramme et obtenu
la création du Tour lors d'une nouvelle tentative.

- `discovery-codetour-2026.tour` : refus à 10:58:07 UTC, création à 10:58:20 UTC.
- `knowledge-reuse-2026.tour` : refus à 11:02:42 UTC, création à 11:02:58 UTC.

Ces intervalles comprennent le travail de Copilot et les appels d'outils ; ils
ne mesurent pas isolément le coût de validation Mermaid. Ils ne suffisent pas à
conclure sur la fréquence générale du problème ou sur une économie de tokens.
Le [carnet d'essai](../../.scratch/spec223-parcours-2026-11-19.md) contient le
contexte et les mesures disponibles ; il se trouve dans `.scratch`, ignoré par
Git, et peut donc être absent d'un autre checkout.

L'exemple d'arête présent dans les indications du serveur était lui-même
invalide pour un `flowchart` avec le moteur Mermaid de CodeTour. Le diagnostic
local a confirmé que l'exemple initial échouait et qu'une arête dont le libellé
est entre guillemets passait. Ce constat ne prouve pas que cet exemple était la
cause unique des erreurs produites par Copilot.

## Comportement actuel et correction engagée

Le serveur valide les diagrammes pendant `create_project_tour`, avant l'écriture
du Tour. Cette validation utilise le moteur de rendu partagé avec la lecture et
préserve le Tour précédent en cas de refus. Les règles actuelles comprennent une
légende `**Diagram — …**`, les types autorisés et des limites de taille et de
nombre ; voir [la décision sur Mermaid](../adr/0007-render-mermaid-diagrams-within-codetour.md)
et [la validation MCP](../../packages/mcp-server/src/mermaid-validation.ts).

Dans les changements locaux, l'exemple fourni par `create_project_tour` est
remplacé par un exemple valide, accompagné d'une indication sur les guillemets.
Un test d'intégration récupère l'exemple exposé par le MCP et le fait rendre par
le moteur utilisé par CodeTour. La suite MCP a passé après correction. Une
validation de l'effet sur les générations Copilot reste à établir : un exemple
valide n'empêche pas le modèle de produire un autre diagramme invalide.

## Pistes

### 1. Guide court exposé par le MCP

Conserver dans les indications de l'outil les quelques règles nécessaires à une
utilisation courante et proposer, via une ressource MCP consultable à la demande,
un guide plus détaillé : types pris en charge, légende, limites, pièges fréquents
et exemples complets. Les exemples doivent être exécutés automatiquement avec
le moteur verrouillé de CodeTour. Une ressource à la demande évite de charger
systématiquement un guide long dans chaque contexte.

### 2. Outil MCP de validation ciblée

Un outil éventuel `validate_mermaid` pourrait recevoir une source et, si le
contrat le prévoit, sa légende, puis renvoyer un résultat structuré : validité,
catégorie d'erreur et localisation fiable lorsqu'elle est disponible. Pour une
erreur reconnue, il pourrait fournir une suggestion seulement si celle-ci est
produite de manière déterministe ; sinon, il doit donner le diagnostic connu sans
inventer de correction. L'outil réutiliserait le même moteur et les mêmes règles
que la création du Tour ; Copilot resterait auteur du diagramme et aucun second
modèle ne serait nécessaire.

L'appel préalable serait facultatif et ne remplacerait pas la validation finale
de `create_project_tour` : le contenu peut changer entre les deux appels. Il
faudrait préciser le contrat, notamment la représentation des erreurs, le
traitement de la légende, les limites, les résultats quand une ligne ou colonne
n'est pas disponible et l'absence d'écriture de fichiers.

### 3. Améliorer les diagnostics existants

Avant d'ajouter un outil, examiner si la réponse actuelle de création peut
exposer une erreur plus exploitable : distinguer légende, type, taille et
syntaxe ; indiquer la position lorsque le moteur la fournit de façon fiable ;
garder un extrait borné et éviter d'exposer des données inutiles. Cette piste
conserve un seul appel dans le cas nominal, mais intervient après la soumission
du Tour complet.

Ces options peuvent se compléter. Le choix entre ressource, outil préalable et
diagnostic enrichi doit être guidé par des essais : un appel de validation
supplémentaire a lui-même un coût et n'est pas automatiquement rentable.

## Vérification proposée

1. Tester chaque exemple servi avec le moteur de rendu verrouillé et les règles
   de validation réellement utilisées par le MCP ; inclure des exemples
   volontairement invalides et vérifier des réponses structurées utiles.
2. Si un outil préalable est ajouté, vérifier qu'il n'écrit aucun Tour, que ses
   résultats concordent avec la validation finale et que les diagnostics ne
   prétendent pas à une localisation ou une correction non fiable.
3. Relancer de vraies générations Copilot avant et après, sur des briefs, un
   instantané du projet, des outils, un modèle et des budgets équivalents. Noter
   l'ordre, le cache, les appels, les refus, la qualité du Tour et les échecs.
4. Séparer le temps et les tokens du guide ou de la validation préalable, de la
   génération, des reprises et de la consolidation. Une seule comparaison ne
   démontre ni une réduction générale des erreurs ni une économie de tokens.
