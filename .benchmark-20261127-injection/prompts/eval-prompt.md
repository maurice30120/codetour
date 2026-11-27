# Prompt d'évaluation (à l'aveugle)

Identique pour les 12 tours. Une nouvelle session `pi -p` par tour, même modèle
(`mistral/deepseek-v4-1-flash-1017`, thinking `high`), même grille, identifiant masqué
(le tour est copié sous `.tours/project.tour` dans un workspace neutre `run-NN`).

---

Tu évalues la qualité d'un CodeTour déjà créé dans ce workspace : `.tours/project.tour`.

Méthode :
1. Lis entièrement le fichier `.tours/project.tour`.
2. Pour chaque affirmation technique du tour (fichier, chemin, symbole, comportement, flux d'exécution), vérifie-la dans le code source du workspace. Ne crois pas le tour sur parole.
3. Note trois critères, chacun sur 10, avec des entiers :
   - `exactitude_technique` : les affirmations correspondent-elles au code ?
   - `exhaustivite` : le tour couvre-t-il l'architecture et les principaux chemins d'exécution attendus d'un Project Tour ?
   - `absence_erreurs` : absence d'affirmations fausses, de fichiers ou chemins inventés, d'hallucinations (10 = aucune erreur).
4. La note globale est la moyenne des trois critères.

Ne modifie aucun fichier. Réponds uniquement par un objet JSON, sans texte autour :
{"exactitude_technique": n, "exhaustivite": n, "absence_erreurs": n, "note_globale": x.x, "erreurs_constatees": ["..."], "affirmations_verifiees": n, "commentaire": "..."}
