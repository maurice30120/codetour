# Mode WebView parallèle pour les tours — interface A

## Problem Statement

Les explications des tours affichées dans les commentaires natifs occupent de la place au milieu du code. Le lecteur souhaite pouvoir les déplacer dans une WebView à côté de l’éditeur, tout en gardant un repère discret sur le code concerné. Il souhaite conserver le mode de lecture actuel et sa compatibilité, le rendu Mermaid et la possibilité d’éditer les tours.

La variante A du prototype a été choisie : une étape à la fois, avec la navigation sous l’explication. Le prototype actuel est une démonstration distincte ; il ne remplace pas encore le lecteur réel et ne prend pas en charge l’édition.

## Solution

Ajouter un mode WebView en parallèle du mode par commentaires natifs. Le mode actuel reste disponible et constitue le défaut pour préserver le comportement existant. Une préférence VS Code et une commande permettent de choisir le mode et de basculer pendant un tour.

En mode WebView, le code affiche seulement l’ancre matérialisée par le petit logo CodeTour dans la marge. Le texte, les diagrammes, la progression et les commandes de lecture apparaissent dans une WebView reprenant la disposition A. Aucun commentaire textuel CodeTour n’est affiché dans l’éditeur ou le panneau Comments pour cette lecture.

Les deux modes pilotent le même tour, la même étape et la même progression. L’édition reste disponible dans les deux modes ; en WebView, elle se fait dans le panneau, avec le Markdown source, un aperçu compatible Mermaid et les actions d’enregistrement ou d’annulation.

## User Stories

