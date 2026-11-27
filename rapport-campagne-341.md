# Campagne #341 — le digest Knowledge mesuré sur les traces Pi

**Second relevé du 27 novembre 2026.** Branche `spec-341-integration` (`a75d574`, correctifs de la
revue de code et prompt Knowledge propre inclus), comparée au même bras de référence `f1a6c18`.

Cette campagne a déjà fait l'objet d'un premier relevé (`5a08581`), qui avait laissé deux défauts
ouverts et un troisième non mesuré. Les trois sont corrigés et remesurés ici, sur **les mêmes
traces et les mêmes épingles** :

1. **les commentaires de l'agent n'atteignaient pas le proposeur sur Pi** (0 sur 24 sessions) : la
   série de lectures était refermée sur toute réponse portant un appel d'outil, avant que son texte
   n'y soit rattaché, or Pi écrit presque toujours le texte dans la même réponse que l'appel
   suivant. Le texte rejoint maintenant la série ouverte, puis la réponse la referme ;
2. **le message utilisateur était compté dans les 16 000 caractères** de sa séquence, alors que la
   spec ne compte que « le code, les commentaires et les références associés » : une séquence
   réelle gardait zéro observation pour cette seule raison ;
3. **les contradictions n'étaient pas mesurées.** Le harnais sonde désormais le cycle de vie de
   bout en bout (admission, puis repli d'une session que le même détecteur contredit) et écrit
   `not measured` là où la sonde ne s'applique pas, jamais un zéro.

Le second relevé contient aussi un changement de prompt qui appartient au bras neuf : la Knowledge
n'hérite plus du préambule des Facts natifs (qui exigeait encore `cite >= 2` et un détecteur de
commande, en contradiction avec les contrats #342/#343), et l'appel partagé étiquette désormais les
deux jeux de règles. Le prompt du digest est donc plus court d'un préambule natif entier ; le
matériau du digest, lui, est inchangé : les sections « observations », « plafond » et
« admissibilité » donnent exactement les mêmes chiffres que le relevé intermédiaire fait avant ce
changement de prompt.

Ce rapport est à la racine du workspace, avec les rapports de la campagne 313, et non dans le
dépôt TokenEconomizer : celui-ci ne garde aucun résultat de run dans git (`CLAUDE.md`, « No run
outputs in the repository »). Le harnais qui produit ces chiffres, son test et les limites durables
qu'il documente pour Copilot vivent dans TokenEconomizer ; les tableaux de résultats vivent ici.

## Réponses courtes

- **Le digest envoie-t-il moins que le mécanisme précédent ?** Oui, au total : **20,5 % de caractères
  en moins** (541 605 contre 681 018, soit −34 853 tokens estimés). Le détail dépend du type de
  session : les 17 sessions du lot A (exploration large, lectures partielles) reçoivent **58 % de
  caractères en moins** (222 448 contre 529 912), les 7 sessions du lot B (`/codetour`, grosses
  lectures complètes) **2,1 fois plus** (319 157 contre 151 106). Le prompt du digest ne porte plus
  le préambule natif des Facts : c'est ce qui fait la différence, et le code que la spec veut montrer
  y est entier.
- **Moins de lectures offertes.** 45 observations offertes par le digest contre 180 par l'ancienne
  fenêtre (somme des états par repli). Ce n'est pas de la déduplication : **0 lecture dédoublonnée**
  sur ces traces. C'est la fenêtre : **8 séquences** au lieu de 8 sessions, dont **23 séquences de
  la session courante poussées dehors** sur le lot A, et **8 replis sur 24 où le digest n'offre
  rien du tout**. 45 au lieu des 42 du premier relevé : deux unités que le message évinçait sont
  désormais retenues, le reste de l'écart venant du comptage par repli.
- **Le plafond mord encore 5 fois sur 24 sessions, mais il ne vide plus aucune séquence.** 11 unités
  refusées (13 au premier relevé), 108 341 caractères écartés (131 298). La séquence qui gardait
  **zéro** observation — message de 2 000 caractères plus première lecture de 15 428 — garde
  maintenant cette lecture de 15 435 caractères, et refuse les deux suivantes faute de place. Le
  plus haut remplissage réel est 15 463 des 16 000 (96,6 %).
- **La règle du premier dépassement ne coûte plus rien dans la fenêtre.** Sur les 108 341 caractères
  refusés, une règle d'emballage (sauter ce qui ne tient pas, garder ce qui tient) n'en
  récupérerait **aucun** dans les cinq séquences concernées : ce sont des unités postérieures trop
  grosses pour le reste d'une séquence déjà remplie à 12 000–15 000 par sa tête. Le seul cas où
  l'emballage aiderait est une séquence que la fenêtre de 8 a déjà poussée dehors.
- **L'admission est plus souvent atteignable.** Sur les 16 replis qui offrent une observation, la
  première est admise 7 fois (3 pour l'ancien mécanisme sur 21 offres), et `ambiguous-source` — qui
  coûtait 3 refus à l'ancienne fenêtre — **disparaît** : une `ref` désigne une lecture, pas un
  chemin présent dans deux sessions.
- **Doublons :** une même `claim` deux fois de suite répond `duplicate` dans les 7 replis où la
  première a été admise (et sur le témoin synthétique). **Contradictions : mesurées, et elles
  retirent le fait.** 7 replis sur 24 ont pu porter la sonde : dans les 7, la Knowledge admise
  passe `ACTIVE` → `RETIRED` sur le repli qui la contredit, et `render()` cesse de la retourner.
  Les 17 autres replis disent `not measured` avec leur raison.
- **Les commentaires de l'agent arrivent enfin au proposeur, mais ils restent rares.** Le nouveau
  rattachement en attache **1** sur les 24 sessions (83 caractères), contre 0 au premier relevé.
  La raison n'est plus la règle mais la matière : Pi annonce puis lit (« I'll start by reading… »
  plus l'appel), donc le texte qui accompagne un appel ouvre une série, il n'en suit pas une ; et
  la plupart des séries ne contiennent aucune lecture **observée** (lectures partielles sans
  capture, ou hors workspace).
- **Coût de proposition :** non mesuré, seulement approché en caractères/4 (135 410 contre 170 263
  tokens estimés sur 24 replis). Aucun modèle n'a été appelé.
- **Pertinence :** jugée sur 5 séquences seulement, et sur le **matériau** offert, pas sur une
  Knowledge. Le code retenu est celui que la demande a réellement lu ; la cinquième séquence, qui
  n'offrait rien, offre maintenant sa plus grosse lecture.
- **Les quatre modes et la cadence sont inchangés** et tous pinnés par des tests existants (voir
  « Modes et cadence »). Aucun test de mode n'a eu besoin d'être ajouté.

## Conditions

- Hôte : Pi 1.6.0, traces `~/.pi/agent/sessions/` (JSONL réels, non modifiés). Les formats de
  résultat de lecture sont ceux que le README vérifie contre Pi 1.6.0 ; les lectures partielles
  exigent une capture, et **aucune capture n'est fournie** à la mesure (`captures=None`), comme
  après un repli.
- Deux bras, mêmes traces, un sous-processus chacun (`PYTHONPATH` sur le bras, les noms de modules
  se recouvrent) :
  - **nouveau** : `spec-341-integration` (`a75d574`) — le digest par séquences de travail
    (`tokeneconomizer/knowledge/digest.py`), et un prompt Knowledge qui ne porte plus le préambule
    des Facts natifs (`knowledge/stage.py::_proposal_prompt`) ;
  - **ancien** : `f1a6c18`, la pointe d'intégration après #342 et avant #343 — la fenêtre
    `observed_sources` par session, matérialisée par `git archive` dans un répertoire temporaire
    hors du dépôt (aucun état git laissé).
- Chaque trace est repliée par le vrai étage Knowledge (`Knowledge.load` puis `update`, conversion
  d'hôte pour le digest, journal brut pour les observations), avec un **proposeur factice** qui
  enregistre le prompt et répond `{"facts": []}`. Aucun appel modèle, aucun réseau, aucune horloge.
- État : un répertoire temporaire par bras, supprimé à la fin. **`~/.tokeneconomizer` n'est jamais
  touché**, aucun fichier des deux workspaces non plus (les sondes travaillent sur une copie et
  n'écrivent que dans leurs répertoires temporaires).
- Cadence : `microskills_propose_every = 3` (`load_config(workspace, env={})`), la valeur livrée ;
  le harnais la rebinde comme le fait le repli, et passe `env={}` pour qu'aucune variable `TE_*`
  ambiante ne change la mesure.
- Commande du bras neuf (l'interpréteur est celui du venv de test, qui a les parseurs) :

```
PYTHONPATH=$PWD <venv>/python scripts/knowledge_digest_measure.py \
    --traces ~/.pi/agent/sessions/--Users-dhuyet-Documents-POC-CodeTOUR+Economiser-- \
    --workspace /Users/dhuyet/Documents/POC/CodeTOUR+Economiser \
    --baseline-ref f1a6c18 --out /tmp/mesure-A.json
```

  Sans `--arm`, la même commande mesure les deux bras et affiche la comparaison ; `--arm current`
  ne mesure que le bras courant, `--control <dir>` écrit et mesure le témoin synthétique. Sans
  `--out`, le JSON va dans un fichier temporaire hors du dépôt (`--out` qui pointerait dans le
  checkout est redirigé vers ce fichier).
  `scripts/knowledge_digest_measure.py` est le seul instrument ; `tests/test_knowledge_digest_measure.py`
  (7 tests, < 0,2 s) pin le format du rapport, la cadence, la fenêtre multisession, la sonde de
  contradiction et le déterminisme.
- Les JSON de mesure sont hors de Git (`/tmp/mesure-*.json`), régénérables par la commande ci-dessus.

### Calibration initiale

Les valeurs **8 messages / 16 000 caractères** sont figées pour cette campagne et mesurées telles
quelles : `SEQUENCES = 8`, `BUDGET = 16 000`, `MESSAGE_CAP = 2 000`, `PAIRS = 32` ne sont pas
modifiés (le réglage est hors périmètre de #346). Le harnais rejoue la mesure entière, il ne
consomme pas l'état réel : il n'y a donc **pas de session de calibration** au sens de la campagne
313, et pas d'`opt_tokens` réel à citer.

| Run | Sessions repliées (`now`) | `last_propose` | `opt_tokens` |
| --- | ---: | ---: | ---: |
| avant le lot A | 0 | -1 | 0,0 |
| après le lot A (17 replis) | 17 | 17 | 0,0 |
| avant le lot B | 0 | -1 | 0,0 |
| après le lot B (7 replis) | 7 | 5 | 0,0 |

`opt_tokens` reste à 0 parce que le proposeur factice répond 0 token : c'est une mesure de volume,
pas une facture. Les sessions mesurées **comptent dans la cadence du run** (`now`, `last_propose`),
pas dans celle d'un store réel. Le point qui compte pour une campagne future : une session de
calibration repliée dans le vrai store avance `now` et `last_propose` de la même façon, et se compte
donc dans la cadence de proposition.

## Traces

Deux lots, parce que deux workspaces réels : le digest est cumulatif (une fenêtre de 8 séquences
qui traverse les replis), donc **un run = une campagne = un workspace**. Les additionner dans un
seul run changerait la fenêtre et les chiffres.

| Lot | Sessions | Messages | Appels `read` | Chemins distincts | Workspace |
| --- | ---: | ---: | ---: | ---: | --- |
| A — `…/--Users-dhuyet-Documents-POC-CodeTOUR+Economiser--/` | 17 | 92 | 78 | 69 | `/Users/dhuyet/Documents/POC/CodeTOUR+Economiser` |
| B — `…-TokenEconomizer--/` | 7 | 7 | 50 | 31 | `…/CodeTOUR+Economiser/TokenEconomizer` |
| **Total** | **24** | **99** | **128** | **100** | |

- **Trois messages de plus dans le lot A, aucune lecture de plus.** La session `2026-11-27T04-07-22`
  est la session de travail en cours : elle a reçu trois messages entre le premier relevé et
  celui-ci (92 au lieu de 89), sans aucun appel `read` de plus (78 dans les deux). Le bras de
  référence le voit aussi, à hauteur de 87 caractères (529 912 au lieu de 529 825, 140 entrées dans
  les deux cas) : c'est la mesure de la dérive, et elle ne change aucune conclusion.
- **Session à plusieurs demandes** : lot A, 11 sessions sur 17 en ont au moins deux ; la plus longue
  en a 18 (13, 12, 10 et 9 pour les suivantes). Une session de 18 demandes occupe **8 séquences**
  et en laisse 10 hors fenêtre.
- **Fenêtre multisession** : lot A, la fenêtre est pleine (8 séquences) dès le 2ᵉ repli et couvre
  jusqu'à **4 sessions** à la fin (8 séquences, 4 sessions). Lot B : elle grandit de 1 à 7 séquences
  et 7 sessions, une séquence par session.
- **Séquence qui atteint le plafond** : réelle, 5 fois (voir « Dépassements »). Le plus haut
  remplissage réel est **15 463 caractères sur 16 000** (96,6 %) ; si l'on ajoute le message, deux
  séquences dépasseraient les 16 000, et c'est exactement ce que la spec refuse.
- **Témoin synthétique**, parce que les traces réelles ne montrent pas les deux cas extrêmes de la
  règle d'arrêt : `--control <dir>` écrit une session Pi de 2 demandes / 4 lectures dans un
  workspace neuf. Séquence 1 : une lecture de 1 200 caractères gardée (820 caractères facturés), une
  de 20 400 qui arrête la rétention, une de 120 perdue bien qu'elle eût tenu. Séquence 2 : une
  lecture de 17 000 en tête, donc **rien de retenu**. Les fichiers sont ce que le journal dit, si
  bien que le même repli fait aussi l'échelle d'admission `admitted` → `duplicate` →
  `stale-proof`, et porte la sonde de contradiction.
- **Pourquoi les traces réelles ne suffisaient pas** : sur les 24 sessions, aucune séquence de la
  fenêtre ne commence par une lecture au-dessus de 16 000 ; le cas « première unité trop grande »
  n'arrive donc jamais en vrai dans la fenêtre, et il commande la seule séquence qui ne peut rien
  citer.

## Comparaison

Mêmes 24 traces, mêmes deux bras. Les colonnes « offre » sont l'état de la fenêtre au moment du
repli ; un total est donc « ce qu'un prompt contenait, additionné sur les replis ».

### Volume réellement envoyé

| | Lot A (17 replis) | Lot B (7 replis) | Total |
| --- | ---: | ---: | ---: |
| Prompt — digest | 222 448 car. / 55 618 tok. | 319 157 / 79 792 | **541 605 / 135 410** |
| Prompt — ancien mécanisme | 529 912 / 132 484 | 151 106 / 37 779 | **681 018 / 170 263** |
| Écart | −307 464 (−58,0 %) | +168 051 (+111 %) | **−139 413 (−20,5 %)** |
| Par repli (digest / ancien) | 13 085 / 31 171 | 45 594 / 21 587 | — |
| Plus gros prompt (digest / ancien) | 36 837 / 49 995 | 81 594 / 37 228 | — |

Ce que le prompt du digest contient encore de lourd, c'est le catalogue : sur le lot B il pèse 79 %
d'un prompt de 45 594 caractères, et le plus gros repli (81 594) reste 2,2 fois le plus gros de
l'ancien mécanisme. Sur le lot A, où les lectures sont petites et partielles, le prompt est 2,4 fois
plus léger que celui de l'ancienne fenêtre (222 448 contre 529 912).

Répartition en blocs du prompt du digest (le prompt est la somme des blocs) :

| Bloc | Lot A | % du prompt | Lot B | % du prompt |
| --- | ---: | ---: | ---: | ---: |
| prompt natif (avant l'annexe Knowledge) | 0 | — | 0 | — |
| consigne Knowledge | 35 003 | 15,7 % | 14 413 | 4,5 % |
| séquences de travail | 60 589 | 27,2 % | 48 470 | 15,2 % |
| catalogue d'observations | 118 962 | 53,5 % | 253 296 | 79,4 % |
| commentaires de l'agent | 3 069 | 1,4 % | 973 | 0,3 % |
| signaux (compteurs, paires) | 4 825 | 2,2 % | 2 005 | 0,6 % |

Le prompt natif est à **zéro** : le prompt du digest ne porte plus le préambule des Facts, seulement
la consigne Knowledge suivie de ses quatre blocs (séquences, catalogue, commentaires, signaux). Le
catalogue domine partout, et d'autant plus que les lectures sont complètes (lot B, 79,4 %).
L'ancien mécanisme n'a pas de frontière de bloc : ses observations voyagent dans la liste native des
digests de session, donc son volume se lit au total seul.

Le bloc commentaires n'est plus vide sans être plein : **un seul commentaire** est retenu (83
caractères), présent dans **2 replis** du lot A (la fenêtre de 8 le garde un repli), et dans aucun
repli du lot B. Les 3 069 caractères du lot A sont son en-tête plus deux fois son entrée. Les paires
de cooccurrence restent vides sur ces traces (aucune ne cooccurre).

### Lectures et entrées de catalogue

| | Lot A | Lot B | Total |
| --- | ---: | ---: | ---: |
| Appels `read` du journal | 78 | 50 | 128 |
| Chemins distincts lus | 69 | 31 | 100 |
| Observations offertes — digest | 19 | 26 | 45 |
| Observations offertes — ancien | 140 | 40 | 180 |
| Chemins distincts offerts — digest | 19 | 26 | 45 |
| Chemins distincts offerts — ancien | 133 | 38 | 171 |
| Chemins répétés offerts — digest | 0 | 0 | **0** |
| Chemins répétés offerts — ancien | 7 | 2 | **9** |

Ce que la déduplication a rapporté : **rien** sur ces traces (0 `ref` repliée dans une entrée
existante). Les lectures sont disjointes à l'intérieur de la fenêtre. Ce que l'ancienne fenêtre
répétait : 9 entrées sur 180 montraient un chemin déjà montré par une autre session, faute de
consolidation entre sessions.

Ce que la fenêtre de 8 séquences coûte : **23 séquences** de la session courante n'entrent pas dans
les 8 emplacements (lot A, 4 unités avec elles), et **8 replis sur 24** n'offrent aucune observation
(7 dans le lot A, 1 dans le lot B). L'ancienne fenêtre n'en laissait aucun dehors avant 8 sessions.
Les deux causes de ces replis vides sont les lectures partielles sans capture (invisibles pour la
mesure) et les lectures hors workspace.

### Dépassements du plafond

| | Digest | Ancien mécanisme |
| --- | ---: | ---: |
| Unités produites / retenues | 30 / 19 | 180 observations |
| Unités refusées par le budget | 11 | — |
| Caractères refusés | 108 341 | — |
| Séquences arrêtées avant leur dernière unité | 5 (3 lot A, 2 lot B) | — |
| Séquences qui ne retiennent rien | **0** | — |
| Enregistrements coupés à 2 000 caractères | — | 172 / 180 |
| Caractères montrés / caractères observés | — | 347 528 / 1 444 853 (24 %) |

Les cas réels, en détail :

| Session | Unités | Retenu | Refusé | Pourquoi |
| --- | ---: | --- | ---: | --- |
| `2026-11-25T12-45-43` (lot A) | 3 | 1 (`codetour/src/cli/index.ts`, 15 435 car.) | 9 136 | message non facturé : la tête tient (15 435 < 16 000) ; `cli.ts` (4 919) et `agentSelection.ts` (4 161) ne tiennent pas dans les 565 restants |
| `2026-11-24T17-04-53` (lot A) | 5 | 4, 13 671 car. | 15 463 | `cli/index.ts` (15 428) referme la séquence à 85 % de remplissage |
| `2026-11-27T04-07-22` (lot A) | 5 | 1 (`observation.py`, 12 791) | 41 895 | les 4 suivantes, dont `proof.py` (7 550), ne tiennent pas dans les 3 209 restants |
| `2026-11-24T14-46-56` (lot B) | 3 | 1 (`microskills/stage.py`, 8 894) | 18 841 | deuxième lecture (8 610) trop grosse pour le reste (7 106) |
| `2026-11-24T15-01-56` (lot B) | 4 | 2 (`proof.py` 7 534, `README.md` 7 558) | 23 006 | la suite ne tient plus dans les 908 restants |

Deux enseignements pour la décision à venir :

1. **Le premier dépassement arrête tout ne coûte plus rien dans la fenêtre.** Sur les 108 341
   caractères refusés, une règle d'emballage n'en récupérerait **aucun** : dans chaque séquence
   concernée, la tête pèse 8 894 à 15 435 caractères et les unités suivantes sont toutes plus
   grosses que ce qui reste. Le seul cas où l'emballage aiderait est la séquence 0 de
   `2026-11-25T18-18-23` (une unité de 24 323 puis une de 12 232 qui eût tenu) — une séquence que
   la fenêtre de 8 a déjà poussée dehors, donc non citable de toute façon.
2. **La tête de séquence reste le vrai coût, mais elle est maintenant celle du code.** Le message
   sorti du budget, la séquence retient son observation la plus lourde (12 000–15 400 caractères sur
   16 000) et perd les suivantes : c'est un choix de rétention, pas une perte sèche. Ce que la
   decision de réglage doit arbitrer est donc la taille d'une unité (une lecture complète de
   `cli/index.ts` pèse 15 435 à elle seule), pas la part du message.

### Admissibilité, doublons, contradictions

Quatre sondes par repli, toutes déterministes et sur des copies : trois candidats minimaux
construits sur la première observation que le bras offre (le candidat lui-même, la même `claim` une
seconde fois, puis le même candidat après avoir modifié une copie du fichier — le workspace réel
n'est jamais touché), et une sonde de contradiction.

| | Digest | Ancien mécanisme |
| --- | ---: | ---: |
| Replis offrant une observation | 16 / 24 | 21 / 24 |
| Première observation **admise** | 7 | 3 |
| Première observation **périmée** (`stale-proof`) | 9 | 15 |
| Première observation **ambiguë** (`ambiguous-source`) | 0 | 3 |
| Même `claim` deux fois → `duplicate` | 7 / 7 | 3 / 3 |
| Sonde périmée → `stale-proof` | 16 / 16 | 18 / 21 |

- `ambiguous-source` disparaît : un chemin lu dans deux sessions de la fenêtre était ambigu, une
  `ref` ne l'est jamais. C'est le gain le plus net de #342/#343 sur ces traces.
- La première offre du digest est **plus fraîche** (9 périmées sur 16, contre 15 sur 21) parce
  qu'elle vient de la séquence la plus récente, non de la plus vieille session de la fenêtre.
- **Doublons** : traités par la `claim`, pas par la `ref`. Une Knowledge identique proposée deux fois
  est refusée dès la seconde, et une `ref` refusée ne prend pas de place.
- **Contradictions, désormais mesurées.** La sonde replie une session synthétique dont la sortie
  confirme le détecteur de la sonde, admet une Knowledge qui le porte (l'admission ne demande que
  des preuves, pas de confirmation), enregistre son cycle de vie et ce que `render()` retourne, puis
  replie une session que le même détecteur contredit et relève les deux à nouveau :

| | Lot A | Lot B | Total |
| --- | ---: | ---: | ---: |
| Replis où la sonde s'applique | 7 / 17 | 0 / 7 | **7 / 24** |
| Knowledge admise puis **`RETIRED`** | 7 | — | **7 / 7** |
| Fait encore retourné par `render()` après le retrait | 0 | — | **0** |
| Replis `not measured` | 10 | 7 | **17** |

  Les 17 replis où la sonde ne s'applique pas ne comptent pas zéro : ils disent `not measured` avec
  leur raison — 8 × « aucune observation offerte à citer » (7 dans le lot A, 1 dans le lot B) et
  9 × preuve périmée (3 dans le lot A, 6 dans le lot B). C'est cohérent : une Knowledge ne peut
  être admise que sur une preuve qui vérifie encore, et les fichiers des traces de novembre ont
  bougé. La sonde confirme donc le contrat sur les replis admissibles ; elle ne dit rien de la
  véracité du constat.

### Coût de proposition

Aucun modèle n'est appelé : le coût réel (`optimizer_tokens`, effectif et tenant compte du cache)
n'est **pas** mesuré. Le proxy est `caractères / 4`, comme le budget d'injection
(`knowledge_tokens`) :

| | Lot A | Lot B | Total |
| --- | ---: | ---: | ---: |
| Digest | 55 618 tok. estimés | 79 792 | 135 410 |
| Ancien mécanisme | 132 484 | 37 779 | 170 263 |

Trois raisons de ne pas lire ces chiffres comme une facture : le prompt mesuré est
`_proposal_prompt()` seul, sans l'enveloppe du repli (consigne « up to 8 candidates TOTAL ») ni le
vocabulaire de l'adaptateur ; un vrai proposeur renvoie des tokens effectifs, dominés par le cache ;
et le tick est partagé, donc la moitié « Knowledge » d'un appel combiné n'est pas isolable par cette
mesure. Ce que le proxy dit de solide : le prompt du digest est **plus léger au total** (−20,5 %) et
nettement plus léger là où les lectures sont petites et partielles (−58 %), mais il reste plus
lourd là où elles sont complètes (×2,1) — le plafond de 16 000 par séquence pèse plus que les
2 000 par chemin de l'ancienne vue, d'autant plus depuis que le message ne le rogne plus.

### Pertinence (échantillon)

Méthode : pour 5 séquences tirées des deux lots, comparer les chemins **retenus** par le digest aux
chemins que la séquence a lus, et à ce que la demande (ses 2 000 premiers caractères) décrit. Aucun
texte de prompt n'est reproduit ici.

| Séquence | Demandes de la session | Lus | Retenus | Jugement |
| --- | ---: | ---: | ---: | --- |
| `01a20e84/0` | 1 | 5 | 4 (`tourDiscovery.ts`, `tourSchema.ts`, `provider.ts`, `extension.ts`) | cohérent : le quatuor découverte/schéma/providers/extension est le mécanisme exploré ; `cli/index.ts` (15 435) est le seul écarté |
| `01a20e06/0` | 1 | 3 | 1 (`microskills/stage.py`) | cohérent : fichier du mécanisme en cours |
| `01a20e0a/0` | 1 | 3 | 2 (`plugin/adapter.py`, `plugin/hook.py`) | cohérent, un troisième écarté par le budget |
| `01a20e0e/0` | 1 | 2 | 1 (`loopguard/rules.py`) | cohérent |
| `01a212bd/0` | 1 | 3 | **1** (`cli/index.ts`, 15 435) | le plafond ne vide plus la séquence : c'est la lecture la plus lourde qui reste, les deux plus petites (4 919, 4 161) sont écartées |

Ce qu'un stub ne peut pas montrer : la **Knowledge elle-même**. Aucune `claim` n'est produite, donc
la justesse d'une phrase, la généralisation, la distinction constat / hypothèse / exigence future et
la réutilisation réelle restent non mesurées. Ce qui est mesuré est en amont : le proposeur reçoit
le code que la demande a réellement lu, dans l'ordre des lectures, avec sa version et ses `ref`.

## Modes et cadence

Quatre modes, tous pinnés par des tests existants — **aucun test de mode n'a été ajouté** :

| Mode | Sélection | Tests qui le pinent |
| --- | --- | --- |
| Knowledge seule | `TE_KNOWLEDGE=on TE_MICROSKILLS=off` | `tests/test_knowledge_workflow.py::test_knowledge_is_independent_and_disabled_by_default` (indépendance, défaut *off*) ; `tests/test_knowledge_pi.py::test_pi_hook_learns_from_recorded_active_sessions` (apprend au 2ᵉ repli, en micro-skills *off*) |
| Micro-skills seules | `TE_MICROSKILLS` à `on`, `envfacts` ou `distiller`, Knowledge off | même test d'indépendance ; `tests/test_live_hooks.py::test_micro_skills_on_runs_the_proposer_without_paid_and_charges_it` (2 appels sur 5 sessions, tous les 3) ; `tests/test_live_hooks.py::test_micro_skills_is_off_by_default_and_learns_nothing` |
| Combinées | `TE_KNOWLEDGE=on TE_MICROSKILLS=distiller` | `tests/test_knowledge_workflow.py::test_paid_native_and_knowledge_share_one_proposal_budget` (**un seul appel**, budget de 8 candidats partagé, `shared_proposals = {"native" : {1,1}, "knowledge" : {7,6}}`) ; `::test_one_observed_source_still_shares_the_proposal_call` (un seul appel, transcription **inchangée**, `load_trajectory` toujours à 2 appels d'outil → aucun appel d'outil ajouté) |
| Sans LLM | les deux à *off*, ou `TE_MICROSKILLS=envfacts` (couche gratuite), ou `TE_SHADOW` | `tests/test_envfacts.py::test_prefix_stage_envfacts_profile_needs_no_runner_and_reports_zero` (`runner=None`, `opt_tokens` invariant 0) ; `tests/test_live_hooks.py::test_resume_does_not_inject_again_and_shadow_never_injects` (shadow n'injecte rien) ; le test « off by default » ci-dessus |

Cadence, mesurée par le harnais (`tick` : `cadence` = le tick est dû, `sources` = le digest a de
quoi proposer, `ran` = l'appel est parti) :

| | Lot A | Lot B |
| --- | ---: | ---: |
| Replis où le tick est dû | 6 / 17 | 2 / 7 |
| Replis avec au moins une observation | 10 / 17 | 6 / 7 |
| Ticks envoyés | 6 | 2 |

Identique dans les deux bras : **8 replis sur 24** déclenchent un appel, tous les trois replis, et
les 8 ont trouvé de quoi proposer. `has_proposal_sources` n'a donc retenu aucun tick dû sur ces
traces ; avec un tick à chaque repli, il en aurait retenu 7 (lot A) et 1 (lot B) — c'est le point à
surveiller dans une vraie campagne, où la cadence tombe parfois sur un repli sans rien à proposer. `tests/test_knowledge_digest_measure.py::test_the_harness_reports_the_cadence_and_the_window_across_sessions`
pin ce comptage et la fenêtre à deux sessions.

## Ce que Copilot permet d'observer et de prouver

Résumé de ce que `tokeneconomizer/knowledge/README.md` (section « What Copilot lets
TokenEconomizer observe and prove ») fixe durablement, avec son test dans
`tests/test_knowledge_copilot.py` :

- **Format de session 1.0.105 uniquement.** Toute autre version ne produit aucune observation : une
  montée de version de Copilot arrête l'apprentissage Knowledge silencieusement.
- **Télémétrie de troncature obligatoire** (`viewType: "file"`, `command: "view"`, pas de
  `largeOutputAvoided`, `options` exactement `truncateBasedOn: tokenCount` / `truncateStyle: middle`,
  `inputs` exactement `["path", "command"]`, et `resultLength == resultForLlmLength ==` longueur
  UTF-16 du contenu). Sans elle, TE ne distingue pas un fichier entier d'une vue tronquée.
- **Refus au-delà de 20 KiB** (20 480 octets), y compris un `view` marqué `largeOutputAvoided`.
  L'agent peut lire un fichier de 40 Ko ; TE ne peut jamais prouver ce qu'il y a lu.
- **Pas de `view` partiel.** `arguments` doit valoir exactement `{"path"}` : `view_range` est refusé,
  et il n'existe pas de capture pour Copilot (`knowledge/capture.py` est réservé à Pi). Donc **ni
  plages de lignes, ni fragments, ni preuve de symbole depuis une lecture partielle** :
  `partial-needs-symbol` et `symbol-not-observed` y sont inatteignables.
- **Pas de commentaires** : aucun lecteur de `assistant.message`, donc aucune séquence Copilot ne
  porte le texte visible de l'agent, et rien n'en est inventé.
- **Aucun texte de prompt ni horodatage dans une preuve.** Le texte de `user.message` est un
  contexte de séquence (borné) et `data.turnId` n'est pas lu ; une lecture est rattachée à sa
  séquence par la position de l'événement, jamais par comparaison d'heures.
- **Une ligne corrompue perd la session** : le lecteur strict UTF-8/JSON échoue fermé.

Conséquence pour une décision future : côté Copilot, la question « la lecture était-elle
suffisante pour prouver ce constat ? » n'a pas de réponse pour les lectures partielles, et la
question « le fichier a-t-il été vu en entier ? » dépend d'une télémétrie que l'hôte peut cesser
d'émettre. La mesure de cette campagne est Pi uniquement.

## Anomalies et limites

- **Un seul commentaire d'agent retenu sur 24 sessions** (83 caractères, lot A), au lieu de zéro
  avant le correctif. Ce n'est plus la règle qui bloque, c'est la matière : sur Pi, 176 messages
  assistant du lot A portent du texte, dont 77 dans la même réponse qu'un appel d'outil ; le
  nouveau rattachement les accepte, mais il n'y a de série à rejoindre que si une lecture a été
  **observée** avant. Or Pi annonce puis lit (« I'll start by reading… » suivi de l'appel) : ce
  texte ouvre la série, il ne la suit pas. Les 58 messages du lot A qui suivent au moins une
  lecture observée dans leur séquence ne sont donc, pour la plupart, plus dans la série (un appel
  sans texte l'a refermée) ou n'ont plus de lecture observée devant eux.
- **Les lectures partielles sont invisibles dans cette mesure.** Le hook de Pi écrit une capture au
  moment de la lecture et le repli la supprime ; le harnais n'en fournit aucune. Une session dont
  toutes les lectures sont partielles n'offre donc rien (7 des 17 sessions du lot A). En production
  le digest les voit — et c'est aussi ce qui ouvrirait des séries de commentaires. C'est la première
  cause des « 8 replis sans observation ».
- **Lectures hors workspace** (`~/.agents/skills/…`) : jamais observées, par contrat. Elles comptent
  dans les appels `read` du journal, pas dans les observations.
- **`stale-proof` massif** : les traces datent de novembre, les fichiers ont changé. 9 des 16 offres
  du nouveau bras et 15 des 21 de l'ancien pointent un fichier modifié depuis, et 17 des 24 replis
  ne peuvent pas porter la sonde de contradiction pour cette raison. L'admissibilité mesurée porte
  donc sur des **preuves fraîches ou figées**, pas sur la qualité des propositions : un vrai
  proposeur, sur des traces fraîches, verrait plus d'admissions et la sonde s'appliquerait partout.
- **Aucune proposition réelle, aucun coût réel.** Le stub ne renvoie aucun fait : la qualité des
  cards, la généralisation et `optimizer_tokens` ne sont pas mesurés. La sonde de contradiction
  rejoue le cycle de vie avec une `claim` fixe et un détecteur de synthèse : elle prouve que le
  contrat retire le fait, pas que le fait était juste.
- **La fenêtre est cumulative.** Un run = une campagne ; l'ordre et le choix des traces changent la
  fenêtre. Les deux lots ont donc été mesurés séparément, et non additionnés dans un seul run.
- **Les traces bougent.** La session `2026-11-27T04-07-22` est la session de travail en cours : elle
  a reçu trois messages (sans lecture) entre le premier relevé et celui-ci. Les comparaisons du lot A
  portent donc sur 92 messages au lieu de 89 ; le bras de référence le voit aussi, à hauteur de
  87 caractères sur 24 replis, ce qui borne l'effet.
- **Le plafond de message mange le contexte.** Sur le lot B, les 7 messages sont des expansions
  `/codetour` de plus de 2 000 caractères : le proposeur voit le prologue du skill, pas la demande.
  Sur le lot A, les 4 séquences les mieux pourvues ont aussi un message tronqué à 2 000.
- **`reads` et `paths` viennent du journal** (branche active, appels d'outil `read`), pas du
  mécanisme : une lecture que l'hôte refuserait (échouée, tronquée) y compte.
- **Ce que le harnais mesure exactement** : `_proposal_prompt()` de l'étage Knowledge, sans
  l'enveloppe du repli ni le vocabulaire de l'adaptateur ; les tailles de blocs sont des positions
  dans cette chaîne.
- Les anciens calculs d'emballage (9 066 caractères récupérables) dataient de la règle précédente :
  ils sont refaits ici sur les mêmes traces (aucun caractère récupérable dans la fenêtre), et ce
  calcul reste un script d'analyse ponctuel, non versionné ; les chiffres du harnais, eux, se
  régénèrent.
- Les journaux bruts restent hors de Git : `~/.pi/agent/sessions/` (traces) et `~/.tokeneconomizer`
  (états réels, non touchés par cette mesure).

## Pour trancher

1. **La fenêtre de 8 messages, pas 8 sessions.** 23 séquences poussées dehors sur le lot A, 8 replis
   sur 24 sans rien à offrir, et une session de 18 demandes qui occupe toute la fenêtre à elle
   seule. La question à instruire : garder 8 messages (récence fine, couverture étroite) ou indexer
   sur un nombre de sessions × messages (couverture plus large, récence plus grossière) ?
2. **La taille d'une unité, pas la part du message.** Le message est désormais hors du budget ; ce
   qui coûte une séquence, c'est une lecture complète de 12 000–15 400 caractères en tête. Faut-il
   plafonner une unité (et montrer un extrait, au prix d'un budget qui ne compte plus ce qu'il
   montre), conserver une tête plus petite par un ordre de rétention différent, ou accepter que deux
   séquences saturent ? C'est un choix de rétention, plus une correction.
3. **La règle du premier dépassement peut rester** : elle ne coûte aucun caractère récupérable dans
   la fenêtre, sur ces traces.
4. **L'attribution des commentaires sur Pi a été corrigée et ne produit qu'un commentaire.** La
   question restante n'est pas la règle mais le texte qui *ouvre* une série : l'attacher à la série
   qu'il annonce reviendrait à le rattacher à des lectures qui n'ont pas encore eu lieu (et, sur Pi,
   à des lectures que la capture rend visibles). À instruire avec des traces fraîches **et des
   captures**, sinon le bloc commentaires restera un en-tête.
5. **Refaire la mesure avec un vrai proposeur et des traces fraîches**, pour l'admissibilité, les
   doublons, les contradictions sur des preuves vivantes et le coût réel : ici tout est fait avec un
   stub, sans réseau, et sur des fichiers qui ont bougé depuis.

## Livrables

- Ce rapport, à la racine du workspace, non versionné dans TokenEconomizer (second relevé).
- Dans TokenEconomizer (`spec-341-integration`) : `scripts/knowledge_digest_measure.py` (harnais
  reproductible, sonde de contradiction, `--out` par défaut hors du dépôt),
  `tests/test_knowledge_digest_measure.py` (7 tests), `tokeneconomizer/knowledge/README.md`
  (section « What Copilot lets TokenEconomizer observe and prove », section « Measuring the digest
  on Pi session logs », sans tableau de résultats), et les correctifs mesurés ici
  (`digest.session_sequences`, `digest._retain`, `Knowledge.update`,
  `Knowledge._proposal_prompt`).
