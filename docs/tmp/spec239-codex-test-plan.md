# Plan de test manuel — spec #239 (interface CLI CodeTour : Pi & Copilot CLI)

> Document destiné à un agent testeur (Codex ou humain). Tout ce qui suit est à exécuter
> EFFECTIVEMENT dans un vrai terminal pour les tests d'interaction — les suites automatisées
> restent in-process. Cocher `[ ]` → `[x]` au fur et à mesure, noter les écarts.

## 0. Contexte d'exécution

| Élément | Valeur |
| --- | --- |
| Workspace | `/Users/dhuyet/Documents/POC/codetour` |
| Branche à tester | `spec-239-cli-reader-pi-copilot` |
| Tip attendu | `8e355a4` (history : `45c7302` = fixes code-review spec-239, puis `8e355a4` ADRs/docs) |
| Ticket tracker | #239 (spec) + #240–#244 — tous fermés ; vérifier : `gh issue list --repo maurice30120/codetour --state open` ne doit les lister aucun |
| Tour de test | `.tours/lecture-navigation-2026.tour` (15 étapes, contient un diagramme Mermaid) |
| Ne PAS tester / hors périmètre | push, publication, format `.tour`, MCP server, génération, Codex/OpenCode/Claude Code en Playback Surface |

## 0-bis. Surfaces touchées par la branche — comment les lancer