1. En tant que lecteur, je veux conserver le mode de commentaires natifs, afin de continuer à utiliser CodeTour comme aujourd’hui.
2. En tant que lecteur, je veux choisir le mode WebView, afin de lire les explications sans interrompre la lecture du code.
3. En tant que lecteur, je veux basculer de mode pendant un tour, afin de choisir la présentation adaptée sans recommencer le parcours.
4. En tant que lecteur, je veux retrouver le même tour et la même étape après une bascule, afin de conserver mon contexte.
5. En tant que lecteur, je veux que mon choix de présentation soit mémorisé par les préférences VS Code, afin de retrouver cette présentation au prochain tour.
6. En tant que lecteur, je veux que le démarrage depuis l’arbre ou la palette utilise le mode choisi, afin de ne pas devoir lancer une commande de prototype.
7. En tant que lecteur, je veux voir le petit logo à l’ancre de l’étape active, afin de savoir à quel code l’explication se rapporte.
8. En tant que lecteur, je veux que le texte reste uniquement dans la WebView en mode WebView, afin de garder l’éditeur dégagé.
9. En tant que lecteur, je veux que le repère actif fonctionne même si les marqueurs généraux des tours sont masqués, afin de toujours retrouver l’ancre du parcours en cours.
10. En tant que lecteur, je veux retrouver l’ancre depuis la WebView ou la commande Reprendre, afin de revenir au code après avoir consulté un autre fichier.
11. En tant que lecteur, je veux voir le titre du tour, le titre de l’étape et sa position dans le parcours, afin de comprendre où je suis.
12. En tant que lecteur, je veux lire une seule étape à la fois dans la disposition A, afin de rester concentré sur l’explication courante.
13. En tant que lecteur, je veux utiliser Précédent, Suivant et Fin sous l’explication, afin de parcourir le tour facilement.
14. En tant que lecteur, je veux que les raccourcis et les actions de l’arbre restent synchronisés avec la WebView, afin de naviguer avec les commandes que je connais.
15. En tant que lecteur, je veux que ma progression soit enregistrée comme dans le lecteur actuel, afin que changer de présentation ne change pas le suivi du tour.
16. En tant que lecteur, je veux conserver les transitions vers le tour précédent ou suivant lorsqu’elles existent, afin de parcourir une série de tours.
17. En tant que lecteur, je veux que chaque étape ouvre le fichier et la sélection associés, afin de suivre l’explication dans le code réel.
18. En tant que lecteur d’un tour de changements, je veux que les étapes de diff ouvrent la comparaison attendue et marquent son côté modifié, afin de revoir les changements effectivement analysés.
19. En tant que lecteur, je veux lire les étapes sans fichier et celles qui ciblent un répertoire ou une vue, afin de parcourir tous les types d’étapes existants.
20. En tant que lecteur, je veux pouvoir continuer lorsque le fichier ou le diff est indisponible, afin qu’un problème d’ancre ne masque pas l’explication.
21. En tant que lecteur, je veux retrouver le Markdown, les tableaux, les images et les liens pris en charge, afin de lire les tours existants sans les convertir.
22. En tant que lecteur, je veux conserver les diagrammes Mermaid et leur texte alternatif, afin de comprendre les mêmes explications dans les deux modes.
23. En tant que lecteur, je veux que la WebView et Mermaid suivent le thème clair ou sombre de VS Code, afin de conserver un rendu lisible.
24. En tant que lecteur, je veux qu’un diagramme invalide produise le comportement de repli existant, afin de pouvoir lire le reste de l’étape.
25. En tant qu’auteur autorisé à modifier un tour, je veux entrer en édition depuis la WebView, afin de corriger l’étape sans réafficher son texte dans le code.
26. En tant qu’auteur, je veux modifier le Markdown source, y compris les blocs Mermaid, afin de préserver une source éditable plutôt qu’une image générée.
27. En tant qu’auteur, je veux prévisualiser mon brouillon dans la WebView, afin de vérifier le Markdown et les diagrammes avant de sauvegarder.
28. En tant qu’auteur, je veux sauvegarder dans le fichier de tour existant, afin que les modifications soient compatibles avec les outils et les autres utilisateurs.
29. En tant qu’auteur, je veux annuler mes changements et retrouver la description enregistrée, afin de pouvoir abandonner un brouillon.
30. En tant qu’auteur, je veux conserver mon brouillon pendant une bascule de mode, afin de ne pas perdre mon travail.
31. En tant qu’auteur, je veux pouvoir sauvegarder, abandonner ou conserver mon brouillon avant de quitter son étape, afin qu’une navigation ne le remplace pas silencieusement.
32. En tant qu’auteur, je veux conserver mon brouillon si une sauvegarde échoue, afin de pouvoir corriger le problème et réessayer.
33. En tant que lecteur d’un tour non modifiable, je veux que les restrictions d’édition soient respectées dans la WebView, afin que la nouvelle interface conserve les permissions existantes.
34. En tant qu’utilisateur, je veux que fermer puis reprendre le panneau retrouve le parcours courant, afin de gérer mon espace de travail sans changer involontairement de mode.
35. En tant qu’utilisateur, je veux que terminer le tour retire son ancre active et sa présentation, afin de ne pas laisser d’information périmée dans l’éditeur.
36. En tant qu’utilisateur au clavier, je veux accéder à la navigation et à l’édition avec un focus visible et des libellés explicites, afin de pouvoir utiliser la WebView sans souris.
37. En tant qu’utilisateur des fonctions d’enregistrement existantes, je veux qu’elles restent opérationnelles, afin que l’ajout du mode de lecture ne bloque pas la création de tours.

## Implementation Decisions

