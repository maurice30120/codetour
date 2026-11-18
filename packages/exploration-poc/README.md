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
codetour-research --knowledge "Comment le harnais rejette-t-il les appels forgés ?"
```

Le répertoire courant est utilisé par défaut ; pour un workspace multi-racines, sélectionner explicitement une racine avec `--workspace`. La sortie standard est du JSON, y compris en cas d'échec, avec statut, références, limites, identifiant de recherche et métriques disponibles. L'option `--output-file <chemin>` écrit ce JSON dans le fichier indiqué (écrasé s'il existe) et n'imprime sur la sortie standard qu'un résumé JSON compact (statut, jetons, durée, nombre de citations, `functionTries`, mémoire acceptée/rejetée, chemin du fichier) ; une erreur d'écriture est signalée sur la sortie d'erreur. Pendant la run, la progression (`plan` avec le plan initial, `investigate`, `step` avec outil, paramètres tronqués et erreur, `consolidate`, `consolidation_result` avec fonctions acceptées/rejetées et raisons, `memory_unused` si la mémoire est active mais qu'aucun `function_try`/`memory_run` n'a eu lieu, `end`, avec durée et jetons cumulés) est ajoutée en JSON lignes dans `<chemin>.progress` (tronqué au démarrage) ; un second run sur le même fichier de sortie est refusé tant que le premier est vivant (verrou sous `.tours/.log/locks/`). Tous les réglages (modèle, URL de l'API, effort de raisonnement, température, budgets, limites de scripts, citations, sorties mémoire, rotation du journal, `search.exclude` : répertoires ignorés par les recherches et listages, par défaut `.tours/research-reports`, `.tours/.log` et `.tours/.memory` ; `context.keepToolResults` : nombre de derniers résultats d'outils renvoyés en clair au modèle, les plus anciens étant remplacés par un stub, 8 par défaut et 0 pour désactiver ; `context.maxResultBytes` : taille maximale d'un résultat d'outil, 8000 par défaut) sont lus dans `.tours/config.json` (voir `src/config.ts` pour les valeurs par défaut) ; la clé peut aussi venir de `MISTRAL_API_KEY`, qui prime sur le fichier. Un appel d’outil renvoyant deux fois le même résultat reçoit une note ; au troisième, le garde-fou arrête la boucle et peut demander une conclusion contrôlée si une preuve valide est déjà disponible. Le préflight vérifie l'accès au projet et la sandbox QuickJS en Code Mode. Un runtime, une clé ou une permission manquante est une erreur explicite. Les options `--model`, `--tokens`, `--duration-ms`, `--iterations`, `--calls` et `--temperature` surchargent la config pour une run.

Après une recherche terminée sans fonction candidate, le harness peut proposer une fonction à partir des appels directs aux primitives et corriger les erreurs de sa proposition. Il saute cette synthèse lorsqu'une fonction mémorisée a fourni une ligne citée dans la réponse et que sa preuve a été vérifiée. Le nombre total de tentatives est réglable dans `.tours/config.json` avec `{"limits":{"memorySynthesisAttempts":5}}` (cinq par défaut, entier positif). Ces tentatives partagent le budget de la recherche ; une fonction valide reste soumise à la sélection et au rejeu de consolidation.

Le harnais signale aussi les lectures successives qui recouvrent largement des lignes déjà renvoyées, sans interrompre les pages apportant de nouvelles lignes. Après trois appels identiques ou trois échecs identiques, s'il dispose déjà d'une preuve issue d'une fonction valide et qu'il reste du budget, il demande une seule conclusion sans outils. La réponse reste soumise au contrôle du schéma et des références ; à défaut, la recherche reste partielle. L'avertissement de recouvrement ne garantit pas la détection de toutes les boucles.

Les résultats volumineux ou masqués peuvent être conservés temporairement dans `.tours/.scratch/<runId>/`, dans la limite de 1 000 000 octets par recherche. Le modèle peut les relire avec `readScratch` par pages de 8 000 octets maximum et doit citer les sources originales. Les résultats déjà tronqués par la sandbox restent incomplets. Si la sauvegarde échoue ou dépasse la limite, le modèle est averti que le résultat n'est pas récupérable. Les fichiers sont supprimés à la fin de la recherche ; au démarrage, les dossiers de plus de 24 heures sont supprimés seulement si leur processus propriétaire n'existe plus. Les dossiers dont l'état est incertain sont conservés.

La mémoire activée par `--memory` reste propre au projet dans `.tours/.memory/` ; les journaux structurés sont dans `.tours/.log/`. Les fichiers `.tour` existants sont conservés. Lancer les questions séquentiellement : le catalogue ne garantit pas les écritures concurrentes. Les références valides prouvent l'existence des lignes, pas la justesse sémantique de l'explication. Le harnais répond à des questions et ne crée pas de Tour.

## Mode Knowledge expérimental (`--knowledge`)

Le harnais peut lire des Knowledge préparées manuellement. Une Knowledge est
un unique fichier Markdown dans le catalogue de mémoire du projet
(`src/knowledge.ts`) ; dans ce mode expérimental (spécification #219,
ticket #220) la découverte expose uniquement le nom et la description et
`memory_read(name)` vérifie d'abord la totalité du contrat de preuves déclaré
(SHA-256 déterministe de chaque fichier cité) puis renvoie le corps Markdown
validé ; la Knowledge est interprétée, jamais exécutée. Ce mode n'expose ni
Memory Functions ni création : `memory_run`, `function_try` et
`memory_unusable` sont absents des outils proposés et rejetés au dispatch,
aucune consolidation n'a lieu et les invitations à créer des fonctions sont
absentes. `--code --knowledge` conserve les outils de recherche et `code` ;
`--knowledge` et `--memory` sont mutuellement exclusifs ; `--knowledge` seul
fonctionne sans Code Mode. Une lecture refusée renvoie exactement `invalid`,
sans le corps ni aucun détail sensible (une trace porte le motif compressé) ;
un catalogue absent ou une entrée invalide n'empêche jamais la recherche
ordinaire. Les lectures sont masquées comme tout résultat d'outil.

Préparation d'une entrée `knowledge/<nom>.md` (nom = identifiant TypeScript
valide = nom de fichier), avec le SHA-256 des octets du fichier cité :

```sh
mkdir -p .tours/.memory/knowledge
shasum -a 256 src/exploration-du-harnais.ts   # macOS ; sha256sum sous Linux
```

Entrée d'exemple `.tours/.memory/knowledge/dispatch_flow.md` — frontmatter
YAML restreint (sous-ensemble déterministe : scalaires plats et séquence
`evidence`, voir `parseKnowledge`), puis corps Markdown libre non vide :

```markdown
---
name: dispatch_flow
description: How tool calls dispatch and refuse forgery
evidence:
  - type: file
    path: src/explore.ts
    sha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
