# Spec #246 — guide de revue et de recette pour Codex

Ce document sert à **relire le code, lancer les tests automatisés et exercer les
surfaces réellement touchées** comme le ferait un testeur. Il couvre la spec
[#246](https://github.com/maurice30120/codetour/issues/246) et ses sept tickets
#247 → #253.

## 1. Où se trouve le travail

| Élément | Valeur |
| --- | --- |
| Branche d'intégration | `spec-246-integration` |
| Worktree à utiliser | `/Users/dhuyet/Documents/POC/codetour-wt/spec246-integration` |
| Branche de base | `spec-239-cli-reader-pi-copilot` (`6c7d79b`, contient le lecteur CLI) |
| Dernier commit de référence | `3019fc8` (merge #253) + commits de revue éventuels |
| Spec (GitHub) | issue #246, copie locale `/Users/dhuyet/Documents/POC/codetour-spec246-notes/spec-246.md` |
| Tickets (critères d'acceptation) | #247–#253, copie locale `/Users/dhuyet/Documents/POC/codetour-spec246-notes/spec-246-tickets.md` |
| Décisions | `docs/adr/0048-select-the-acp-agent-and-model-explicitly.md`, `docs/adr/0049-restrict-pi-tools-through-a-replacement-launcher.md`, ADR 0014 marquée supplantée |
| Vocabulaire | `GLOSSARY.md` (Agent Profile, Agent Availability, Agent Probe, Effective Agent, Effective Model, Agent-Managed Model) |

Tickets implémentés et mergés (un commit de feature + un merge chacun, sauf le
docs initial) :

| Ticket | Sujet | Commit de feature |
| --- | --- | --- |
| #251 | Vocabulaire Agent Profile + chrome anglais | `f0dcb82` |
| #250 | Agent effectif affiché dans les deux surfaces | `505d3ac` |
| #247 | Catalogue versionné, sonde 5 s, disponibilité, sélection automatique | `18d9a34` |
| #249 | Choix manuel de l'agent, refresh, échecs Retry / Change agent | `ad09ffa` |
| #252 | Connexion d'un agent qui le demande (`Sign in`) | `3fa38d7` |
| #248 | Choix du modèle annoncé par l'agent | `d61652b` |
| #253 | Pi derrière un lanceur restreint + smoke test réel | `72f2bfe` |

## 2. Revue de code

Depuis le worktree :

```bash
git log --oneline 6c7d79b..HEAD            # la liste des commits
git diff 6c7d79b...HEAD                    # le patch complet de la spec
git diff 6c7d79b...HEAD --stat             # la carte des fichiers
```

Points d'entrée à relire en priorité :

| Fichier | Ce qu'il porte |
| --- | --- |
| `src/agent/agentCatalogue.ts` | catalogue versionné (rang `Copilot, Vibe, Pi, Codex, Claude Code`), les six états, `AgentSelection` (sonde, cache panneau, sélection collante, mémoire modèle par profil) |
| `src/agent/agentProbe.ts` | sonde bornée 5 s (`initialize` + `session/new`), `ENOENT` → not-installed, code `-32000` → auth-required, timeout → connection-error, session libérée |
| `src/agent/agentAuth.ts` | capacités client annoncées (`fs`, `configOptions`, `_meta["terminal-auth"]`), plan de connexion |
| `src/agent/piReadonlyLauncher.ts` | lanceur Pi versionné, allowlist `read,grep,find,ls`, `--no-mcp`, jamais de repli non restreint |
| `src/agent/acpSession.ts` + `src/agent/acpModelOptions.ts` | options de session, `session/set_config_option`, suivi de `config_option_update`, modèle effectif |
| `src/agent/stepChatContract.ts`, `stepChatAgent.ts`, `fallbackStepChatAgent.ts` | identité (agent + modèle effectifs), sélection courante, pas de bascule silencieuse |
| `src/agent/stepConversations.ts` | l'unique store de conversation (ADR 0031), identité par échange, blocage pendant une réponse |
| `src/player/stepChat.ts`, `markdown.ts`, `tourWebview.ts` | peintre webview, protocole de messages, contrôles Agent/Modèle, `Sign in`, Retry / Change agent |
| `src/cli/reader/*`, `src/cli/terminal.ts`, `src/cli/stepChatSupport.ts` | view model terminal, ligne de statut, panneau de conversation, sélection présélectionnée/effective |
| `src/agent/fakeAcpAgent.ts` | faux agent à processus réel : option modèle présente/absente/refusée, notification, auth par code, terminal-auth conditionnée |
| `src/agent/piAgentSmoke.test.ts` + `docs/pi-agent-smoke.md` | smoke test Pi réel, manuel, non bloquant |

Vérifications de revue attendues (au-delà des tests) :

- aucun appel réseau, aucun registre ACP distant, aucun catalogue statique de modèles ;
- `src/agent/agentCatalogue.ts` n'importe pas `vscode` et ne démarre aucun processus (sonde injectée) ;
- une seule règle de sélection, un seul store de conversation ;
- `Sign in` n'est jamais déclenché automatiquement ; la méthode terminale n'est jamais passée à ACP `authenticate` ;
- aucun Pi non restreint possible, y compris par sélection manuelle ;
- chrome anglais, HTML échappé, garde `token` / `targetTourId` / `step` inchangée ;
- hors périmètre intact : `.tour`, MCP, génération, grounding, streaming, annulation, mémoire par étape.

## 3. Prérequis

- Node.js 24.18.0 et npm 12.0.1, Git.
- Dépendances installées et paquets construits dans le worktree :
  ```bash
  npm ci
  npm ci --prefix packages/description-renderer
  npm ci --prefix packages/knowledge
  npm ci --prefix packages/mcp-server
  npm run build
  ```
- Agents sur le `PATH` selon ce que vous voulez tester : `copilot` (Copilot CLI),
  `vibe-acp`, `codex-acp`, `claude-agent-acp`, `pi-acp` + `pi`.
  CodeTour n'installe ni ne connecte aucun agent.
- Pour Pi : `pi` installé et déjà connecté (`pi auth login`), `pi-acp` sur le `PATH`.
- Pour la recette VS Code : VS Code installé et un bureau graphique.
- Le worktree contient déjà des Tours dans `.tours/`, donc la fenêtre de
  développement propose des Tours sans rien créer.

## 4. Tests automatisés

Toujours depuis le worktree d'intégration.

### 4.1 Compilation et suite ciblée (rapide, c'est la porte de chaque ticket)

```bash
npx tsc -p tsconfig.test.json
node --test dist/test/agent/*.test.js \
  dist/test/player/stepChat*.test.js \
  dist/test/player/tourWebviewHtml.test.js \
  dist/test/cli/stepChatSupport.test.js \
  dist/test/cli/reader/*.test.js
```

Attendu : 0 échec ; seuls les tests du smoke Pi sont « skipped » sans la variable
d'activation. Au commit `3019fc8` : 264 tests, 260 pass, 4 skipped.

### 4.2 Suite complète

```bash
node scripts/run-compiled-tests.js dist/test
```

Attendu au commit `3019fc8` : 527 tests, 517 pass, 0 fail, 10 skipped.
Les 6 skips historiques existaient avant la spec ; les 4 autres sont le smoke Pi.

### 4.3 Build des artefacts (extension + CLI)

```bash
npm run build
```

Attendu : les deux bundles webpack se construisent, le runtime resvg est copié.
C'est ce build qui produit `dist/extension-node.js` et `dist/cli.js` utilisés par
les lancements manuels ci-dessous.

### 4.4 Smoke test Pi réel (manuel, non bloquant)

```bash
npx tsc -p tsconfig.test.json
CODETOUR_PI_SMOKE=1 node --test dist/test/agent/piAgentSmoke.test.js
```

Sans `CODETOUR_PI_SMOKE=1`, le fichier s'auto-ignore : il ne bloque jamais la CI.
Il s'auto-ignore aussi si `pi`/`pi-acp` manquent, sous Windows, ou si Pi répond
« authentication required ». Il vérifie : négociation de version ACP avec
`pi-acp`, surface d'outils réellement active (`read, grep, find, ls` mesurée via
`pi.getActiveTools()`), cycle modèle annoncé → demandé → confirmé + une vraie
question, et la commande de connexion déclarée (`pi-acp --terminal-login`, lue
mais jamais exécutée). Voir `docs/pi-agent-smoke.md`.

Attendu au commit `3019fc8` sur cette machine : 4/4 pass en ~6 s, Pi 1.5.2,
`pi-acp` 0.0.31, outils effectifs `read, grep, find, ls`.

### 4.5 Smoke test VS Code réel (interface graphique)

```bash
npm run build
node scripts/run-vscode-tests.js
```

Ou, pour une extension empaquetée :

```bash
node scripts/run-vscode-tests.js --vsix /chemin/absolu/vers/package.vsix
```

Prérequis : VS Code installé, bureau graphique, Node ≥ 22. Le runner isole
profils, extensions et Tours dans un répertoire temporaire et pilote la vraie
WebView. Voir `test/vscode/README.md`. Ce test ne couvre pas les nouveaux
contrôles Agent/Modèle : la recette manuelle ci-dessous les couvre.

## 5. Lancer les surfaces

### 5.1 Extension VS Code (webview Expanded Description View)

1. Ouvrir le worktree d'intégration dans VS Code.
2. `npm run build` (ou laisser la tâche `preLaunchTask` le faire).
3. `F5` → configuration **Test Extension (Project Tour)**. Une nouvelle fenêtre
   s'ouvre sur le worktree.
4. Dans la fenêtre de développement : panneau CodeTour → choisir un Tour
   (`architecture_codetour_extension_mcp` par exemple) → **Start Tour**.
5. La zone de conversation est en bas de l'**Expanded Description View** :
   ligne `Agent:` + sélecteur d'agent, sélecteur de modèle, puis le champ
   « Ask a question about this step… ».

Pour voir les erreurs de l'extension : **Help → Toggle Developer Tools**.
Pour la webview : **Developer: Open Webview Developer Tools**.

### 5.2 Lecteur terminal

Depuis le worktree, après `npm run build` :

```bash
node dist/cli.js architecture_codetour_extension_mcp --renderer terminal
```

Remplacer le titre par n'importe quel Tour de `.tours/` (sans l'extension
`.tour`). Le lecteur s'affiche dans le terminal courant. Touches utiles :
`←/→` étapes, `j/k` défilement, `a` poser une question, `q` quitter /
interrompre une réponse.

Le panneau de conversation à droite affiche `▌ <agent>` et la ligne de statut
affiche le nom de l'agent effectif (et le modèle) ; avant la première réponse,
la mention est `(preselected)`.

### 5.3 Vérifier le lanceur Pi à la main

```bash
launcher="${TMPDIR:-/tmp}/codetour-pi-readonly/pi-readonly-1.sh"
cat "$launcher"        # doit contenir : exec pi --tools read,grep,find,ls --no-mcp "$@"
ls -l "$launcher"      # doit être exécutable
```

Aucun fichier ne doit être écrit dans `~/.pi` par CodeTour.

## 6. Scénarios de recette

Cocher chaque scénario ; noter le résultat réel et joindre une capture ou la
sortie console en cas d'écart. `[ ]` = à faire.

### 6.1 #251 — vocabulaire et chrome anglais

- [ ] L'interface de conversation ne contient plus le mot « provider » ; elle
      parle d'agent.
- [ ] Provoquer l'échec d'un agent avant tout texte de réponse (voir §7.2) :
      l'activité affiche `… unavailable, trying the next agent…` en anglais.
- [ ] Faire échouer tous les agents : le message final est
      `No ACP agent available (Copilot → Vibe → Pi → Codex → Claude Code). …`,
      sans reste de français.

### 6.2 #250 — le lecteur voit qui a répondu

Webview :

- [ ] Avant toute question, la ligne dit
      `Agent: <profil> (preselected)`.
- [ ] Après la première réponse, elle dit `Agent: <profil> (effective)`.
- [ ] Chaque réponse porte une petite légende avec l'agent qui l'a produite
      (et le modèle une fois #248 en place).
- [ ] Changer d'étape et revenir : la conversation de l'étape et son agent
      restent attachés à l'étape.

Terminal :

- [ ] Le panneau de conversation nomme l'agent effectif, pas le premier binaire
      du `PATH`.
- [ ] La ligne de statut est cohérente avec le panneau (même agent, même
      modèle).
- [ ] Avant la première réponse, la mention `(preselected)` est visible.

### 6.3 #247 — la disponibilité sondée décide qui répond

- [ ] Ouvrir le panneau : la sonde démarre, puis Copilot est présélectionné
      **si et seulement si** Copilot est réellement joignable.
- [ ] Sans Copilot, le premier profil disponible dans l'ordre
      `Copilot, Vibe, Pi, Codex, Claude Code` est présélectionné.
- [ ] Les six états sont visibles : `unknown`, `not-installed`, `unverified`,
      `auth-required`, `available`, `connection-error`.
- [ ] Un agent non installé est visible mais non sélectionnable.
- [ ] Poser une question **pendant** la sonde initiale : la réponse attend la
      fin de la sonde (≤ 5 s) au lieu de partir sur un profil non vérifié.
- [ ] Aucun agent utilisable (voir §7.3) : un état explicatif s'affiche, le
      champ d'envoi et les suggestions sont désactivés, et le Tour reste
      entièrement navigable.
- [ ] Un agent lent > 5 s est `connection-error` : écarté de la sélection
      automatique mais sélectionnable à la main.

### 6.4 #249 — le choix de l'agent tient

- [ ] Le sélecteur liste **tout** le catalogue avec l'état de chaque profil.
- [ ] Un profil `not-installed` est grisé et non sélectionnable ; un profil
      `auth-required` ou `connection-error` reste sélectionnable.
- [ ] Ouvrir le sélecteur sonde une fois les profils encore `unverified`.
- [ ] **Refresh** re-sonde à la demande.
- [ ] Choisir un agent, poser une question, puis faire échouer son transport :
      l'erreur est attachée à **cet** échange et propose `Retry` et
      `Change agent` ; les échanges suivants ne sont pas pollués.
- [ ] `Retry` réessaie le **même** agent ; aucune bascule silencieuse après la
      première question.
- [ ] `Change agent` ouvre le sélecteur ; changer d'agent conserve l'historique
      de l'étape et la question suivante ouvre une session neuve, sans delta de
      l'ancien agent.
- [ ] Pendant qu'une réponse s'écrit, les contrôles Agent et Modèle (et Refresh,
      envoi, suggestions) sont désactivés ; un changement ne coupe pas la
      réponse.

### 6.5 #252 — se connecter à un agent qui le demande

- [ ] Un agent qui répond `authentication required` affiche son état et une
      action `Sign in`.
- [ ] Cliquer `Sign in` ouvre un **terminal VS Code** qui exécute la commande
      déclarée par l'agent (chez Pi : `pi-acp --terminal-login`).
- [ ] Aucune connexion n'est déclenchée automatiquement, ni à la sonde, ni au
      changement d'agent (surveiller les terminaux et les processus).
- [ ] Après la connexion, **seul** ce profil est re-sondé ; les autres états
      restent ceux du cache.
- [ ] La connexion ne réinitialise ni l'historique de l'étape ni l'agent
      sélectionné.

### 6.6 #248 — le modèle annoncé par l'agent

- [ ] Le sélecteur de modèle ne liste que les valeurs annoncées par l'agent
      sélectionné (jamais un catalogue statique).
- [ ] Le modèle choisi est mémorisé pour cet agent pendant toute la lecture et
      rejoué à la session suivante (même après une navigation d'étape).
- [ ] Un changement n'est affiché comme effectif qu'après confirmation par
      l'agent ; l'affichage suit ensuite l'agent, y compris s'il change seul.
- [ ] Un modèle refusé ou inconnu retombe silencieusement sur la valeur de
      l'agent, et l'affichage montre cette valeur.
- [ ] Un agent sans option de modèle affiche **Agent-managed model** et reste
      utilisable.
- [ ] Le terminal affiche le modèle effectif à côté de l'agent (pas de
      sélecteur dans le terminal).

### 6.7 #253 — Pi derrière un lanceur restreint

- [ ] Pi apparaît dans le catalogue **après Vibe** (`Copilot, Vibe, Pi, Codex,
      Claude Code`).
- [ ] Sélectionner Pi et poser une question : la réponse arrive, et le panneau
      nomme bien `Pi`.
- [ ] Le lanceur `$TMPDIR/codetour-pi-readonly/pi-readonly-1.sh` contient
      l'allowlist et est exécutable (§5.3) ; `~/.pi` n'est pas modifié.
- [ ] Lancer le smoke test Pi (§4.4) : négociation, outils effectifs, cycle
      modèle, chemin de connexion.
- [ ] Sous Windows (ou lanceur indisponible), Pi apparaît en `connection-error`
      et n'est jamais lancé sans restriction.

## 7. Provoquer les états à la main

Lancer VS Code depuis un shell dont le `PATH` est maîtrisé (l'extension hérite
du `PATH` de la fenêtre). Exemple :

```bash
mkdir -p /tmp/codetour-agents-bin
# Garder Node et Git accessibles :
ln -sf "$(command -v node)" /tmp/codetour-agents-bin/node
ln -sf "$(command -v git)"  /tmp/codetour-agents-bin/git
# Exposer seulement les agents voulus, par exemple Vibe et Codex :
ln -sf "$(command -v vibe-acp)"  /tmp/codetour-agents-bin/vibe-acp
ln -sf "$(command -v codex-acp)" /tmp/codetour-agents-bin/codex-acp
PATH="/tmp/codetour-agents-bin:/usr/bin:/bin:/usr/sbin:/sbin" \
  code --new-window /Users/dhuyet/Documents/POC/codetour-wt/spec246-integration
```

### 7.1 `not-installed`

Un agent absent de ce `PATH` doit apparaître `not-installed`, grisé, non
sélectionnable.

### 7.2 `connection-error` immédiat (et message de bascule anglais)

Créer un faux binaire qui meurt tout de suite :

```bash
cat > /tmp/codetour-agents-bin/copilot <<'EOF'
#!/bin/sh
exit 1
EOF
chmod +x /tmp/codetour-agents-bin/copilot
```

Copilot devient `connection-error`, sélectionnable à la main ; une question
dessus doit afficher l'échec attaché à l'échange, avec `Retry` / `Change agent`.

### 7.3 `connection-error` par dépassement de délai (> 5 s)

```bash
cat > /tmp/codetour-agents-bin/copilot <<'EOF'
#!/bin/sh
sleep 6
exec /chemin/vers/le/vrai/copilot "$@"
EOF
chmod +x /tmp/codetour-agents-bin/copilot
```

Après ~5 s, Copilot est `connection-error` mais reste sélectionnable à la main.

### 7.4 Aucun agent utilisable

Retirer tous les agents du `PATH` (garder Node/Git) et rouvrir le panneau :
état explicatif, composer désactivé, Tour navigable.

### 7.5 `auth-required`

Utiliser un agent installé mais non connecté (par exemple `codex-acp` ou
`vibe-acp` après déconnexion), ou un agent dont le compte a expiré. L'état doit
être lu depuis le code d'erreur ACP, pas depuis le texte ; `Sign in` doit
apparaître dès que l'agent annonce une méthode terminale.

> Ne jamais vous connecter à la place du testeur : `Sign in` est une action
> manuelle, et le smoke Pi ne s'authentifie pas.

## 8. En cas d'échec, joindre

- la commande exacte, le worktree et `git rev-parse HEAD` ;
- la sortie complète du test (ne pas filtrer les skips) ;
- pour la webview : la console des Developer Tools (webview et extension host) ;
- pour le terminal : la sortie brute du lecteur et la valeur des variables
  `CODETOUR_ACP_*` éventuelles ;
- pour Pi : la version de `pi`, de `pi-acp`, le contenu du lanceur
  `$TMPDIR/codetour-pi-readonly/pi-readonly-1.sh`, et la ligne de diagnostic du
  smoke test (protocole, outils effectifs, modèle) ;
- `git status --porcelain` (le worktree doit rester propre).

## 9. Limites connues et hors périmètre

- Rien n'est persisté au-delà du panneau : fermer la vue efface choix d'agent,
  modèle et états sondés (ADR 0019/0031).
- Le lecteur terminal n'a **aucun** sélecteur interactif ; il affiche l'agent et
  le modèle effectifs et garde `CODETOUR_ACP_PROVIDER` / `CODETOUR_ACP_COMMAND`
  comme échappatoires.
- Sous Windows, CodeTour ne fournit pas de lanceur Pi : Pi est `connection-error`
  et jamais lancé sans restriction (ADR 0049).
- Aucune découverte réseau, aucun registre ACP distant, aucun catalogue statique
  de modèles, aucune installation automatique d'agent, aucune gestion de clés.
- Hors périmètre : intégration CLI Codex (#239), format `.tour`, génération de
  Tours, serveur MCP, migration de version ACP, sélection interactive terminal,
  élargissement de la surface d'outils d'un agent.
