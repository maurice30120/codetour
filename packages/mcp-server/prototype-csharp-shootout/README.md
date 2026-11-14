# Prototype — shootout de stratégies de contexte sur C# (issue #148, handoff du 13/11/2026)

**Question posée :** quel mécanisme de contexte produit un Tour valide au coût en tokens
minimal — et la base « Tree-sitter + pack de règles » tient-elle sur C#, un langage
que ni A (`@codeflow-map`) ni un LSP embarqué ne peuvent couvrir dans le MCP ?

**Périmètre : C# uniquement**, sur des fixtures dédiées (aucune mesure sur le code du
dépôt, pour ne pas biaiser avec un langage déjà couvert). Décisions verrouillées du
handoff respectées : tout tourne en Node, multi-langage = base Tree-sitter + règles,
A et LSP embarqué exclus comme base, `unsupported` pour les langages non couverts.

## Lancer

```bash
npm install                    # web-tree-sitter, tree-sitter-wasms, gpt-tokenizer
node shootout.mjs              # S1 (grep+lecture) vs S2 (pack de règles) -> data.json
node lsp-csharp.mjs            # S3 : csharp-ls sur les fixtures -> lsp-result.json
node shootout.mjs              # relancer pour afficher S3 côte à côte
```

Prérequis S3 : `dotnet` (=> 8) et `dotnet tool install -g csharp-ls`. Les `.wasm`
sont déjà dans `grammars/` (récupérés de `tree-sitter-wasms@0.1.13`).

## Les trois stratégies

| Stratégie | Contexte injecté |
|---|---|
| S1 — sans graphe | `grep` du symbole + lecture intégrale des fichiers touchés (plafond 8) |
| S2 — pack de règles | payload compact (IN/OUT + preuve fichier:ligne) + lignes `?` d'ambiguïté + tranches ciblées ± 8 lignes |
| S3 — LSP | csharp-ls/Roslyn : références (usages de classe) + call hierarchy + tranches ciblées |

Le pack de règles C# (`lib/rules/csharp.mjs`, ~200 lignes jetables) couvre :
méthodes/constructeurs/champs typés, appels `this.x` / récepteur typé / `var` inféré,
créations (`new X(...)` -> `X.constructor`), alias `using X = Y`, appel de base
(`: base()`), héritage/interfaces comme candidats, sites non résolubles -> `?`.
Il exploite ce que le C# garantit statiquement : **types déclarés partout**.

## Résultats (13/11/2026)

| Cas | S1 (grep+lecture) | S2 (règles+`?`+tranches) | S3 (LSP) | IN S2 | IN S3 |
|---|---:|---:|---:|---:|---:|
| `UserService` (héritage, interface, usages) | 1 008 tok / 169 lignes | **370 tok** (245 + 125) | 523 tok | 4/4 v | 4/4 |
| `AdminService` (homonyme, alias using) | 1 267 tok / 203 lignes | **286 tok** (161 + 125) | 483 tok | 2/2 v | 2/2 |
| `SlowPicker` (dispatch dynamique, ternaire) | 1 267 tok / 203 lignes | **226 tok** (101 + 125) | 364 tok | 1/1 `?` | 1/1 |

Couverture sortante S2 : 5/5, 3/3, 1/1 (best-effort de toute façon). Durées :
graphe complet S2 = 22 ms (8 fichiers) ; S3 = 1,8 s d'init + 0-350 ms par requête,
et exige un runtime .NET.

## Ce que disent ces chiffres

1. **Sur C#, le pack de règles bat le LSP en tokens à couverture égale, sur les 3 cas.**
   Les types déclarés (champs, paramètres, `var` inféré, alias) rendent presque tout
   l'entrant *assertable* sans système de types : payload de 101-245 tokens, tranches
   minuscules. L'économie vs grep : 2,7× à 5,6× — et elle croît avec la taille des
   fichiers, les fixtures étant volontairement petites.
