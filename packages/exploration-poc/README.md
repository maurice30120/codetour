# POC : exploration structurée

POC expérimental avec Code Mode, budgets et métriques. Des essais Mistral et leurs limites sont documentés dans `poc/exploration-benchmark/`.

Node.js 24 est requis. Installer avec `npm install`, puis définir `MISTRAL_API_KEY` dans l'environnement. Depuis ce répertoire :

```sh
npm run explore -- /chemin/vers/depot "Trouver le point d'entrée"
npm run explore -- --code /chemin/vers/depot "Trouver le point d'entrée"
npm run explore -- --code --memory /chemin/vers/memoire /chemin/vers/depot "Trouver le point d'entrée"
npm test
```

Le modèle peut utiliser les outils de liste, recherche littérale, lecture bornée et dernier commit ; le résultat est un JSON de références validées. Le harnais ne génère pas de Tour. `MISTRAL_MODEL` permet de choisir le modèle ; par défaut `mistral-small-latest`. Ne pas committer la clé API.

Code Mode nécessite également `npm install --prefix ../exploration-sandbox`. Les budgets de l'API `explore` sont `iterations`, `calls` (modèle et outils), `tokens` (entrée et sortie cumulées) et `durationMs`. Un arrêt avant réponse structurée produit `status: "partial"` avec `stopReason`. Les tokens proviennent des compteurs du fournisseur ; l'entrée n'est connue qu'après chaque appel et peut dépasser le budget sur le dernier appel. Le coût est `null` tant qu'aucun tarif vérifié n'est configuré ; les références validées prouvent l'existence du fichier et des lignes, pas la pertinence sémantique de l'affirmation.

Le modèle évalue lui-même les lacunes et peut demander plusieurs séries d'outils avant de conclure ; aucun vérificateur sémantique indépendant n'est fourni. Les lectures sont mises en cache pendant une seule demande. Si le budget expire avant un résultat structuré, le résultat partiel contient des listes vides et une incertitude explicite : les réponses intermédiaires des outils ne sont pas promues automatiquement en preuves. Les erreurs du modèle et les résultats JSON ou références invalides sont rejetés, sans reprise automatique. `usageAvailable: false` indique qu'au moins un appel n'a pas fourni ses compteurs, auquel cas les totaux de tokens sont incomplets et la limite de tokens ne peut pas être garantie. Le budget de temps interrompt les appels modèle et les scripts ; les autres opérations sur le système de fichiers restent sujettes à la latence du système d'exploitation.

La mémoire est expérimentale et désactivée par défaut. `--memory` exige `--code` et stocke les scripts dans le dossier indiqué, séparés par chemin réel du dépôt ; utiliser un dossier vide par répétition. Les paramètres sont transmis à la sandbox comme données, les preuves sont recalculées et vérifiées à chaque demande. Après une exploration terminée, les scripts candidats exécutés avec succès et dont la sortie n'a pas été tronquée peuvent être conservés même sans preuve associée ; leur présence ne garantit donc pas leur utilité. Un chevauchement avec une preuve finale est un signal faible, pas une validation sémantique. Une expression peut composer une expression mémorisée avec `script(id, params)` ; les dépendances ne sont pas encore suivies lors de la purge. Les scripts non sélectionnés ne comptent pas comme échec technique. La bibliothèque est limitée à 20 scripts et ne prend pas en charge les accès concurrents : exécuter les demandes séquentiellement. Les appels interrompus avant résultat validé ne vieillissent pas la bibliothèque ; les échecs techniques tentés sont conservés.

Une sortie inutilisable pour le sujet couvert peut être signalée explicitement par le modèle avec `memory_unusable` après exécution ; ce signal ne devient un échec qu'après validation du résultat final. La distinction avec une sélection hors sujet repose sur le jugement du modèle. Une sortie tronquée n'est jamais utilisée pour enregistrer ou créditer un script, même si une de ses références aurait été visible.
