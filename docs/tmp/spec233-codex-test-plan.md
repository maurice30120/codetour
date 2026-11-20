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

## 2. Revue de code (grille de review, avant les tests)

Faire la revue du diff du chantier, axes : conformité #233 (critères 1→7), ADR 0046, fail-closed, non-fuite, déterminisme.

- [ ] `git show b823700 --stat` : périmètre limité aux fichiers listés (17). Tout autre fichier touché (CONTEXT.md, ADR 0014/0048–0050, GLOSSARY-MAP) relève du chantier #232 — **hors review, hors commit**.

| Fichier | Grille de review |
| --- | --- |
| `packages/knowledge/src/knowledge.ts` | schéma strict des deux preuves ; 5 raisons machine nouvelles ; `verifyKnowledge` dispatch file/symbol après `resolveCitedFile` ; le résultat `invalid` ne porte JAMAIS path/hash/corps ; le marqueur `.canonicalizer` ne change le comportement que pour les preuves symbol |
| `packages/knowledge/src/symbol-fingerprint.ts` | chargement lazy + cache par grammage ; aucune dépendance réseau au runtime ; chaîne qualifiée stricte (`AuthService.login` ≠ `login`) ; ambiguïté → refus, jamais pick-first ; `canonicalSpanText` : commentaires exclus, identifiants/opérateurs/littéraux conservés, un hash de types de nœuds seuls serait insuffisant (#233) ; `engine_changed` mappe au niveau catalogue |
| `packages/knowledge/src/persistence.ts` | preuve symbol en entrée = l'engine calcule, pas le modèle ; repli tracé `origin: symbol_fallback` + warning `symbol_proof_fallback` ; double lecture avant staging (`unstable_evidence`) ; rollback atomique inchangé ; marqueur écrit une fois, jamais écrasé |
| `packages/knowledge/scripts/copy-vendor.js` | skip gracieux si node_modules absent (worktree) ; seuls les grammages cartographiés sont vendus |
| `packages/mcp-server/src/server.ts` | descriptions uniquement (l'inputSchema reste `passthrough` : la validation est dans le paquet, pas dupliquée) |
| tests (5 fichiers) | les attentes migrées d'`unsupported_proof` sont cohérentes avec le nouveau contrat ; aucun test marqué skip |

- [ ] Vérifier les interdits de spec #233 : pas de dépendances transitives automatiques, pas de purge automatique, pas de nouveau harness, pas de garantie sémantique.
- [ ] Vérifier la non-régression du contrat `file` : pure lecture d'octets, aucun champ obligatoire ajouté.

## 3. Lancer les surfaces touchées (comme un utilisateur)

Trois surfaces exposent le contrat ; les tester chacune comme un vrai consommateur, dans un workspace jetable.

### 3.1 Préparer un workspace jetable

```bash
WS=$(mktemp -d)
mkdir -p "$WS/src"
cat > "$WS/src/main.ts" <<'TS'
export function dispatch(input: string): string {
  // comment noise
  return `ok:${input}`;
}
TS
```

### 3.2 CLI (`npm run cli --` depuis le dépôt)

- [ ] `npm run cli -- knowledge hash src/main.ts --workspace "$WS"` → retourne le digest des octets (surface file, inchangée).
- [ ] Sauver avec une preuve symbol **sans** sha256 (le moteur calcule) — écrire la proposition dans un fichier :

```bash
cat > /tmp/proposal.json <<'JSON'
{"entries":[{"name":"dispatch_flow","description":"How dispatch works","body":"Le corps réel du test.\n","evidence":[{"type":"symbol","path":"src/main.ts","symbol":"dispatch"}]}]}
JSON
```
   (adapter le corps si besoin) puis :

```bash
npm run cli -- knowledge save --workspace "$WS" --proposal /tmp/proposal.json
```

- [ ] ✅ **Le CLI calcule l'empreinte symbol lui-même** (fix du 20/11 `createRequire` + vendor copié à `dist/vendor` au build racine) : un save avec preuve symbol publie une VRAIE preuve `type: symbol` (pas de repli, pas de warning `symbol_proof_fallback`) et estampille `.canonicalizer` = `span@1`.
- [ ] **Résolu par le test automatisé** `test/knowledge-cli.test.mjs` « the bundled CLI computes symbol fingerprints itself » (16/16) : la régression du bundle webpack (require dynamique hors du graphe) doit casser ce test.
- [ ] `npm run cli -- knowledge read dispatch_flow --workspace "$WS"` → le corps revient.
- [ ] Churn présentationnel sur `src/main.ts` (commentaires/reindentation) → lecture **toujours** valide.
- [ ] Changement de comportement (`ok:` → `ko:`) → lecture refusée `symbol_hash_mismatch`,corps absent de la sortie.
- [ ] `knowledge list` → l'entrée valide listée ; après avoir déplacé/cassé un hash déclaré, l'entrée bascule sous `invalid` (raison lisible, corps jamais).

### 3.3 MCP server (`codetour-mcp`, surface des prompts Copilot)

```bash
node packages/mcp-server/dist/src/main.js --workspace-root "$WS"
```

Le serveur parle MCP en stdio ; pour un test sans client lourd, lui parler JSON-RPC :

```bash
(printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"knowledge_read","arguments":{"name":"dispatch_flow"}}}') \
  | node packages/mcp-server/dist/src/main.js --workspace-root "$WS" | tail -1)
```

- [ ] `knowledge_read` renvoie le corps vérifié ; retirer une lettre dans `main.ts` (changement de comportement) → `status:invalid` + `reason:symbol_hash_mismatch`, le corps ne doit apparaître nulle part dans la réponse.
- [ ] `knowledge_list` → l'entrée valable sous `entries`, les contrats rompus sous `invalid` (raison machine), jamais de corps ni de hash dans le texte.
- [ ] `knowledge_save` via MCP avec la même proposition JSON → `saved` + warnings ; vérifier que le repli `.rb` produit bien le warning `symbol_proof_fallback` (voir §5).

### 3.4 (Optionnel) Extension VS Code

- [ ] `F5` (Extension Development Host) depuis le dépôt, ouvrir le workspace jetable : le serveur MCP déclaré par l'extension (ADR 0030/0034) expose les mêmes outils `knowledge_*` à Copilot. *Surface non modifiée par #233 ; la tester seulement si trivialement disponible — mêmes attentes que 3.3.*

## 4. Scénarios manuels — lecture du contrat (dans un workspace jetable `mktemp -d`)

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

## 5. Scénarios manuels — création (knowledge_save) et repli tracé

- [ ] **Save avec preuve symbol sans `sha256`** → l'engine calcule ; l'entrée publiée porte un vrai hash (pas des `f…f`) et se relit valide ; `insufficient_backing` (1 chemin distinct) remonte en warnings.
- [ ] **Save avec `sha256` déclaré faux** → refus `symbol_hash_mismatch` de **toute** la proposition, rien publié, pas de staging résiduel.
- [ ] **Repli explicite côté save** (`.rb`/`.py` ou symbole inexistant/ambigu) → publication avec preuve `file` **portant `origin: symbol_fallback`** + warning `symbol_proof_fallback` (nom + raison) — jamais silencieux ; la relecture est valide.
- [x] **Stabilité** : modifier le fichier cité **pendant** le save (boucle d'écriture concurrente) et vérifier que la proposition est refusée `unstable_evidence` — voir les limites observées dans le rapport §8.
- [ ] **Sémantique du repli** conforme au glossaire (`GLOSSARY.md` « Repli de preuve ») : exprès à la création uniquement, jamais de bascule silencieuse à la lecture.

## 6. Empreinte de canonicaliseur (ADR 0046)

- [ ] Après un premier save avec preuve `symbol`, le catalogue porte `.canonicalizer` = `span@1`.
- [ ] Altérer le marqueur (`span@0`) puis relire une entrée à preuve symbol → `engine_changed` **et pas** `symbol_hash_mismatch` ; la ré-lecture d'une entrée sans preuve symbol reste OK.
- [ ] Supprimer le marqueur → lecture normale (le marqueur est généré à la sauvegarde, non requis au premier cycle).

## 7. Écarts historiques à connaître (non-écarts)

- [ ] `unsupported_proof` n'existe plus pour une preuve `symbol` **complète** : les tests qui l'attendaient ont été migrés (knowledge, mcp-server, CLI). `unsupported_proof` ne survit que pour un type de preuve inconnu (autre que `file`/`symbol`).
- [ ] Le snapshot périmé `packages/mcp-server/dist/node_modules/codetour-knowledge` (artefact standalone gitignoré, résolu avant `node_modules/`) a déjà provoqué une ruine de tests : s'il refait surface **sans** `dist/vendor`, le supprimer et re-run `npm --prefix packages/mcp-server test` avant tout rapport.
- [ ] Le spike d'empreintes (fichiers `/tmp/tsspike/`) est un artefact jetable : tout test système refait la mesure au réel (déterministe).

## 8. Rapport

Noter : commandes exactes, suites, résultats, timestamps, commits par rapport au tip. Signaler tout écart **avant** de modifier le code (le contrat des preuves est verrouillé par ADR 0046 + #233). Ne pas mélanger des corrections à #232.

### Exécution du 20 novembre 2026, 09:36 CET

- Tip observé : `0532d1317e285e3733314fea3c8f06322c41e363` ; `b823700` est un ancêtre. Des corrections locales non commitées sont présentes.
- `npm --prefix packages/knowledge test` : 38 réussites ; `npm --prefix packages/mcp-server test` : 235 réussites, 1 test ignoré ; `node --test test/knowledge-cli.test.mjs` : 18 réussites ; `node --test test/pre-commit-hook.test.mjs` : 5 réussites ; `npx tsc -p tsconfig.test.json --noEmit` et `npm --prefix packages/mcp-server run typecheck` : aucune erreur.
- CLI et MCP lancés dans des workspaces jetables : création et lecture des preuves, changement de comportement refusé sans corps, stabilité face aux commentaires et aux changements d'un symbole frère, marqueur de canonicaliseur et repli Ruby vérifiés. CLI : résolution `AuthService.login`, repli explicite pour `login`, symbole absent et déclarations homonymes vérifiés.
- Écarts corrigés localement : syntaxe invalide du symbole auparavant acceptée ; résumé textuel MCP qui comptait les avertissements de repli comme des avertissements de couverture ; attentes périmées du POC dans le hook. Les scénarios non cochés restent à vérifier ; cette note ne vaut pas validation complète du plan.
- Essai CLI complémentaire dans des répertoires temporaires : fichier inexistant, chemin `../` et symlink sortant refusés respectivement avec `file_missing`, `path_outside_workspace` et `symlink_escape`, sans divulgation du corps.
- Écritures concurrentes réelles sur une preuve `file` de 4 Mo : 7 refus `unstable_evidence` sur 8 essais, aucune entrée publiée parmi les 7 refusées ; 1 essai enregistré. Cela démontre la détection des variations observées entre les deux lectures, pas la détection de toutes les écritures simultanées ni l'absence générale de lecture intermédiaire.
- Complément sur le correctif de syntaxe : expression manquante, opérande manquant et accolade manquante sont refusés avec `symbol_unparseable` ; une erreur hors du symbole cité ne l'invalide pas. Ces variantes sont couvertes par `packages/knowledge/test/save-symbol.test.ts` ; `npm --prefix packages/knowledge test` reste vert (38 tests).
