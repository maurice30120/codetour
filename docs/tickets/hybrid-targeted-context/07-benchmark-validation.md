# 07: Benchmark de validation C vs D en production

**What to build:** Exécuter un benchmark complet en conditions réelles pour valider que :
- Les Changes Tours avec approche C offrent bien >95% de réduction de tokens vs baseline
- Les Project Tours avec approche D offrent bien >90% de réduction de tokens vs baseline
- Les performances (durée, mémoire) restent dans les limites acceptables
- La détection automatique fonctionne correctement

**Blocked by:** 04, 05

**Status:** partial

- [x] Benchmark reproductible exécuté sur un dépôt de référence (codetour)
- [x] Changes Tour C : tokens servis et durée collectés
- [x] Project Tour D : tokens servis et durée collectés
- [ ] Coût et mémoire collectés (exige l'instrumentation Copilot, hors de ce harnais)
- [ ] Comparaison avec une baseline A exécutable (le mode historique n'est pas instrumenté)
- [x] Rapport généré et versionné (`benchmark-reports/`)
- [x] Validation que C < 150K tokens pour Changes Tours
- [x] Validation que C < 3 secondes pour Changes Tours
- [x] Validation que D < 400K tokens pour Project Tours
- [x] Validation que D < 4 secondes pour Project Tours
- [x] Validation que la détection automatique fonctionne (tests du ticket 01)

**Mesure du 12 novembre 2026** — dépôt `codetour`, commit `94f4d37`, comparaison
`8f42a4f...94f4d37` (merge-base avec `origin/main`), rapport
`benchmark-reports/targeted-context-94f4d37.{json,md}` :

| Scénario | Tokens estimés | Seuil | Verdict | Symboles | Fichiers | Durée |
|---|---|---|---|---|---|---|
| Changes, première page | 1 989 | — | — | 137 | 17 | 208 ms |
| Changes, contexte complet | 1 969 | < 150 000 | ✅ | 137 | 19 | 208 ms |
| Project, contexte complet | 1 220 | < 400 000 | ✅ | 283 | 50 | 16 ms |

**Limites explicites :**

- Les tokens sont des **estimations** (~4 caractères/token) sur le texte réellement servi, pas des
  tokens facturés ni des AI Credits.
- Un seul dépôt et une seule paire de commits : le résultat est reproductible, pas général.
- Sur ce diff, une seule page suffit (137 < 200), donc « première page » n'est pas plus petite que
  le contexte complet. L'économie de pagination n'apparaît que sur un diff dépassant `pageSize`.
- Les cases « coût », « mémoire » et « baseline A » restent ouvertes : elles demandent
  l'instrumentation Copilot décrite dans l'issue #118, pas ce harnais.

**Harnais :** `npm run benchmark:targeted-context`
(`scripts/benchmark-targeted-context.cjs`), rapport JSON + Markdown, option `--check` pour échouer
si un seuil est dépassé.