---
Corps libre en Markdown présenté au modèle après vérification.
```

Les preuves `file` utilisent le chemin relatif au workspace et le SHA-256 des
octets ; les preuves `symbol` ne sont pas prises en charge et rendent
l'entrée invalide. Contrôle d'une entrée avant la run : une question
explicite qui la lit,

```sh
codetour-research --knowledge "Lis dispatch_flow et explique le dispatch des appels d'outils"
```

renvoie `invalid` pour toute entrée périmée (fichier modifié après
préparation, hash falsifié, fichier manquant, chemin hors workspace, lien
symbolique sortant, contrat malformé) ; la disponibilité (noms +
descriptions), les lectures réelles et les refus restent distingués dans la
trace (`memory_list`, puis `knowledge_read` en `read` ou `refused`). Les
Knowledge sont des entrées préparées manuellement, jamais écrites par le
harnais ; seul ce prototype sait les lire, et aucune exécution ni création
n'en découle.

Le modèle évalue lui-même les lacunes et peut demander plusieurs séries d'outils avant de conclure ; aucun vérificateur sémantique indépendant n'est fourni. Les lectures sont mises en cache pendant une seule demande. Si le budget expire avant un résultat structuré, le résultat partiel contient des listes vides et une incertitude explicite : les réponses intermédiaires des outils ne sont pas promues automatiquement en preuves. Les erreurs du modèle et les résultats JSON invalides sont rejetés. Les citations invalides sont signalées au modèle pour correction dans le même run et les mêmes budgets ; tous les appels sont comptés. Les lectures directes présentées au modèle portent des numéros de ligne explicites. `usageAvailable: false` indique qu'au moins un appel n'a pas fourni ses compteurs, auquel cas les totaux de tokens sont incomplets et la limite de tokens ne peut pas être garantie. Le budget de temps interrompt les appels modèle et les scripts ; les autres opérations sur le système de fichiers restent sujettes à la latence du système d'exploitation.
