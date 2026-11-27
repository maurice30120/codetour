# Simplification de CodeTour : skill et CLI sans MCP

## Problem Statement

L'utilisateur doit installer et maintenir une intégration MCP pour demander à un agent de créer un Tour. Cette couche s'ajoute à la CLI, au skill et aux intégrations des agents. Le parcours est trop complexe pour une opération qui peut être réalisée par l'agent et une commande locale. Les problèmes de proposition doivent apparaître directement lors de la création, sans étape de dry-run séparée.

## Solution

L'utilisateur sélectionne Copilot CLI ou Pi depuis la CLI CodeTour. L'installation met en place le skill et, lorsque l'agent le permet, un hook déterministe. L'agent utilise le skill pour analyser le Tour Workspace et appelle la CLI avec sa proposition. La CLI valide et crée le Tour, ou retourne directement les problèmes. Aucun serveur MCP CodeTour n'est nécessaire.

En fin de réponse, le hook affiche les Tours créés pendant cette réponse et les tokens observés. Il ne contrôle pas l'agent. Si les tokens ou le hook ne sont pas disponibles, la création reste utilisable et la limite est signalée.

## User Stories

1. En tant qu'utilisateur, je veux sélectionner les agents à intégrer depuis la CLI, afin d'installer seulement ce dont j'ai besoin.
2. En tant qu'utilisateur de Copilot CLI, je veux installer le skill CodeTour, afin de générer un Tour depuis mon agent.
3. En tant qu'utilisateur de Pi, je veux installer le même parcours, afin de générer un Tour depuis mon agent.
4. En tant qu'utilisateur, je veux désigner un agent explicitement, afin d'automatiser l'installation sans interaction.
5. En tant qu'utilisateur, je veux savoir si un agent est absent ou incompatible, afin de comprendre ce qui a été installé.
6. En tant qu'utilisateur, je veux réinstaller sans doublon, afin de mettre à jour le skill facilement.
7. En tant qu'utilisateur, je veux que mes fichiers et configurations tiers soient préservés, afin de ne pas perdre mes autres intégrations.
8. En tant qu'utilisateur, je veux désinstaller les éléments gérés par CodeTour, afin de retirer l'intégration proprement.
9. En tant qu'utilisateur, je veux diagnostiquer l'installation, afin de résoudre les problèmes de configuration.
10. En tant qu'utilisateur, je veux demander un Project Tour, afin de découvrir un projet.
11. En tant qu'utilisateur, je veux demander un Changes Tour neutre ou critique, afin de comprendre ou examiner des changements.
12. En tant qu'utilisateur, je veux donner une orientation et une langue au Tour, afin qu'il réponde à mon besoin.
13. En tant qu'utilisateur, je veux choisir le workspace à chaque génération, afin que l'installation ne me limite pas à un projet.
14. En tant qu'agent, je veux transmettre une proposition structurée à la CLI, afin que CodeTour applique ses règles de création.
15. En tant qu'agent, je veux transmettre une proposition volumineuse par entrée standard ou fichier, afin de ne pas dépendre de la longueur d'une commande.
16. En tant qu'agent, je veux recevoir des erreurs précises à la création, afin de corriger une proposition invalide.
17. En tant qu'utilisateur, je veux que la validation précède l'écriture, afin d'éviter un Tour invalide ou une écriture partielle.
18. En tant qu'utilisateur, je veux que les ancres restent dans le workspace, afin que le Tour concerne le projet choisi.
19. En tant qu'utilisateur, je veux garder les validations des changements Git, des images et des diagrammes, afin que le Tour créé soit exploitable.
20. En tant qu'utilisateur, je veux que le Tour créé s'ouvre dans les lecteurs existants, afin de conserver mon parcours de lecture.
21. En tant qu'utilisateur, je veux voir en fin de réponse les Tours réellement créés, afin de les retrouver.
22. En tant qu'utilisateur, je veux voir tous les Tours créés par une même réponse, afin de n'en manquer aucun.
23. En tant qu'utilisateur, je veux voir les tokens disponibles pour cette réponse, afin d'apprécier son coût.
24. En tant qu'utilisateur, je veux distinguer entrée, sortie et cache quand ces valeurs sont disponibles, afin de comprendre la mesure sans compter le cache deux fois.
25. En tant qu'utilisateur, je veux être informé si les tokens sont indisponibles ou approximatifs, afin de ne pas confondre absence de mesure et zéro ou estimation et mesure exacte.
26. En tant qu'utilisateur, je veux que le hook reste silencieux quand aucun Tour n'a été créé, afin de ne pas encombrer mes conversations.
27. En tant qu'utilisateur, je veux que le hook n'affiche pas les Tours d'une autre réponse ou session, afin que son récapitulatif soit fiable.
28. En tant qu'utilisateur, je veux que le hook ne bloque jamais l'agent, afin qu'un diagnostic ou une mesure indisponible ne bloque pas mon travail.
29. En tant qu'utilisateur existant, je veux migrer sans perdre mes Tours ni mes configurations tierces, afin de passer au nouveau parcours sereinement.
30. En tant qu'utilisateur, je veux continuer à lire et enregistrer manuellement des Tours et à utiliser les conversations existantes, afin de garder mes usages actuels.
31. En tant qu'utilisateur, je veux connaître la rupture de compatibilité MCP, afin de migrer mes éventuels clients tiers.

## Implementation Decisions

