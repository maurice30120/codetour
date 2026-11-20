# T04 — Fixture PostgreSQL et jeu de questions scellé

**Spec**: [Spec #174 — Benchmark PostgreSQL réel vs sous-agent Vibe natif + décomposition des tâches](../../../specs/postgres-real-benchmark-2026-11-15.md)

**Status**: ⏳ Not Started
**Priority**: High
**Blocked By**: None
**Blocks**: T05 (Runner et compteurs), T06 (Évaluateur aveugle), T07 (Pilote + 80 runs)
**Gate**: G3 (Fixture réelle)

## Objectif

Créer une **fixture reproducible** du dépôt PostgreSQL et un **jeu de 40 questions scellées** (20 pour série R, 20 pour série T) pour le benchmark.

**Ce ticket bloque T05, T06, T07**. Si G3 ne passe pas, NO-GO.

## Périmètre

- **Fixture**: Clone en lecture seule de `postgres/postgres` au SHA **`70c4a57b64d39c526eb4c44a925eb92a6e56f3c5`**
- **Questions**: 40 questions pré-enregistrées (R et T)
- **Attentes**: Attentes sémantiques distinctes des prompts
- **Hors Périmètre**: Modification du code PostgreSQL

## Livrables

1. **Fixture PostgreSQL**: Clone gelé au SHA spécifié
2. **Jeu de questions**: 40 questions (20 R + 20 T)
3. **Attentes sémantiques**: Corrigés et critères de correction
4. **Manifeste scellé**: Hash de tout le dossier
5. **Validation G3**: Sign-off que la fixture est valide

## Critères d'acceptation

### G3 — Fixture réelle

✅ **Clone PostgreSQL**:
- Répértoire: `poc/benchmark/postgres/` ou similaire
- SHA: `70c4a57b64d39c526eb4c44a925eb92a6e56f3c5`
- Statut: lecture seule (pas de modification)
- Sous-modules: checkout complet
- État: propre (pas de fichiers non-commités)

✅ **Vérification SHA**:
- SHA du commit vérifié avant chaque série
- Arbre propre vérifié avant chaque run
- Preuve d'intégrité enregistrée dans les logs

✅ **Même arbre pour les deux agents**:
- CodeTour et Vibe utilisent la même fixture
- Aucun avantage pour un agent

### Jeu de questions

#### Série R — Répétition (20 questions)

**Structure**: 5 questions réelles de compréhension, chacune répétée 4 fois

**Exemples de thèmes**:
- Compréhension des points d'entrée principaux
- Flux de traitement des requêtes
- Architecture du parseur
- Gestion des connexions
- Mécanismes de stockage

**Format de chaque question**:
```json
{
  "id": "R-Q1-R1",
  "objective": "Explain the main entry point of PostgreSQL query execution",
  "series": "R",
  "phase": "repetition",
  "repeat_index": 1,
  "postgres_sha": "70c4a57b64d39c526eb4c44a925eb92a6e56f3c5",
  "expected_areas": ["src/backend/main", "src/backend/tcop"],
  "criteria": [
    "Must identify PostgresMain as entry point",
    "Must explain the call chain",
    "Must mention at least 3 key functions"
  ],
  "relations_to_verify": [
    {"from": "PostgresMain", "to": "exec_simple_query", "type": "calls"},
    {"from": "exec_simple_query", "to": "pg_parse_query", "type": "calls"}
  ]
}
```

#### Série T — Transfert (20 questions)

**Structure**: 10 questions d'amorçage + 10 questions nouvelles voisines

**Caractéristiques**:
- Questions pré-définies
- Non identiques
- Non visibles comme réponses aux agents
- Couverture de différents aspects du code

**Format similaire à R** mais avec:
```json
{
  "id": "T-Q1-A1",
  "objective": "Trace the flow from query parsing to execution",
  "series": "T",
  "phase": "transfer",
  "repeat_index": 1,
  "postgres_sha": "70c4a57b64d39c526eb4c44a925eb92a6e56f3c5",
  "is_priming": true,
  "expected_areas": ["src/backend/parser", "src/backend/rewrite"],
  "criteria": [...],
  "relations_to_verify": [...]
}
```

### Attentes sémantiques

Pour chaque question:
- **Attendus**: Zones du code attendues (fichiers, fonctions)
- **Critères**: Ce que la réponse doit contenir
- **Relations**: Relations entre entités à vérifier
- **Preuves**: Plusieurs chemins de preuves admissibles

**Important**:
- Les attentes sont **distinctes des prompts**
- Les attentes sont **non révélées aux agents**
- Plusieurs réponses correctes possibles
- Éviter le surapprentissage d'une ligne précise

## Implémentation

### Étape 1: Cloner PostgreSQL

```bash
# Cloner au SHA spécifié
cd poc/benchmark
git clone https://github.com/postgres/postgres.git
cd postgres
git checkout 70c4a57b64d39c526eb4c44a925eb92a6e56f3c5

# Vérifier le SHA
git rev-parse HEAD  # Doit être 70c4a57b64d39c526eb4c44a925eb92a6e56f3c5

# Rendre en lecture seule (optionnel)
chmod -R a-w .
```

### Étape 2: Vérifier l'intégrité

```bash
# Vérifier que l'arbre est propre
git status  # Doit être clean

# Vérifier les sous-modules (si applicable)
git submodule status

# Calculer l'empreinte du dossier
find . -type f -exec sha256sum {} \; | sort | sha256sum > postgres-fixture.sha256
```

### Étape 3: Créer le jeu de questions

Basé sur `poc/exploration-benchmark/postgres-tour-tasks.json` mais **révisé**:
- Les "lignes attendues" ne suffisent pas
- Il faut des **attentes sémantiques**
- Plusieurs chemins de preuves admissibles

**Fichier**: `poc/benchmark/postgres-questions.json`

```json
{
  "version": "1.0",
  "postgres_sha": "70c4a57b64d39c526eb4c44a925eb92a6e56f3c5",
  "date": "2026-11-15",
  "series_R": [
    // 20 questions (5 questions × 4 répétitions)
  ],
  "series_T": [
    // 20 questions (10 amorçage + 10 nouvelles)
  ],
  "evaluation_criteria": {
    "correct": "La réponse est pertinente et les relations centrales sont justes",
    "evidence_supported": "Toutes les affirmations sont soutenues par des preuves du code",
    "major_missing_relation": "Une relation majeure attendue est absente",
    "critical_false_claim": "Une affirmation critique est fausse"
  }
}
```

### Étape 4: Créer le manifeste scellé

**Fichier**: `poc/benchmark/manifest.json`

```json
{
  "spec_version": "174",
  "postgres_sha": "70c4a57b64d39c526eb4c44a925eb92a6e56f3c5",
  "questions_hash": "sha256:...",
  "fixture_hash": "sha256:...",
  "date": "2026-11-15",
  "author": "...",
  "notes": "Manifeste scellé pour le benchmark PostgreSQL - ne pas modifier"
}
```

### Étape 5: Valider G3

G3 passe si:
- [ ] Clone PostgreSQL au bon SHA
- [ ] Arbre propre
- [ ] Sous-modules checkout
- [ ] État vérifiable
- [ ] Même arbre pour les deux agents

## Fichiers à créer

- [ ] `poc/benchmark/postgres/` (clone du dépôt)
- [ ] `poc/benchmark/postgres-questions.json` (40 questions)
- [ ] `poc/benchmark/postgres-expected-answers.json` (attentes sémantiques)
- [ ] `poc/benchmark/manifest.json` (manifeste scellé)
- [ ] `poc/benchmark/verify-fixture.sh` (script de vérification)
- [ ] `docs/specs/spec-174-tickets/04-fixture-postgres-evidence.md`

## Dépendances

- **Git**: Pour cloner le dépôt
- **SHA256**: Pour calculer les empreintes
- **Espace disque**: PostgreSQL fait ~200Mo-1Go

## Risques

- **Risque**: SHA incorrect
  - **Mitigation**: Vérifier le SHA avant et après le clone

- **Risque**: Questions trop faciles/inetressantes
  - **Mitigation**: Révision par un évaluateur indépendant

- **Risque**: Questions trop spécifiques (surapprentissage)
  - **Mitigation**: Plusieurs chemins de preuves admissibles

## Validation

- [ ] Fixture PostgreSQL clonée au bon SHA
- [ ] Arbre propre vérifié
- [ ] 40 questions créées (20 R + 20 T)
- [ ] Attentes sémantiques définies
- [ ] Manifeste scellé créé
- [ ] G3 validé (fixture valide)

## Preuves requises

1. Sortie de `git log --oneline -1` dans le clone PostgreSQL
2. Sortie de `git status` (doit être clean)
3. Hash SHA-256 de la fixture
4. Contenu du jeu de questions
5. Contenu des attentes sémantiques
6. Manifeste scellé
7. Validation que G3 passe

## Liens

- [PostgreSQL Repository](https://github.com/postgres/postgres)
- [Commit 70c4a57b](https://github.com/postgres/postgres/commit/70c4a57b64d39c526eb4c44a925eb92a6e56f3c5)
- [Existing benchmark tasks](poc/exploration-benchmark/postgres-tour-tasks.json)
