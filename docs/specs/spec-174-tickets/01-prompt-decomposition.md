# T01 — Prompt de décomposition et tests de comportement

**Spec**: [Spec #174 — Benchmark PostgreSQL réel vs sous-agent Vibe natif + décomposition des tâches](../../../specs/postgres-real-benchmark-2026-11-15.md)

**Status**: 🔴 Re-opened — complément canonique à appliquer (#174/#172, 15/11/2026)
**Priority**: High
**Blocked By**: None
**Blocks**: T07 (Pilote + 80 runs)

## Objectif

Injecter le texte canonique de décomposition (§2.2 de la spec) dans le prompt d'exploration du POC CodeTour **uniquement**, sans modifier le baseline Vibe. Ce prompt incite l'agent à décomposer l'objectif du Tour en **questions fonctionnelles autonomes et durables** avant d'explorer, à **rechercher les questions équivalentes dans la mémoire avant toute création**, à exécuter par `memory_run` la procédure qui répond déjà, à n'utiliser `function_try` que pour une question réellement manquante et plausible à réutiliser, et à ne jamais recréer primitives ni questions équivalentes.

## ⚠️ Addendum — re-ouverture et complément canonique (15 novembre 2026)

Corrigé par la [revue croisée #174](https://github.com/maurice30120/codetour/issues/174#issuecomment-6898714632) (correction bloquante n°1 : source de vérité incohérente) et le [complément au protocole #174](https://github.com/maurice30120/codetour/issues/174) / [complément validé #172](https://github.com/maurice30120/codetour/issues/172) :

- L'ancien prompt versionné « besoins concrets » (décomposition en besoins de type « localiser les points d'entrée… ») **est supersédé** : il contredit la source de vérité et ne doit plus être injecté ni reproduit.
- Le **prompt canonique ci-dessous est la nouvelle référence** ; il doit exister en **une seule version canonique**, stockée dans **une seule constante** du code (aucune copie parallèle, aucune variante, aucune paraphrase).
- Son **SHA-256** est calculé par l'implémenteur **au gel G5** (« SHA256(prompt canonique) : à calculer au gel G5 » dans la spec) et référencé par le manifeste G5.

## Périmètre

- **Code Touché**: Prompt d'exploration du POC (fichiers de configuration du MPC server ou de l'agent)
- **Hors Périmètre**: Aucun changement dans Vibe natif
- **Tests**: Tests automatiques démontrant les comportements de §2.4

## Livrables

1. **Texte du prompt**: Version canonique EXACTE du texte de §2.2, en **une seule version canonique** stockée dans une **constante unique**, injectée une seule fois
2. **Preuve d'injection**: Hash du prompt modifié, emplacement du fichier
3. **Tests de comportement**: Demonstrer les 6 critères de §2.4

## Critères d'acceptation (à partir de §2.4)

✅ **Test avec mémoire utile**: 
- La trace montre catalogue consulté via `memory_list(query)`
- `memory_run(id, params)` utilisé avec des paramètres valides
- Aucune nouvelle fonction redondante créée

✅ **Test avec mémoire vide**:
- La trace montre une fonction ciblée, paramétrée
- Exécutée avec succès via `function_try(source, params)`
- Ni réponse pré-enregistrée ni fonction jamais essayée

✅ **Test de besoin déjà couvert par primitive**:
- Aucune création de fonction imposée
- Utilisation directe de la primitive existante

✅ **Test de besoin composite**:
- Réutilisation de plusieurs petites opérations si utile
- Interdiction d'appel fonction-mémorisée → fonction-mémorisée

✅ **Test de sortie erronée/absence de preuve**:
- Correction ou incertitude explicite
- Pas de faux succès

✅ **Comparaison des tokens**:
- Tokens du prompt comparés avant/après
- La décomposition ne doit pas être considérée utile du seul fait qu'elle est observée

## Implémentation

### Étape 1: Localiser le prompt d'exploration

Rechercher dans:
- `packages/mcp-server/src/`
- `packages/exploration-poc/`
- Fichiers de configuration des agents

### Étape 2: Injecter le texte

Texte canonique à injecter (à placer au bon endroit dans le prompt) — version canonique unique, supersédant l'ancienne version « besoins concrets » :

```
Avant d'explorer le dépôt, décompose mentalement l'objectif du Tour en quelques questions concrètes et indépendantes. Pour chacune, cherche les questions équivalentes via memory_list(query). Si une procédure répond déjà, exécute-la avec memory_run(id, params), vérifie ses preuves et complète seulement ce qui manque. Sinon, utilise d'abord les primitives permanentes ; si une question fonctionnelle autonome paraît réutilisable, essaie une procédure TypeScript paramétrée avec function_try(source, params). Suis le nommage canonique et les contrats du catalogue. Ne recrée ni primitives, ni questions équivalentes ; n'imbrique aucune procédure mémorisée dans une autre. Retourne des résultats structurés, compacts, sourcés, avec limites et incertitudes. Ne mémorise pas de réponse figée : seules les procédures exécutées peuvent être proposées après validation du Tour. Arrête l'exploration lorsque les preuves sont suffisantes ; n'explicite pas systématiquement la décomposition.
```

**Ancien prompt (version « besoins concrets ») — SUPERSEDÉ le 15/11/2026, conservé uniquement comme référence historique, à ne plus jamais injecter :**

```
Avant d'explorer, décompose mentalement l'objectif du Tour en quelques besoins concrets et indépendants : localiser les points d'entrée, repérer les appels ou définitions, suivre les relations, vérifier les lignes de preuve. Pour chaque besoin, recherche d'abord une fonction réutilisable via `memory_list(query)`. Si elle convient, utilise `memory_run(id, params)` avec les bons paramètres. Sinon, utilise une primitive disponible ou essaie avec `function_try(source, params)` la plus petite fonction TypeScript réutilisable qui répond à ce besoin. Privilégie les opérations ciblées, paramétrées et vérifiables. Ne crée pas une fonction si un appel existant suffit. Ne recommence pas une recherche de catalogue sans raison nouvelle. Regroupe les besoins si cela évite des appels, arrête l'exploration dès que les preuves sont suffisantes, et signale les relations non démontrées. Ne mémorise jamais une réponse figée : seules des procédures réellement exécutées sont candidates à la consolidation après validation du Tour.
```

### Étape 3: Versionner le prompt

- Stocker le prompt canonique dans **une constante unique** (une seule définition dans le code, aucune copie parallèle ni variante)
- Enregistrer l'empreinte (hash) du prompt original « besoins concrets » comme référence historique supersédée
- Calculer le **SHA-256 du prompt canonique au gel G5** et le faire référencer par le manifeste G5 (placeholder dans la spec : « SHA256(prompt canonique) : à calculer au gel G5 »)
- Documenter l'emplacement du fichier et la source canonique (issues #172/#174)

### Étape 4: Créer les tests

Créer des tests qui vérifient:

1. **Mémoire utile**: 
   ```typescript
   // Test que memory_list et memory_run sont appelés correctement
   it('should use memory_list and memory_run with valid parameters when memory is useful', async () => {
     // Setup: mémoire avec des fonctions existantes
     // Execute: demander un Tour
     // Verify: memory_list appelé, puis memory_run avec des paramètres valides
   })
   ```

2. **Mémoire vide**:
   ```typescript
   it('should create and try minimal TypeScript function via function_try when memory is empty', async () => {
     // Setup: mémoire vide
     // Execute: demander un Tour
     // Verify: function_try appelé avec une fonction ciblée et paramétrée
   })
   ```

3. **Primitive suffisante**:
   ```typescript
   it('should use primitive directly when it covers the need', async () => {
     // Setup: besoin couvert par une primitive existante
     // Execute: demander un Tour
     // Verify: primitive utilisée directement, aucune fonction créée
   })
   ```

## Fichiers à modifier

- [ ] `packages/mcp-server/src/server.ts` (ou fichier contenant le prompt)
- [ ] `packages/mcp-server/src/prompts/` (si les prompts sont externalisés)

## Fichiers à créer

- [ ] `packages/exploration-poc/test/prompt-decomposition.test.ts`
- [ ] `docs/specs/spec-174-tickets/01-prompt-decomposition-evidence.md`

## Dépendances

Aucune dépendance externe. Ce ticket peut être travaillé en parallèle avec T02, T03, T04.

## Risques

- **Risque**: Modifier le mauvais prompt (celui de Vibe au lieu du POC)
  - **Mitigation**: Vérifier que le changement n'affecte que le POC CodeTour

- **Risque**: Le prompt de décomposition réduit la qualité des Tours
  - **Mitigation**: Les tests de §2.4 doivent passer avant validation

## Validation

- [ ] Prompt modifié avec succès
- [ ] Hash du prompt original enregistrée
- [ ] Hash du prompt modifié enregistrée
- [ ] Tous les tests de §2.4 passent
- [ ] Aucune régression sur les fonctionnalités existantes

## Preuves requises

1. Diff du fichier de prompt
2. Hash SHA-256 du prompt original
3. Hash SHA-256 du prompt canonique (calculé au gel G5, référencé par le manifeste G5)
4. Résultats des 6 tests de comportement
5. Trace d'exécution montrant l'utilisation correcte de memory_list/memory_run

## Liens

- [Spec #172 (POC procedural memory)](https://github.com/maurice30120/codetour/issues/172)
- [PR #173 (POC à auditer)](https://github.com/maurice30120/codetour/pull/173)
