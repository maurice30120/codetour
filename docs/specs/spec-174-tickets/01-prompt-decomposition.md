# T01 — Prompt de décomposition et tests de comportement

**Spec**: [Spec #174 — Benchmark PostgreSQL réel vs sous-agent Vibe natif + décomposition des tâches](../../../specs/postgres-real-benchmark-2026-11-15.md)

**Status**: ⏳ Not Started
**Priority**: High
**Blocked By**: None
**Blocks**: T07 (Pilote + 80 runs)

## Objectif

Injecter le texte de décomposition (§2.2 de la spec) dans le prompt d'exploration du POC CodeTour **uniquement**, sans modifier le baseline Vibe. Ce prompt incite l'agent à décomposer le besoin en petits besoins concrets et indépendants avant d'explorer.

## Périmètre

- **Code Touché**: Prompt d'exploration du POC (fichiers de configuration du MPC server ou de l'agent)
- **Hors Périmètre**: Aucun changement dans Vibe natif
- **Tests**: Tests automatiques démontrant les comportements de §2.4

## Livrables

1. **Texte du prompt**: Version exacte du texte de §2.2 injecté une seule fois
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

Texte à injecter (à placer au bon endroit dans le prompt):

```
Avant d'explorer, décompose mentalement l'objectif du Tour en quelques besoins concrets et indépendants : localiser les points d'entrée, repérer les appels ou définitions, suivre les relations, vérifier les lignes de preuve. Pour chaque besoin, recherche d'abord une fonction réutilisable via `memory_list(query)`. Si elle convient, utilise `memory_run(id, params)` avec les bons paramètres. Sinon, utilise une primitive disponible ou essaie avec `function_try(source, params)` la plus petite fonction TypeScript réutilisable qui répond à ce besoin. Privilégie les opérations ciblées, paramétrées et vérifiables. Ne crée pas une fonction si un appel existant suffit. Ne recommence pas une recherche de catalogue sans raison nouvelle. Regroupe les besoins si cela évite des appels, arrête l'exploration dès que les preuves sont suffisantes, et signale les relations non démontrées. Ne mémorise jamais une réponse figée : seules des procédures réellement exécutées sont candidates à la consolidation après validation du Tour.
```

### Étape 3: Versionner le prompt

- Enregistrer l'empreinte (hash) du prompt original
- Enregistrer l'empreinte du prompt modifié
- Documenter l'emplacement du fichier

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
3. Hash SHA-256 du prompt modifié
4. Résultats des 6 tests de comportement
5. Trace d'exécution montrant l'utilisation correcte de memory_list/memory_run

## Liens

- [Spec #172 (POC procedural memory)](https://github.com/maurice30120/codetour/issues/172)
- [PR #173 (POC à auditer)](https://github.com/maurice30120/codetour/pull/173)
