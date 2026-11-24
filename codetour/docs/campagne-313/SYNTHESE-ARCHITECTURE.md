# CodeTour — synthèse d'architecture

Rédigée à partir des Tours CT1 à CT6 (titres, descriptions et étapes).

## Une donnée, trois surfaces

Un Tour est un fichier JSON `.tour`. Il porte un titre, une description et des étapes. Chaque étape a une explication, une destination (fichier, répertoire ou URI) et une position (`line`, `selection` ou `pattern`). Le format existe en deux formulations : `schema.json` pour la validation à l'écriture, et les schémas zod de `src/store/tourSchema.ts` pour les types à l'exécution (CT1).

Trois surfaces partagent ce fichier :

| Surface | Rôle | Tours |
| --- | --- | --- |
| Serveur MCP (`packages/mcp-server`) | Reçoit une proposition de l'agent, la valide, l'écrit | CT3, CT4, CT5 |
| Extension VS Code (`src/`) | Découvre, charge et affiche les Tours | CT2, CT5, CT6 |
| CLI (`src/cli`) | Lecteur terminal, sous-commande `mcp`, passage vers VS Code | CT5, CT6 |

## Le flux d'écriture

La commande `/codetour` crée une identité de run, puis confie la génération à l'agent. Celui-ci appelle `create_project_tour` ou `create_changes_tour` sur le serveur MCP (stdio, un workspace canonique). Un prélude de validation commun contrôle les paramètres, les règles d'étape et la sécurité des ancres (regex bornée, confinement dans le workspace). Un dernier filet valide le schéma, puis le fichier est écrit de façon atomique dans `.tours/`. Un journal de run confirme la création (CT3, CT5).

Un Project Tour ancre ses étapes dans le workspace, sans accès Git. Un Changes Tour dépend de la comparaison Git : le HEAD est relu juste avant l'écriture, puis les ancres de diff sont posées (CT4).

## Le flux de lecture

La découverte des fichiers `.tour` est un contrat partagé (`src/core/tourDiscovery.ts`). L'extension et le lecteur terminal l'utilisent tous deux. Dans VS Code, le démarrage d'une visite installe le lecteur. Une réaction suit la position de lecture, résout la cible de l'étape et l'ancre dans l'éditeur. Deux présentations existent : le fil de commentaire natif et le panneau webview. Un Changes Tour ajoute la variante diff. Le terminal peut reprendre le Tour dans VS Code (CT2, CT5, CT6).

## Distribution

Trois bundles sortent d'une seule implémentation, et des intégrations installent la commande et le serveur dans des agents hors VS Code (CT6).

## Limite de cette synthèse

Elle reflète ce que les Tours disent et ce qu'ils ancrent ; seules les ancres ont été vérifiées par un contrôle automatique.
