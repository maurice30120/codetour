# Spec: Hybrid Targeted Context - C pour Changes Tours, D pour Project Tours

**Statut**: En cours
**Date**: 11 Novembre 2026
**Auteur**: Agent
**Branche**: `spec-92-integration`
**Relie à**: Spec #92 (Optimisation du coût CodeTour)

---

## Problem Statement

Les approches individuelles de Targeted Context (C et D) offrent des avantages complémentaires mais isolés :
- **Approche C** (Progressive MCP) excelle pour les **Changes Tours** avec 97% de réduction de tokens, mais manque de contexte architectural global
- **Approche D** (Project Tour) fournit une **couverture complète du workspace** pour les Project Tours, mais à un coût plus élevé (400K tokens vs 150K pour C)

Actuellement, le système n'utilise pas automatiquement l'approche optimale selon le type de Tour. Les utilisateurs et agents doivent choisir manuellement, ce qui mène à des inefficacités.

---

## Solution

Implémenter une **stratégie automatique** qui :
1. Détecte le type de Tour (Changes Tour vs Project Tour)
2. Applique **l'approche C** (Progressive MCP) pour les **Changes Tours** (diff, PR, revues de code)
3. Applique **l'approche D** (Project Tour) pour les **Project Tours** (découverte, onboarding, questions architecturales)
4. Garantit que chaque approche utilise sa configuration optimale

---

## User Stories

### Détection Automatique
1. As a developer, I want the Tour Generator to automatically use approach C for Changes Tours, so that I get optimal token efficiency when reviewing PRs
2. As a developer, I want the Tour Generator to automatically use approach D for Project Tours, so that I get comprehensive context when discovering a project
3. As a developer, I want the detection to be based on the presence of baseRef and headRef parameters, so that Changes Tours are clearly identified

### Changes Tours avec Approche C
4. As a developer reviewing a PR, I want the Tour Generator to use progressive pagination (approach C), so that I can explore changes incrementally
5. As a developer reviewing a PR, I want the context to focus only on changed files, so that I don't waste tokens on unchanged code
6. As a developer, I want Changes Tours with approach C to cost less than 150K tokens, so that it remains economically viable
7. As a developer, I want Changes Tours to complete in under 3 seconds, so that the review process is responsive

### Project Tours avec Approche D
8. As a developer new to a project, I want the Tour Generator to use approach D, so that I get a comprehensive overview of the codebase structure
9. As a developer asking architectural questions, I want the Tour Generator to include key project files, so that I can understand the system design
10. As a developer, I want Project Tours with approach D to cover the main source directories, so that I don't miss important components
11. As a developer, I want Project Tours to respect configurable limits (max files, max symbols), so that token usage remains controlled
12. As a developer, I want Project Tours to cost less than 400K tokens, so that it remains economically viable

### Configuration et Flexibilité
13. As a developer, I want approach C to have optimal defaults for Changes Tours (maxSymbols: 5000, pageSize: 200), so that it works well out of the box
14. As a developer, I want approach D to have optimal defaults for Project Tours (maxFiles: 50, maxSymbolsPerFile: 50), so that it provides good coverage without excessive cost
15. As a developer, I want the configuration to be easily adjustable, so that I can fine-tune for specific use cases

### Intégration MCP
16. As an MCP client, I want to request Changes Tours via a unified resource, so that I don't need to specify the approach manually
17. As an MCP client, I want to request Project Tours via a unified resource, so that the correct approach is used automatically
18. As an MCP client, I want the existing resources to remain functional, so that backward compatibility is maintained

### Validation
19. As a maintainer, I want benchmarks comparing C and D in production scenarios, so that we can validate the token savings
20. As a maintainer, I want documentation explaining when to use C vs D, so that users understand the difference

---

## Implementation Decisions

### Architecture de Détection

**Tour Type Detection Module**
- Détecte le type de Tour basé sur les paramètres de la requête
- **Changes Tour**: Présence de `baseRef` ET `headRef` → utilise approche C
- **Project Tour**: Absence de `baseRef`/`headRef` ou demande explicite → utilise approche D

### Configuration par Défaut

**Approche C (Changes Tours) - Configuration Optimale:**
```typescript
{
  enabled: true,
  maxSymbols: 5000,
  maxFiles: 50,
  pageSize: 200,
  includeExtensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go"],
  excludeExtensions: [".test.", ".spec.", ".d.ts"],
  trackCost: true,
  excludeNodeModules: true
}
```

**Approche D (Project Tours) - Configuration Optimale:**
```typescript
{
  enabled: true,
  maxFiles: 50,
  maxSymbolsPerFile: 50,
  includeExtensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".java", ".go", ".rs"],
  excludeExtensions: [".test.", ".spec.", ".d.ts", ".min.js"],
  includeDocumentation: true,
  trackCost: true,
  rootDirectories: ["src", "lib", "packages", "app", "server"],
  excludeNodeModules: true
}
```

