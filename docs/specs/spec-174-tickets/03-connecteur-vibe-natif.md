# T03 — Intégration du véritable sous-agent Vibe

**Spec**: [Spec #174 — Benchmark PostgreSQL réel vs sous-agent Vibe natif + décomposition des tâches](../../../specs/postgres-real-benchmark-2026-11-15.md)

**Status**: ⏳ Not Started
**Priority**: Critical
**Blocked By**: None
**Blocks**: T05 (Runner et compteurs), T07 (Pilote + 80 runs)
**Gates**: G1 (Vibe authentique), G2 (Instrumentation totale)

## Objectif

**Prover l'invocation du vrai sous-agent de recherche natif de Vibe**, avec:
- Nom/API/version
- Identifiant d'exécution
- Outils réellement utilisés
- Configuration modèle
- Résultat
- **Vraie consommation de tokens**

**Ce ticket bloque le benchmark principal** (T07). Si G1 ou G2 ne passent pas, NO-GO.

## Périmètre

- **Code**: Adaptateur/connecteur pour invoker Vibe natif
- **Hors Périmètre**: Modification du comportement de Vibe
- **Exigence**: Utiliser le sous-agent de recherche natif, **pas** Vibe headless ou une façade

## Livrables

1. **Adaptateur d'invocation**: Code qui appelle le sous-agent natif Vibe
2. **Exécution sentinelle**: Preuve concrète d'invocation réussie
3. **Manifeste d'identité**: Document avec toutes les métadonnées Vibe
4. **Validation G1/G2**: Sign-off que les gates passent

## Critères d'acceptation

### G1 — Vibe authentique

✅ **Preuve d'invocation**:
- Une exécution sentinelle prouve l'appel au sous-agent de recherche natif
- Nom de l'agent: doit contenir "Vibe" ou "vibe"
- API/version: version exacte du sous-agent
- Identifiant d'exécution: ID unique de la session

✅ **Outils utilisés**:
- Liste des outils réellement utilisés par Vibe
- Doit inclure des outils de recherche (search, grep, etc.)
- Pas juste des outils de base

✅ **Configuration modèle**:
- Modèle LLM utilisé (ex: gpt-4, claude-3, etc.)
- Paramètres (température, max_tokens, etc.)

✅ **Résultat**:
- Résultat brut de l'exécution
- Doit être une réponse valide à une question de Tour

### G2 — Instrumentation totale

✅ **Compteurs fiables**:
- Compteur pour chaque appel de modèle
- Y compris orchestrateur et sous-agent Vibe
- Prompts, recherches, retries, corrections, consolidation POC

✅ **Traces complètes**:
- Date/heure de chaque appel
- Type d'appel (prompt, search, tool, etc.)
- Tokens d'entrée
- Tokens de sortie
- Durée
- Résultat

✅ **Gestion des manque**:
- Si un appel LLM n'a pas de mesure fiable: `usage_missing=true`
- **Ne PAS calculer de gain global** si usage manquant

## Implémentation

### Étape 1: Comprendre l'architecture Vibe

Vibe expose:
- Un serveur MCP (Model Context Protocol)
- Des outils de recherche natifs
- Un sous-agent spécialisé pour la recherche

**À vérifier:**
- Comment invoquer le sous-agent natif (vs le mode headless)
- Quels outils sont disponibles
- Comment récupérer la consommation de tokens

### Étape 2: Créer l'adaptateur

L'adaptateur doit:
1. **Se connecter** au serveur MCP de Vibe
2. **Identifier** le sous-agent de recherche natif
3. **Invoquer** le sous-agent avec une question de Tour
4. **Récupérer** la réponse
5. **Récupérer** la consommation de tokens (directement ou via l'API)

```typescript
// Exemple de structure
interface VibeNativeAgent {
  name: string;           // Nom du sous-agent
  version: string;        // Version
  model: string;          // Modèle LLM
  tools: string[];        // Outils disponibles
}

interface VibeExecution {
  id: string;             // ID d'exécution
  agent: VibeNativeAgent;
  question: string;
  response: string;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  toolsUsed: string[];
  timestamp: Date;
  durationMs: number;
}

// Fonction principale
async function invokeVibeNativeAgent(
  question: string,
  options?: { model?: string; maxTokens?: number }
): Promise<VibeExecution> {
  // 1. Se connecter au serveur MCP
  // 2. Trouver le sous-agent de recherche natif
  // 3. Invoquer avec la question
  // 4. Récupérer réponse + tokens
  // 5. Retourner VibeExecution
}
```

### Étape 3: Exécution sentinelle

Créer un test qui:
1. Pose une question simple mais réelle
2. Invoque le sous-agent natif
3. Vérifie que:
   - La réponse est valide
   - Les métadonnées (nom, version, outils) sont présentes
   - La consommation de tokens est disponible

```typescript
it('should invoke real Vibe native sub-agent', async () => {
  const execution = await invokeVibeNativeAgent(
    'Explain the main entry point of this codebase'
  );
  
  expect(execution.agent.name).toMatch(/vibe/i);
  expect(execution.agent.version).toBeDefined();
  expect(execution.agent.tools).toContain('search');
  expect(execution.response).toBeDefined();
  expect(execution.tokens.input).toBeGreaterThan(0);
  expect(execution.tokens.output).toBeGreaterThan(0);
  
  // Sauvegarder les métadonnées pour le manifeste
  saveManifest(execution);
}, { timeout: 120000 }); // 2 minutes timeout
```

### Étape 4: Instrumentation

L'adaptateur doit **toujours** capturer:
- Les tokens d'entrée pour chaque appel
- Les tokens de sortie pour chaque appel
- Les outils utilisés
- La durée

**Important:** Si Vibe ne fournit pas directement les tokens, il faut:
1. Compter via l'API du fournisseur (si disponible)
2. Estimer à partir de la taille du texte (moins précis)
3. **Ne PAS inventer** des chiffres

### Étape 5: Validation G1/G2

G1 passe si:
- [ ] Preuve d'invocation du sous-agent natif Vibe
- [ ] Toutes les métadonnées sont présentes
- [ ] Le résultat est valide

G2 passe si:
- [ ] Tous les appels LLM ont des compteurs fiables
- [ ] `usage_missing=false` pour tous les appels

## Fichiers à créer/modifier

- [ ] `packages/vibe-connector/` (nouveau package ou dans existing)
- [ ] `packages/vibe-connector/src/agent.ts` (adaptateur principal)
- [ ] `packages/vibe-connector/src/types.ts` (types Vibe)
- [ ] `packages/vibe-connector/test/vibe-native.test.ts` (tests sentinelle)
- [ ] `docs/specs/spec-174-tickets/03-connecteur-vibe-natif-manifeste.json` (manifeste)

## Dépendances

- **Accès à Vibe**: Nécessite un compte Vibe et l'accès au sous-agent natif
- **MCP Client**: Bibliothèque pour se connecter au serveur MCP

## Risques

- **Risque**: Impossible d'accéder au sous-agent natif
  - **Mitigation**: Vérifier les permissions Vibe, contacter le support
  - **Conséquence**: NO-GO si impossible

- **Risque**: Vibe ne fournit pas les tokens
  - **Mitigation**: Utiliser l'API du fournisseur si disponible
  - **Conséquence**: G2 ne passe pas, NO-GO

- **Risque**: Le sous-agent natif a un comportement différent du headless
  - **Mitigation**: Documenter les différences dans le manifeste

## Validation

- [ ] Adaptateur crée et fonctionnel
- [ ] Exécution sentinelle réussie
- [ ] Manifeste complet avec toutes les métadonnées
- [ ] G1 validé (sous-agent natif prouvé)
- [ ] G2 validé (instrumentation complète)

## Preuves requises

1. Code de l'adaptateur
2. Résultat de l'exécution sentinelle (log complet)
3. Manifeste avec:
   - Nom/API/version du sous-agent
   - Identifiant d'exécution
   - Outils utilisés
   - Configuration modèle
   - Résultat de l'exécution
   - Consommation de tokens
4. Validation que G1 passe
5. Validation que G2 passe

## Liens

- [Vibe Documentation](https://vibe.dev)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [Spec #174 Issue](https://github.com/maurice30120/codetour/issues/174)
