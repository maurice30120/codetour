# Plan de test manuel — spec #233 (preuves `symbol` et `file` dans les Knowledge)

> Document destiné à un agent testeur (Codex ou humain). Les suites automatisées sont le socle ;
> les scénarios manuels sont à exécuter **effectivement** dans un workspace jetable (jamais dans
> ce dépôt). Cocher `[ ]` → `[x]`, noter les écarts à la fin.

## 0. Contexte d'exécution

| Élément | Valeur |
| --- | --- |
| Workspace du dépôt | `/Users/dhuyet/Documents/POC/codetour` |
| Branche à tester | `spec-239-cli-reader-pi-copilot` (le commit #233 a atterri ici) |
| Commit attendu | `b823700` — `feat(spec233): symbol proofs join the knowledge contract with engine-canonicalized fingerprints` ; vérifier : `git merge-base --is-ancestor b823700 HEAD` |
| Dépendance npm à connaître | `packages/knowledge` embarque son runtime vendorisé dans `dist/vendor/` (web-tree-sitter + grammages typescript/tsx/javascript), copié au build par `packages/knowledge/scripts/copy-vendor.js` — **ne pas** nettoyer `dist/vendor` sans rebuild |
| Tickets faits (ce chantier) | #233 — critères 1→7 couverts, commenté sur l'issue (le 20/11) ; benchmarks restants |
| Tickets liés, NE PAS TOUCHER | **#232 en cours par un autre chantier** (consolidation create/append/replace + compare-and-swap, ADRs 0048–0050) — aucun commit, aucune retouche de contrat d'écriture |
| Tickets hors périmètre | #230 (CodeGraph, exclue), #234/#235 (composées, après #232), #236/#237 (Pi, WIP) |
| Interdits | push, publication, synchro upstream Microsoft, suppression d'issues, retouche du schéma des preuves sans ADR |

## 1. Suites automatisées (prérequis, doivent être vertes)

- [ ] Build + typecheck : `npm --prefix packages/knowledge run typecheck` → 0 erreur ; `npm --prefix packages/knowledge test` → 37 pass / 0 fail.
- [ ] Vendor bien produit : `packages/knowledge/dist/vendor/` contient `tree-sitter.js`, `tree-sitter.wasm`, `grammars/tree-sitter-{typescript,tsx,javascript}.wasm`.
- [ ] MCP : `npm --prefix packages/mcp-server test` → 233 pass / 0 fail (le build re-stage `codetour-knowledge` avec `dist/vendor` — vérifier que `packages/mcp-server/dist/node_modules/codetour-knowledge/dist/vendor/grammars` existe ; le snapshot périmé `dist/node_modules/codetour-knowledge` **sans vendor** a déjà causé une ruine de tests : s'il revient sans vendor après un `package-standalone`, le symptôme est `unsupported_language` sur un `.ts` pourtant couvert (supprimer le snapshot, re-stager, relancer)).
- [ ] CLI : `node --test test/knowledge-cli.test.mjs` → 15 pass / 0 fail.
- [ ] Garde : `node --test test/pre-commit-hook.test.mjs` → 5 pass / 0 fail (fixture : `scripts/` + symlink `node_modules` de `packages/knowledge`).
- [ ] Régression globale : `node --test test/copilot-adapter.test.mjs test/copilot-hook.test.mjs test/copilot-plugin-install.test.mjs test/pi-guard.test.mjs test/pi-plugin-install.test.mjs test/pi-extension.test.mjs test/cli-resolution.test.mjs` → 112 pass / 0 fail.
- [ ] Non-régression typecheck mcp-server : `npm --prefix packages/mcp-server run typecheck` → 0 erreur.
- [ ] Note : `npx tsc -p tsconfig.test.json --noEmit` à la racine a des **échecs préexistants** dans `src/cli/ttyHandoff*` (WIP #239/#243 non committé) — ils ne sont **pas** imputables à #233.

## 2. Scénarios manuels — lecture du contrat (dans un workspace jetable `mktemp -d`)

Créer un workspace jetable, un catalogue (`.tours/.memory/knowledge/`) et lancer le CLI du dépôt :
`npx codetour-cli knowledge …` ou `npm run cli -- knowledge read <nom>` depuis le dépôt avec `--workspace` pointant le jetable.

- [ ] **Preuve `file` historique inchangée** : entrée citant un fichier + SHA-256 correct → lecture OK, corps rendu tel quel.
- [ ] **Preuve `symbol` complète, fingerprint engine** : `main.ts` contenant `export function dispatch(input: string): string { return \`ok:${input}\`; }`, entrée avec preuve `{type: symbol, path: main.ts, symbol: dispatch, sha256: <calculé>}` → lecture valide.
  Le fingerprint se calcule par le moteur (pas à la main) : passer par `knowledge_save` sans `sha256` (le save le calcule) ou par le module (`treeSitterSymbolFingerprinter`).
- [ ] **Churn présentationnel** : ajouter commentaires (tête + intérieur), réindenter, couper des lignes → la lecture reste **valide** (empreinte stable).
- [ ] **Changement de comportement** : `ok:` → `ko:` → lecture **refusée** `symbol_hash_mismatch`, jamais le corps.
- [ ] **Changement d'un symbole frère** : ajouter/modifier une autre fonction → la preuve du symbole cité reste valide.
- [ ] **Nom qualifié** : `AuthService.login` résolu via la chaîne de déclaration → valide ; `login` nu ne matche **pas** la méthode de classe (chaîne `['AuthService','login']` ≠ `['login']`) — c'est déterministe, pas un hasard.
- [ ] **Ambiguïté** : deux déclarations top-level homonymes → `symbol_ambiguous` (jamais « premier trouvé »).
- [ ] **Symbole absent** → `symbol_unresolved` ; **langage non cartographié** (`.rb`, `.py`) → `unsupported_language` (jamais d'empreinte inventée).
- [ ] **Sécurité des chemins** : `../`, chemin absolu, symlink sortant, chemin inexistant → mêmes motifs que les preuves `file` (`path_outside_workspace`, `symlink_escape`, `file_missing`) ; le motif de refus **ne doit jamais fuir** le corps ni un hash.

## 3. Scénarios manuels — création (knowledge_save) et repli tracé

- [ ] **Save avec preuve symbol sans `sha256`** → l'engine calcule ; l'entrée publiée porte un vrai hash (pas des `f…f`) et se relit valide ; `insufficient_backing` (1 chemin distinct) remonte en warnings.
- [ ] **Save avec `sha256` déclaré faux** → refus `symbol_hash_mismatch` de **toute** la proposition, rien publié, pas de staging résiduel.
- [ ] **Repli explicite côté save** (`.rb`/`.py` ou symbole inexistant/ambigu) → publication avec preuve `file` **portant `origin: symbol_fallback`** + warning `symbol_proof_fallback` (nom + raison) — jamais silencieux ; la relecture est valide.
- [ ] **Stabilité** : modifier le fichier cité **pendant** le save (boucle d'écriture concurrente) et vérifier que la proposition est refusée `unstable_evidence` — la double lecture ne publie jamais une empreinte captée mid-write.
- [ ] **Sémantique du repli** conforme au glossaire (`GLOSSARY.md` « Repli de preuve ») : exprès à la création uniquement, jamais de bascule silencieuse à la lecture.

## 4. Empreinte de canonicaliseur (ADR 0046)

- [ ] Après un premier save avec preuve `symbol`, le catalogue porte `.canonicalizer` = `span@1`.
- [ ] Altérer le marqueur (`span@0`) puis relire une entrée à preuve symbol → `engine_changed` **et pas** `symbol_hash_mismatch` ; la ré-lecture d'une entrée sans preuve symbol reste OK.
- [ ] Supprimer le marqueur → lecture normale (le marqueur est généré à la sauvegarde, non requis au premier cycle).

## 5. Écarts historiques à connaître (non-écarts)

- [ ] `unsupported_proof` n'existe plus pour une preuve `symbol` **complète** : les tests qui l'attendaient ont été migrés (knowledge, mcp-server, CLI). `unsupported_proof` ne survit que pour un type de preuve inconnu (autre que `file`/`symbol`).
- [ ] Le snapshot périmé `packages/mcp-server/dist/node_modules/codetour-knowledge` (artefact standalone gitignoré, résolu avant `node_modules/`) a déjà provoqué une ruine de tests : s'il refait surface **sans** `dist/vendor`, le supprimer et re-run `npm --prefix packages/mcp-server test` avant tout rapport.
- [ ] Le spike d'empreintes (fichiers `/tmp/tsspike/`) est un artefact jetable : tout test système refait la mesure au réel (déterministe).

## 6. Rapport

Noter : commandes exactes, suites, résultats, timestamps, commits par rapport au tip. Signaler tout écart **avant** de modifier le code (le contrat des preuves est verrouillé par ADR 0046 + #233). Ne pas mélanger des corrections à #232.
