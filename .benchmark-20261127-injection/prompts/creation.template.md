Crée un CodeTour de type Project Tour pour ce dépôt.

Lis d'abord entièrement la compétence `/Users/dhuyet/.pi/agent/packages/codetour-plugin/skills/codetour-generate/SKILL.md`, puis le module de référence qu'elle désigne pour la voie Project Tour, et applique-les exactement.

Paramètres de cette demande :

- `type=project` ;
- workspace : la racine du répertoire courant ;
- sujet : expliquer l'architecture du projet et ses principaux chemins d'exécution à un développeur qui découvre ce dépôt ;
- langue : français, pour le titre, la description et toutes les étapes ;
- dans la proposition JSON, `fileName` vaut `{{ID}}.tour` ;
- exploration en lecture seule : ne modifie, ne crée et ne supprime aucun fichier, ne lance ni build, ni test, ni installation, et n'ouvre aucun fichier `.tour` existant ;
- crée le tour avec la commande CLI indiquée par la compétence, depuis la racine du workspace.

Termine en recopiant la sortie JSON de la commande CLI.
