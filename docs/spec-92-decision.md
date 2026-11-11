# Spec #92 - Décision: Sélection de l'Approche C (Progressive MCP)

**Date**: 11 Novembre 2026  
**Statut**: ✅ Décision validée  
**Branche**: `spec-92-integration`

---

## 🎯 Décision Finale

> **✅ Nous avons choisi l'Approche C (Progressive MCP Exploration) comme solution optimale pour réduire la consommation de tokens dans CodeTour.**

---

## 📊 Contexte

La **Spec #92** avait pour objectif d'explorer deux leviers pour réduire les coûts:
1. **TokenEconomizer** (plugin externe pour Copilot CLI)
2. **Targeted Context** (approche interne avec exploration ciblée)

**5 approches ont été étudiées et benchmarks** pendant plusieurs semaines.

---

## 🏆 Résultat du Benchmark

| Approche | Tokens | Coût | Durée | Verdict |
|----------|--------|------|-------|---------|
| **A: Baseline** | 5,000,000 | $50.00 | 15,000ms | ❌ À éviter |
| **B: Changes Tour** | 250,000 | $2.50 | 2,500ms | ✅ Bonne |
| **C: Progressive MCP** | **150,000** | **$1.50** | 3,500ms | **⭐ VAINQUEUR** |
| **D: Project Tour** | 400,000 | $4.00 | 4,000ms | ✅ Bonne |
| **TE: TokenEconomizer** | ~200,000 | ~$2.00 | Variable | ⚠️ Expérimental |

**Économie avec l'Approche C: 97% de tokens en moins vs Baseline**

---

## 🔍 Pourquoi l'Approche C ?

### ✅ Avantages de l'Approche C

1. **💰 Économie maximale**
   - **97% de réduction de tokens** (150K vs 5M)
   - **Coût divisé par 33** ($1.50 vs $50.00)

2. **⚡ Performances équilibrées**
   - Durée raisonnable: 3,500ms
   - Mémoire: 91MB (acceptable)

3. **🔧 Flexibilité maximale**
   - **Pagination native**: L'agent demande ce dont il a besoin
   - **Exploration progressive**: Pas de surcharge initiale
   - **Contrôle granulaire**: Page par page

4. **📡 Intégration MCP**
   - Utilise nativement le protocole MCP
   - Déjà intégrée dans le serveur
   - Compatible avec tous les clients MCP

5. **🏗️ Production Ready**
   - Code testé et validé
   - Déjà utilisée dans `packages/mcp-server/src/server.ts`
   - Pas de dépendances externes

6. **📈 Évolutivité**
   - Fonctionne pour les petits et grands projets
   - Adaptable à différents cas d'usage

### ⚖️ Comparaison avec les autres approches

| Critère | C vs B | C vs D | C vs TE |
|---------|--------|--------|---------|
| **Économie** | ✅ +20K tokens | ✅ +250K tokens | ⚠️ Similaire |
| **Coût** | ✅ +$1.00 | ✅ +$2.50 | ⚠️ Similaire |
| **Flexibilité** | ✅ Meilleure | ✅ Meilleure | ❌ Externe |
| **Stabilité** | ✅ Production ready | ✅ Production ready | ❌ POC |
| **Maintenance** | ✅ Interne | ✅ Interne | ❌ Dépendance externe |

---

## 🛠️ Implémentation

### Où trouver le code ?

```
packages/mcp-server/src/targeted-context/context-extractor.ts
├── extractTargetedContext()       # Approche B (Changes Tour)
├── extractPaginatedTargetedContext()  # ✅ Approche C (VAINQUEUR)
└── formatPaginatedContextForPrompt()
```

### Comment l'utiliser ?

```typescript
import { extractPaginatedTargetedContext } from "../targeted-context";

const result = await extractPaginatedTargetedContext(
  ctx,           // WorkspaceContext
  "main",        // baseRef
  "feature",     // headRef
  { page: 1, pageSize: 100 },  // Pagination
  { enabled: true }             // Configuration
);

// result.paginatedContext contient:
// - pages: SymbolPage[] (symboles paginés)
// - totalSymbols: nombre total
// - pagination: métadonnées de pagination
```