- La première livraison prend en charge **Copilot CLI et Pi uniquement**. Les agents sont installés séparément et ne sont pas authentifiés par CodeTour.
- L'installation interactive propose la sélection des agents ; une sélection explicite permet l'usage non interactif. Sans choix explicite ni terminal interactif, elle échoue avec une instruction utile. Les installations, mises à jour, désinstallations et diagnostics respectent la propriété des fichiers et ne remplacent pas silencieusement des éléments non reconnus.
- Le skill et ses ressources sont distribués avec la CLI autonome. Ils décrivent les Project Tours, Changes Tours, la revue critique, le choix du workspace, la proposition et les erreurs. Le Tour Generator est l'agent ; la CLI ne lance pas de modèle.
- La CLI expose des opérations de création de Project Tour et de Changes Tour, avec workspace explicite et proposition JSON fournie par fichier ou entrée standard. Les champs métier et comportements utiles des outils actuels sont conservés. Les résultats structurés sur stdout, diagnostics sur stderr et codes de sortie permettent à l'agent de distinguer succès et échec. Une erreur ne prétend jamais qu'un Tour a été créé.
- Il n'y a plus de dry-run ni d'étape de validation séparée dans le parcours. La création valide avant écriture et renvoie directement les erreurs ; elle conserve les contrôles métier, le confinement au workspace, la validation Git, Mermaid et images et la compatibilité des fichiers Tour. Une proposition invalide n'écrit pas de Tour et ne modifie pas un Tour existant.
- Les instructions, ressources et appels MCP de création sont remplacés par le skill et la CLI. Retirer le serveur MCP CodeTour, ses commandes, configurations, déclarations, distributions et dépendances exclusivement liées au protocole. Extraire les règles métier communes avant de retirer le transport. Les intégrations de lecture et les conversations ACP restent fonctionnelles.
- L'installation installe également le hook propre à l'agent lorsque l'hôte le permet. Le hook est déterministe, purement informatif et ne bloque ni ne relance l'agent. Il ne déclenche aucun appel à un modèle. Il affiche les titres et chemins de tous les Tours dont la création réussie peut être rattachée à la session et à la réponse courantes ; il reste silencieux si aucun Tour n'est identifié.
- Le hook présente un seul relevé de tokens pour la réponse, et non une attribution par Tour. Il affiche entrée, sortie et cache lorsqu'ils sont disponibles, sans double comptage, et qualifie la mesure approximative si son périmètre ne permet pas une attribution exacte. Lorsque les tokens ne sont pas observables, il indique leur indisponibilité, jamais zéro par défaut. L'indisponibilité du hook ou des tokens ne fait pas échouer la création.
- Le mécanisme de rattachement entre création CLI et hook doit distinguer sessions et réponses concurrentes et ne jamais attribuer un ancien Tour par supposition. Réutiliser les points d'intégration existants des agents lorsque c'est possible. Copilot dispose déjà d'un hook de fin et de données de session ; Pi dispose d'un événement de fin, mais l'accès à ses tokens reste à vérifier. Ne garantir que les données observables.
- La migration ne retire que les anciennes configurations et fichiers dont CodeTour peut établir la propriété ; elle signale les éléments ambigus et préserve les Tours existants et les configurations tierces. Les clients MCP tiers ne sont plus pris en charge ; documenter la rupture et le remplacement.
- Mettre à jour la documentation active et les glossaires ; conserver les ADR historiques et enregistrer une nouvelle décision qui remplace les choix de transport et d'intégration concernés, notamment les ADR 0030 et 0041. Les anciens mécanismes d'état, de garde et de métriques liés au MCP ne sont conservés que s'ils servent le contrat ci-dessus ; aucune garantie supplémentaire n'est implicite.

## Testing Decisions

- Tester les comportements observables aux points d'entrée les plus hauts possibles : installation CLI, commande de création, et session ou événements d'intégration des agents. Les tests vérifient les résultats plutôt que l'organisation interne.
- Réutiliser les tests existants de la CLI, de validation et persistance des Tours et des intégrations Copilot/Pi comme exemples. Vérifier depuis l'artefact autonome et sans serveur MCP.
- Couvrir sélection et installation, répétition, désinstallation, conflits de propriété, absence d'agent et chemins contenant des espaces.
- Créer les deux types de Tours et les lire avec les lecteurs existants ; couvrir le mode critique, le workspace explicite, les entrées fichier et stdin, les refus et codes de sortie, les erreurs Git, ancres, Mermaid et images, et l'absence d'écriture partielle.
- Vérifier pour chaque agent pris en charge le récapitulatif d'une création, de plusieurs créations, d'aucune création, de sessions concurrentes et de données de tokens absentes ou partielles. Vérifier qu'il ne bloque jamais et ne compte pas le cache deux fois. Compléter par un parcours réel pour chaque agent lorsque disponible ; signaler les limites observées.
- Vérifier la migration et la préservation des Tours et configurations tiers, l'absence de démarrage et de déclaration du serveur MCP CodeTour et les non-régressions de lecture et de conversations ACP.

## Out of Scope

- Support de Codex et d'autres agents dans cette première livraison ; création d'un plugin Codex.
- Serveur MCP CodeTour et compatibilité des anciens clients MCP.
- Dry-run ou commande de validation de proposition distincte de la création.
- Mise en place d'un modèle, d'une authentification d'agent ou d'un nouveau système de garde, de relance ou de télémétrie.
- Attribution prétendument exacte des tokens à chaque Tour quand l'hôte ne la fournit pas.

## Further Notes

Le hook Copilot existant est déjà informatif et lit des données de session dont les frontières ne garantissent pas une attribution exacte. Pi possède un événement de fin ; sa capacité à fournir des tokens doit être vérifiée pendant l'implémentation. Si un hôte ne fournit pas une identité de réponse fiable, ne pas deviner le rattachement ; signaler la limite et conserver la création utilisable.
