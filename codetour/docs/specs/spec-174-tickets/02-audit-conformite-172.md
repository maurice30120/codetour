# T02 — Audit et remise en conformité technique #172

**Spec**: [Spec #174 — Benchmark PostgreSQL réel vs sous-agent Vibe natif + décomposition des tâches](../../../specs/postgres-real-benchmark-2026-11-15.md)

**Status**: 🔴 Re-opened — complément + corrections (#174, 15/11/2026)
**Priority**: Critical
**Blocked By**: None
**Blocks**: T05 (Runner et compteurs), T07 (Pilote + 80 runs)
**Gate**: G0 (Conformité POC à #172)

## Objectif

Vérifier et valider que le POC CodeTour est **100% conforme** à la spec #172. Cela inclut :
- Les 10 primitives
- L'interface `function_try` TypeScript strict
- La whitelist et l'exécution QuickJS
- `memory_list(query)` et `memory_run(id, params)`
- Les traces d'exécution
- La mémoire et la consolidation

**Ce ticket bloque le benchmark principal** (T07). Si G0 n'est pas satisfait, NO-GO.

## 🔴 Re-ouverture — complément #174 et corrections bloquantes (15 novembre 2026)

Réouverture exigée par la [revue croisée #174](https://github.com/maurice30120/codetour/issues/174#issuecomment-6898714632) et le [complément au protocole #174](https://github.com/maurice30120/codetour/issues/174) / [complément validé #172](https://github.com/maurice30120/codetour/issues/172). À auditer **en plus** de la matrice initiale, **avant G0** :

1. **Contrat `memory_list(query)`** : exposer pour chaque entrée `id`, **question canonique**, **description/périmètre**, **paramètres typés**, **contrat de sortie** et **limites/cas d'incertitude** — **sans lecture du code source** de la fonction (ni code ni réponse enregistrée renvoyés).
2. **Contrat de sortie `memory_run` / `function_try`** : sortie **compacte, structurée, bornée et sourcée** (fichier/lignes/révision), avec relation démontrée vs incertitude, état vide, erreurs et **signal de troncature** ; une sortie tronquée n'est jamais interprétée comme exhaustive ; bornes en octets/items/tokens et moyen de retrouver le détail (curseur ou lecture ciblée) ; limites de sécurité QuickJS testées par abus (imports, réseau, écriture FS, ressources).
3. **Normalisation du nommage** : question canonique stable ; nom TypeScript `camelCase` en `verbe + domaine + objet` ; variantes = paramètres ; le nom seul n'est jamais une preuve d'équivalence.
4. **Règle de déduplication** : sur **question + périmètre + contrat**, jamais sur le nom seul ; « pas deux capacités pour une même question » est un objectif **testé sur des cas de référence**, pas une garantie absolue ; autoriser « non déterminé » plutôt qu'une équivalence inventée ; pas d'embeddings ni de classifieur.
5. **Robustesse au remplacement + rollback** : `memory_run` contrôle **révision + validité des preuves** ; résultat incertain/obsolète ⇒ **signal explicite** et exploration alternative, jamais une preuve périmée ; avant de **remplacer** une fonction mémorisée, vérifier la candidate sur **ses propres paramètres ET un jeu représentatif de tests de l'ancienne version** (aucune régression silencieuse) ; **rollback conservé**.
6. **Signal concret de validation de Tour** (déclencheur de consolidation) : disponibilité d'une **sortie/contrat structuré**, **preuves structurelles**, **statut d'exécution** — **jamais** le juge aveugle du benchmark (a posteriori) ; définir le **cas Tour partiel/échec** : pas de consolidation, traces toujours enregistrées pendant le run, **aucune mutation du catalogue en cours de run**.
7. **Les 7 tests d'acceptation avant G0** (cf. G0 dans la spec, complément #174) : (1) deux formulations de la même question ne créent pas deux capacités ; (2) même fonction réutilisée sans relecture du code ; (3) primitive suffisante ⇒ aucune création ; (4) question composite ⇒ procédures indépendantes et exploration du manque ; (5) sortie avec preuves et limites, signal de bornage/troncature ; (6) candidate non exécutée refusée ; (7) résultat syntaxiquement plausible mais preuve de relation absente ⇒ incertitude/échec explicite.

Rappels du complément : une procédure mémorisée n'appelle **que les dix primitives permanentes** ; la composition se fait **par l'agent pendant le Tour**, jamais dans le code mémorisé ; consolidation **ajouter/remplacer/ignorer** uniquement, recouvrements partiels tolérés ; pas de moteur de score, d'index sémantique, de graphe de dépendances ni de purge par inactivité.

## Périmètre

- **Code Audité**: Tout le code du POC lié à la spec #172
- **Hors Périmètre**: Modifications de Vibe natif
- **Réutilisation**: Réutiliser le travail de la spec #172 plutôt que créer un second moteur

## Livrables

1. **Matrice de conformité**: Exigence → chemin de code → test → résultat
2. **Rapport d'audit**: Liste des écarts et corrections appliquées
3. **Preuves de tests**: Tous les tests passent
4. **Validation G0**: Sign-off que G0 est satisfait

## Critères d'acceptation

### Les 10 primitives (à vérifier)

D'après la spec #172, les 10 primitives doivent être:

1. **list**: Lister les fichiers/répertoires
2. **read**: Lire le contenu d'un fichier
3. **search**: Rechercher dans le code
4. **grep**: Recherche regex
5. **find**: Trouver des fichiers
6. **stat**: Statut d'un fichier
7. **git_log**: Historique Git
8. **git_diff**: Diff Git
9. **git_blame**: Blame Git
10. **code**: Exécuter du code JavaScript/TypeScript

**Pour chacune:**
- [ ] Existe dans le code
- [ ] Fonctionnelle
- [ ] Testée automatiquement
- [ ] Bornée (ne peut pas faire plus que sa description)

### Interface `function_try`

✅ **TypeScript strict**: 
- Valide du TypeScript en mode strict
- Restreint aux 10 primitives (whitelist)

✅ **Transpilation QuickJS**:
- Transpile le TypeScript vers JavaScript
- Exécute dans QuickJS
- Retourne le résultat

✅ **Traces**:
- Génère des traces d'exécution
- Inclut: source, paramètres, résultat, durée, erreurs

### Mémoire et consolidation

✅ **memory_list(query)**:
- Recherche dans la mémoire des fonctions mémorisées
- Retourne une liste de fonctions correspondantes
- Fonctionne avec des queries

✅ **memory_run(id, params)**:
- Exécute une fonction mémorisée
- Passe les paramètres
- Retourne le résultat

✅ **Contraintes mémoire**:
- **Aucune fonction mémorisée n'appelle une autre fonction mémorisée**
- Consolidation **uniquement après Tour validé**
- Consolidation sur version **réellement essayée**
- **Pas de cache de réponses**
- **Pas de purge par inactivité**

### Tests automatiques

Chaque exigence doit avoir un **test automatique concret**. Pas de validation manuelle.

## Implémentation

### Étape 1: Identifier le code du POC #172

Rechercher dans:
- `packages/exploration-poc/`
- `packages/exploration-sandbox/`
- Fichiers liés à `function_try`, `memory_list`, `memory_run`

### Étape 2: Créer la matrice de conformité

Format:

```markdown
| Exigence | Chemin de code | Test | Résultat |
|----------|----------------|------|----------|
| Primitive 1 (list) | `src/primitives/list.ts` | `test/primitives/list.test.ts` | ✅ Pass |
| Primitive 2 (read) | `src/primitives/read.ts` | `test/primitives/read.test.ts` | ✅ Pass |
| ... | ... | ... | ... |
| function_try TypeScript | `src/function-try.ts` | `test/function-try.test.ts` | ✅ Pass |
| memory_list | `src/memory.ts` | `test/memory.test.ts` | ✅ Pass |
| memory_run | `src/memory.ts` | `test/memory.test.ts` | ✅ Pass |
```

### Étape 3: Corriger les écarts

Pour chaque échec:
- Identifier la cause racine
- Appliquer la correction
- Vérifier que le test passe
- Documenter dans le rapport d'audit

### Étape 4: Valider G0

G0 est satisfait si:
- [ ] Les 10 primitives sont implémentées et testées
- [ ] `function_try` valide TypeScript strict, whitelist, QuickJS
- [ ] `memory_list(query)` fonctionne
- [ ] `memory_run(id, params)` fonctionne
- [ ] Aucune fonction mémorisée n'appelle une autre
- [ ] Consolidation uniquement après validation
- [ ] Pas de cache de réponses
- [ ] Tous les tests passent

## Fichiers à auditer

- [ ] `packages/exploration-poc/src/primitives/`
- [ ] `packages/exploration-poc/src/function-try.ts`
- [ ] `packages/exploration-poc/src/memory.ts`
- [ ] `packages/exploration-poc/src/consolidation.ts`
- [ ] `packages/exploration-sandbox/`

## Fichiers à créer

- [ ] `docs/specs/spec-174-tickets/02-audit-conformite-172-matrix.md` (matrice de conformité)
- [ ] `docs/specs/spec-174-tickets/02-audit-conformite-172-rapport.md` (rapport d'audit)
- [ ] `packages/exploration-poc/test/spec-172-conformance.test.ts` (tests de conformité)

## Dépendances

Aucune dépendance externe. Ce ticket peut être travaillé en parallèle avec T01, T03, T04.

## Risques

- **Risque**: Le POC #172 n'est pas conforme
  - **Mitigation**: Corriger tous les écarts avant de valider G0

- **Risque**: Les corrections cassent des fonctionnalités existantes
  - **Mitigation**: Tous les tests existants doivent continuer à passer

- **Risque**: Performance impactée
  - **Mitigation**: Pas de contenu dans ce ticket sur la performance

## Validation

- [ ] Matrice de conformité complète
- [ ] Tous les tests de conformité passent
- [ ] Rapport d'audit signé
- [ ] G0 validé (sign-off)

## Preuves requises

1. Matrice de conformité remplie
2. Rapport d'audit avec liste des corrections
3. Résultats de tous les tests
4. Preuve que G0 est satisfait

## Liens

- [Spec #172 (POC procedural memory)](https://github.com/maurice30120/codetour/issues/172)
- [Spec #172 Tickets](https://github.com/maurice30120/codetour/docs/specs/spec-172-tickets/README.md)