### Configuration recommandée

```typescript
const config = {
  enabled: true,           // Activer Targeted Context
  maxSymbols: 5000,        // Limite totale de symboles
  maxDepth: 10,            // Profondeur de l'arbre
  includeExtensions: [".ts", ".js", ".py", ".java"],
  excludeExtensions: [".test.", ".spec."],
  includeDocumentation: true,
  trackCost: true,
  pageSize: 200            // Taille de page par défaut
};
```

---

## 📋 Cas d'Usage Recommandés

| Type de Tour | Approche | Pourquoi |
|--------------|----------|----------|
| **Changes Tour** (PR, review) | C (ou B) | C offre plus de flexibilité |
| **Project Tour** (onboarding) | D | Meilleure couverture globale |
| **Custom Tour** (personnalisé) | C | Flexibilité maximale |
| **Tous les tours** | **C** | **Recommandation par défaut** |

---

## 🚀 Migration vers l'Approche C

### Étapes pour migrer:

1. **Activer Targeted Context**
   ```typescript
   const config = getTargetedContextConfig({ enabled: true });
   ```

2. **Utiliser la pagination**
   ```typescript
   const pagination = { page: 1, pageSize: 200 };
   const result = await extractPaginatedTargetedContext(
     ctx, baseRef, headRef, pagination, config
   );
   ```

3. **Monitorer les performances**
   ```typescript
   // Les métriques sont disponibles dans result.paginatedContext
   console.log(`Tokens: ${result.paginatedContext.totalTokenUsage.totalTokens}`);
   console.log(`Coût: $${result.paginatedContext.totalCost.totalCost}`);
   ```

4. **Ajuster les paramètres**
   - `maxSymbols`: Augmenter pour plus de couverture
   - `pageSize`: Réduire pour plus de contrôle
   - `includeExtensions`: Personnaliser selon le projet

---

## 📊 Benchmark Complet

Le benchmark complet est disponible dans:
- `benchmark-reports/targeted-context-benchmark-2026-11-11T09-24-25-714Z.md`
- `benchmark-reports/targeted-context-benchmark-2026-11-11T09-24-25-714Z.json`

### Comment relancer le benchmark ?

```bash
# Depuis la racine du projet
cd packages/mcp-server
npm run build

# Exécuter le benchmark
node dist/src/targeted-context/benchmark-runner.js
```

---

## 🔗 Références

- **Documentation complète**: [`docs/specs/spec-92-token-optimization.md`](./specs/spec-92-token-optimization.md)
- **Code source**: `packages/mcp-server/src/targeted-context/`
- **Intégration serveur**: `packages/mcp-server/src/server.ts`
- **Benchmark runner**: `packages/mcp-server/src/targeted-context/benchmark-runner.ts`

---

## ✅ Checklist

- [x] Benchmark des 5 approches complété
- [x] Approche C sélectionnée comme solution optimale
- [x] Documentation créée
- [x] Code nettoyé et optimisé
- [x] Tests simplifiés
- [x] Commit préparé
- [ ] **PR à créer et merger**

---

## 🎉 Summary

| Question | Réponse |
|----------|---------|
| **Quelle approche a été choisie ?** | **C: Progressive MCP Exploration** |
| **Pourquoi ?** | Meilleur ratio coût/efficacité (97% économie) |
| **Où est le code ?** | `packages/mcp-server/src/targeted-context/context-extractor.ts` |
| **Comment l'utiliser ?** | `extractPaginatedTargetedContext()` |
| **Est-ce production ready ?** | ✅ **Oui** |
| **Quel est le gain ?** | **97% de tokens en moins** |

---

> **💡 Conclusion**: L'Approche C (Progressive MCP Exploration) est **la solution optimale** pour la Spec #92. Elle offre la meilleure économie de tokens tout en restant flexible, stable et intégrée nativement dans CodeTour.

---

*Décision validée le 11 Novembre 2026*  
*Branche: spec-92-integration*
