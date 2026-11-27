# Protocole — réutilisation de Knowledge entre des Project Tours distincts

## Objectif

Observer si TokenEconomizer réinjecte, dans une nouvelle session, des faits appris
pendant la génération de Tours précédents, alors que chaque génération porte sur un
sujet différent du même dépôt CodeTour.

Il s'agit d'une campagne **à un seul bras** : `knowledge=on` et `microskills=on`
pendant toute la séquence. Elle documentera la réutilisation effective des mémoires,
mais ne permettra pas d'attribuer une baisse de coût ou une hausse de qualité à
Knowledge plutôt qu'aux micro-skills, au modèle ou à la variation des tâches. Ne pas
présenter ses résultats comme une comparaison causale.

## Plan figé

- 12 sessions Pi neuves, chacune créant un Project Tour distinct ; voir `tasks.json`.
- Les sujets couvrent des sous-systèmes différents, avec des interfaces communes
  susceptibles de produire des faits réutilisables.
- Exécution strictement séquentielle, dans l'ordre `reuse-01` à `reuse-12`.
- Même copie du code, même chemin de workspace, même modèle, mêmes réglages et même
  état TokenEconomizer pendant toute la séquence. Le chemin constant est essentiel :
  Knowledge est indexé par workspace.
- Modèle recommandé pour la comparaison avec les essais précédents :
  `mistral/deepseek-v4-1-flash-1017`, avec le même mode de réflexion si le fournisseur
  l'accepte. Noter tout changement ou refus ; ne pas mélanger les modes dans une
  même série.
- Le dépôt peut être modifié depuis les essais précédents. La copie du workspace doit
  être faite depuis l'architecture actuelle au moment du lancement, et non depuis
  l'ancien commit `c248a4ab`. La copie exclut les dépendances, les anciens Tours,
  les artefacts compilés, `poc/benchmark` et les fichiers de secrets usuels (`.env*`,
  clés privées, `.npmrc`, `.netrc`). Consigner le commit, les changements locaux et la
  liste des fichiers copiés dans `env/versions.json`. Vérifier que la
  commande `codetour` utilisée par la compétence est compatible avec cette version
  du code ; noter son chemin et sa version.

## Préparation et isolation

Depuis la racine du dépôt, initialiser le benchmark une seule fois :

```bash
python3 .benchmark-20261127-reuse/bench.py setup
```

Le runner copie le `codetour/` courant dans
`/private/tmp/codetour-bench-20261127-reuse/workspace`. Le chemin externe évite de
confondre la copie avec la racine Git et l'isole des anciens artefacts du dépôt.
Cette copie est le workspace fixe des 12 générations ; ne pas la recréer entre les
sessions. Les Tours produits sont déplacés vers `tours/` après le fold de chaque
session, puis `.tours/` est retiré de la copie afin qu'un Tour précédent ne devienne
pas une source parasite pour le suivant.

Le runner utilise un `TOKENECONOMIZER_HOME` dédié sous
`.benchmark-20261127-reuse/state/te-home`. Ne pas réutiliser ni modifier le home
TokenEconomizer personnel. Ce home doit commencer sans Knowledge pour ce workspace ;
le runner configure `knowledge=on`, `microskills=on` et
`knowledge_injection=both` avant chaque session, sans réinitialiser l'état appris.
Les commandes sont :

```bash
python3 .benchmark-20261127-reuse/bench.py status
python3 .benchmark-20261127-reuse/bench.py run reuse-01
# Continuer dans l'ordre, ou lancer toute la séquence :
python3 .benchmark-20261127-reuse/bench.py run-all
```

Archiver dans `env/versions.json` le commit du parent et du sous-module,
`git status --short`, les empreintes des fichiers copiés, les versions de Pi et de
TokenEconomizer, le modèle et la configuration effective. Ne pas lancer deux sessions
à la fois : le fold de l'une doit être terminé avant la suivante.

## Exécution

Pour chaque tâche de `tasks.json`, dans l'ordre :

1. Démarrer une nouvelle session `pi -p` depuis la copie fixe du workspace, avec le
   modèle et le prompt de la tâche. Chaque prompt demande un Tour français différent,
   en lecture seule sur le code et créé sous `.tours/reuse-NN.tour`.