- Deux modes de présentation : commentaires natifs et WebView. La préférence appartient à VS Code, avec les portées utilisateur/workspace habituelles ; elle ne modifie pas le format persistant des tours. Le mode par commentaires reste le défaut par décision de compatibilité.
- Le lecteur et les actions existantes restent la source de vérité pour le tour actif, l’étape, les permissions et la progression. La WebView constitue une surface du même lecteur, pas un second lecteur avec un état autonome.
- La WebView adopte la structure A choisie par l’utilisateur : en-tête du tour et progression, titre et contenu de l’étape, navigation en dessous. Le sélecteur de variantes et l’état de diagnostic du prototype ne font pas partie du produit final.
- Le lecteur sépare la résolution et l’ouverture de l’ancre de la présentation de la description. Reprendre une étape ne dépend plus de la présence d’un commentaire natif.
- En mode WebView, aucun fil de commentaires CodeTour portant la description n’est créé, y compris pendant l’édition. Le passage depuis le mode natif retire le fil existant et tout aperçu périmé qui dupliquerait le texte de l’étape.
- Une décoration de marge affiche le petit logo CodeTour à l’ancre active réellement résolue. Elle ne porte ni description, ni bloc de commentaire, ni aperçu textuel de la description au survol. La sélection de code habituelle reste possible. Les marqueurs généraux restent une fonctionnalité séparée ; le repère actif suit le tour même lorsqu’ils sont désactivés.
- Le repère suit les fichiers ordinaires, les sélections, les motifs d’ancrage et le côté modifié des diffs selon les règles du lecteur existant. Les étapes sans ancre de code exploitable n’inventent pas un repère sur un fichier ou une ligne arbitraire ; elles restent lisibles dans le panneau.
- Le panneau affiche la cible de l’étape et propose un retour vers le code. Son ouverture ne remplace pas l’éditeur de code ou le diff associé. La navigation depuis les boutons, la palette, les raccourcis, les liens et l’arbre actualise la même étape.
- La progression et les transitions entre tours réutilisent les actions existantes, notamment les comportements de fin ; une bascule de présentation ou un simple affichage ne compte pas comme une étape supplémentaire parcourue.
- Les tours de changements conservent la résolution de leur comparaison Git et les règles de repli existantes. Le mode WebView ne change pas les références persistées ni le côté du diff ciblé.
- Toutes les surfaces consomment la préparation partagée des descriptions. La conversion Markdown vers HTML et l’assainissement réutilisent le moteur commun des surfaces appartenant à l’extension, conformément à la décision d’architecture existante.
- Mermaid conserve sa version verrouillée, ses types de diagrammes, ses limites, son rendu sécurisé, ses thèmes, son cache et ses comportements de repli. Aucun moteur Mermaid supplémentaire n’est introduit dans le panneau et aucune image de diagramme n’est persistée.
- Le mode d’édition de la WebView expose la source Markdown, un aperçu et les actions Sauvegarder/Annuler. Les actions existantes de modification du titre, de l’ancre et de l’ordre des étapes restent accessibles et ne divergent pas entre présentations.
- Le brouillon d’édition est associé au tour et à l’étape, indépendamment du panneau. Une bascule de mode transfère le brouillon, sans sauvegarde implicite. Une action qui quitterait l’étape avec un brouillon propose sauvegarde, abandon ou annulation de l’action ; elle ne perd jamais silencieusement le texte.
- Sauvegarder réutilise la logique de modification et de persistance des tours. Les erreurs de sauvegarde sont signalées et préservent le brouillon ; annuler restaure le contenu enregistré. La compatibilité des tours édités est conservée dans les deux modes.
- Les permissions d’édition existantes sont appliquées dans l’interface et dans le traitement des messages. Les identifiants de tour/étape et les actions provenant du panneau sont validés ; un message périmé ne doit pas modifier une autre étape.
- Les règles existantes de liens et d’actions CodeTour restent compatibles, avec validation des messages, assainissement HTML et politique de sécurité de contenu. Le changement de présentation n’élargit pas les commandes autorisées et ne déclenche pas une action proposée dans une description sans interaction explicite.
- Une bascule de mode conserve le tour actif, son étape et sa progression. Fermer le panneau ne change pas la préférence ni l’étape ; Reprendre le réouvre. Un brouillon reste disponible en mémoire pendant la session. La fin explicite du tour traite d’abord un éventuel brouillon puis retire le repère actif et la présentation liée au tour.
- Un changement de thème actualise l’étape visible et les diagrammes. Les rendus asynchrones obsolètes sont ignorés lorsqu’une navigation, une bascule ou une fermeture a changé la cible ; aucun résultat retardé ne remplace la nouvelle étape.
- L’ajout du mode ne supprime pas l’enregistrement de tours existant. La création complète de nouveaux tours directement dans une WebView est hors du périmètre ; la lecture et l’édition d’étapes existantes en WebView sont dans le périmètre.

## Testing Decisions