| Surface (fichiers touchés) | Comment lancer |
| --- | --- |
| CLI terminal (lecteur + handoff + open-in-vscode) : `src/cli/index.ts`, `src/cli/reader/*`, `src/cli/terminal.ts`, `src/cli/ttyHandoff.ts`, `src/cli/{openInVscode,internalOpenVscode}.ts` | build puis `npm run cli -- "<titre du Tour>"` (ou `npm run cli -- --internal-tour .tours/lecture-navigation-2026.tour`) dans le terminal courant |
| Extension VS Code (réception URI, joueur) : `src/extension.ts` (URIHandler, inchangé), `src/desktopIntegration.ts` | Dev : `code --extensionDevelopmentPath="$PWD"` puis recharger ; Prod : `npm run package` puis installer le VSIX produit — ou directement `scripts/install-local.sh` (étape 1–2) |
| Plugin Pi : `packages/pi-plugin/*`, `src/cli/piPlugin.test.ts` | `scripts/install-local.sh` (installe la stack complète : VSIX + CLI npm-link + `codetour --install` qui pose plugin/guard/launcher.json Pi et Copilot quand l'hôte existe), puis ouvrir `pi` dans un projet et lancer `/codetour generate` |
| Plugin Copilot CLI : `src/cli/{copilot-plugin,copilot-extension}.generated.ts`, `src/cli/agentIntegrations.ts` | même `scripts/install-local.sh`, puis une session `copilot` avec `/codetour generate` |
| Suites de tests (in-process uniquement) | `npx tsc -p tsconfig.test.json && node --test dist/test/cli/…` et `test/*.test.mjs` cités en section 1 |

## 0-ter. Rôle du testeur — review de code + tests + lancement des apps

Le testeur n'invente rien : il (1) relit le diff, (2) lance les suites automatisées, (3) lance chaque surface pour de vrai. Ordre conseillé :

1. **Review de code d'abord** (lecture seule) :
   - `git log 7b5f028..HEAD --oneline` puis, ticket par ticket, `git show <sha> --stat` : vérifier que chaque commit ne touche que son périmètre (AUCUN des commits spec-239 ne touche `packages/knowledge`, `packages/mcp-server`, le format `.tour` — sauf `b823700`/`8e355a4` qui appartiennent au travail parallèle spec-232/233 hérité sur la branche).
   - Refuser (blocant) : un nouveau seam hors view model ; une duplication de la logique d'ouverture ou d'URI ; du comportement lecture dans `terminal.ts` ; une invocation `code <chemin>` aveugle ; du résumé textuel substituant le lecteur (Pi comme Copilot).
   - Standards : `docs/adr/0025/0027/0028/0029` respectés ; vocabulaire `CONTEXT.md`/`GLOSSARY.md` partout (`Tour Step`, `Step Narration`, `Tour Step Conversation`, `Playback Surface`…) ; tests = assertions sur le view model, jamais PTY/VT.
2. **Suites automatisées** (section 1) — tout doit être vert AVANT de lancer les apps.
3. **Lancer les surfaces réelles** (sections 2–8), une par une, dans un vrai terminal.

## 1. Suites automatisées (prérequis, doivent être vertes)

- [ ] Build : `npx tsc -p tsconfig.test.json` (compile `dist/`), puis typecheck `npx tsc -p tsconfig.test.json --noEmit` → 0 erreur.
- [ ] Suite lecteur : `node --test --test-concurrency=1 dist/test/cli/reader/*.test.js` → 81/81 (dont `endToEndPlayback` : Tour réel, Mermaid, diff, image, narration, conversation ancrée à l'étape).
- [ ] Handoff & open-in-vscode : `node --test dist/test/cli/ttyHandoff.test.js dist/test/cli/internalOpenVscode.test.js dist/test/cli/openInVscode.test.js dist/test/cli/piPlugin.test.js` → tous verts (13 = décision VS Code, 9 = open in-reader, handoff…) ; total attendu avec pi-extension/pi-reader-proposal : 135 pass / 0 fail :
      `node --test --test-concurrency=1 dist/test/cli/ttyHandoff.test.js dist/test/cli/internalOpenVscode.test.js dist/test/cli/openInVscode.test.js dist/test/cli/piPlugin.test.js dist/test/cli/reader/*.test.js test/pi-extension.test.mjs test/pi-reader-proposal.test.mjs`
- [ ] (Rappel) les 4 échecs `test/pre-commit-hook.test.mjs` observés pendant le review venaient du travail knowledge non commité (maintenant committé en `8e355a4`) — à re-vérifier, hors périmètre 239 si toujours rouge.

## 2. T2 (#241) — lecture de bout en bout dans le terminal courant

Tout se joue DANS le terminal de la session — jamais une fenêtre de terminal indépendante.

- [ ] Ouvrir le Tour via le CLI livré (lecture = défaut) : vérifier qu'il s'ouvre sans fenêtre séparée (alt-screen pris : le scrollback d'avant est conservé à la sortie).
- [ ] `←`/`→` (ou équivalents) : navigation étape par étape, bornes bloquées (pas de crash au premier/dernier Step).
- [ ] Chaque Step : description rendue, reference de code visible, Step de diff affiche section `@@` + lignes `+`/`-` réelles, Mermaid dessiné (pas de code brut `graph TD`), image portée par la description visible.
- [ ] Quitter : écran restauré exactement (ADR 0025), pas de résidu de rendu.
- [ ] Redimensionner la fenêtre pendant la lecture → re-render, position de scroll préservée (clampée), la narration NE repart PAS (ADR 0029 : re-render ≠ narration).
- [ ] Échec de rendu d'un Step (provoquer, ex. référence de fichier manquante) → écran précédent restauré + diagnostic imprimé après restauration, jamais d'écran noir.

## 3. Narration (ADR 0029 — policy dans le module de lecture)

- [ ] Voix OFF par défaut à l'ouverture.
- [ ] `v` seul (non modifié) : toggle voix ON → la Step affichée est narrée ; ` Ctrl+v` et `⌥v` etc. ne déclenchent PAS le toggle.
- [ ] Nouvelle touche de navigation pendant la parole → la voix est COUPÉE immédiatement (cut at keypress).
- [ ] La voix ne narre que la Step effectivement affichée (commit only displayed Step) : naviguer vite ×2 → aucune narration de la Step intermédiaire.
- [ ] Une re-render seule (resize) ne déclenche aucune narration.
- [ ] Status line : précédence FIXE — voix (ok/off) en premier, puis avertissement de voix (coupe/pending), puis fournisseur conversation, PUIS compteur d'échanges, et l'avertissement open-in-VS Code en DERNIER si présent.

## 4. Conversation (Tour Step Conversation)

- [ ] Poser une question sur l'étape affichée (mode « demander », capture clavier) → réponse streamée en direct dans le panneau, activité d'outils visible, échange rejoué dans le panneau après coup.
- [ ] Demander explicitement un RÉSUMÉ du Tour entier → accepté en conversation MAIS ne remplace jamais la lecture (le stub de test l'épingle : ancrage uniquement à l'étape).
- [ ] Faire échouer une réponse (agent indisponible) → état d'erreur visible dans l'échange, panneau utilisable à nouveau.
- [ ] SANS agent ACP installé : le panneau + composeur affichent le même guidage et la liste de suggestions d'étapes.

## 5. T1/#240 — contrat view model (vérification code, pas terminal)

- [x] `src/cli/reader/reader.ts` : interface `TourReader` unique ; aucune fonction du module n'importe le DOM, le terminal ou un process.
- [ ] `src/cli/terminal.ts` : TermDOM = adaptateur paint-only (CSS/palette, alt-screen, clavier, resize debouncé, extents) — aucune décision de lecture.
- [x] Aucun test lecteur n'utilise de pseudo-terminal ni de décodage VT (recherche `node-pty` et appel `script(` dans les tests de `src/cli/reader/` ; inspection du test end-to-end).

## 6. T3 (#242) — plugin Pi : fin de génération

- [ ] Générer un Tour via le plugin Pi (`/codetour generate` réel ou skill `codetour-generate`) → à la fin, UNE question à deux choix exactement : **Terminal** (« the real interactive reader ») / **VS Code** (« the Tour at the active step »).
- [ ] Choix **Terminal** → le lecteur RÉEL s'ouvre IMMÉDIATEMENT dans le même terminal (via le launcher du `launcher.json` du plugin, pas un `codetour` du PATH périmé) ; attendre la sortie puis rendre la main à la session.
- [ ] Choix **VS Code** → `codetour --internal-open-vscode <chemin>` réellement exécuté (voir section 8).
- [ ] AUCUN des deux chemins ne produit un résumé textuel des étapes à la place du lecteur.
- [ ] Tour sans titre → la question/basename se rabat proprement ; sans Tour généré → pas de question.

## 7. T4 (#243) — handoff TTY Copilot CLI (expérimental)

- [ ] Dans une session Copilot CLI réelle, exécuter `codetour --experimental-tty-handoff <chemin.tour> [--workspace-root <racine>]` → le TTY de la session est remis au lecteur (même terminal), le Tour se lit réellement, puis le prompt Copilot reprend la main proprement.
- [ ] Flag nu sans valeur : `--experimental-tty-handoff` SANS argument ne doit PAS produire `TypeError: boolean true is not iterable` (fix F1 — régression du review). Il doit soit refuser proprement, soit dériver le Tour de la session.
- [x] TTY absent / non interactif → comportement défini et message clair, pas de crash.
- [x] Le flag n'est JAMAIS propagé aux arguments de l'enfant spawné (l'enfant ne tourne que `--internal-tour <tour> [root]`).
- [x] `docs/adr/0051-hand-off-the-terminal-from-a-copilot-session-to-the-codetour-reader.md` : la limitation « pas de panneau interactif dans l'API d'extension Copilot » est documentée (section « Evidence ») et le retrait du launcher Copilot y est marqué bloqué.
- [x] Double numérotation ADR résolue : le handoff est `0051-hand-off-…` et aucune citation de `0050-hand-off-…` ne subsiste (recherche dans `docs/`, `src/`, `packages/`, `test/`).

## 8. T5 (#244) — Ouvrir dans VS Code à l'étape active

- [ ] `codetour --internal-open-vscode <chemin.tour> --workspace-root <racine>` avec VS Code ouvert sur le workspace → RÉUTILISATION de la fenêtre existante (pas de doublon) ; joueur VS Code ouvert à l'étape active du Tour.
- [ ] VS Code fermé sur ce workspace → nouvelle fenêtre ouverte, puis Tour à l'étape active.
- [x] VS Code non installé/joignable → comportement défini (limitation énoncée clairement, pas de crash muet).
- [ ] Plusieurs fenêtres VS Code ouvertes sur le workspace → comportement défini et documenté (ADR `0047-open-tour-in-vs-code-over-the-extension-uri-contract.md`).
- [ ] URI contract cohérent : `vscode://maurice30120.codetour/openTour?tour=<chemin relatif encodé>&step=<n 1-based>` ; l'étape 0-based du view model arrive bien décalée d'un.
- [ ] Dans le lecteur terminal : la touche `o` déclenche la même ouverture ; en mode « demander », `o` est saisi comme du texte ; si VS Code est injoignable → avertissement non bloquant en status line (en dernière position, voir section 3).
- [ ] Chemins canoniques : trailing `/`, symlinks, `.`/`..` → résolution canonique, aucune double fenêtre à répétition.

## 9. Lancement des apps — checklists par surface

### 9.1 CLI terminal (T2)

```sh
npx tsc -p tsconfig.test.json   # build dist
npm run cli -- "Lecture Navigation 2026"      # lecture = défaut, même terminal
npm run cli -- --internal-tour .tours/lecture-navigation-2026.tour
```

- Vérifier qu'aucune fenêtre indépendante ne s'ouvre (up : alt-screen, restauration à la sortie).
- Puis dérouler les sections 2, 3, 4 IN-TERMINAL.

### 9.2 Extension VS Code (T5) — acceptation de l'URI

```sh
code --extensionDevelopmentPath="$PWD" .   # ou npm run package && installer le .vsix
# dans un AUTRE terminal, rejouer le contrat :
open "vscode://maurice30120.codetour/openTour?tour=.tours%2Flecture-navigation-2026.tour&step=3"
```

- Le joueur VS Code s'ouvre sur le Tour à l'étape 3 (contrat 1-based, section 8).
- Fermé sur ce workspace → nouvelle fenêtre ; déjà ouvert → réutilisation, pas de doublon.

### 9.3 Plugin Pi (T3)

```sh
scripts/install-local.sh        # build VSIX + npm link CLI + codetour --install (Pi + Copilot si présents)
cd <un projet quelconque> && pi  # puis /codetour generate
```

- Fin de génération → question **Terminal / VS Code** exactement (section 6).
- Choix Terminal → lecteur réel immédiat dans le même terminal, via le launcher du `launcher.json` du plugin ; main rendue à Pi après la lecture.

### 9.4 Plugin Copilot CLI (T4, expérimental)

```sh
copilot                          # session réelle
codetour --experimental-tty-handoff .tours/lecture-navigation-2026.tour
```

- Même terminal : TTY remis au lecteur puis rendu à Copilot (section 7, y compris le flag nu sans valeur — régression F1).

## 10. Clôture

- [ ] `gh issue list --repo maurice30120/codetour --state open` : #239–#244 toutes absentes.
- [ ] Rappeler : aucun push n'a été fait — la branche reste locale ; le merge/push revient au mainteneur.
- [ ] Rédiger un court compte-rendu pass/fail par section, avec SHA du tip testé et commandes réellement exécutées.

### État des essais au 20 novembre 2026, 09:36 CET

- Tip observé : `0532d1317e285e3733314fea3c8f06322c41e363` ; des modifications locales non commitées sont présentes.
- Section 1 : la compilation et le typecheck racine passent ; la suite combinée lecteur/handoff/Pi passe (135 tests) et le hook passe (5 tests), après correction locale d'attentes Knowledge périmées.
- Sections 2–4 : le lecteur réel a été démarré dans un terminal pseudo-TTY, avec voix désactivée au départ, puis quitté avec `q`. Le rendu visuel, la navigation complète, la narration et la conversation restent à vérifier interactivement.
- Sections 6–8 : les tests automatisés passent et le flag de handoff sans argument refuse proprement. Les parcours réels Pi, Copilot et VS Code restent à vérifier. L'accès automatisé à Ghostty a été refusé ; la fenêtre VS Code visible appartenait à un autre workspace et n'a pas été manipulée.
- Aucun push ni publication effectués pendant ces essais. Les cases ci-dessus restent ouvertes tant que leurs critères complets ne sont pas établis.
- Contrôles complémentaires : les commits de la spec #239 ont été inspectés avec `git show --stat` ; `reader.ts` expose `TourReader` sans import DOM/process, les tests lecteur ne contiennent pas de PTY ; `node dist/cli.js --experimental-tty-handoff .tours/lecture-navigation-2026.tour` sans TTY donne un message explicite et ne plante pas. Le code de handoff ne transmet que `--internal-tour` et ses arguments à l'enfant.
- Pi : l'accès à son verrou habituel nécessitait une autorisation hors bac à sable. Une session Pi isolée, hors ligne et sans persistance, a ensuite chargé l'extension et affiché le choix Project/Changes pour `/codetour` ; la génération complète et le dialogue final restent à essayer.
- Écart découvert par revue : le choix final VS Code affichait seulement une commande. Correction locale : exécution du lanceur géré, et avertissement avec commande manuelle en cas d'échec. `node --test test/pi-extension.test.mjs test/pi-reader-proposal.test.mjs` : 26 réussites ; `node --test dist/test/cli/piPlugin.test.js` : 7 réussites ; build et typecheck verts. L'ouverture réelle dans VS Code reste à vérifier.
- Complément : un test utilise une copie installée du plugin et son `launcher.json`, avec espaces dans les chemins ; les 27 tests Pi ciblés passent. Les instructions de génération distinguent désormais l'offre automatique du plugin d'une invocation sans `runId` ; la copie embarquée est synchronisée et ses 7 tests passent.
- CLI réellement lancé avec un `PATH` sans `code` : sortie 1 et diagnostic explicite `Visual Studio Code is not reachable`. La fenêtre VS Code accessible appartenait à `talowin` et n'a pas été manipulée.
- Problème relevé dans la décision d'ouverture : `workspaceStorage/.../workspace.json` persistait après fermeture mais était assimilé à une fenêtre active. Correction locale appliquée : la détection a été retirée, le CLI demande systématiquement à VS Code d'ouvrir le workspace avant l'URI, et l'URI porte un paramètre `workspace` canonique que l'extension vérifie avant d'ouvrir (refus visible si l'URI arrive dans un autre workspace ; les liens historiques sans paramètre gardent leur comportement). La revue a aussi relevé qu'un identifiant de Tour déjà décodé pouvant contenir `#`, `?` ou `%` était réinterprété comme une URI : corrigé, avec un test dédié. La canonicalisation des chemins est désormais partagée par le CLI et l'extension (`src/core/workspacePath.ts`). Vérifié : `node --test dist/test/extensionUri.test.js dist/test/cli/openInVscode.test.js dist/test/cli/internalOpenVscode.test.js` → 16/16, `npm test` → vert. Le délai fixe et le routage de l'URI ne garantissent toujours pas la bonne fenêtre ni la disponibilité de l'extension ; l'ouverture réelle dans VS Code et la réutilisation des fenêtres restent à valider.
- Reprise du 20 novembre 2026 (poursuite après limite d'usage) : la correction de l'ouverture VS Code a été terminée. `#`/`?`/`%` d'un identifiant de Tour décodé ne sont plus réinterprétés comme délimiteurs d'URI ; la canonicalisation des chemins est partagée par le CLI et l'extension (`src/core/workspacePath.ts`) au lieu d'être dupliquée ; les messages d'erreur de l'extension suivent la convention locale. Commits : `37f9dbd` (#233), `019cecc` (Pi), `a74f168` (ouverture VS Code), `2951813` (dates du hook Copilot). Suites : `node --test dist/test/extensionUri.test.js dist/test/cli/openInVscode.test.js dist/test/cli/internalOpenVscode.test.js` → 16/16 ; `npm test` complet → vert (137 tests finaux, 0 échec sur toutes les phases). Rien n'a été poussé.
- Toujours non vérifié : les sections 2, 3 et 4 (rendu, navigation, narration, conversation du lecteur réel), les sections 6 à 8 dans les applications réelles (Pi, Copilot, VS Code) et la réutilisation effective des fenêtres VS Code. La fenêtre VS Code visible appartient à un autre projet et n'a pas été manipulée.
