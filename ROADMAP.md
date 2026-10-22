# Feuille de route

L’objectif est de proposer des Tours générés par une IA pour expliquer un projet ou les changements apportés à son code.

## Bugs connus

- [ ] Redimensionner automatiquement les images des diagrammes Mermaid selon l’espace disponible dans le commentaire ou la surface de prévisualisation, sans débordement ni texte illisible.

## Priorité 1 — Modes de génération

### Questions de l’agent guidées par le MCP

Guider le Tour Generator pour qu’il précise l’intention du lecteur avant de générer un Tour, en s’appuyant sur les descriptions des outils MCP pour proposer des questions pertinentes.

- [ ] Demander uniquement les informations absentes de la demande ou du contexte du projet, et réutiliser les réponses déjà données.
- [ ] Pour une demande de revue, demander si le lecteur souhaite une explication neutre des changements ou une évaluation avec le skill `code-review` ; distinguer l’explication de remarques existantes de la réalisation d’une nouvelle revue.
- [ ] Préciser le périmètre de la revue : branche ou pull request, référence de base, inclusion des modifications non commitées, remarques de revue ou spécification existantes.
- [ ] Pour la découverte d’un projet, demander le niveau de familiarité du lecteur, son objectif (prise en main, architecture, compréhension d’une fonctionnalité ou préparation d’une contribution) et son domaine d’intérêt.
- [ ] Proposer un parcours centré sur une question : demander à quelle question concrète le Tour doit répondre, par exemple « Comment fonctionne l’authentification ? » ou « Où ajouter ce comportement ? ».
- [ ] Pour préparer une contribution, demander quelle fonctionnalité ou quel comportement le lecteur souhaite modifier, puis relier son point d’entrée, sa logique métier, ses tests et sa configuration dans le Project Tour.
- [ ] Demander le niveau de détail souhaité et le parcours préféré (vue d’ensemble du système, flux d’exécution, concepts métier, tests ou sous-système ciblé).
- [ ] Évaluer si un temps de lecture facultatif (par exemple 5 ou 15 minutes) permet d’adapter utilement la longueur et le détail du Tour ; conserver cette piste comme une exploration, sans imposer de choix de durée.
- [ ] Utiliser les réponses pour sélectionner un Project Tour ou un Changes Tour et adapter son périmètre, l’ordre des Tour Steps, le détail et les diagrammes, en conservant les deux outils MCP spécialisés.
- [ ] Définir le comportement lorsque le lecteur n’a pas de préférence ou que le skill demandé est indisponible, et rendre les hypothèses retenues visibles avant la génération.
- [ ] Valider ce guidage avec des exemples de conversations couvrant une explication neutre des changements, une revue avec un skill, une découverte centrée sur une question et la préparation d’une contribution.

### Project Tour — Découverte du projet

Expliquer le rôle du projet, sa structure et ses principaux parcours d’exécution.

- [ ] Vérifier que les Tour Anchors restent pertinents lorsque le code évolue.
- [ ] Évaluer la pertinence du guidage C4 existant pour découvrir un projet : examiner le diagramme de contexte, le diagramme de conteneurs conditionnel et la correspondance avec les répertoires du projet sur des cas représentatifs.
- [ ] Déterminer quand C4 aide le lecteur et quand une vue d’ensemble plus simple ou un diagramme de flux d’exécution répond mieux à son objectif, notamment pour les bibliothèques, les outils en ligne de commande et les projets à processus unique.
- [ ] Utiliser cette évaluation et les réponses du lecteur pour décider quels éléments d’orientation doivent rester obligatoires ou devenir conditionnels ; conserver des frontières justifiées par le code et signaler explicitement les incertitudes.

### Explication d’une revue de code

Présenter les remarques d’une revue de code, leur contexte et les corrections attendues.

- [ ] Définir la source de la revue : commentaires locaux, GitHub Issues ou pull request.
- [ ] Déterminer si cette fonctionnalité doit être un mode distinct ou une présentation spécialisée du Changes Tour.
- [ ] Associer chaque remarque à un Tour Anchor et indiquer sa priorité.
- [ ] Distinguer clairement les problèmes, les suggestions et les points positifs.
- [ ] Définir le comportement lorsqu’une remarque ne peut pas être associée à une ligne stable.

### Changes Tour — Explication des changements

Expliquer l’intention, l’implémentation et les effets des changements depuis la divergence avec la branche de base.

