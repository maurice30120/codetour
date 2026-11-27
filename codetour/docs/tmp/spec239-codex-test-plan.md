# Plan de test manuel — spec #239 (interface CLI CodeTour : Pi & Copilot CLI)

> **Statut : les suites et la revue de code sont faites. Il reste à lancer les applications réelles.**
> Tout ce qui suit s'exécute dans un vrai terminal — les suites automatisées sont in-process.
> Cocher `[ ]` → `[x]`, noter les écarts.

| Élément | Valeur |
| --- | --- |
| Workspace | `/Users/dhuyet/Documents/POC/codetour` |
| Branche | `spec-239-cli-reader-pi-copilot` (poussée sur `origin`) |
| Tip testé | `85c8a27` |
| Tour de test | `.tours/lecture-navigation-2026.tour` (15 étapes, diagramme Mermaid) |
| Suites | `npm test` vert (toutes phases, 137 tests finaux) |
| Hors périmètre | push, merge, publication, format `.tour`, benchmarks |

## 1. Lancer les surfaces

```sh
npm run build                                                    # dist/ + vendor
npm run cli -- "Lecture Navigation 2026"                         # lecteur terminal (défaut)
npm run cli -- --internal-tour .tours/lecture-navigation-2026.tour
node dist/cli.js --internal-open-vscode .tours/lecture-navigation-2026.tour "$PWD"
code --extensionDevelopmentPath="$PWD" .                        # hôte de dev VS Code
scripts/install-local.sh                                         # VSIX + CLI + plugins Pi/Copilot
```

## 2. Lecteur terminal (T2/#241) — à faire

Dans le terminal courant, jamais dans une fenêtre séparée.

- [ ] Ouverture sans fenêtre indépendante ; à la sortie, le scrollback est restauré exactement (ADR 0025).
- [ ] Navigation `←`/`→` : bornes bloquées au premier et au dernier Step, pas de crash.
- [ ] Chaque Step : description rendue, référence de code visible, diff affichant les vraies lignes
      `+`/`-` et la section `@@`, Mermaid dessiné (pas de `graph TD` brut), image visible.
- [ ] Redimensionnement pendant la lecture : re-render, scroll conservé et clampé, la narration ne
      repart pas (ADR 0029).
- [ ] Échec de rendu sur un Step (référence de fichier manquante) : écran précédent restauré,
      diagnostic imprimé après restauration, jamais d'écran noir.

## 3. Narration (ADR 0029) — à faire

- [ ] Voix OFF par défaut à l'ouverture.
- [ ] `v` seul bascule la voix et narre la Step affichée ; `Ctrl+v`, `⌥v` ne déclenchent rien.
- [ ] Navigation pendant la parole : la voix est coupée immédiatement.
- [ ] Navigation rapide ×2 : seule la Step effectivement affichée est narrée.
- [ ] Status line : voix, puis avertissement de voix, puis fournisseur de conversation, puis compteur
      d'échanges, puis — en dernier — l'avertissement open-in-VS Code.

## 4. Conversation (Tour Step Conversation) — à faire

- [ ] Question sur la Step affichée en mode « demander » : réponse streamée en direct, activité d'outils
      visible, échange rejoué après coup.
- [ ] Demande de résumé du Tour entier : acceptée en conversation, ne remplace jamais la lecture.
- [ ] Agent indisponible : état d'erreur visible dans l'échange, panneau utilisable ensuite.
- [ ] Sans agent ACP installé : guidage identique dans le panneau et le composeur, avec suggestions.

## 5. Plugin Pi (T3/#242) — à faire

`scripts/install-local.sh`, puis `pi` dans un projet et `/codetour generate`.

- [ ] Fin de génération : **une** question, exactement **Terminal** / **VS Code**.
- [ ] Choix **Terminal** : le lecteur réel s'ouvre immédiatement dans le même terminal, via le
      `launcher.json` du plugin (pas un `codetour` du PATH), puis la main revient à Pi.
