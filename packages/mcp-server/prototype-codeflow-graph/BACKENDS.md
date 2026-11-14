# Backends de graphe dans le MCP — A + ambiguïtés vs LSP embarqué

**Contrainte de départ :** le graphe doit être produit **dans le processus `codetour-mcp`**.
Tout ce qui exige l'hôte d'extension VS Code est hors sujet, ainsi que tout ce qui suppose un
runtime Python ou un indexeur installé par l'utilisateur.

Deux backends restent : Tree-sitter (piste A) avec un contrat d'ambiguïtés, et un client LSP
avec serveurs embarqués.

**Méthode :** mêmes fixtures que le prototype, même vérité terrain (`ground-truth.mjs`).
A est mesuré par `analyze.mjs` ; LSP est mesuré par `lsp-spike.mjs` (TypeScript uniquement).
Python n'est pas mesuré.

---

## Le produit change la donne : Java, C#, TS…

CodeTour ne génère pas des Tours pour son propre dépôt TypeScript. Il en génère pour **des bases
de code arbitraires** — Java, C#, TypeScript, Python, Go. Le critère premier n'est donc pas la
précision sur TS, c'est **la couverture des langages**.

Et là, les deux backends étudiés s'effondrent pour la même raison : ils supposent un moteur
par langage.

| Langage | Piste A (CodeFlow 1.0.3) | LSP : serveur requis | Embarquable dans le MCP ? | SCIP |
|---|---|---|---|---|
| TypeScript / JS | oui (résolution faible) | tsserver / tls | **oui** (Node, ~25 Mo) | oui (Node) |
| Python | oui (faible) | pyright | **oui** (Node, ~19 Mo) | oui (Python) |
| Go | oui (faible) | gopls | non (binaire Go) | oui (Go) |
| **Java** | **non** — analyseur `null`, renvoie un graphe vide | JDT LS | **non** (JVM) | oui (JVM) |
| **C#** | **non** — `.cs` absent de la table d'extensions, fichiers ignorés | OmniSharp / Roslyn | **non** (.NET) | oui (.NET) |
| Rust | non — `rust: null` | rust-analyzer | non | oui |

Vérifié dans le paquet publié : `FILE_EXTENSION_MAP` ne contient pas `.cs`, et
`{ java: null, rust: null }` fait que `parseFile` renvoie `{ functions: [], calls: [] }`
**sans erreur** pour Java. Un Tour sur un dépôt Java obtiendrait donc un graphe vide, silencieux.

Conséquence : **ni A ni LSP embarqué ne peuvent être la base** d'un produit multi-langage.
Embarquer JVM + .NET + Node + Go dans un VSIX et un CLI n'est pas un arbitrage, c'est un
non-sujet.

### La seule base possible : Tree-sitter + règles par langage

C'est la piste B du #148, mais recadrée : pas un indexeur généraliste, **un pack de règles par
langage, limité au besoin du Tour** (appels entrants/sortants, usages de classe, profondeur 1,
ambiguïté explicite).

| Langage | Grammaire WASM | Ce qu'il faut résoudre | Difficulté | Ordre |
|---|---|---|---|---|
| **Java** | oui | imports explicites, types déclarés, `extends`/`implements` | moyenne (tout est typé explicitement) | 1 |
| **C#** | oui | `using`, types déclarés, classes partielles, génériques | moyenne | 2 |
| TypeScript | oui | alias/tsconfig, ré-exports, typage structurel | difficile | 3 |
| Python | oui | typage dynamique, imports relatifs | difficile | 4 |
| Go | oui | packages, interfaces | moyenne | 5 |

Un pack de règles, c'est : déclarations (classe, méthode, champ, constructeur), imports, type du
récepteur (champ, paramètre, variable locale), hiérarchie, puis émission d'arêtes avec niveau de
confiance. ~300–600 lignes par langage, plus les fixtures et les tests.

**Effort honnête : 1 à 2 semaines par langage** pour atteindre la barre du Tour, avec une longue
traîne. C'est exactement ce que le #148 annonçait comme « mini-indexeur ».

LSP et A ne disparaissent pas, ils changent de rôle :

- **LSP** : plugin de précision **optionnel**, activé quand le serveur du langage est présent
  (extension VS Code, JDK + JDT LS, .NET + OmniSharp) ou embarqué pour TS/Python. Il produit des
  arêtes `resolved` ; la base produit `heuristic` / `ambiguous`.
- **A** : au mieux un extracteur temporaire pour TS/JS/Python/Go pendant l'écriture des règles.
  Pas une base : il ne couvre pas deux des trois langages cités.

### La règle produit qui en découle

Un langage non supporté doit être **explicite** : `unsupported`, jamais un graphe vide. Un Tour
sur un dépôt Java doit dire « impact non analysé : Java non supporté par ce backend », pas
laisser croire qu'il n'y a aucun appelant.

