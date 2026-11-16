# PostgreSQL : comparaison exploratoire avec Vibe — 16 novembre 2026

**Comparaison témoin invalide :** Vibe ne disposait pas de son shell natif. Ne pas utiliser ces résultats pour conclure sur ses performances ou pour classer les deux implémentations.

Trois questions identiques sur le protocole étendu PostgreSQL ont été exécutées en parallèle avec le harnais et Vibe 3.1.2. Modèle : `zai-glm-5-3-flash` ; raisonnement explicitement `high` ; révision PostgreSQL `7fc2f0423320e02beb8c44b863f1827604c47c75`. Un seul essai par question et par système. Chaque essai du harnais part d'une copie distincte de la mémoire en fin de série.

Les budgets affichés sont 30 tours, 160 000 tokens et 480 secondes ; leur application diffère entre les deux systèmes. Vibe a reçu une instruction supplémentaire indiquant le chemin du dépôt et demandant les outils de lecture. L'accès au shell était désactivé ; Vibe a malgré tout essayé de l'utiliser et ces appels ont été refusés. Ses lectures de fichiers ont fonctionné, mais les refus et la consigne supplémentaire limitent la comparaison. Les comptes de tokens sont ceux rapportés par chaque outil ; ils incluent les entrées mises en cache lorsqu'elles sont incluses dans le compteur d'entrée. Les éventuels coûts facturés ne sont pas établis.

| Question | Harnais : statut | Harnais : entrée + sortie | Vibe : statut | Vibe : entrée + sortie | Entrée Vibe en cache |
| --- | --- | ---: | --- | ---: | ---: |
| 08 — erreur et Sync | Partiel, sans preuve | 53 984 + 2 398 = 56 382 | Limite de tokens, sans réponse finale | 206 983 + 9 180 = 216 163 | 86 400 |
| 09 — fermeture de portail | Structuré, avec incertitudes | 73 425 + 7 430 = 80 855 | Limite de tokens, sans réponse finale | 156 791 + 6 711 = 163 502 | 87 552 |
| 13 — fermeture d'instruction préparée | Structuré, avec incertitudes | 78 522 + 6 128 = 84 650 | Limite de tokens, sans réponse finale | 152 071 + 4 343 = 156 414 | 111 744 |

Les réponses structurées du harnais sont validées sur la forme et l'existence des lignes citées ; une revue des relations et de leur pertinence reste nécessaire. Vibe a lu respectivement 12, 9 et 10 portions de fichiers, mais s'est arrêté avant de finir sa réponse. Vibe rapporte `token_limit` même lorsque son total exporté est inférieur à 160 000 ; les deux compteurs ne doivent donc pas être supposés identiques. Les mesures ne démontrent pas un gain reproductible : elles montrent seulement une consommation et des résultats différents dans ces conditions.

Une première comparaison en `low`, avec les mêmes restrictions de lecture pour Vibe, a donné trois résultats partiels sans preuve pour le harnais (54 272, 64 564 et 59 948 tokens) ; Vibe a atteint sa limite de tokens sans réponse finale (176 334, 194 456 et 194 548 tokens). Les questions et systèmes sont les mêmes mais un essai par cas ne permet pas d'attribuer les écarts au niveau de raisonnement.

Lors de rejeux précédents avec le raisonnement du fournisseur non spécifié, les six réponses vides ont chacune atteint 16 384 tokens. Le fournisseur a indiqué `finish_reason=length` et attribué 16 383 ou 16 384 tokens au raisonnement pour ces réponses. Cela établit la cause pour ces rejeux, pas rétroactivement pour les rapports originaux qui ne conservaient pas ces champs. La récupération peut maintenant augmenter une seule fois le plafond de sortie à 32 768 lorsque le fournisseur indique ce cas, dans le budget global. Les essais interrompus lors d'un changement de consigne ne sont pas comptés.

Les données brutes restent temporaires : `/private/tmp/codetour-high-08.json`, `-09.json`, `-13.json` et `/private/tmp/codetour-vibe-high-read/` ; les résultats `low` sont dans `/private/tmp/codetour-low-08.json`, `-09.json`, `-13.json` et `/private/tmp/codetour-vibe-low-read/`. Les exports Vibe incluent la configuration effective et des traces de session : vérifier leur contenu avant tout partage.