2. Archiver le transcript Pi complet, stdout/stderr, heure de début/fin, usage
   (input, output, cache lu/écrit, coût estimé), appels d'outils, Tour et résultat
   de validation CLI dans `runs/`, `logs/` et `tours/`.
3. Attendre la fin du fold TokenEconomizer. Avant de poursuivre, enregistrer si le
   fold a été reçu, l'état des micro-skills, les cartes Knowledge admises/modifiées,
   leurs identifiants, preuves, révisions et sources.
4. Le runner archive le Tour sous `tours/reuse-NN.tour`, puis retire les artefacts
   `.tours/` de la copie de travail avant la tâche suivante. Ne toucher à aucun
   fichier source.
5. Enregistrer toute déviation, absence d'injection, erreur ou timeout ; ne pas
   relancer silencieusement un essai et ne pas remplacer un résultat.

Conserver le texte réellement injecté dans chaque transcript, pas seulement la sortie
d'une sonde `SessionStart`. Pour Pi, inspecter les sections du message système
(`sections.tokeneconomizer`) ainsi que les messages personnalisés d'injection après
outil. Les sondes qui ne lisent que `hookSpecificOutput.additionalContext` peuvent
indiquer zéro alors que le contexte a bien été livré.

## Mesure de la réutilisation

Pour chaque tâche, établir une table reliant :

- la carte et sa preuve, produites par une session antérieure ;
- son identifiant et son texte effectivement injecté dans la session courante ;
- le moment de l'injection par rapport aux lectures d'outils ;
- les affirmations du Tour qui correspondent à cette carte ;
- la vérification de ces affirmations dans le code actuel ;
- les fichiers/symboles lus par l'agent avant et après l'injection.

Une réutilisation est **vérifiée** seulement si la carte existait avant la session,
a été livrée à cette session, porte sur un fait pertinent pour son nouveau sujet et
correspond à une affirmation exacte du Tour vérifiée dans le code. Une carte injectée
après la lecture de sa source peut être comptée comme contexte reçu, mais pas comme
lecture évitée. La similarité de texte seule ne prouve pas l'usage de la mémoire.

Rapporter au minimum : nombre de tâches, folds réussis, cartes injectées, injections
pertinentes/non pertinentes, réutilisations vérifiées, erreurs techniques, qualité
du Tour et coût par tâche. Les tokens de cache doivent être séparés des tokens hors
cache ; le coût fournisseur est estimé par Pi. Inclure séparément les coûts des
proposeurs/folds TokenEconomizer s'ils sont disponibles, et signaler explicitement
toute part inconnue.

## Évaluation qualité

Évaluer les 12 Tours à l'aveugle après les générations, avec un évaluateur distinct
des sessions de création. Désactiver Knowledge et les micro-skills dans le home
d'évaluation isolé afin que le juge ne voie pas les cartes étudiées. Vérifier les
chemins, symboles, ancres et affirmations dans la copie figée du code. Noter sur 10 :
exactitude technique, couverture du sujet demandé et absence d'erreurs. Archiver les
affirmations vérifiées et les erreurs, pas uniquement la note.

## Limites d'interprétation

Cette campagne répond à « observe-t-on des mémoires réutilisées entre des sujets
distincts ? », pas à « Knowledge économise-t-il des tokens ? ». Sans bras témoin,
aucune économie, amélioration de qualité ou effet propre à Knowledge ne peut être
établi. Les tâches sont toutes dans le même dépôt ; une réussite ne démontre pas le
transfert à un autre dépôt ou domaine.

## Artefacts

```text
tasks.json              sujets et ordre figés
env/versions.json       code, outils, modèle et configuration
state/te-home/          home TokenEconomizer isolé et persistant
state/checkpoints/      empreintes de l'état TE après chaque fold
/private/tmp/.../       copie unique du code actuel
runs/                   métriques et statut par tâche
logs/                   stdout/stderr par tâche
sessions/               copie intégrale des transcripts Pi
tours/                  Tours produits
eval/                   évaluations à l'aveugle et preuves
results.md              synthèse, limites et conclusion
```
