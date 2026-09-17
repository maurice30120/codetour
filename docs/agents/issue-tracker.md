# Suivi des tickets : GitHub

Les tickets et les spécifications de ce dépôt sont enregistrés dans les GitHub Issues. Utiliser la CLI `gh` pour toutes les opérations.

## Conventions

- **Créer un ticket** : `gh issue create --title "..." --body "..."`. Utiliser un heredoc pour les descriptions multilignes.
- **Lire un ticket** : `gh issue view <numéro> --comments`, en filtrant les commentaires avec `jq` et en récupérant également les libellés.
- **Lister les tickets** : `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`, avec les filtres `--label` et `--state` appropriés.
- **Commenter un ticket** : `gh issue comment <numéro> --body "..."`.
- **Ajouter ou retirer des libellés** : `gh issue edit <numéro> --add-label "..."` / `--remove-label "..."`.
- **Fermer un ticket** : `gh issue close <numéro> --comment "..."`.

Déduire le dépôt à partir de `git remote -v` ; `gh` le fait automatiquement lorsqu’il est exécuté dans un clone.

## Pull requests comme surface de triage

**PR comme surface de demandes : non.** _(Passer cette valeur à `oui` si ce dépôt traite les PR externes comme des demandes de fonctionnalité ; `/triage` lit cette option.)_

Lorsque cette option vaut `oui`, les PR suivent les mêmes libellés et états que les tickets, au moyen des commandes `gh pr` équivalentes :

- **Lire une PR** : `gh pr view <numéro> --comments` et `gh pr diff <numéro>` pour le diff.
- **Lister les PR externes à trier** : `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`, puis ne conserver que les valeurs `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR` ou `NONE` de `authorAssociation` et exclure `OWNER`, `MEMBER` et `COLLABORATOR`.
- **Commenter, étiqueter ou fermer** : `gh pr comment`, `gh pr edit --add-label` / `--remove-label`, `gh pr close`.

GitHub partage la même séquence de numéros entre les tickets et les PR. Une référence comme `#42` peut donc désigner l’un ou l’autre : essayer `gh pr view 42`, puis `gh issue view 42` en cas d’échec.

## Lorsqu’une compétence demande de publier dans le suivi des tickets

Créer un ticket GitHub.

## Lorsqu’une compétence demande de récupérer le ticket concerné

Exécuter `gh issue view <numéro> --comments`.

## Opérations de repérage

Ces opérations sont utilisées par `/wayfinder`. La **carte** est un ticket unique dont les **tickets enfants** représentent les travaux à réaliser.

- **Carte** : un ticket portant le libellé `wayfinder:map` et contenant les sections Notes, Décisions prises et Zones d’incertitude. Le créer avec `gh issue create --label wayfinder:map`.
- **Ticket enfant** : un ticket lié à la carte comme sous-ticket GitHub au moyen de `gh api` et de l’API des sous-tickets. Si les sous-tickets ne sont pas disponibles, ajouter l’enfant à une liste de tâches dans la description de la carte et placer `Part of #<carte>` au début de sa description. Utiliser un libellé `wayfinder:<type>` parmi `research`, `prototype`, `grilling` et `task`. Une fois réclamé, assigner le ticket au développeur qui conduit le travail.
- **Blocage** : utiliser les dépendances natives de tickets GitHub, représentation canonique et visible dans l’interface. Ajouter une dépendance avec `gh api --method POST repos/<propriétaire>/<dépôt>/issues/<enfant>/dependencies/blocked_by -F issue_id=<id-bdd-bloquant>`, où `<id-bdd-bloquant>` est l’identifiant numérique de base de données du ticket bloquant obtenu avec `gh api repos/<propriétaire>/<dépôt>/issues/<n> --jq .id`, et non son numéro `#n` ni son `node_id`. GitHub expose les blocages ouverts dans `issue_dependencies_summary.blocked_by`. Si les dépendances ne sont pas disponibles, utiliser une ligne `Blocked by: #<n>, #<n>` au début de la description. Un ticket est débloqué lorsque tous ses bloqueurs sont fermés.
- **Recherche du prochain ticket** : lister les enfants ouverts de la carte avec `gh issue list --state open`, limiter le résultat aux sous-tickets ou à la liste de tâches de la carte, puis exclure les tickets ayant un bloqueur ouvert ou un responsable. Le premier ticket dans l’ordre de la carte est retenu.
- **Réclamer un ticket** : `gh issue edit <n> --add-assignee @me`. Il s’agit de la première écriture de la session.
- **Résoudre un ticket** : ajouter la réponse avec `gh issue comment <n> --body "<réponse>"`, fermer le ticket avec `gh issue close <n>`, puis ajouter dans la section Décisions prises de la carte un pointeur de contexte accompagné de son lien.
