# POC : exploration structurée

POC expérimental avec Code Mode, budgets et métriques. Des essais Mistral et leurs limites sont documentés dans `poc/exploration-benchmark/`.

Node.js 24 ou ultérieur et une clé `MISTRAL_API_KEY` sont requis. Depuis un checkout du dépôt, installer une fois la CLI globale :

```sh
cd packages/exploration-poc
npm install --install-links
npm pack
npm install -g ./codetour-exploration-poc-0.1.0.tgz
```

Pour rendre le skill disponible dans tous les projets de l'utilisateur, copier
son dossier depuis ce checkout vers l'emplacement personnel Copilot (vérifier
auparavant qu'il ne contient pas une version à conserver) :

```sh
mkdir -p ~/.copilot/skills/codetour-research
cp skills/codetour-research/SKILL.md ~/.copilot/skills/codetour-research/SKILL.md
```

Dans une nouvelle session VS Code Copilot Chat, sélectionner
`/codetour-research` et ajouter la demande de Project Tour. Vérifier que la
commande apparaît et que son invocation charge les instructions ; noter la
version de VS Code et tout comportement divergent. Le skill est manuel : les
demandes ordinaires continuent d'utiliser le parcours Copilot et MCP habituel.
Voir [Agent Skills dans VS Code](https://code.visualstudio.com/docs/agent-customization/agent-skills).

Depuis tout projet, lancer une question à la fois :

```sh
codetour-research --code --memory "Où sont validées les entrées ?"
codetour-research --workspace /chemin/vers/projet --code --memory "Comment sont enregistrées les données ?"
```

Le répertoire courant est utilisé par défaut ; pour un workspace multi-racines, sélectionner explicitement une racine avec `--workspace`. La sortie standard est du JSON, y compris en cas d'échec, avec statut, références, limites, identifiant de recherche et métriques disponibles. La clé est lue dans l'environnement ; `MISTRAL_MODEL` sélectionne le modèle. Le préflight vérifie l'accès au projet et la sandbox QuickJS en Code Mode. Un runtime, une clé ou une permission manquante est une erreur explicite. Les options `--tokens`, `--duration-ms`, `--iterations`, `--calls` et `--temperature` règlent les budgets et le modèle.

La mémoire activée par `--memory` reste propre au projet dans `.tours/memory/` ; les journaux structurés sont dans `.tours/.log/`. Les fichiers `.tour` existants sont conservés. Lancer les questions séquentiellement : le catalogue ne garantit pas les écritures concurrentes. Les références valides prouvent l'existence des lignes, pas la justesse sémantique de l'explication. Le harnais répond à des questions et ne crée pas de Tour.

Le modèle évalue lui-même les lacunes et peut demander plusieurs séries d'outils avant de conclure ; aucun vérificateur sémantique indépendant n'est fourni. Les lectures sont mises en cache pendant une seule demande. Si le budget expire avant un résultat structuré, le résultat partiel contient des listes vides et une incertitude explicite : les réponses intermédiaires des outils ne sont pas promues automatiquement en preuves. Les erreurs du modèle et les résultats JSON invalides sont rejetés. Les citations invalides sont signalées au modèle pour correction dans le même run et les mêmes budgets ; tous les appels sont comptés. Les lectures directes présentées au modèle portent des numéros de ligne explicites. `usageAvailable: false` indique qu'au moins un appel n'a pas fourni ses compteurs, auquel cas les totaux de tokens sont incomplets et la limite de tokens ne peut pas être garantie. Le budget de temps interrompt les appels modèle et les scripts ; les autres opérations sur le système de fichiers restent sujettes à la latence du système d'exploitation.
