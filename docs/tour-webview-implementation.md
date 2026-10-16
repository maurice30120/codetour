# Vue étendue du tour

Comportement validé le 14 octobre 2026.

Le tour démarre dans les commentaires natifs. « Show Expanded Description », disponible dans le commentaire, la barre de la vue CodeTour et la palette pendant la lecture, ouvre l’explication de l’étape active dans un panneau latéral. Il existe une seule disposition, issue de la vue A, sans sélecteur ni préférence de présentation.

Le panneau affiche le titre du tour, la progression, le titre et la cible de l’étape, puis sa description avec Markdown, tableaux, images et Mermaid. Pour un tour modifiable, le bouton « Edit » déclenche la commande d’édition existante : le panneau se ferme et le brouillon s’ouvre dans l’éditeur Markdown natif. Le panneau n’intègre pas d’éditeur Markdown. Les liens présents dans le contenu restent utilisables selon les règles de sécurité existantes.

La navigation passe par l’arbre, les commandes et les raccourcis de l’extension. Le panneau suit la même étape et la même progression. Les fichiers, sélections, motifs, répertoires, vues et diffs conservent leur résolution existante.

Lorsque le panneau est ouvert, le code affiche uniquement le petit logo CodeTour à l’ancre active, sans description ni commentaire CodeTour dans le panneau Comments. Le repère reste visible si les marqueurs généraux sont masqués. Une étape sans ancre exploitable ne reçoit pas de repère arbitraire.

Fermer la vue étendue rétablit le commentaire natif de la même étape, sans modifier la progression. Le bouton permet de la rouvrir. Une fermeture pendant une résolution ou un rendu asynchrone ne doit pas recréer le panneau.

L’édition est demandée depuis l’extension et revient à la présentation native. L’explication est modifiée dans le document Markdown géré par l’extension ; « Save Step » et « Cancel Step Editing » enregistrent ou abandonnent le brouillon. L’enregistrement de nouveaux tours conserve son flux de commentaires natifs.

Les brouillons restent protégés par le choix Save/Discard/Cancel lors d’une navigation, d’une réorganisation, d’une fin de tour ou d’une ouverture de la vue étendue. Une erreur de sauvegarde ou une saisie plus récente que le contenu envoyé sur disque préserve le brouillon. Les permissions d’édition sont vérifiées par l’extension.

## Conversation de l'étape (socle)

Sous l’explication de l’étape, un champ permet de poser une question à cette étape. Chaque question est envoyée avec l’identité du rendu actif (jeton, tour, étape), comme les autres messages du panneau ; une question périmée ou mal formée est ignorée.

L’extension capture le contexte de l’étape pour la question via un résolveur, fidèle à ce que le lecteur voit pour chaque type de cible : un fichier ou une URI transmet le code du buffer affiché — modifications non enregistrées comprises — avec le chemin déclaré par le tour et la description de l’étape ; une étape à contenu embarqué transmet le texte du document virtuel servi par le système de fichiers du tour, c’est-à-dire son propre contenu ; une étape ancrée à un répertoire transmet le répertoire déclaré sans aucun code, et une étape sans cible de code (vue ou simple explication) transmet la seule description. Une cible non affichée ou indisponible est signalée telle quelle, avec son chemin déclaré, jamais remplacée par un autre fichier.

Le répondant est injecté (`src/player/stepChat.ts`) ; aucun agent réel n’est câblé dans ce socle. La réponse Markdown passe par le moteur et l’assainissement partagés avant d’atteindre le chat. Chaque étape possède sa conversation propre, gardée en mémoire jusqu’à la fermeture du panneau et jamais persistée ; les échanges réussis alimentent les questions de suivi. Une erreur du répondant, ou l’absence de répondant, s’affiche dans le chat sans perturber la lecture.

Le protocole de messages couvre les deux sens : `askQuestion` (webview → extension) et `stepChat` (extension → webview), qui remplace la conversation affichée de l’étape. Un rafraîchissement de rendu sert le même état depuis l’extension, et une réponse arrivée sur un autre rendu n’est jamais poussée dans l’étape affichée.

## Validation

Les tests passent par les commandes publiques du lecteur et de l’édition : ouverture et fermeture, progression, synchronisation, repère seul, fichiers/diffs et étapes sans ancre, enregistrement et annulation, erreurs et concurrence de sauvegarde. Le panneau ignore les anciens messages de navigation et de modification ainsi que les messages de liens périmés.

Le rendu partagé couvre Markdown, assainissement, politique de sécurité, Mermaid et changements de thème. Le test en hôte VS Code vérifie également le panneau réel en thèmes clair et sombre et dans une colonne étroite.

## Structure simplifiée

- `src/player/tourWebview.ts` possède l’unique création de panneau et traite ses liens. Un rendu ne crée jamais de panneau ; fermer ou terminer retire la vue et son état. Les commandes de l’extension restent l’unique point d’ouverture.
- `src/player/markdown.ts` regroupe le moteur Markdown, l’assainissement et le HTML de cette vue.
- `src/player/stepChat.ts` regroupe le résolveur de contexte, le répondant injecté et l’état de conversation des étapes.
- `src/player/stepEditing.ts` regroupe le document de brouillon, la session, la sauvegarde, l’annulation et la protection avant de quitter une étape. Toutes les sauvegardes réutilisent la même opération. Un rafraîchissement ne réécrit jamais le document actif.

Les étapes URI et à contenu embarqué avec une ligne explicite reçoivent le même logo que les étapes ciblant un fichier. Aucun mode de présentation sélectionnable ni API d’édition par messages webview n’est conservé.
