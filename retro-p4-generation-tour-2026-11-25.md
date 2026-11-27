# Rétro — essai P4 (Pi, Changes Tour, mémoire active), 25 novembre 2026

Portée : un essai de la campagne « 10 essais Pi + Copilot », celui où la génération de Tour a
échoué sans que la cause soit visible. Objectif de cette fiche : établir ce qui s'est réellement
passé, puis proposer des améliorations de l'environnement de l'agent.

## 1. État de l'essai

| Élément | Valeur |
| --- | --- |
| Commande | `/codetour changes neutral Explique en français les changements committés depuis origin/main, sans tenir compte des modifications locales.` |
| Agent / modèle | Pi 1.6.0, `mistral/deepseek-v4-1-flash-1017`, thinking off, sans MCP |
| Mémoire | `--memory=both` ; bloc injecté 478 caractères, 2 faits (`dist-cli-entrypoint`, `nvm-node-24`), `injected_ids` enregistrés |
| Workspace | lancé dans `codetour/`, `--workspace .` |
| Base / tête | `origin/main` = `a55138959ceed699aa3b9951983f350b906e73a4`, HEAD = `cdcab992df9304a4eaaf9495ff0a1bde685cf55c` |
| Session Pi | `01a21407-40b6-7052-9fc2-f2ab8c939a52` |
| Transcription d'écran | `/tmp/campaign/P4-pi.log` |

## 2. Ce qui s'est passé

Relevé : 66 appels d'outils (65 `bash`, 1 `write`), 143 s, 67 requêtes, 53 363 tokens d'entrée hors
cache, 14 709 de sortie, 2 836 480 lus du cache, 0 écrit.

1. Proposition soumise avec la légende Mermaid `**Diagramme — Les trois mouvements de la branche**`
   → refus `INVALID_PROPOSAL`, `steps[0].description.mermaid[0].caption` (légende traduite).
2. Légende corrigée en `**Diagram — …**` → **38 issues**, toutes de la forme
   `steps[i].file: does not exist in the analyzed commit` (19 étapes × `file` + `pattern`).
3. Les chemins de la proposition étaient relatifs à la **racine Git** : `codetour/README.md`,
   `codetour/packages/tour-generation/src/creation.ts`, plus `AGENTS.md`, `.gitmodules`,
   `PROTOCOLE-TEST.md` (fichiers de la racine, hors du workspace).
4. Huit appels consommés à relire `validation.ts`, `git.ts` et `workspacePrefix` pour reconstituer
   la règle : `readCommitAnchors` (`packages/tour-generation/src/git.ts:123`) retire le préfixe du
   workspace, donc `file` s'écrit **relatif au workspace**, ici `packages/…`.
5. Contournement trouvé : relance du CLI **depuis la racine** avec `--workspace .` → succès.
6. Tour de 20 étapes écrit dans `/Users/dhuyet/Documents/POC/CodeTOUR+Economiser/.tours/changes.tour`,
   `ref cdcab99`, `baseRef a551389`, journal de création à la racine avec le même `sessionId`.
7. Le hook Pi, qui résout son workspace à `codetour/`, ne voit aucune création attribuable :
   **aucun rapport de fin**, ni résumé ni ligne de tokens. L'essai a été lu comme un échec complet.

Cause racine : le workspace (`codetour/`) est un **sous-dossier** du worktree Git. Le diff et
`git show` nomment les fichiers `codetour/…`, les ancres doivent les nommer `…`. Rien dans la skill
ni dans le message de refus ne nomme cet écart ; le modèle a résolu la contradiction en changeant
le workspace, ce qui déplace le Tour hors de l'emplacement attendu et coupe le rapport de fin.

## 3. Corrections à porter au dossier de campagne

- P4 n'est **pas** « aucun Tour créé » : c'est « Tour créé à la racine du dépôt, hors de
  `codetour/.tours`, sans rapport de fin ». Les mesures de tokens restent valides.
- L'hypothèse consignée plus tôt — « étapes ancrées sur des fichiers non commités » — est fausse :
  les fichiers existent dans le commit, sous un autre préfixe.
