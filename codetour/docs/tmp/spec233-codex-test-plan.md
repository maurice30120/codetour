# Plan de test — spec #233 (preuves `symbol` et `file` dans les Knowledge)

> **Statut : validation terminée le 20 novembre 2026.** Il ne reste aucun test manuel à faire.
> Seul point ouvert : les benchmarks de la spec #233 (voir la fin de ce document).

Branche testée : `spec-239-cli-reader-pi-copilot`, tip `85c8a27` (correctif `37f9dbd`).
Contrat verrouillé par ADR 0046 + #233 ; le ticket de traçabilité est
[#263](https://github.com/maurice30120/codetour/issues/263) (fermé).

## 1. Couvert par les suites (ne pas rejouer)

| Suite | Commande | Résultat |
| --- | --- | --- |
| Knowledge | `npm --prefix packages/knowledge test` | 38 pass |
| MCP | `npm --prefix packages/mcp-server test` | 235 pass, 1 skip |
| CLI Knowledge | `node --test test/knowledge-cli.test.mjs` | 18 pass |
| Garde pre-commit | `node --test test/pre-commit-hook.test.mjs` | 5 pass |
| Typechecks | racine + `packages/knowledge` + `packages/mcp-server` | 0 erreur |
| Suite complète | `npm test` | vert |

Couvrent : empreinte symbol calculée par le moteur (jamais déclarée par le modèle),
stabilité face aux commentaires/reformatage, invalidation sur changement de comportement,
granularité vis-à-vis d'un symbole frère, résolution qualifiée vs nu, ambiguïté, absence,
langage non cartographié, sécurité des chemins, repli `symbol → file` à la création,
non-divulgation du corps, écritures concurrentes, et le refus d'un symbole non analysable
(`symbol_unparseable`).

## 2. Vérifié à la main le 20 novembre 2026 (workspace jetable, CLI livré)

Commandes réellement exécutées : `node dist/cli.js knowledge save|read|list --workspace <jetable>`.

- `save` d'une preuve symbol **sans** `sha256` → preuve `type: symbol` publiée avec un vrai hash,
  aucun avertissement de repli ; le catalogue porte `.canonicalizer` = `span@1`.
- `read` → corps rendu ; après ajout de commentaires/réindentation → toujours valide.
- Changement de comportement (`ok:` → `ko:`) → `symbol_hash_mismatch`, corps absent de la sortie.
- Marqueur altéré (`span@1` → `span@0`) → `engine_changed`, corps absent ; une entrée à preuve
  `file` seule reste valide ; `knowledge list` classe l'entrée sous `invalid` avec la raison.
- Marqueur supprimé → lecture normale (le marqueur est écrit à la sauvegarde, pas requis pour lire).
- Preuve `file` historique : lecture et `list` inchangées ; `insufficient_backing` remonte en warning.
- Refus sans fuite : `file_missing`, `path_outside_workspace`, `symlink_escape` ; repli Ruby
  (`.rb`, `unsupported_language`) tracé par `origin: symbol_fallback` + warning
  `symbol_proof_fallback`.
- MCP : `knowledge_read` refusé ne divulgue ni corps ni chemin ; `knowledge_save` signale le
  repli séparément d'`insufficient_backing`.

## 3. Reste à faire (hors tests manuels)

- [ ] **Benchmarks #233** : fréquence d'invalidation évitée, tokens cumulés avec la consolidation,
      qualité vs preuves `file` seules. Chantier de mesure, pas une vérification du contrat.
      À coordonner avec les protocoles de #232 (issues #254–#258), sans réutiliser leurs chiffres.

## 4. Pièges connus (à garder en tête si un test est rejoué)

- `packages/knowledge/dist/vendor/` porte le runtime vendorisé (web-tree-sitter + grammaires
  typescript/tsx/javascript) ; ne pas le nettoyer sans rebuild.
- Un snapshot périmé `packages/mcp-server/dist/node_modules/codetour-knowledge` **sans** `dist/vendor`
  se résout avant `node_modules/` et fait échouer des preuves `.ts` avec `unsupported_language` :
  supprimer le snapshot, re-stager (`npm --prefix packages/mcp-server run build`), relancer.
- Le marqueur de catalogue vit dans `<catalogue>/.canonicalizer` (pas dans l'entrée `.md`).
