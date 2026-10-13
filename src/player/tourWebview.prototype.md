# Prototype jetable : tours dans une WebView VS Code

Question : quelle disposition permet de lire une explication tout en suivant le code ?

Branche : `feature/tour-webview`. Aucun choix de disposition n’est encore validé.

Lancer `npm run prototype:webview`, puis exécuter **CodeTour IA: Prototype Tour WebView** dans la palette de la fenêtre VS Code ouverte. Choisir un tour du workspace.

- A : une étape à la fois, navigation en bas.
- B : sommaire latéral, navigation en haut de l’explication.
- C : toutes les explications dans un document, avec accès au code par étape.

La barre flottante et les touches gauche/droite changent la variante. Le paramètre `?variant=A/B/C` est mis à jour dans la WebView ; la variante reste en mémoire lors de la navigation entre étapes. « État du prototype » expose la variante, l’étape, l’ancre et les références Git.

Le prototype lit les vrais tours et réutilise le rendu Markdown/Mermaid et la résolution des diffs. Il ne crée pas de commentaires natifs, ne modifie pas les fichiers `.tour` et ne sauvegarde pas la progression. Les commandes contenues dans les étapes ne sont pas exécutées. L’édition et l’enregistrement restent dans le lecteur existant. La commande est disponible uniquement dans un hôte de développement.

Verdict provisoire : la surface peut être séparée des commentaires et conserver l’accès aux fichiers et aux diffs. La disposition gagnante et son confort d’utilisation restent à valider dans VS Code. Après choix, réécrire l’intégration du lecteur pour la production ; conserver ces variantes uniquement dans la branche de prototype.
