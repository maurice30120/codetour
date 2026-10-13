# Intégrer la lecture des tours en WebView — variante A

État : interface choisie, intégration à réaliser.

Le 13 octobre 2026, l’utilisateur a choisi la variante A du prototype : une étape par écran, avec sa progression et sa description, puis les commandes de navigation en bas. Le code reste visible dans l’éditeur à côté.

Source primaire : branche `prototype/tour-webview`, fichiers `src/player/tourWebview.prototype.ts` et `src/player/tourWebview.prototype.md`. Le prototype a servi à comparer trois dispositions ; son code doit être réécrit pour le lecteur final.

Parcours retenu : `/implement` dans le contexte actuel. Branche d’implémentation : `feature/tour-webview`.

## Périmètre

- Démarrer un tour avec la commande ou l’arbre habituel ouvre le lecteur WebView A.
- La WebView affiche le titre, l’étape courante, la progression et la description Markdown/Mermaid.
- Précédent, suivant et fin utilisent les actions existantes, avec la progression et les liens entre tours.
- Changer d’étape ouvre le fichier, la sélection ou le diff correspondant dans l’éditeur à côté.
- Reprendre un tour, changer le thème ou terminer le tour garde la WebView synchronisée avec le lecteur.
- La lecture remplace les commentaires natifs. L’édition et l’enregistrement conservent leur interface actuelle pour cette première intégration.
- Les fichiers `.tour`, le MCP et les données existantes restent compatibles.
- La version finale retire le sélecteur A/B/C, l’état de diagnostic et la commande de prototype. Les trois variantes restent consultables sur la branche de référence.

## Vérification attendue

Vérifier le démarrage et la navigation d’un tour de plusieurs étapes, ses extrémités, la progression, les liens, l’affichage d’un diff, les étapes sans fichier et le passage en édition. Contrôler le rendu avec les thèmes clair et sombre et l’absence de panneaux périmés après fermeture ou changement de tour.
