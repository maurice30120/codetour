# Rétrospective — génération d'une Changes Tour critique (PR #268), 20 novembre 2026

Préparée avec le skill `retro` et son guide `writing-for-agents`, à partir de la session courante : le prompt servi par `get_generation_prompt` (mode `critical`), les descriptions d'outils du serveur MCP, les deux entrées Knowledge publiées, l'état de run `.tours/.log/codetour-run-0726135c11bf4f6eb37ac333.json`, et les fichiers du dépôt qu'ils citent. Les pistes ci-dessous restent à analyser : cette sauvegarde n'implémente rien.

Le résultat utile est une Tour de 16 étapes sur `.tours/changes.tour` et deux entrées Knowledge vérifiées. Aucun test n'a été exécuté. La première création a été refusée pour une légende Mermaid, puis corrigée. Deux avertissements du serveur ont été émis : `STEP_LIMIT_EXCEEDED` (16 > 15, avis seulement) et `UNCOMMITTED_CHANGES_EXCLUDED` (le fichier `.tour` et les entrées créées par la revue elle-même).

## Constats classés par gravité

| Priorité | Constat et preuve | Amélioration de l'environnement | État |
|---|---|---|---|
| P0 — preuve | L'étape de consolidation du prompt servi ne nomme jamais la preuve `symbol` : `CONSOLIDATION_STEP` (`packages/mcp-server/src/server.ts`) dit « backed by the files you cite » et « include in `evidence` every file a reader needs ». Les deux entrées publiées ne citent donc que des preuves `file`. | Nommer les deux formes dans `CONSOLIDATION_STEP`, avec la règle de choix : `symbol` pour un constat portant sur un symbole, `file` pour un constat portant sur le fichier entier. | Proposition, non implémentée |
| P0 — divulgation | `KNOWLEDGE_SAVE_DESCRIPTION`, la description toujours chargée de l'outil, annonce `evidence [{path, sha256?}]`. La preuve `symbol` n'apparaît que dans le schéma JSON du paramètre `entries` (`server.ts`). Une forme qui a l'air complète dans la description ne se cherche pas plus bas. | Remonter « file or symbol proofs » dans la description principale, et laisser au schéma les détails de forme. | Proposition, non implémentée |
| P1 — observabilité | Aucun artefact ne dit quels types de preuves une entrée publiée a utilisés. Le run state n'enregistre que les noms (`consolidation.created`), et l'avertissement `insufficient_backing` compte des chemins distincts, pas des types. | Ajouter au bloc additif du run state les types de preuves par entrée publiée (précédent : ADR 0045), ou les rendre dans le résultat de `knowledge_save`. | Proposition, non implémentée |
| P1 — navigation | `npm run check:fast` existe (tests `packages/knowledge`, `tsc --noEmit`, adaptateur Copilot, exploration-poc) et `.githooks/pre-commit` existe, non installé sur ce clone (`core.hooksPath` vide ; la commande d'installation est écrite dans le hook lui-même). Aucun fichier toujours chargé ne nomme ni l'un ni l'autre : `AGENTS.md` ne contient que quatre pointeurs de domaine. La revue n'a donc rien vérifié, et la CI de la PR avait échoué à `npm ci`, avant tout test. | Un pointeur d'une ligne dans `AGENTS.md` : « Vérifier avec `npm run check:fast` ; installer le hook local avec `git config core.hooksPath .githooks` ». | Proposition ; la CI `test.yml` exécute bien `npm run test`, aucun garde-fou manquant n'est revendiqué |
| P1 — langue | La légende d'un diagramme doit être la ligne littérale `**Diagram — …**`. Une Tour écrite en français traduit le mot (« **Diagramme — …** ») et la création est refusée ; la règle de langue du prompt ne mentionne aucune exception pour les mots-clés de validation. | Ajouter à la règle de langue : la légende Mermaid garde le mot `Diagram` quelle que soit la langue de la Tour, ou accepter les traductions dans le validateur. | Constat observé sur cette session ; non implémenté |
| P2 — économie d'outil | `gh pr view 268 --json …,commits,changedFiles` a renvoyé ~50 Ko tronqués, alors que le corps et les métadonnées suffisaient. | Dans l'étape de contexte de PR du prompt, nommer les champs utiles (`title,body,baseRefName,url`) et laisser les commits au `git log` déjà disponible. | Proposition, non implémentée |
| P2 — bruit | `STEP_LIMIT_EXCEEDED` avertit au-delà de 15 étapes alors que la description de l'outil dit explicitement qu'un nombre supérieur est autorisé et que l'avertissement est consultatif. | Relever le seuil, ou rappeler l'autorisation dans le texte de l'avertissement. | Avis seulement, aucune action prise |

## Pourquoi `catalogue-agents-et-repli-ordonne.md` n'a pas de preuve de symbole

**Ce qu'aurait apporté une preuve `symbol`.** Une preuve `file` épingle le SHA-256 des octets du fichier cité ; une preuve `symbol` épingle le SHA-256 de l'étendue source du symbole cité, commentaires et espaces insignifiants retirés (ADR 0046, vocabulaire « Knowledge Entry » dans `CONTEXT.md`). La seconde survit à une modification sans rapport dans le même fichier, et elle nomme l'étendue sur laquelle le constat repose.

**La cause directe est le prompt servi, pas l'outil.** L'étape de consolidation, seule instruction faisant autorité pendant la génération, parle exclusivement de fichiers : « verify that every claim of the body is backed by the files you cite », « include in `evidence` every file a reader needs ». Le mot `symbol` n'y apparaît pas. La description principale de `knowledge_save` répète la même forme, `evidence [{path, sha256?}]`. La forme `symbol` n'existe que dans le schéma du paramètre `entries` (`[{type: "symbol", path, symbol, sha256?}]`, avec résolution et empreinte calculées par le moteur et repli signalé par `symbol_proof_fallback`). Un agent qui suit le prompt et lit la description de l'outil n'a aucune raison d'aller chercher plus bas.

**Pourquoi cela compte pour ces deux entrées.** Toutes deux portent sur des symboles précis — `AGENT_CATALOGUE`, `AgentSelection.candidates()`, `createFallbackStepChatResponder` pour la première ; `withCatalogueLock`, `acquireCatalogueLock`, `publish`, `replace` pour la seconde — et pourtant chacune cite des fichiers entiers. Toute modification sans rapport dans `src/agent/agentCatalogue.ts` ou `packages/knowledge/src/persistence.ts` invalide donc le contrat et force une relecture complète, alors que l'étendue réellement attestée n'est pas nommée.

**Aucun signal n'a été donné.** Le repli `symbol_proof_fallback` ne se déclenche que pour une preuve de symbole déclarée et non résoluble ; ici aucune preuve de symbole n'a été demandée, donc aucune alerte, et `insufficient_backing` ne compte que des chemins distincts (les deux entrées citent 5 et 3 fichiers).

**Propositions, de la moins chère à la plus coûteuse.**

1. Une phrase dans `CONSOLIDATION_STEP` : préférer une preuve `symbol` pour un constat sur un symbole, une preuve `file` pour un constat sur le fichier entier, et donner la forme exacte.
2. La même phrase, remontée dans `KNOWLEDGE_SAVE_DESCRIPTION`, puisque c'est la chaîne toujours chargée que l'agent lit avant d'appeler l'outil.
3. Enregistrer les types de preuves par entrée publiée dans le run state, pour que l'omission soit observable après coup.
4. Aucune règle de revue : le sujet est mécanique, une phrase de prompt ou un contrôle battra toujours une consigne de standards.

**État.** Rien n'est implémenté. Les deux entrées gardent leurs preuves `file` vérifiées : leur contrat est valide, elles ne sont pas incomplètes au sens du serveur, seulement moins durables qu'elles pouvaient l'être.

## Ce qu'il ne faut pas conclure

- Ce n'est pas un défaut du contrat Knowledge : les deux entrées sont valides, vérifiées, citent plus de deux fichiers, et le MCP n'a émis aucun `warnings`.
- La preuve `file` n'est pas un pis-aller : un constat sur la séquence des modes de persistance, ou sur une règle qui traverse un fichier entier, se cite correctement par fichier.
- Aucun garde-fou n'est absent du dépôt : `.github/workflows/test.yml` exécute `npm run test` sur trois OS, et `.githooks/pre-commit` existe. Les deux étaient simplement inopérants pour cette revue : `npm ci` a échoué en CI, et `core.hooksPath` n'est pas configuré sur ce clone.
- Aucun résultat de test n'est affirmé ici, ni par la Tour, ni par cette rétrospective.