- Conséquence de méthode : les contrôles de fin d'essai doivent inclure les deux emplacements
  possibles (`<workspace>/.tours` et `<racine>/.tours`), sinon une création passe inaperçue.

## 4. Améliorations proposées, par gravité

### 4.1 Le hook se taît quand le Tour naît dans un autre workspace — observabilité

Preuve : création enregistrée pour le même `sessionId` à la racine, rapport de fin absent.
`extensions/codetour.ts` (`reportResponse`) est silencieux « quand aucune création n'est
attribuée », ce qui est conforme au contrat, mais ne distingue pas « rien n'a été créé » de
« quelque chose a été créé ailleurs ».

Correctif : quand le journal de la réponse porte une création du même `sessionId` pour un autre
workspace, émettre une ligne de diagnostic (« Tour créé dans `<racine>` ; lecture indisponible
depuis ce workspace »). Test ciblé à côté des tests d'attribution existants.

### 4.2 Le refus du validateur ne nomme pas la cause — vérification automatisée

Preuve : 38 issues identiques, aucune indication de préfixe, 8 appels pour retrouver la règle.
`packages/tour-generation/src/validation.ts:674` (`checkCommitAnchor`) ne dispose pas du préfixe,
alors que `workspacePrefix` (`git.ts:177`) le fournit à l'appelant.

Correctif : transmettre le préfixe et, si `value` commence par lui alors que le reste existe dans le
commit, répondre « est relatif à la racine Git ; le workspace est `<préfixe>`, écrire `<reste>` » ;
et « est hors du workspace » pour un fichier de la racine. Test unitaire à côté de celui qui fige le
message actuel (`packages/tour-generation/test/unit/proposal-validation.test.ts:209`).
C'est le correctif au meilleur rendement : il supprime le mur de 38 issues et l'exploration du code
du validateur.

### 4.3 La référence d'ancrage n'énonce pas le cas du sous-dossier — pointeur

`packages/pi-plugin/skills/codetour-generate/references/anchors.md`, étape 2, dit seulement
« workspace-relative ». La branche qui a échoué n'est pas couverte. Ajouter : « quand le workspace
est un sous-dossier du worktree Git, le diff et `git show` montrent `sous/dossier/fichier` et
l'ancre s'écrit `fichier` ; un fichier hors du workspace ne peut pas être ancré ». Répliquer dans la
copie Copilot (`packages/copilot-plugin/…`, parité déjà testée).

### 4.4 `Diagram —` traduit en `Diagramme` — variance persistante

Troisième occurrence en deux jours (17:41, 17:46, 19:45), y compris après un refus qui cite la forme
exacte. La règle vit dans `references/mermaid.md`, donc derrière un pointeur. Levier : faire du
jeton un *leading word* en tête de cette référence (« légende = jeton littéral, jamais traduit ») et
rendre la légende corrigée directement copiable dans le premier message de refus. Efficacité non
démontrable avec une exécution par configuration.

### 4.5 Économie d'outils

65 appels bash et 2,9 M de tokens lus du cache pour un Tour, contre 31 appels et 859 k pour le même
essai sans mémoire. La moitié du surcoût vient de 4.2 ; le reste est de l'exploration légitime du
validateur, pas du gaspillage à corriger.

### 4.6 Cadrage de la campagne — décision d'environnement

Lancer Pi depuis la **racine du dépôt**, pas depuis `codetour/`. Trois mécanismes ne s'accordent
qu'à cette condition : les ancres Changes sont relatives à la racine, `--internal-list-tours` ne
découvre que `<racine>/.tours`, et le hook n'attribue que son propre workspace. C'est aussi ce qui
rend le Tour lisible sans `--internal-tour`.

## 5. Décisions à prendre

1. Appliquer 4.2 (message + test) puis 4.1 (diagnostic) avant de relancer P4 ?
2. Relancer P4 depuis la racine (4.6), en gardant P4 actuel comme « Tour hors emplacement, sans
   rapport de fin » ?
3. Ajouter 4.3 et 4.4 dans la même passe, ou les traiter après la campagne ?
