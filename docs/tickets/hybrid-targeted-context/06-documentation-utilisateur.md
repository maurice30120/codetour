# 06: Documentation utilisateur - Quand utiliser C vs D

**What to build:** Documentation claire et complète pour les utilisateurs et agents expliquant :
- **Approche C** : À utiliser pour les **Changes Tours** (revues de PR, analyses de diff) → rapide, économique, focalisé sur les modifications
- **Approche D** : À utiliser pour les **Project Tours** (découverte de projet, onboarding, questions architecturales) → complet, couverture large du codebase
- Tableau comparatif des deux approches (cas d'usage, couverture, limites)
- Exemples d'utilisation pour chaque type de Tour

**Blocked by:** 01, 04, 05

**Status:** partial

- [x] Documentation créée dans `docs/user-guide-hybrid-targeted-context.md`
- [x] Section "Choosing Between Changes Tour and Project Tour" ajoutée
- [ ] Tableau comparatif C vs D avec : coût, durée, couverture, cas d'usage
- [x] Exemples concrets pour Changes Tours (revue de PR)
- [x] Exemples concrets pour Project Tours (onboarding, architecture review)
- [x] Explication des ressources MCP disponibles
- [ ] Documentation validée par l'équipe

**Écarts constatés :**

- Le tableau comparatif annonçait `pageSize: 200`, une option qui n'existe pas dans
  `TargetedContextConfig`. Corrigé : le guide présente désormais la pagination comme un paramètre
  d'URI.
- Les métriques de coût, de durée et de réduction de tokens n'ont jamais été mesurées ; le guide
  les présente maintenant comme des objectifs, pas comme des résultats.
