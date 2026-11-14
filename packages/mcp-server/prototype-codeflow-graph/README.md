# Prototype — graphe de dépendances compact : gain de tokens ? (issue #148, piste A)

**Question posée :** si CodeTour injecte dans le Targeted Context un graphe `nodes/edges`
produit par `@codeflow-map/core` au lieu de laisser l'agent lire les fichiers, est-ce que
ça économise vraiment des tokens — et est-ce que la réponse reste utilisable pour un Tour
de review ?

**Barre retenue (pas 100 % de couverture globale) :** pour un Tour qui modifie une fonction,
il faut que **tous les appelants** de cette fonction soient soit assertés, soit pointés
(fichier + ligne + candidats). Le côté sortant peut rester partiel. Cette barre est appelée
« actionnable » dans la démo.

**Réponse courte :** la piste A seule ne l'atteint pas, mais l'écart n'est pas là où on
l'attend. La bibliothèque *voit* les appels ambigus et les jette au lieu de les pointer.
Reconstitués, ces pointeurs ramènent 5 appelants sur 7 et changent le calcul de tokens.
Ce qui reste invisible est structurel : les constructeurs, les alias d'import et les
usages de classe (aucun nœud de classe dans le graphe).

## Lancer

```bash
npm install
npm run measure     # analyse + régénère index.html
open index.html     # démo autonome, un seul fichier
```

Les grammaires WASM ne sont pas versionnées (3 Mo). Pour les récupérer :

```bash
npm pack callgraph-mcp && tar xzf callgraph-mcp-*.tgz
cp package/grammars/tree-sitter-typescript.wasm package/grammars/tree-sitter-python.wasm \
   package/grammars/tree-sitter.wasm grammars/
```

## Ce que fait le prototype

1. `analyze.mjs` exécute `@codeflow-map/core` sur quatre cas : deux fixtures TypeScript
   (dont le cas des méthodes homonymes demandé par #148), une fixture Python de contrôle,
   et une fonction réelle du dépôt (`orientationStepWarnings`).
2. Pour chaque cas il construit quatre textes :
   - **payload** : ce que la bibliothèque affirme (relations entrantes/sortantes, preuve
     fichier:ligne) ;
   - **payload + ambiguïtés** : le même, plus une ligne `?` par appel vu mais non attribué,
     avec ses candidats — ce que la bibliothèque *pourrait* dire, elle a déjà les
     `RawCall` en main ;
   - **lectures ciblées** : les seules tranches de ± 8 lignes autour des pointeurs ;
   - **baseline** : `grep` du nom puis lecture intégrale des fichiers qui le mentionnent
     (plafond 8 fichiers).
3. Il compare le tout à une vérité terrain écrite à la main (`ground-truth.mjs`) et compte
   les tokens avec `gpt-tokenizer`.
4. `index.html` présente les quatre attitudes de l'agent (confiance / ambiguïtés explicites /
   relecture complète / sans graphe), les relations assertées ou pointées, et trois parcours
   guidés.

## Résultats mesurés (13/11/2026)

| Cas | Payload | + ambiguïtés | dont lectures ciblées | Baseline | IN actionnable | OUT actionnable |
|---|---:|---:|---:|---:|---:|---:|
| Fixture TS — `UserService` | 34 tok | 140 tok | 226 tok | 353 tok | **2/3** | 2/5 |
| Fixture TS — `AdminService` (homonyme) | 16 tok | 99 tok | 127 tok | 353 tok | **1/1** | 0/0 |
| Fixture Python — `UserService` | 33 tok | 76 tok | 128 tok | 169 tok | **1/2** | 2/2 |
| Dépôt réel — `orientationStepWarnings` | 37 tok | 37 tok | 0 tok | 17 437 tok | **1/1** | 0/1 |

Coût total en mode « ambiguïtés explicites » (payload + tranches ciblées) :
226 tok, 226 tok, 204 tok, 37 tok. Baseline cumulée : 18 312 tok.

### Ce que ces chiffres disent

- **Sur l'homonyme, le pointeur suffit et il gagne.** `AdminService.getUser` passe de
  « absent, silencieusement » à « api.ts:8, deux candidats » : 226 tokens au lieu de 353,
  avec le côté entrant complet. La bibliothèque avait l'information et l'a jetée.
- **Sur la fixture UserService, on est à l'équilibre (366 vs 353).** Les fichiers font
  6 à 19 lignes : lire des tranches de ± 8 lignes revient à lire le fichier. Le gain de la
  piste A n'apparaît que sur des fichiers assez gros pour que la tranche soit minoritaire.
- **Sur le dépôt réel, l'écart est énorme (37 vs 17 437) mais l'angle sortant est aveugle.**
  `diagramNodeCount` n'a jamais été extrait : aucune arête, aucun pointeur. On ne pointe pas
  ce qu'on n'a pas vu.
- **Les constructeurs et les usages de classe restent invisibles partout.** `new Users(repo)`
  n'est pas un appel au nom de la classe (alias), et il n'existe aucun nœud de classe :
  la question « quels sont les usages de cette classe ? » n'a pas de représentation.
  C'est le seul point où la demande « ramener les appels de cette classe » n'est pas
  satisfaite même avec des ambiguïtés explicites.

## Interprétation

- Le déficit de la piste A n'est pas d'abord un déficit de tokens : c'est un déficit de
  **contrat de sortie**. Elle sait qu'un appel n'est pas attribuable et choisit de le taire.
  Exposer `ambiguous` coûte ~100 tokens et change la nature du contexte.
- Avec ce contrat, la piste A devient utilisable pour un Tour de review **sur les appels de
  méthode**, pas sur les usages de classe. La piste B ne serait nécessaire que pour combler
  constructeurs, alias d'import et relations de type.
- La métrique à retenir pour #148 n'est donc pas « % de couverture » mais :
  **entrant actionnable + coût en tokens**, le sortant restant best-effort.

## Fichiers

- `BACKENDS.md` — comparatif détaillé **A + ambiguïtés vs LSP embarqué**, avec les mesures.
- `lsp-spike.mjs` — spike LSP : `typescript-language-server` en stdio, références, entrants,
  sortants et usages de classe sur les fixtures.
- `fixture/ts`, `fixture/py` — fixtures du ticket #148 (homonymes, alias, `this.x`,
  héritage, interface, Python de contrôle).
- `ground-truth.mjs` — les relations qu'un développeur confirmerait, avec la distinction
  `statique` / `hard` (interface, dispatch dynamique).
- `lib/payload.mjs` — logique pure : index du graphe, voisinage, rendu compact, lignes
  d'ambiguïté, couverture actionnable par direction.
- `analyze.mjs` — exécution de la bibliothèque + ambiguïtés + baseline + tokens.
- `index.template.html` / `render.mjs` — la démo autonome générée dans `index.html`.

Prototype jetable : aucune intégration dans `packages/mcp-server/src/parsing`, aucun
changement de format `.tour`, aucun nouvel outil MCP.
