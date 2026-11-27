# Préparation — création de Knowledge sur spec-341-integration

Date : 27 novembre 2026. **Préparation uniquement : aucun essai lancé.**

## Périmètre convenu

Tester la branche `spec-341-integration` après la fin de son implémentation, en se
concentrant sur la création de Knowledge : observations → digest → proposition →
admission → stockage. Ne pas changer de branche pour reprendre l’ancienne
implémentation de #329.

Références : [spec #341](https://github.com/maurice30120/codetour/issues/341),
[spec mère #329](https://github.com/maurice30120/codetour/issues/329),
[ticket de restitution #336](https://github.com/maurice30120/codetour/issues/336).
Ce protocole ciblé ne couvre pas tous les critères de #336. La campagne comparative
[#335](https://github.com/maurice30120/codetour/issues/335) est encore ouverte, sans
rapport publié lors de cette préparation ; aucune stratégie n’est recommandée ici.

Hors de cette préparation : livraison et injection, comparaison A/B/C/D, préfixe
caché, économies lors de la réutilisation, reprise et compression du contexte injecté.
La reprise d’une session reste pertinente pour vérifier la fenêtre d’apprentissage.

Aucune modification du code, des tests versionnés, des sélecteurs, des valeurs par
défaut ou de la configuration versionnée. Un défaut constaté sera documenté, sans
correction ni création automatique d’un ticket. Aucun lancement, installation,
effacement de stock ou appel LLM pendant la préparation.

## Conditions avant exécution

- Attendre la fin de l’implémentation et le feu vert pour lancer les essais.
- Relever les SHA finaux CodeTour et TokenEconomizer, les états Git, les versions
  de Pi, du modèle principal et du proposeur, les plugins réellement chargés et
  tous les réglages effectifs. Vérifier l’alignement entre checkout et code exécuté.
- Définir un stock de test isolé avec le mécanisme réellement disponible. Vérifier
  l’identité native du dépôt et de l’hôte : un simple clone ou worktree ne garantit
  pas l’isolation. Ne pas purger les données personnelles pour préparer les essais.
- Conserver les traces Pi et leur branche active, les observations retenues, le
  digest réellement envoyé, les propositions brutes, les décisions d’admission,
  l’état stocké et le ledger, lorsque l’existant permet de les recueillir.
- Fixer les prompts, les sources de référence et la grille d’évaluation avant les
  essais. Comparer les mécanismes sur les mêmes traces, avec les mêmes paramètres.
- Inventorier les commandes et tests existants sur la version finale. Ne pas
  inventer de commande de génération de digest ni de nouveau test versionné.
  Si une preuve exige un changement de code, marquer la vérification bloquée.

## Cas à préparer

| Cas | Situation | Attendu selon #341 | Preuve à recueillir |
| --- | --- | --- | --- |
| C1 — atomique | Une lecture suffisante d’un fichier ou symbole, dans une seule séquence | Admission possible dès le cycle courant, sans confirmation par une autre session | Lecture, digest, proposition, décision, entrée persistée |
| C2 — multisource | Deux sources observées expliquent un même mécanisme | Une Knowledge cohérente, étayée par les deux sources | Correspondance de chaque affirmation aux extraits |
| C3 — absence de fait | Message sans lecture, ou observations sans fait durable | Liste vide acceptable ; pas de Knowledge inventée | Entrée de fenêtre, proposition vide ou motifs de rejet |
| C4 — lecture partielle | Fragment couvrant un symbole, puis fragment ne permettant pas la preuve demandée | Preuve limitée à ce qui a réellement été présenté ; rejet de la référence insuffisante | Plages, symbole résolu, preuves accessibles à l’admission |
| C5 — références refusées | Source absente, ambiguë, périmée ou écartée du digest | Aucune admission sur cette référence | Proposition et motif de rejet, absence dans le stock |
| C6 — séquences | Deux demandes distinctes dans une session, message sans lecture et messages de pilotage Pi | Une séquence par vrai message utilisateur ; le pilotage identifiable n’en crée pas | Ordre des messages et séquences du digest |
| C7 — fenêtre | Plus de huit messages, plusieurs sessions traitées dans un ordre différent, puis reprise | Huit derniers messages par heure d’émission ; ajouts après le premier traitement hors fenêtre | Horodatages, sessions traitées, références retenues |
| C8 — déduplication | Lectures répétées, plages chevauchantes et fragments disjoints sur les mêmes octets | Code dédupliqué, provenance et contextes conservés | Catalogue d’extraits, compteurs de lectures/séquences/sessions |
| C9 — versions | Fichier modifié entre lectures, dont lignes décalées avec empreinte de symbole stable | Pas de fusion de deux instantanés sur la seule empreinte du symbole | Versions de fichier et provenance des fragments |
| C10 — commentaires | Analyse visible, correction ultérieure, hypothèse, exigence future et instruction dans les données | Ordre et rattachement conservés ; admission étayée par le code observé | Commentaires retenus et justification de chaque fait |
| C11 — plafond | Séquence à la limite de 16 000 caractères, première unité trop grande, dépassement suivi d’une petite unité | Unités complètes ; arrêt au premier dépassement ; aucun emprunt à une autre séquence | Décompte incluant code, commentaires et références ; exclusions |
| C12 — coexistence | Knowledge seule, micro-skills seules, missions combinées, modes sans LLM et deux missions désactivées | Cadence et fenêtre natives préservées ; un appel partagé quand les deux missions LLM sont actives | Appels, missions, paramètres et coût compté une seule fois |

Les cas d’admission contrôlée et les cas de refus doivent utiliser les points
d’entrée et dispositifs existants, s’ils sont disponibles après implémentation.
Une proposition simulée vérifie un contrat, pas la qualité du proposeur réel.
Une proposition réelle vide n’est pas, à elle seule, un échec du moteur.

## Évaluation des Knowledge réellement créées

Pour chaque candidate, relever les quatre champs métier `id`, `claim`, `injection`
et `detector`, puis distinguer proposition brute et contrat persisté avec preuves
calculées localement. Les métadonnées internes du digest ne sont pas du contenu
métier à injecter.

Évaluer séparément :

- la justesse : chaque affirmation est-elle étayée par le code réellement observé ?
- la portée : la candidate généralise-t-elle au-delà de ses preuves ?
- l’intérêt : explique-t-elle un comportement ou mécanisme durable et non évident ?
- la cohérence : ses sources décrivent-elles un même fait, sans confondre cooccurrence
  et relation fonctionnelle ?
- les doublons et contradictions : entre candidates, avec le stock initial et avec
  les corrections visibles de l’agent ; relever le traitement effectif du moteur.

La validité d’une empreinte prouve la stabilité du code couvert, pas la vérité du
texte. L’utilité à la relecture reste une appréciation ; elle ne prouve aucune
économie de tokens lors d’une session ultérieure.

## Relevé et restitution

Pour chaque essai, renseigner : identifiant, SHA, paramètres, état initial, prompt
ou trace, commande exacte, résultat attendu, résultat observé, pièces justificatives,
écarts et statut (`réussi`, `échoué`, `non concluant`, `bloqué`, `non exécuté`).
Tous les essais sont actuellement **non exécutés**.

Le bilan devra compter séparément les lectures, séquences et sessions, le volume du
digest, les dépassements, les appels de proposition, les candidates proposées,
admises, refusées et dupliquées, ainsi que les entrées réellement persistées.
Ventiler consommation réelle d’entrée/sortie/cache et estimations de volume ;
comptabiliser une seule fois l’appel partagé. Relever la latence si observable.
Les données absentes restent « non mesurées », jamais zéro.

Avant toute comparaison au mécanisme précédent, identifier les deux versions et
vérifier que les mêmes traces et preuves sont exploitables sans modifier le code.
À défaut, expliquer la limite et restituer les seuls résultats disponibles.

Ce document est un protocole préparatoire local. Il ne publie aucun résultat,
ne modifie aucun ticket et ne déclenche pas la clôture de #336.