---

## Résultats mesurés

### LSP embarqué, sur les fixtures TS

```
initialize : 48–57 ms
references : 3–24 ms
call hierarchy : 360–414 ms au premier appel, 0 ms ensuite
```

| Requête | Résultat |
|---|---|
| `UserService.getUser` — références | 3 : définition + `api.ts:8` + `api.ts:13` |
| `UserService.getUser` — entrants | 2/2 : `handleRequest`, `auditUsers` |
| `UserService.getUser` — sortants | 3/3 : `validate` (BaseService), `audit`, `find` (Repository, **via interface**) |
| `AdminService.getUser` — entrants | 1/1 : `handleRequest` — **pas d'arête vers `UserService.getUser`** |
| usages classe `UserService` | 5 : import alias, `new Users(...)`, annotation de type |
| usages classe `BaseService` | 3 : `extends BaseService` inclus |

### Piste A, sur les mêmes fixtures

| Cas | Relations assertées | Entrant actionnable (avec `?`) |
|---|---|---|
| `UserService` (TS) | 1/8 | 2/3 |
| `AdminService` (TS) | 0/1 | 1/1 |
| `UserService` (Python) | 1/4 | 1/2 |
| `orientationStepWarnings` (dépôt) | 1/2 | 1/1 |

Payload : 34–37 tokens. Avec ambiguïtés : 76–140 tokens, plus 127–226 tokens de tranches lues
sur les fixtures, 0 sur le cas réel.

**Lecture :** LSP résout exactement les relations que A perd — alias d'import, récepteur typé,
interface, héritage, usages de classe. A ne les résout pas et ne peut pas, faute de types.

---

## Piste A + ambiguïtés

**Principe.** Tree-sitter extrait les fonctions/méthodes par langage ; un résolveur par nom
associe les appels ; les appels non attribuables sont exposés en `?` avec leurs candidats.

### +

- **Toujours disponible.** Aucun serveur, aucun indexeur, aucun `tsconfig`. C'est le seul
  backend qui répond sur une machine fraîche, hors ligne, sur un dépôt sans configuration.
- **Léger.** 142 Ko de JS + 2,2 Mo (TS) / 0,5 Mo (Python) / 0,2 Mo (core) de WASM.
- **Multi-langage immédiat** : TS, JS, TSX, JSX, Python, Go (Java/Rust déclarés mais non
  implémentés dans la version publiée).
- **Déterministe et local** : même entrée, même sortie ; aucun état de projet.
- **Rapide** : analyse complète de 14 fichiers en ~700 ms sur le dépôt, ~250 ms sur les fixtures.
- **Déjà prototypé** : le contrat `?` et la couverture actionnable sont écrits et testés.

### −

- **Pas de types, donc pas de sémantique.** `users.getUser()` avec deux candidats homonymes
  n'est jamais tranché ; l'héritage et les interfaces sont perdus.
- **Aucun nœud de classe.** `new Users()`, `extends`, usages de classe et constructeurs ne sont
  pas représentables — même avec des `?`.
- **Extraction incomplète sur du code réel.** Sur `validation.ts`, `diagramNodeCount` et
  `validateSteps` ne sont pas extraits, et l'extracteur produit des nœuds fantômes
  (`if[method]`, `validateStep[iife]`). Ces trous ne produisent **aucun** `?` : impossible de
  pointer ce qu'on n'a pas vu.
- **Défauts non corrigeables.** Package mono-mainteneur ; corriger l'extracteur exige un fork.
- **Le bruit dépend de la taille des fichiers.** Sur des fichiers de 20 lignes, les tranches
  lues coûtent plus que le fichier entier (366 tokens contre 353 mesurés).
- **Faux sentiment de sécurité.** Une arête par nom n'est pas une preuve : elle doit être
  étiquetée `heuristic`, pas `resolved`.

---

## LSP embarqué

**Principe.** `codetour-mcp` démarre `typescript-language-server` (TS/JS) et
`pyright-langserver` (Python) en sous-processus, parle JSON-RPC/LSP, et traduit
`textDocument/references` + `callHierarchy/*` dans le contrat.

### +

- **Précision de l'IDE.** Alias, récepteur typé, interface, héritage, usages de classe :
  mesuré 2/2, 3/3, 1/1, et 5 usages de classe sur les fixtures.
- **Ambiguïté levée, pas signalée.** Là où A produit `? api.ts:9, 2 candidats`, LSP répond
  directement `AdminService.getUser`. C'est la différence entre « va lire » et « voilà ».
- **Réutilise l'écosystème.** TS et Python sont des paquets npm : rien à écrire côté sémantique.
- **Multi-langage extensible.** Un serveur par langage, un seul client ; `gopls`,
  `rust-analyzer`, `clangd` peuvent être ajoutés plus tard, en option.