2. **La ligne `?` fait son travail sur le seul cas non prouvable.** Ternaire polymorphe
   (`var picker = fast ? (IPicker)new FastPicker() : new SlowPicker()`) : le pack
   émet `? IN HandleViaPicker @Api/RequestHandler.cs:42 GetUser -> 5 candidats`.
   Avec la tranche ± 8 lignes, l'agent tranche : entrant actionnable pour 125 tokens
   de surcoût.
3. **Le LSP C# n'est pas nécessaire comme base — et son call hierarchy est plus faible
   que ses références.** `callHierarchy/incomingCalls` ne voit pas le dispatch par
   interface (0/1 sur SlowPicker) ; ce sont les `references` (qui suivent l'implémentation
   de l'interface) qui trouvent le site d'appel. Si un plugin LSP arrive un jour,
   il doit s'appuyer sur references, pas sur call hierarchy.
4. **Convention de contrat à figer : les arêtes « hard » pointent le port, pas l'impl.**
   `UserService.GetUser -> IRepository.Find` est asserté vers l'interface
   (`callType: "interface"`), pas vers `DatabaseRepository.Find`. C'est directionnellement
   correct et c'est ce que la vérité terrain doit nommer — sinon la comparaison perd
   son sens.

### Verdict

La base « Tree-sitter + pack de règles » est **suffisante sur C# au barre retenue**
(entrant asserté ou pointé, sortant best-effort), pour ~200 lignes de règles couvrant
les idiomes du Tour. Le LSP (csharp-ls) n'apporte ici rien que le pack n'ait déjà,
coûte plus de tokens, plus de latence et un runtime .NET : il reste un plugin de
précision optionnel, jamais une dépendance. La recommandation du handoff
(Java, C#, TS au lancement) reste jouable : C# est mesuré, TS l'était déjà (pack
équivalent à écrire, LSP optionnel déjà spike).

## Limites

- Fixtures petites (8 fichiers, 20-55 lignes/file) : le seuil « tranche vs fichier
  entier » est favorable mais pas écrasant ; sur des fichiers de 6-19 lignes
  (cas TS du premier prototype), S2 retombe à l'équilibre.
- Le pack est calibré sur ces idiomes : pas de delegates/events, pas de `static`,
  pas de méthodes d'extension, pas de fichiers partiels, pas de surcharges.
  Chacun est une règle de plus, pas une remise en cause de l'architecture.
- « Tokens par Tour valide » au sens strict (génération réelle) n'est pas encore
  mesuré — c'est la phase 2 ci-dessous.

## Phase 2 — tokens par Tour valide (génération réelle)

Le pipeline existe déjà : un agent CLI appelle `prompts/get generate_project_tour`
sur le MCP, explore le projet via les outils codetour, et écrit le Tour. Le harnais :

1. même tâche sur `fixture/csharp` : « génère le Tour de review des appelants de
   `UserService.GetUser` », trois fois — S1 (l'agent n'a que grep/lecture),
   S2 (paquet du harnais injecté dans le targeted-context), S3 (paquet LSP) ;
2. compter tokens input/output de chaque session (l'adaptateur relatait déjà
   les messages) ;
3. validité : le Tour produit cite-t-il chaque appelant de la vérité terrain ?
   (les 4 de UserService, même dans le bruit grep de l'homonyme) ;
4. métrique : tokens/Tour valide, 3 contextes × 1 exécution d'abord.

## Fichiers

- `lib/rules/csharp.mjs` — pack de règles Tree-sitter C# (jetable, logique séparable).
- `shootout.mjs` — assemble S1/S2/(S3), compte, compare à la vérité terrain.
- `lsp-csharp.mjs` — spike S3 csharp-ls (client LSP adapté du premier prototype).
- `ground-truth.mjs` — relations qu'un développeur confirmerait (provable/hard).
- `fixture/csharp/` — projet net10.0 chargé par Roslyn (usages pour S3).
- Réutilise sans modification `prototype-codeflow-graph/lib/payload.mjs`
  (logique pure du premier prototype) : preuve que le format de graphe est portable.

Prototype jetable : rien dans `packages/mcp-server/src`, aucun fichier de production
touché, rien commis.
