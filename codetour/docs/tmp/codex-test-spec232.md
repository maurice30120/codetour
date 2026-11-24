# Tester la spec #232 (Knowledge create / append / replace)

Guide pour Codex : exécuter les étapes dans l'ordre, dans le worktree
d'intégration. Aucune intervention humaine, aucun réseau.

```sh
cd /Users/dhuyet/Documents/POC/codetour-wt/knowledge-update
npm run build        # une fois ; produit dist/cli.js et le serveur MCP
CLI="$PWD/dist/cli.js"
```

Sortie attendue : JSON sur stdout. Codes de sortie CLI :
`0` succès, `2` usage, `3` entrée absente, `4` refus (`invalid` ou `conflict`).

## 1. Suites automatisées

```sh
npm --prefix packages/knowledge test
npm --prefix packages/mcp-server test
node --test test/knowledge-cli.test.mjs
node --test test/copilot-hook.test.mjs test/pi-guard.test.mjs
```

Attendu : 0 échec.

## 2. Scénario CLI complet

```sh
ws=$(mktemp -d); cd "$ws"
echo 'export const start = 1;' > main.ts
echo 'export const stop = 2;'  > reader.ts
printf 'Old dispatch rules.\n' > body.md
printf 'Rebuilt from current code.\n' > newbody.md
printf '## Exception\nRetries are capped.\n' > add.md
```

1. **Créer** (`mode` omis = `create`) :
   ```sh
   node "$CLI" knowledge save --workspace "$ws" --name flow \
     --description "How dispatch works" --body-file body.md --evidence main.ts
   ```
   Attendu : `"status":"saved"` + un warning `insufficient_backing` (1 seul fichier cité).

2. **Lister**, récupérer la révision :
   ```sh
   node "$CLI" knowledge list --workspace "$ws"
   ```
   Attendu : `entries[0].revision` = 64 caractères hexadécimaux.

3. **Lire** :
   ```sh
   node "$CLI" knowledge read flow --workspace "$ws"
   ```
   Attendu : `"status":"valid"`, le corps, la même `revision`.

4. **Ajouter** (corps historique intact) :
   ```sh
   REV=$(node "$CLI" knowledge list --workspace "$ws" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).entries[0].revision))')
   node "$CLI" knowledge save --workspace "$ws" --mode append --name flow \
     --addition-file add.md --evidence reader.ts --expected-revision "$REV"
   ```
   Attendu : `"status":"appended"`, `warnings` vide.
   Vérifier le fichier `.tours/.memory/knowledge/flow.md` : le corps doit être
   exactement `Old dispatch rules.\n\n## Exception\nRetries are capped.\n`
   (une seule ligne vide, addition verbatim), et 2 preuves.

5. **Rien de nouveau** : relancer la même commande avec la révision courante.
   Attendu : `"status":"no_change"`, exit 0, fichier inchangé.

6. **Casser une preuve** :
   ```sh
   echo 'export const start = 999;' > main.ts
   node "$CLI" knowledge read flow --workspace "$ws"
   ```
   Attendu : exit 4, `"status":"invalid"`, `reason":"file_hash_mismatch"`, et une
   `revision` présente (c'est ce qui permet la réparation).

7. **Réparer** avec la révision de l'entrée invalide :
   ```sh
   node "$CLI" knowledge save --workspace "$ws" --mode replace --name flow \
     --description "How dispatch works" --body-file newbody.md --evidence main.ts \
     --expected-revision "$INVALID_REV"
   ```
   Attendu : `"status":"replaced"`, puis `read` → `valid` avec le nouveau corps.

8. **Révision périmée** : réutiliser `INVALID_REV` pour un autre `replace`.
   Attendu : exit 4, `"status":"conflict"`, `reason":"revision_conflict"`,
   fichier inchangé.

9. **Nom absent** :
   ```sh
   node "$CLI" knowledge save --workspace "$ws" --mode replace --name ghost \
     --description x --body-file newbody.md --evidence main.ts --expected-revision "$REV"
   ```
   Attendu : exit 4, `reason":"unknown_entry"` (`replace` ne fait pas d'upsert).

10. **Deux écrivains** : lancer deux `replace` en parallèle avec la même
    révision, chacun vers un fichier de sortie. Attendu : exactement un
    `"replaced"` et un `"revision_conflict"` ; l'entrée finale est celle du
    gagnant.

## 3. Seam MCP

Le contrat agent est le serveur MCP, pas la CLI. Depuis ce worktree :

```sh
node packages/mcp-server/dist/src/main.js --workspace-root "$ws"
```

S'y connecter en JSON-RPC (SDK dans `packages/mcp-server/node_modules`) et
appeler, dans l'ordre : `knowledge_save` (création), `knowledge_list`
(`entries[0].revision`), `knowledge_save` avec `mode:"append"` et
`expectedRevision`. Attendu : `created`, puis `appended`.

Avec un `runId` sur les deux appels (par ex. `spec232run01`), inspecter
`.tours/.log/codetour-run-spec232run01.json` : `consolidation.status` vaut
`created`, `created[]` contient le nom créé et `changed[]` le nom ajouté.

Cas `engine_changed` (à faire via MCP, pas via la CLI) : créer une entrée avec
une preuve `symbol`, remplacer `.tours/.memory/knowledge/.canonicalizer` par une
autre valeur, puis `knowledge_list` → l'entrée passe dans `invalid` avec
`reason":"engine_changed"` et une `revision` ; un `replace` porteur d'une preuve
`symbol` est refusé `engine_changed` et le marqueur n'est jamais réécrit.

## 4. Limites connues

- Un run Copilot réel (create + append + replace dans une même session) n'est
  pas automatisable ici : la PR le laisse en vérification manuelle.
- La campagne de mesure #258 n'est pas exécutée : aucun gain de tokens n'est
  annoncé.
- La CLI bundlée ne résout pas les preuves `symbol` (elle retombe sur une preuve
  `file` avec un warning `symbol_proof_fallback`) ; utiliser le seam MCP pour
  les symboles.

## 5. Nettoyage

```sh
rm -rf "$ws"
cd /Users/dhuyet/Documents/POC/codetour-wt/knowledge-update
git status --porcelain   # doit être vide (hors docs/tmp)
```