- [ ] Choix **VS Code** : le lanceur géré exécute `--internal-open-vscode` et le Tour s'ouvre à
      l'étape active ; en cas d'échec, message + commande manuelle.
- [ ] Aucun des deux chemins ne produit de résumé textuel à la place du lecteur.
- [ ] Tour sans titre → repli propre sur le basename ; sans Tour généré → pas de question.

## 6. Handoff TTY Copilot CLI (T4/#243, expérimental) — à faire

- [ ] Session Copilot réelle : `codetour --experimental-tty-handoff .tours/lecture-navigation-2026.tour`
      → le TTY passe au lecteur, le Tour se lit, le prompt Copilot reprend proprement.

## 7. Ouverture VS Code (T5/#244) — à faire

- [ ] Workspace déjà ouvert : réutilisation de la fenêtre (pas de doublon), joueur à l'étape active.
- [ ] Workspace fermé : ouverture de la fenêtre, puis Tour à l'étape active.
- [ ] Plusieurs fenêtres sur le workspace : comportement observé et cohérent avec l'amendement d'ADR 0047.
- [ ] URI reçue par une fenêtre d'un **autre** workspace : erreur visible, aucun Tour homonyme ouvert.
- [ ] Dans le lecteur, `o` déclenche la même ouverture ; en mode « demander », `o` est saisi comme texte.

> Limite assumée (ADR 0047) : `code --open-url` est routé par VS Code vers sa fenêtre active ; le CLI
> ouvre d'abord le workspace, mais ni la réutilisation graphique ni la disponibilité de l'extension
> après le délai de 2 s ne sont garanties par les tests. C'est précisément ce que ces quatre cases
> doivent trancher.

## 8. Clôture

- [ ] `gh issue list --repo maurice30120/codetour --state open` : #239–#244 absentes
      (#245 « T6 » reste ouverte volontairement, hors plan).
- [ ] Courte synthèse pass/fail par section, avec le SHA du tip et les commandes réellement lancées.

## 9. Déjà vérifié — ne pas rejouer

- Suites automatisées : `npm test` complet vert (`fail 0` sur toutes les phases, 137 tests finaux) ;
  ciblé `extensionUri` + `openInVscode` + `internalOpenVscode` → 16/16 ; Pi 27 ; paquet embarqué 7.
- T1/#240 : `src/cli/reader/reader.ts` expose `TourReader` sans import DOM/process ; aucun test lecteur
  n'utilise de PTY ni de décodage VT ; `terminal.ts` ne décide pas de la lecture (état, touches,
  redimensionnement et extents viennent du reader — revue du 20/11).
- T4/#243 : TTY absent ou non interactif → message explicite ; flag nu sans argument → refus explicite
  (« requires a Tour file path »), sans `TypeError` ; le flag n'est jamais propagé à l'enfant ;
  ADR 0051 documente l'absence de panneau interactif Copilot et le launcher bloqué ; double
  numérotation ADR résolue (0051, aucune citation de `0050-hand-off`).
- T5/#244 : VS Code injoignable → `Visual Studio Code is not reachable` (exit 1) ; contrat d'URI
  (`?tour=<relatif encodé>&step=<1-based>&workspace=<canonique>`) couvert par tests ; chemins canoniques,
  espaces, `#`/`?`/`%` et multi-racines couverts par tests ; l'ouverture réelle reste en §7.
- Pi (automatisé) : la question Terminal/VS Code, le lanceur géré, les chemins avec espaces, le repli
  en cas d'échec, l'annulation sans résumé, la génération complète restant à faire en §5.
- Un écart corrigé en cours de route : le choix VS Code du plugin ne faisait qu'afficher la commande
  (commit `019cecc`).

## 10. Commits de cette passe

`37f9dbd` (#233, syntaxe invalide) · `019cecc` (Pi, choix VS Code exécuté) · `a74f168` (ouverture VS Code) ·
`2951813` (dates du hook Copilot) · `85c8a27` (ce plan).
