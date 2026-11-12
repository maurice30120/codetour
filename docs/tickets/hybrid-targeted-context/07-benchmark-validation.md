# 07: Benchmark de validation C vs D en production

**What to build:** Exécuter un benchmark complet en conditions réelles pour valider que :
- Les Changes Tours avec approche C offrent bien >95% de réduction de tokens vs baseline
- Les Project Tours avec approche D offrent bien >90% de réduction de tokens vs baseline
- Les performances (durée, mémoire) restent dans les limites acceptables
- La détection automatique fonctionne correctement

**Blocked by:** 04, 05

**Status:** not-started

- [ ] Benchmark exécuté sur un échantillon représentatif de repositories
- [ ] Changes Tours testés avec approche C : métriques collectées (tokens, coût, durée, mémoire)
- [ ] Project Tours testés avec approche D : métriques collectées (tokens, coût, durée, mémoire)
- [ ] Comparaison avec le baseline (approche A) pour validation des gains
- [ ] Rapport de benchmark généré et versionné
- [ ] Validation que C < 150K tokens pour Changes Tours
- [ ] Validation que C < 3 secondes pour Changes Tours
- [ ] Validation que D < 400K tokens pour Project Tours
- [ ] Validation que D < 4 secondes pour Project Tours
- [ ] Validation que la détection automatique (ticket 01) fonctionne à 100%

**Avertissement :** aucun rapport n'existe. L'ancien script de benchmark (`scripts/run-benchmark.*`)
et le runner (`benchmark-runner.ts`) produisaient des métriques simulées ; ils ont été supprimés.
Les chiffres « 97% » et « 92% » qui circulent dans la spec et la décision sont des estimations,
pas des mesures.