- [ ] Détecter ou proposer la référence de base lorsque la demande ne la précise pas ; la comparaison est déjà résolue, enregistrée et affichée lorsque cette référence est fournie.
- [ ] Mettre en évidence les effets sur les tests, la configuration et les migrations.
- [ ] Proposer un parcours centré sur les impacts, couvrant les consommateurs, les contrats et les comportements concernés au-delà des fichiers modifiés, en justifiant chaque relation par le code et en distinguant les impacts potentiels des effets observés.
- [ ] Ajouter un exemple de Changes Tour à la documentation.

## Priorité 2 — Qualité des Tours

- [ ] Formaliser une grille d’évaluation des Tours générés à partir des consignes existantes : exactitude, concision, progression pédagogique et pertinence des Tour Anchors.
- [ ] Vérifier les Tours générés sur plusieurs structures de dépôts représentatives.
- [ ] Compléter la validation sans écriture (`dryRun`) existante par une prévisualisation lisible et une confirmation du remplacement d’un Tour généré existant.

### Questions suggérées au fil de la discussion

Les boutons de questions de la webview peuvent devenir moins pertinents lorsque la Tour Step Conversation avance ou change de sujet. Explorer leur actualisation sans figer la solution à ce stade.

- [ ] Évaluer la régénération des questions suggérées après chaque réponse, en tenant compte des échanges récents et du sujet courant.
- [ ] Comparer ce renouvellement avec le masquage des suggestions devenues obsolètes ; éviter de reproposer des questions déjà traitées et permettre de ne rien afficher lorsqu’aucune relance n’est utile.

### Format des images au moment de l’appel MCP

**Priorité : moyenne. Catégorie : navigation et économie d’outils.**

Le format des images locales est déjà décrit dans le guide utilisateur. Le rendre visible au point d’usage doit éviter au Tour Generator d’explorer le renderer ou de supposer une solution en base64 avant de consulter cette référence ciblée.

- [ ] Ajouter aux consignes Markdown partagées par les descriptions des outils, dans [`packages/mcp-server/src/server.ts`](packages/mcp-server/src/server.ts), une indication courte : « Images locales : `![Schéma](./docs/schema.png)`, chemin depuis la racine du workspace. Une étape purement illustrée n’a pas d’ancre de code. »
- [ ] Pointer vers la section [File References du guide utilisateur](docs/user-guide.md#file-references) pour les détails ; conserver le PNG dans le dépôt et une référence courte dans la description du Tour Step.
- [ ] Garder ce renseignement au point d’usage, sans ajouter de règle globale à `AGENTS.md` ni recopier le guide dans un nouveau skill.
- [ ] Évaluer un avertissement ciblé lorsqu’une image fournie par l’auteur est encodée en base64, pour conseiller la référence locale sans interdire le transport base64 des diagrammes générés par le lecteur.

### Compléments aux tests de l’extension VS Code

- [ ] Poursuivre l’extraction de la logique métier encore couplée à VS Code lorsque cela simplifie les tests ; les tests actuels s’exécutent déjà sans lancer l’éditeur.
- [ ] Réduire les simulations spécifiques aux tests en réutilisant l’hôte VS Code de test existant lorsque cela simplifie leur maintenance.
- [ ] Compléter les tests de résolution des Tour Anchors lors de l’évolution du code, au-delà des cas de fichiers indisponibles et de repli déjà couverts.
- [ ] Exposer une commande `test:unit` dédiée ; les tests de l’extension sont déjà exécutés par `npm test`.
- [ ] Compléter l’exécution existante des tests en intégration continue par un rapport structuré des échecs.
- [ ] Définir un objectif initial de couverture centré sur les modules critiques, sans imposer de pourcentage global artificiel.

## Priorité 3 — Simplification et maintenance

- [ ] Auditer la fonctionnalité d’ouverture d’un Tour par URL, ses usages et ses dépendances.
- [ ] La supprimer si elle n’est plus utile et si cela simplifie l’interface et l’implémentation du projet.
- [ ] Nettoyer les commandes, dépendances, tests et éléments de documentation devenus inutiles après sa suppression.
- [ ] Documenter les décisions structurantes dans un ADR lorsqu’un choix modifie les contrats existants.

## Plus tard

- [ ] Proposer des Tours à embranchements pour permettre au lecteur de choisir le prochain sujet à explorer selon ses intérêts.
- [ ] Afficher les Tour Steps sur une carte interactive des fichiers et de leurs relations, avec une navigation directe vers chaque étape.
- [ ] Étudier l’historique des Tours sans remettre en cause les fichiers générés stables de la version actuelle.
- [ ] Évaluer les Tours interactifs et conditionnels avec des règles de sécurité explicites.
- [ ] Collecter des métriques locales et anonymes sur les erreurs de génération avant toute éventuelle télémétrie.