- Le périmètre a été soumis à l’utilisateur et validé : lecteur complet dans un hôte VS Code, bascule entre modes, logo seul dans le code, texte et Mermaid en WebView, édition/sauvegarde et navigation vers fichiers/diffs ; les tests du rendu partagé restent en complément.
- Privilégier une seule frontière principale : les commandes publiques du lecteur et de l’édition dans un hôte VS Code. Vérifier les effets observables sur l’éditeur, le panneau, les commentaires, le fichier de tour et la reprise du parcours ; ne pas tester la structure interne de l’état ni la forme exacte des fonctions.
- Couvrir un tour de plusieurs étapes avec texte, Mermaid, ancre de ligne, sélection, étape sans fichier, étape de répertoire et diff. Vérifier le démarrage depuis la palette et l’arbre, les bornes de navigation, la reprise, la fin et les transitions entre tours.
- Vérifier les bascules natif → WebView → natif au milieu d’un tour : même étape et même progression, absence de texte/commentaire CodeTour en mode WebView, repère à la bonne ancre et rétablissement du rendu natif en mode natif.
- Vérifier le repère actif avec les marqueurs généraux activés puis masqués, sur un fichier et sur le côté modifié d’un diff ; vérifier l’absence de repère inventé pour une étape sans ancre exploitable.
- Tester l’édition par les actions utilisateur : modification de Markdown et Mermaid, aperçu, sauvegarde, relecture dans les deux modes, annulation, bascule avec brouillon, navigation/fermeture avec brouillon, échec de sauvegarde et refus de modification d’un tour non modifiable.
- Tester les changements rapides d’étape, de mode et de thème ainsi que la fermeture pendant un rendu Mermaid. Le dernier état demandé doit être affiché et aucune ancienne ancre ou description ne doit réapparaître.
- Réutiliser les tests existants du rendu des descriptions et du moteur partagé pour les liens, le Markdown, les images, l’échappement, l’assainissement et la politique de sécurité, ainsi que les tests Mermaid pour les thèmes, les limites et le repli. Compléter uniquement pour les comportements nouveaux.
- Les contrôles du prototype ont déjà exercé le rendu des trois dispositions, la navigation et les messages des boutons avec un tour de 18 étapes, ainsi que la visibilité de la commande en hôte de développement. Ils constituent une référence de régression, sans remplacer les tests du lecteur réel.
- Tester le chargement dans un hôte de développement et dans une extension packagée : le mode produit doit être utilisable hors développement et ne doit pas dépendre d’une commande ou d’un contexte de prototype.
- Vérifier visuellement la disposition A en thèmes clair et sombre, dans un panneau étroit, avec une description longue et des diagrammes ; vérifier les commandes au clavier et le focus. Les contrôles automatisés portent sur le comportement, pas sur des captures exactes ou des détails CSS.
- Exécuter le contrôle TypeScript, les tests ciblés pendant l’implémentation, puis la suite complète et le build de l’extension avant livraison. Préserver les modifications de travail préexistantes pendant cette validation.

## Out of Scope

- Supprimer le mode de commentaires natifs ou forcer la WebView pour tous les utilisateurs.
- Afficher simultanément la description dans les commentaires du code et dans la WebView lorsque le mode WebView est sélectionné.
- Livrer les variantes B/C, le sélecteur de variantes ou les diagnostics du prototype.
- Changer le schéma des tours, les outils MCP, la génération des tours ou les politiques de références Git.
- Ajouter des syntaxes Mermaid, des diagrammes interactifs, une nouvelle version ou un second moteur de rendu.
- Construire un nouveau flux complet de création/enregistrement de tours dans la WebView.
- Persister les brouillons après fermeture de VS Code ou un plantage du processus ; la conservation demandée concerne la session active et les bascules de présentation.
- Ajouter une expérience navigateur indépendante de l’extension VS Code desktop ou modifier la prise en charge Live Share.

## Further Notes

- Cette spec remplace le périmètre initial qui envisageait de remplacer globalement les commentaires et de conserver l’édition uniquement dans l’interface native. La demande actuelle est un mode parallèle avec ancre seule dans le code et édition dans la WebView.
- Source primaire du choix visuel : branche `prototype/tour-webview`. La variante A a été validée par l’utilisateur le 13 octobre 2026 ; la branche conserve les variantes exploratoires et les corrections du prototype.
- Branche de travail : `feature/tour-webview`. Les changements locaux déjà présents sur cette branche ne doivent pas être confondus avec l’implémentation de cette spec.
- Les détails techniques de conservation des brouillons et de séparation des surfaces doivent être développés aux frontières du lecteur et de l’édition, sans dupliquer la résolution des ancres, le rendu des descriptions ou les règles de persistance.
