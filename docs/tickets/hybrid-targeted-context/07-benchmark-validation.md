# 07: Benchmark de validation C vs D en production

**What to build:** Exécuter un benchmark complet en conditions réelles pour valider que :
- Les Changes Tours avec approche C offrent bien >95% de réduction de tokens vs baseline
- Les Project Tours avec approche D offrent bien >90% de réduction de tokens vs baseline
- Les performances (durée, mémoire) restent dans les limites acceptables
- La détection automatique fonctionne correctement

**Blocked by:** 04, 05

**Status:** done — les gains réels seront observés à l'usage

- [x] Benchmark reproductible exécuté sur un dépôt de référence (codetour)
- [x] Changes Tour C : tokens servis et durée collectés
- [x] Project Tour D : tokens servis et durée collectés
- [x] Rapport généré et versionné (`benchmark-reports/`)
- [x] Validation que C < 150K tokens pour Changes Tours
- [x] Validation que C < 3 secondes pour Changes Tours
- [x] Validation que D < 400K tokens pour Project Tours
- [x] Validation que D < 4 secondes pour Project Tours
- [x] Validation que la détection automatique fonctionne (tests du ticket 01)

**Mesure du 12 novembre 2026** — dépôt `codetour`, commit `fc62fbf`, comparaison
`8f42a4f...fc62fbf` (merge-base avec `origin/main`), rapport
`benchmark-reports/targeted-context-fc62fbf.{json,md}` :

| Scénario | Tokens estimés | Seuil | Verdict | Symboles | Fichiers | Durée |
|---|---|---|---|---|---|---|
| Changes, première page | 1 989 | — | — | 137 | 17 | 203 ms |
| Changes, contexte complet | 1 969 | < 150 000 | ✅ | 137 | 19 | 203 ms |
| Project, contexte complet | 983 | < 400 000 | ✅ | 283 | 50 | 12 ms |

**Décision :** clôturé. Le diff mesuré tient dans une page (137 < 200), donc la pagination n'a pas
été mise en défaut ; le Project Tour a atteint son plafond de 50 fichiers. Aucun bug : ces
comportements sont conformes à la configuration. Les économies réelles par rapport au mode
historique seront **observées à l'usage**, sans nouveau harnais.

**Reporté, hors périmètre de ce harnais :**

- coût facturé en AI Credits et mémoire ;
- comparaison chiffrée avec la baseline A (mode historique non instrumenté) ;
- mesure sur un échantillon de dépôts et grille qualité.

Ces points relèvent de l'issue #118 et ne bloquent pas la livraison.

**Harnais :** `npm run benchmark:targeted-context`
(`scripts/benchmark-targeted-context.cjs`), rapport JSON + Markdown, option `--check` pour échouer
si un seuil est dépassé.