### Ressources MCP de contexte

Les ressources de contexte sont **distinctes** des ressources de prompt (`codetour://generate/*`).

- **`codetour://context/changes-tour/{baseRef}/{headRef}`** → force l'approche C, première page
  (200 symboles par défaut)
- **`codetour://context/changes-tour/{baseRef}/{headRef}?page={page}&pageSize={pageSize}`** →
  force l'approche C, page choisie
- **`codetour://context/project-tour`** → force l'approche D

Paramètres requis : `baseRef`, `headRef`. La pagination est optionnelle via un template dédié,
parce que le matcher RFC 6570 du SDK MCP exige **tous** les paramètres de query déclarés.

Pas de paramètre `workspacePath` ni `fileName` :
- le workspace est celui du serveur MCP (répertoire de démarrage) ; accepter un chemin arbitraire
  dans l'URI permettrait de lire hors du dépôt ;
- filtrer sur un fichier unique relèverait d'une ressource dédiée, pas d'un paramètre optionnel
  (impossible à exprimer sans multiplier les templates).

Les ressources de prompt existantes — `codetour://generate/changes-tour/{reviewMode}` et
`codetour://generate/project-tour` — restent inchangées.

### Intégration avec le Serveur MCP

Le serveur MCP doit:
1. Analyser les paramètres de la requête
2. Déterminer le type de Tour
3. Appeler le bon extracteur (C ou D) avec la bonne configuration
4. Retourner le contexte formaté

**Logique de routage:**
```
Si baseRef ET headRef sont présents:
    → Utiliser extractPaginatedTargetedContext (Approche C)
Sinon:
    → Utiliser extractProjectTargetedContext (Approche D)
```

### Rétro-compatibilité

- Les ressources existantes (`create_changes_tour`, `create_project_tour`) restent inchangées
- Les nouveaux comportements s'appliquent uniquement aux nouvelles ressources unifiées
- Les configurations par défaut peuvent être override via paramètres

---

## Testing Decisions

### Philosophie de Test

Tester le **comportement externe** :
- Détection correcte du type de Tour
- Utilisation de la bonne approche (C ou D)
- Respect des configurations par défaut
- Coût token dans les limites attendues

### Modules à Tester

1. **Tour Type Detection**
   - Test: Détection correcte avec baseRef + headRef → C
   - Test: Détection correcte sans refs → D
   - Test: Détection correcte avec workspacePath seul → D

2. **Changes Tour avec C**
   - Test: Utilise bien l'approche C
   - Test: Configuration par défaut appliquée
   - Test: Coût < 150K tokens pour un PR moyen
   - Test: Durée < 3 secondes

3. **Project Tour avec D**
   - Test: Utilise bien l'approche D
   - Test: Configuration par défaut appliquée
   - Test: Coût < 400K tokens
   - Test: Couverture des fichiers clés

4. **Ressources MCP**
   - Test: `changes-tour` retourne un contexte valide avec C
   - Test: `project-tour` retourne un contexte valide avec D

### Prior Art

Utiliser les mêmes patterns de test que :
- `test/unit/targeted-context.test.ts`
- `test/unit/project-targeted-context.test.ts`

---

## Out of Scope

1. **Approche Hybride (C + D)** - Faire un mix des deux approches dans un seul Tour
2. **Switch manuel entre C et D** - Forcer une approche spécifique via paramètre
3. **TokenEconomizer Integration** - C'est une piste séparée (piste TE)
4. **Modification des approches C et D existantes** - Elles doivent rester fonctionnelles indépendamment
5. **Nouveaux algorithmes d'extraction** - Utiliser les extracteurs existants
6. **Interface utilisateur** - Se concentrer uniquement sur le backend MCP
7. **Workspace ou fichier en paramètre** - Le workspace est celui du serveur ; pas de `workspacePath` ni de `fileName` dans les URI de contexte

---

## Further Notes

### Stratégie de Déploiement

**Phase 1**: Implémenter la détection automatique et les configurations par défaut
**Phase 2**: Créer les ressources MCP unifiées
**Phase 3**: Valider avec des benchmarks réels
**Phase 4**: Documenter et publier

### Métriques de Succès

- **Changes Tours**: < 150K tokens, < 3s, 97% de réduction vs baseline
- **Project Tours**: < 400K tokens, < 4s, 92% de réduction vs baseline
- **Détection**: 100% de précision dans le choix de l'approche
- **Rétro-compatibilité**: 0 régressions sur les fonctionnalités existantes

### Relations avec Spec #92

Cette spec **implémente la stratégie d'utilisation** définie dans Spec #92 :
- **C** = Solution optimale pour Changes Tours (97% de réduction)
- **D** = Solution bonne pour Project Tours (92% de réduction)

Elle ne remplace pas les approches existantes mais **automatise leur sélection** selon le contexte.

---

*Document généré le 11 novembre 2026*