- **Coût par requête faible.** 3–24 ms sur les fixtures ; les serveurs restent chauds.
- **Licences propres.** TypeScript et `typescript-language-server` Apache-2.0, `pyright` MIT.
- **Changements Tour ancrés sur le worktree** couverts sans effort (le cas majoritaire).

### −

- **Poids de distribution.** `typescript` ~23 Mo + `typescript-language-server` 2,4 Mo +
  `pyright` 19 Mo. Le VSIX passerait de 25 à ~65 Mo, le tarball de 19 à ~60 Mo.
- **Cycle de vie à gérer.** Démarrage paresseux par (workspace, langage), timeouts, arrêt sur
  inactivité, redémarrage après crash, plusieurs instances MCP sur le même dépôt.
- **Démarrage à froid.** 50 ms sur une fixture ; plusieurs secondes sur un vrai projet ou un
  monorepo, avec une mémoire non triviale.
- **Dépend du projet.** Sans `tsconfig`, il faut un projet inféré ; un monorepo mal configuré
  donne des résultats partiels. Un venv Python absent dégrade les imports.
- **`gitRef` non couvert.** Le serveur voit l'arbre de travail. Un Tour ancré sur un commit
  exige un `git worktree` temporaire.
- **Échecs silencieux possibles.** Serveur absent, crash, timeout : sans contrat explicite,
  l'agent reçoit « aucun appelant » au lieu de « je n'ai pas pu ».
- **Hygiène stdio.** Les pipes LSP doivent rester isolés du protocole MCP ; aucune sortie
  parasite sur stdout.
- **Dérive de versions.** Serveurs et TypeScript doivent être épinglés et testés ensemble.

---

## Face à face

| Critère | A + ambiguïtés | LSP embarqué |
|---|---|---|
| Précision (alias, types, héritage, classe) | faible | **élevée** |
| Usages de classe / `new` | impossibles | **résolus** |
| Homonymes | `?` avec candidats | **tranchés** |
| Langages | TS/JS/Py/Go, sans serveur | TS/Py embarqués, autres en option |
| Poids | **3 Mo** | ~42 Mo |
| Dispo machine fraîche, hors ligne | **toujours** | oui si embarqué |
| Latence | ~250–700 ms par analyse | 50 ms à froid (fixture), quelques s (réel) |
| `gitRef` | arbre de travail seulement | arbre de travail seulement |
| Déterminisme | **élevé** | dépend du projet et des versions |
| Pannes | silencieuses (corrigeables par `?`) | explicites si le contrat les expose |
| Maintenance | fournisseur externe, non corrigeable | versions à épingler, cycle de vie à écrire |
| Effort d'intégration | 3–5 j | 4–6 j (TS), +3–4 j (Python) |
| Licence | MIT | Apache-2.0 / MIT |

---

## Verdict

Le besoin produit (Java, C#, TS…) déplace la décision : ce n'est plus « A ou LSP », c'est
« quelle base couvre tous les langages ».

1. **Base : Tree-sitter + packs de règles par langage.** C'est le seul backend qui fonctionne
   dans le MCP, hors ligne, sur Java, C# et TS sans embarquer JVM ni .NET. À écrire, donc à
   financer : 1–2 semaines par langage.
2. **LSP en plugin de précision.** Embarqué pour TS et Python, détecté pour Java/C# quand le
   serveur est présent. Il élève la confiance à `resolved` là où il existe.
3. **A en extracteur temporaire** pour TS/JS/Python/Go, le temps d'écrire les règles — pas en
   base, puisqu'il ignore Java et C# et renvoie un graphe vide sans le dire.
4. **Contrat unique, provenance obligatoire** : `resolved` (LSP) / `heuristic` (règles de base
   ou A) / `ambiguous` / `unresolved` / `unsupported` (langage non couvert).
5. **Jamais de silence** : un langage ou un projet non analysable doit produire `unsupported`
   ou `unresolved`, pas un graphe vide.

Conséquence de séquencement : commencer par **Java et C#** (les cas cités, et les plus faciles à
résoudre statiquement grâce aux types déclarés), puis TS, puis Python/Go. LSP embarqué pour TS
peut arriver en parallèle comme accélérateur, mais il ne doit pas dicter l'architecture.

Poids et effort, résumés : ~3 Mo et 3–5 jours pour la base Tree-sitter d'un langage ; ~42 Mo pour
LSP TS+Python ; 1–2 semaines par pack de règles. Le seul choix structurant est de savoir quels
langages sont annoncés comme supportés — le reste en découle.

---

## Reproduire

```bash
node lsp-spike.mjs     # LSP : références, entrants, sortants, usages de classe
node analyze.mjs       # A : payload, ambiguïtés, couverture actionnable, tokens
```

`lsp-spike.mjs` démarre `typescript-language-server` en stdio, ouvre les fixtures, et imprime
les mêmes relations que `ground-truth.mjs`. Python n'y est pas encore branché.
