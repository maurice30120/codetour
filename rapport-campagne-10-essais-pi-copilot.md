# Campagne 10 essais — CodeTour × TokenEconomizer (Pi et Copilot)

But : cinq essais par agent (projet, projet avec mémoire, changements, changements avec mémoire,
mécanisme ciblé), un contrôle après chaque Tour, suppression du Tour et de son journal après
relevé. Les comparaisons 1–2 et 3–4 sont indicatives : une exécution par configuration, et l'état
de la mémoire peut changer entre deux sessions.

État : préparation terminée (installation, vérifications, relevé de référence). Aucun essai de la
campagne n'est encore lancé ; les décisions listées en fin de fiche de préparation sont en attente.

## 1. État de référence — 2026-11-25 19:20 CET

| Élément | Valeur |
| --- | --- |
| CodeTour HEAD | `cdcab992df9304a4eaaf9495ff0a1bde685cf55c` (branche `spec-314-integration`) |
| CodeTour arbre de travail | 21 entrées modifiées/non suivies ; diff `bf4f533e6af3`, non-suivis `5bc5a1450aa4` |
| TokenEconomizer HEAD | `3c13f437141c0a9a8500bf0a19c357fed687c9af` (branche `knowledge-relevance-integration`) |
| TokenEconomizer arbre | un fichier non suivi : `.scratch/knowledge-relevance/follow-up.md` |
| Pointeur de sous-module | `3c13f437141c0a9a8500bf0a19c357fed687c9af` (aligné sur TE) |
| Versions | CodeTour 0.1.2, TokenEconomizer 0.1.0, Pi 1.6.0, Copilot CLI 1.0.114 |
| Outils | Node v24.18.0, npm 12.0.1, Python 3.14.5, git 2.56.1 |

Le pointeur annoncé (CodeTour `8cd0603` → TE `fe8041a`) est le commit **précédent** : le HEAD
actuel est `cdcab99` → `3c13f43`, avec en plus les modifications non commitées des plugins
(références `anchors.md` et `mermaid.md`, hooks, tests). Les SHA seuls ne décrivent donc pas
l'arbre réellement testé ; c'est le couple SHA + `diff-hash` + `untracked-hash` ci-dessus qui le
décrit.

## 2. Installation et vérifications

- `./install-local.sh` : `Installation complete.` Les deux intégrations CodeTour étaient déjà
  installées (`already-installed`) mais les fichiers installés sont bien ceux de l'arbre courant :
  parité SHA-256 vérifiée pour `SKILL.md` et les références (`anchors.md`, `mermaid.md`,
  `codetour-adaptation.md`) entre `packages/pi-plugin` et `~/.pi/agent/packages/codetour-plugin`,
  et entre `packages/copilot-plugin` et
  `~/.copilot/installed-plugins/_direct/codetour-plugin-G2mhhg-bd37a2e1`.
- Tree-sitter : `get_parser("python")` répond sans traceback dans le venv.
- `node codetour/dist/cli.js --agents` : `copilot`, `pi`, `vscode` en `installed`.
- `--doctor` : aucune erreur ; seule remarque, une déclaration MCP `codetour` résiduelle dans
  Codex, hors périmètre du parcours sans MCP.
- Pi : une seule entrée par plugin (CodeTour en paquet local, TokenEconomizer local). Pas de
  doublon git.
- Copilot : plugin `codetour` 0.1.2 installé ; `tokeneconomizer` 0.1.0 `source: live` avec
  `installedFrom` sur le checkout local.
- Réglages TE actifs pour la campagne (`te config show`) : `microskills=off`, `knowledge=false`
  au niveau enregistré — les mémoires sont donc activées **par session** avec
  `launch-local.sh --memory=off|both`. Budgets : 4 faits et 150 tokens pour le bloc injecté ;
  4 cartes Knowledge et 300 tokens, dont 50 % au démarrage ; proposition toutes les 3 sessions.
- Mémoire disponible dans ce dépôt : 8 faits suivis, dont 5 `ACTIVE` franchissant la porte
  (`dist-cli-entrypoint`, `invalid-proposal-refusal`, `nvm-node-24`, `repo-layout-src-packages`,
  `tour-generation-validation-package`), 2 `RETIRED`, 1 `ACTIVE` à 0/5 ; aucune carte Knowledge
  dans les captures du dépôt. Les catalogues sont conservés, sauf décision contraire.

## 3. Tours et journaux à supprimer

Aucun fichier `.tour` ne subsiste dans les deux dépôts ni dans leurs racines `.tours` : les essais
du 25 novembre ont déjà supprimé les leurs. Les fichiers `.tour` trouvés ailleurs sur la machine
(`/private/tmp/…`, `k3s-cameleon`, anciens worktrees) ne concernent pas cette campagne.

Journaux et données restants :

| Chemin | Taille | Suivi par git |
| --- | --- | --- |
| `codetour/.tours/` (dont `.log/` de la campagne recherche du 17–18 nov.) | 82 Mo | `.log/` et `config.json` ignorés ; `codetour-research` et `research-reports/*.md` suivis |
| `codetour/src/.tours/` | 1,3 Mo | `config.json` et `.log/research.log` suivis |
| `codetour/.scratch/spec219-b-model/**/.tours` | ≈ 22 Mo | ignoré (`.scratch/`) |

## 4. Protocole retenu

Lancement uniquement via `./launch-local.sh`, depuis `codetour/`, pour que les plugins résolvent
la racine Git et le Python isolé.

| Essai | Agent | Mémoire | Commande | Demande |
| --- | --- | --- | --- | --- |
| P1 / C1 | Pi / Copilot | désactivée | `--memory=off` | Project Tour (demande figée) |
| P2 / C2 | Pi / Copilot | micro-skills + Knowledge | `--memory=both` | même demande que P1/C1 |
| P3 / C3 | Pi / Copilot | désactivée | `--memory=off` | Changes Tour `origin/main..HEAD` |
| P4 / C4 | Pi / Copilot | micro-skills + Knowledge | `--memory=both` | même demande que P3/C3 |
| P5 / C5 | Pi / Copilot | micro-skills + Knowledge | `--memory=both` | mécanisme de validation/refus d'une proposition |

Modèles : Pi `mistral/deepseek-v4-1-flash-1017`. Copilot : fixé à choisir (`auto` actuellement).

Après chaque essai : contrôle du Tour (création, lisibilité `codetour` CLI, pertinence par
relecture ciblée), relevé des tokens (hook de fin, transcription JSONL, ledger TE), durée, appels
d'outils et fichiers lus, micro-skills et Knowledge injectées (journal TE : événement `inject`,
`injected_chars`, `injected_ids`), puis suppression du Tour et de son journal.

## 5. Décisions en attente

1. Supprimer aussi les journaux ignorés des 17–18 novembre (≈ 105 Mo avec `.scratch`), ou
   seulement ce qui est propre à la campagne en cours ? Supprimer `codetour/src/.tours/.log/research.log`
   modifierait un fichier suivi par git.
2. Modèle Copilot à figer (`claude-sonnet-5.5` proposé, les autres récents étant
   `claude-haiku-5.5` et `claude-opus-5.5`).
3. Conserver les catalogues de mémoire (5 faits injectables) ou repartir mémoire vide.
