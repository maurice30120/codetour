# Roadmap

L'objectif est de proposer des Tours générés par une IA pour expliquer un projet ou les changements apportés à son code.

## Bugs connus

- [ ] Redimensionner automatiquement l'image d'un diagramme Mermaid en fonction de l'espace disponible dans le commentaire ou la surface de prévisualisation, sans provoquer de débordement ni rendre le texte illisible.

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
