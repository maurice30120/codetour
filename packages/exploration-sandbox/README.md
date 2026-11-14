# Sandbox expérimentale Code Mode

Installer avec `npm install --prefix packages/exploration-sandbox` et tester avec `npm test --prefix packages/exploration-sandbox`.

```js
const { runScript } = require('../exploration-sandbox');
const result = await runScript({
  workspace: '/chemin/vers/le/depot',
  code: 'search("main").filter(x => x.file.endsWith(".ts"))',
  params: {}, // JSON, facultatif, accessible dans le script par `params`
  timeoutMs: 3000
});
```

Le code est une expression JavaScript synchrone, dont la valeur doit être sérialisable en JSON. Utiliser une fonction immédiatement appelée pour plusieurs instructions. `list()` renvoie au plus 500 fichiers ; `read(chemin, début, fin)` renvoie `{file, start, lines}` (lignes inclusives, maximum 100) ; `search(texte)` parcourt au plus 30 000 fichiers et renvoie au plus 50 `{file, line, text}`. Les chemins sont relatifs et les liens symboliques refusés. Les fichiers de plus de 1 Mio et `.git` ne sont pas lus. Pas d'import, de réseau, d'écriture ou d'API Node dans QuickJS. Les résultats, les appels, la mémoire QuickJS et le temps sont bornés ; le délai inclut le démarrage et un processus enfant est tué si le délai expire ou si le `signal` optionnel est annulé.

Avec une bibliothèque fournie dans `scripts`, une expression peut appeler `script(id, params)` pour réexécuter une expression mémorisée et composer son résultat. Tous les appels partagent le même contexte, budget d'outils, délai et mémoire ; l'imbrication est limitée à 20. La suppression d'une dépendance peut rendre un script composé inexécutable : aucune résolution automatique de dépendances n'est encore assurée.

`params` fournit au script une copie JSON d'au plus 8 Kio ; son contenu est passé comme donnée, sans être interpolé dans le code du script. Chaque exécution utilise un nouveau contexte.

La sandbox est expérimentale : QuickJS/WASM et le processus enfant ne constituent pas une isolation au niveau du système d'exploitation. La vérification des liens symboliques et la lecture sont deux opérations distinctes : ne pas l'utiliser sur un dépôt modifié simultanément par un adversaire. Le plafond mémoire de QuickJS ne limite pas toute la mémoire native du processus ; le délai et la limite V8 constituent des garde-fous supplémentaires, pas une garantie de confinement OS. Les outils hôte doivent rester bornés et ne jamais recevoir de capacités d'écriture ou de réseau.
