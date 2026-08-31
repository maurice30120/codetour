# Roadmap

L'objectif est de proposer des Tours générés par une IA pour expliquer un projet ou les changements apportés à son code.

## Priorité immédiate — Diagrammes Mermaid

Permettre à l'IA de générer des diagrammes Mermaid afin de rendre les Tours plus visuels. Ils pourraient notamment expliquer l'architecture d'un projet, un parcours d'exécution, les dépendances entre modules ou l'enchaînement des changements d'une branche.

- [ ] Identifier les types de diagrammes les plus utiles pour chaque Tour : flux, séquence, classes, états et dépendances.
- [ ] Définir quand un diagramme apporte plus de clarté qu'une explication textuelle afin d'éviter d'en générer systématiquement.
- [ ] Étudier les possibilités d'affichage de Mermaid dans VS Code : rendu Markdown natif, Webview dédiée ou conversion en image locale.
- [ ] Concevoir une interface simple qui accepte une source Mermaid et masque les détails du moteur de rendu aux générateurs de Tours.
- [ ] Autoriser les blocs de code `mermaid` dans le contenu généré tout en conservant un format `.tour` compatible avec CodeTour.
- [ ] Valider la syntaxe Mermaid avant d'enregistrer le Tour et retourner une erreur actionnable en cas de diagramme invalide.
- [ ] Encadrer la génération par des limites de taille, de complexité et de fonctionnalités pour préserver la lisibilité et la sécurité.
- [ ] Prévoir un rendu de secours lisible, sous forme de code Mermaid ou de texte, lorsque le diagramme ne peut pas être affiché.
- [ ] Ajouter des tests couvrant la génération, le rendu, les erreurs de syntaxe et l'ouverture d'un Tour contenant plusieurs diagrammes.
- [ ] Créer un prototype avec un diagramme d'architecture dans un Project Tour et un diagramme de séquence dans un Changes Tour.
- [ ] Documenter la syntaxe supportée et ajouter des exemples de bons diagrammes dans les instructions de génération.

### Critères de réussite

- Le lecteur peut comprendre une relation complexe sans quitter le Tour.
- Un diagramme invalide ne rend pas le reste du Tour inutilisable.
- Le Tour reste lisible dans un environnement ne prenant pas en charge Mermaid.
- La génération et l'affichage ne nécessitent aucun accès réseau.

## Priorité 1 — Modes de génération

### Project Tour

Expliquer le rôle du projet, sa structure et ses principaux parcours d'exécution.

- [ ] Définir les informations minimales attendues dans un Project Tour.
- [ ] Générer un parcours progressif allant du point d'entrée vers les modules importants.
- [ ] Vérifier que les Tour Anchors restent pertinents lorsque le code évolue.
- [ ] Ajouter un exemple de Project Tour dans la documentation.

### Explication de la review

Présenter les remarques d'une revue de code, leur contexte et les corrections attendues.

- [ ] Définir la source de la review : commentaires locaux, GitHub Issues ou pull request.
- [ ] Déterminer si cette fonctionnalité doit être un mode distinct ou une présentation spécialisée du Changes Tour.
- [ ] Associer chaque remarque à un Tour Anchor et indiquer sa priorité.
- [ ] Distinguer clairement les problèmes, les suggestions et les points positifs.
- [ ] Prévoir le comportement lorsqu'une remarque ne peut pas être associée à une ligne stable.

### Changes Tour

Expliquer l'intention, l'implémentation et l'impact des changements depuis la divergence avec la branche de base.

- [ ] Détecter et afficher clairement la branche ou la référence de base utilisée.
- [ ] Regrouper les changements par intention plutôt que par ordre des fichiers.
- [ ] Signaler les changements non commités lorsqu'ils sont explicitement inclus.
- [ ] Mettre en évidence les impacts sur les tests, la configuration et les migrations.
- [ ] Ajouter un exemple de Changes Tour dans la documentation.

## Priorité 2 — Qualité des Tours

- [ ] Définir des critères de qualité communs : exactitude, concision, ordre pédagogique et pertinence des Tour Anchors.
- [ ] Ajouter des tests d'intégration pour chaque mode et pour leurs principaux cas d'erreur.
- [ ] Vérifier les Tours générés sur plusieurs structures de dépôt représentatives.
- [ ] Fournir des erreurs actionnables lorsqu'un fichier, une référence Git ou un Tour Anchor est invalide.
- [ ] Permettre de prévisualiser puis de confirmer le remplacement d'un Tour généré existant.

### Tests unitaires de l'extension VS Code

- [ ] Installer et configurer un framework de tests unitaires compatible avec TypeScript et les modules de l'extension.
- [ ] Séparer la logique métier des dépendances directes à VS Code afin qu'elle puisse être testée sans lancer l'éditeur.
- [ ] Créer des adapters minimaux pour simuler les interfaces VS Code uniquement lorsqu'elles varient réellement dans les tests.
- [ ] Tester en priorité le chargement, la validation, la navigation et la mise à jour des Tours.
- [ ] Tester la résolution des Tour Anchors ainsi que les cas de fichiers ou de lignes devenus introuvables.
- [ ] Tester la génération du contenu de prévisualisation et les principaux cas limites Markdown.
- [ ] Tester les erreurs liées à Git et aux références associées aux Changes Tours.
- [ ] Ajouter une commande `test:unit` et l'intégrer à la commande globale `npm test`.
- [ ] Exécuter les tests unitaires dans l'intégration continue et publier un rapport exploitable en cas d'échec.
- [ ] Définir un objectif de couverture initial centré sur les modules critiques, sans imposer un pourcentage global artificiel.

## Priorité 3 — Simplification et maintenance

- [ ] Auditer la fonctionnalité d'ouverture d'un Tour par URL, ses usages et ses dépendances.
- [ ] La supprimer si elle n'est plus utile et si cela simplifie l'interface et l'implémentation du projet.
- [ ] Nettoyer les commandes, dépendances, tests et éléments de documentation devenus inutiles après sa suppression.
- [ ] Centraliser la validation et la persistance partagées par les modes de génération derrière une interface réduite.
- [ ] Documenter les décisions structurantes dans un ADR lorsqu'un choix modifie les contrats existants.

## Plus tard

- [ ] Étudier l'historique des Tours sans remettre en cause les fichiers générés stables de la version actuelle.
- [ ] Évaluer les Tours interactifs et conditionnels avec des règles de sécurité explicites.
- [ ] Recueillir des métriques locales et anonymes sur les erreurs de génération avant toute télémétrie éventuelle.
