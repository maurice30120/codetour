# Rétro — bloc injecté avec un tour de retard, 25 novembre 2026

Portée : la mémoire native (micro-skills) livrée à une session est le bloc calculé par le **dernier
repli**, pas un bloc calculé pour la session en cours. Conséquence observée pendant la campagne : le
premier essai « avec mémoire » de Pi a reçu l'ancien bloc, rendu avant la correction du budget, et
rien ne l'a signalé.

## 1. Constat, avec les mesures

| Élément | Valeur |
| --- | --- |
| Session | `01a21402-8695-7527-9c39-55637bfa7dc2` (Pi, `--memory=both`, 19:40:39) |
| Bloc livré | 1 336 caractères, **5 faits**, `source: startup`, `injected_ids` vide |
| Bloc que `te microskills` affichait | 478 caractères, **2 faits marqués INJECTED** |
| Bloc livré à la session suivante (`01a21404…`, après repli) | 478 caractères, 2 faits, `injected_ids` = `["dist-cli-entrypoint","nvm-node-24"]` |

Le décalage est donc exactement d'une session : la session `01a21402` a reçu le rendu d'avant la
correction du budget (5 faits ≈ 330 tokens pour un plafond annoncé de 150), la session `01a21404` a
reçu le rendu borné produit par le repli de la précédente.

## 2. Mécanisme, dans le code

- Livraison : `plugin/controller.py:157-158` lit `injection.json["rendered"]` et le rend tel quel au
  démarrage (« inject the repository's micro-skills (cached by the last fold) », en-tête du module).
- Repli : `plugin/controller.py:241` lance en **détaché** le repli des sessions terminées ; le bloc
  n'est donc pas recalculé avant la livraison de la session qui démarre.
- Écriture : `plugin/fold.py:100-105` enregistre `profile`, `reason`, `rendered`, `rendered_ids`,
  `sessions`, `updated` — **rien sur les plafonds** en vigueur au moment du rendu, ni sur la version
  du format.
- Gel : `plugin/fold.py:76-78`, quand `microskills == "off"`, le repli des micro-skills ne s'exécute
  pas et n'écrit rien. Un basculement « coupée → active » livre donc l'avant-dernier état.
- Affichage : `plugin/cli.py:322-339` re-rend à la volée avec les plafonds courants et présente ce
  résultat comme « what the next session actually gets ». C'est faux, et c'est la source de mon
  erreur de relevé.
- Doc : `docs/PLUGIN.md:840-843` décrit le budget et le marqueur `INJECTED` (correct) mais n'énonce
  jamais le retard d'une session.

Conclusion : le retard est voulu (éviter un rendu coûteux au démarrage), mais il est **silencieux**
et **sans signature** : ni l'agent, ni l'opérateur, ni le journal de session ne peuvent distinguer un
bloc frais d'un bloc périmé.

## 3. Conséquences pour la campagne

- Tout essai « avec mémoire » suit un essai « sans mémoire » par construction du protocole : le
  premier essai mémoire reçoit un bloc figé, quel que soit l'intervalle. C'est un biais systématique
  du plan, pas un accident.
- `te microskills` ne peut pas servir de preuve d'injection : il montre un rendu hypothétique. Seuls
  l'événement `inject` du journal, `injected_chars`/`injected_ids` de l'enregistrement de session et
  la section `<tokeneconomizer>` de la transcription font foi.
- Tant que le correctif n'est pas fait, le protocole doit replier explicitement entre deux bras
  (`te fold --host pi --session <id>`) et consigner les plafonds et l'`updated` du bloc livré.

## 4. Améliorations proposées, par gravité

### 4.1 Signer le bloc et invalider un rendu périmé — vérification automatisée

Écrire dans `injection.json` la signature du rendu : `max_facts`, `max_tokens`, `profile` et une
version de format. Au démarrage, si la signature stockée diffère de la configuration courante, ne pas
livrer le bloc et journaliser `inject_skipped: caps_changed` ; le re-rendu sur place est préférable
(`PrefixStage(..., fresh=False).render()` ne fait aucun appel modèle) et supprime le trou de mémoire.
Cela couvre d'un coup le changement de plafonds, la correction du budget et la bascule
« coupée → active ».

Test manquant aujourd'hui : tous les tests écrivent `injection.json` à la main
(`tests/test_live_hooks.py:234`) ; aucun ne vérifie ce que devient la livraison quand les plafonds ont
changé depuis le rendu. Test à ajouter : rendre avec 8/400, reconfigurer à 4/150, démarrer, vérifier
que le bloc livré respecte 150 tokens (ou qu'aucun bloc n'est livré et qu'un diagnostic apparaît).

### 4.2 `te microskills` doit montrer le bloc livré, pas un rendu hypothétique — accès à l'information

Afficher le bloc stocké et son âge (`updated`) ; n'afficher le rendu à la volée que s'il diffère, avec
une ligne explicite du type « la prochaine session recevra le bloc du 25/11 19:41 (~150 tokens) ; le
rendu actuel en donnerait 478 caractères ». `docs/PLUGIN.md:842` énonce déjà ce comportement : c'est
le code qui diverge de la doc.

### 4.3 Enregistrer la provenance du bloc reçu — auditabilité

Ajouter `injected_from` (l'`updated` de `injection.json` au moment de la livraison, et la signature)
dans l'enregistrement de session (`plugin/controller.py:171-176`). « Ce bloc était-il périmé ? »
devient une lecture au lieu d'une enquête dans trois journaux.

### 4.4 Ne pas geler la livraison quand la mémoire est coupée

`fold.py:76-78` est justifié pour le coût d'apprentissage, pas pour la livraison. Avec 4.1, la
signature invalide le bloc à la réactivation ; sans 4.1, une ligne au démarrage suffirait (« le bloc
livré date du …, la mémoire était coupée depuis … »).

### 4.5 Énoncer la règle du retard — pointeur à ajouter

Une phrase dans `docs/PLUGIN.md` (§ micro-skills, à côté du budget) : « le bloc livré est celui du
dernier repli ; ce qu'une session apprend apparaît dans le bloc de la session suivante ». C'est la
phrase qui manquait pour interpréter correctement les essais 1–2.

## 5. Décisions à prendre

1. Implémenter 4.1 et 4.2 maintenant (avec leurs tests), puis relancer l'essai mémoire de Pi ?
2. Ou porter d'abord ces constats au rapport de campagne, replier entre les bras, et corriger après
   les dix essais ?
3. Le protocole doit-il fixer un repli explicite entre deux bras quel que soit le correctif retenu ?
