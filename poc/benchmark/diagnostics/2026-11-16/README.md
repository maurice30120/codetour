# Archives de diagnostic — 16 novembre 2026

Ces preuves sont copiées de l'ancien poste pour analyse et reprise. [Point de reprise](../../../../docs/specs/spec-174-tickets/REPRISE-2026-11-16.md) et [rétrospective](../../../../docs/retros/retro-spec-174-medium-2026-11-16.md). `inventory.json` contient la provenance, la taille et le SHA-256 des fichiers copiés, calculé avant toute adaptation ; il permet de vérifier que les JSON originaux sont conservés.

| Dossier | Contenu et statut |
|---|---|
| `spec174-test10` | Ancien diagnostic Small : dix traces réelles ; certains « success » sont vides ; ancien comptage Vibe non fiable. Aucun verdict comparatif. |
| `codetour-live-q2-public` | Recherche CodeTour Q2 inspectée dans les sources, hors campagne. |
| `codetour-search-validation*` | Essais de recherche `pg_config`, dont erreurs de références et épuisement de budget ; conserver pour l'analyse des boucles. |
| `codetour-search-numbered` | Recherche avec lectures numérotées, complète techniquement mais références fonctionnelles encore incomplètes. |
| `codetour-search-medium` | Recherche Medium 3.5 avec résultat et vérification manuelle : 5 faits / 12 références, 294 084 tokens. Zéro fonction créée/réutilisée. |
| `spec174-test10-medium-20261116T070334Z` | Premier lot Medium arrêté après deux résultats ; résumé `INVALIDATED_TELEMETRY_GAP`. Q1 Vibe : sous-ensemble par appel 111 462 contre exports fournisseur 447 650. Q2 Vibe interrompu. |
| `spec174-test10-medium-20261116T071100Z` | Lanceur préparé et jamais exécuté ; aucun run. |
| `spec174-vibe-retain-journals-20261116` | Prototype de rétention, scripts et preuves d'échec : app-server introuvable au premier essai, timeout sans export au second. Aucune sentinelle réussie. |
| `*-tests.log`, `codetour-gates-numbered.log` | Derniers contrôles hors ligne de cette session. |

Les lanceurs `.cjs` et wrappers Python sont des archives contenant des chemins `/Users/damien/...` et `/tmp/...`. Les manifestes contiennent également des chemins et identités propres à l'ancien poste. Créer de nouveaux chemins et de nouvelles preuves sur la machine cible. Le prototype de conservation utilise une API interne de Vibe et n'est pas validé pour une campagne.

La clé API et `.env.local` ne sont pas archivés. Les mémoires présentes sont des artefacts de diagnostic ; une reprise de test utilise une mémoire initialement vide. Les dossiers `results-20261116-v2` à `v5` voisins conservent d'autres tentatives de pilote et leurs scripts historiques, dont certains peuvent lancer les 80 ; ils ne sont pas des commandes de reprise recommandées.
