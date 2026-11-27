# Rétro — Knowledge : une proposée, zéro admise, 25 novembre 2026

Portée : le proposeur de TokenEconomizer n'a rendu qu'**une** carte Knowledge sur la journée, et
aucune n'a été admise. Objectif de cette fiche : établir pourquoi si peu de candidats de ce type, et
pourquoi aucun n'a passé l'admission — puis proposer les corrections d'environnement qui rendraient
ces questions répondables sans relire le code.

## 1. Constat mesuré

| Élément | Valeur |
| --- | --- |
| Appels du proposeur le 25 novembre | 3 : 34 720 tokens (18:35, `01a213c3`), 55 057 (18:50, `01a213d0`), 72 521 (19:43, `01a21404`) |
| Coût total des propositions | 162 298 tokens, hors conversation |
| Rendement | **1 carte Knowledge proposée, 0 admise** ; 5 à 8 faits natifs par appel |
| Détail de l'appel de 18:35 | 1 carte proposée / 0 admise ; 5 faits proposés / 3 admis (`dist-cli-entrypoint`, `invalid-proposal-refusal`, `nvm-node-24`) |
| État Knowledge du dépôt | 0 carte, `opt_tokens` 0 ; les cartes du 24 novembre sont dans des sauvegardes, pas dans l'état vivant |
| Fenêtre d'apprentissage | 8 dernières sessions, `last_propose` à 8 sur `now` 9 |

## 2. Mécanisme

- **Un seul appel, deux types.** Le proposeur rend au plus **8 candidats au total**, faits natifs et
  Knowledge mêlés (`plugin/fold.py:141-159`). Le prompt est d'abord celui des faits ; l'annexe
  Knowledge s'y ajoute (« For Knowledge candidates only, replace the operating-manual focus above… »).
  Un candidat est reconnu comme Knowledge par la présence d'un champ `source`, `sources` ou
  `dependencies` (`fold.py:169-171`).
- **Cadence.** Un appel toutes les 3 sessions (`microskills_propose_every`, rebind de
  `PROPOSE_EVERY`), 4 candidats par tick en l'absence de partage (`MAX_CANDS`), 8 quand Knowledge
  partage l'appel (`_SharedProposer.max_candidates`).
- **Annexe conditionnelle.** L'annexe Knowledge n'est ajoutée que si la fenêtre contient au moins
  **deux fichiers distincts observés** (`knowledge/stage.py:160-165`). Sinon `fold.py:150-152` rend
  la main sans un mot et l'appel redevient un appel de faits.
- **Admission.** `_admit` (`knowledge/stage.py:167-200`) refuse une carte pour une raison unique :
  moins de deux sources distinctes, `role` ou `flow` vide, `source_session` d'une source absent du
  champ `cite` (`source-not-cited`), fichier non couvert par la preuve (`uncovered-file`), preuve
  intraçable pour ce symbole ou ce fichier, ou contenu invalide
  (`invalid-source-or-content`).
- **Le motif est jeté.** `_apply_proposals` fait `sum(self._admit(spec)[0] …)`
  (`microskills/distiller.py:694-698`) : le couple `(ok, reason)` est calculé puis perdu.
- **Le compte est jeté aussi.** `_SharedProposer` construit
  `self.counts = {"native": {...}, "knowledge": {...}}` (`fold.py:172-181`) et rien ne le lit ni ne
  l'écrit.

## 3. Pourquoi si peu proposé

1. Les cartes sont en concurrence libre avec les faits pour les 8 places, sous un prompt dont le
   sujet principal reste le manuel d'exploitation. Un fait tient en une phrase et se prouve par une
   commande ; une carte exige deux fichiers, un flux, un rôle par fichier et des citations. Les
   faits occupent le budget : 5 à 8 par appel, une carte sur trois appels.
2. La fenêtre doit offrir deux fichiers observés distincts. Les sessions de la campagne en ont lu 0
   à 2 : plusieurs ticks n'avaient pas le droit de proposer une carte, et rien ne le signale. Un
   « 0 carte proposée » peut donc vouloir dire « aucune carte demandée ».

## 4. Améliorations proposées, par gravité

### 4.1 Enregistrer le motif de refus — observabilité

`_admit` rend `(ok, reason)` et l'appelant jette `reason` (`distiller.py:697`). Écrire une ligne par
candidat (`kind`, identifiant ou empreinte de la revendication, `admitted`, `reason`) dans un
`knowledge_proposals.jsonl` du dépôt, et l'afficher dans `te status --explain`. C'est le correctif le
plus rentable : la question posée ici n'a aujourd'hui aucune réponse après coup, et il a fallu lire
`_admit` pour énumérer les cinq refus possibles.

### 4.2 Verser le rendement dans le ledger — vérification automatisée

`_SharedProposer.counts` existe déjà et n'est jamais persisté. Le verser dans l'enregistrement de
session du ledger, à côté de `optimizer_tokens`, donnerait par session : appel payé, candidats par
type, admis par type. Aujourd'hui le ledger dit 162 298 tokens de propositions pour la journée et
rien sur ce qu'elles ont produit.

### 4.3 Réserver une part du budget aux cartes — équilibrage du prompt

Une ligne dans `fold.py:155-159` (« at most 6 native facts and 2 Knowledge candidates ») change la
répartition sans toucher à l'admission. L'effet est observable dans `counts`, donc testable dès que
4.2 est fait.

### 4.4 Dire pourquoi l'annexe Knowledge est absente — silence à corriger

`has_proposal_sources` faux ⇒ tick « faits seulement », sans trace. Ajouter
`counts["knowledge"]["skipped"] = "1 observed file"` transforme une absence inexpliquée en fait
constatable.

### 4.5 Mettre le contrat d'admission dans le prompt — écart mécanique

`_admit` exige `source_session ∈ cite` pour chaque source ; le prompt décrit `cite` comme la preuve
des faits et ne le redit pas pour les cartes. Une phrase (« list every source_session in cite ») et
un test avec un payload fixe suffisent à aligner le texte sur le contrôle.

### 4.6 Aucun test du proposeur partagé — garde-fou manquant

`tests/test_knowledge_workflow.py` couvre les motifs d'admission, mais rien ne couvre
`_SharedProposer` : ni la répartition des 8 candidats, ni le comptage, ni ce qui est écrit. Un test
avec un `runner` bouchon rendant un payload mixte figerait la répartition et le comptage, et
attraperait les régressions de 4.2 à 4.5.

## 5. Décisions à prendre

1. Traiter 4.1 et 4.2 ensemble (même objet : rendre le tick observable), puis relancer une session
   avec mémoire pour vérifier que le motif et le rendement apparaissent ?
2. Appliquer 4.3 et 4.5 dans la même passe (deux modifications de texte, effet mesurable) ?
3. Ouvrir un ticket TE pour 4.4 et 4.6, ou les traiter avec le reste ?
