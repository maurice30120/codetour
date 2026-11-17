# Recherche CodeTour : mémoire procédurale — diagnostic provisoire

Tour prévu : `memoire-procedurale_SKILL_3.tour` ; aucun fichier de tour n'a été créé par ces runs.

Compétence `packages/exploration-poc/skills/codetour-research/SKILL.md`, SHA-256 `47f3d5634d9ff89f4b0f8caf29d170b6b33f37333a37bbb5cd0fbdfbf8ab78a5`.

| Question / résultat | RunId | Statut | Durée | Observations |
| --- | --- | --- | --- | --- |
| Sélection et exécution de la mémoire, `memoire_SKILL_3_run1.json` | `d703962e-e6ce-4e30-a999-e50ed48974c9` | Échec | 29 ms | `TypeError: fetch failed` ; deux appels modèle, aucun outil ni citation. |
| Sélection et exécution de la mémoire, `memoire_SKILL_3_run2.json` | `bc862693-1029-4ab9-9611-e7f3db0d4324` | Échec | 31 ms | Même erreur ; deux appels modèle, aucun outil ni citation. Modèle déclaré : `zai-glm-5-3-flash`. |
| Sélection et exécution de la mémoire, `memoire_SKILL_3_run3.json` | `56f7bf91-1b18-402c-b0d6-783e8df1ac90` | Échec | 27 ms | Même erreur ; deux appels modèle, aucun outil ni citation. |

Les fichiers JSON et de progression sont dans `.tours/.log/q/`. Pour les détails, filtrer `.tours/.log/research.log` par `runId` ; éviter de partager le texte libre sans vérifier qu'il ne contient pas de secrets.

Faits observés : aucun `function_try` ou `memory_run`, aucune consolidation ni fonction persistée par ces runs ; `usageAvailable=false`, donc les tokens ne sont pas mesurables. Aucun cycle inutile n'a été observé avant l'échec. La délégation de recherche n'a pas abouti et la qualité sémantique d'un tour ne peut pas être évaluée.

La cause sous-jacente de `fetch failed` est inconnue ; une difficulté d'accès au service modèle est une hypothèse, pas un diagnostic établi. Les lectures directes de recherche ne sont pas mesurables. Aucun apprentissage ou réemploi de fonction ne peut être revendiqué.

Diagnostic réseau ultérieur : un `fetch` sans authentification vers `https://api.mistral.ai` échoue dans le sandbox avec `getaddrinfo ENOTFOUND api.mistral.ai`. Le même accès hors sandbox retourne HTTP 404 : le serveur répond, ce code étant attendu comme simple preuve de connectivité à la racine et non comme validation de l'API ou des identifiants. Ces observations établissent une différence d'accès réseau dans cet environnement ; elles ne prouvent pas à elles seules que les requêtes authentifiées fonctionneront hors sandbox.
