# Documentation du domaine

Ce document explique comment les compétences d’ingénierie doivent consulter la documentation du domaine avant d’explorer le code.

## Documents à lire avant l’exploration

- **`CONTEXT.md`** à la racine du dépôt ; ou
- **`CONTEXT-MAP.md`** à la racine, s’il existe : il référence un fichier `CONTEXT.md` par contexte. Lire tous ceux qui concernent le sujet étudié ;
- **`docs/adr/`** : lire les ADR qui concernent la zone sur laquelle le travail va porter. Dans un dépôt à contextes multiples, vérifier également les décisions propres à chaque contexte sous `src/<contexte>/docs/adr/`.

Si l’un de ces fichiers n’existe pas, continuer silencieusement. Ne pas signaler son absence et ne pas proposer de le créer à l’avance. La compétence `/domain-modeling`, appelée notamment par `/grill-with-docs` et `/improve-codebase-architecture`, crée ces documents progressivement lorsque des termes ou des décisions sont effectivement clarifiés.

## Structure des fichiers

Ce dépôt utilise un contexte unique :

```text
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Dans un dépôt à contextes multiples, la présence de `CONTEXT-MAP.md` à la racine indique l’organisation suivante :

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← décisions qui concernent tout le système
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← décisions propres au contexte
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Employer le vocabulaire du glossaire

Lorsqu’une sortie nomme un concept du domaine, par exemple dans le titre d’un ticket, une proposition de refactorisation, une hypothèse ou le nom d’un test, utiliser le terme défini dans `CONTEXT.md`. Ne pas employer les synonymes explicitement déconseillés par le glossaire.

Si le concept nécessaire n’existe pas encore dans le glossaire, il faut soit reconsidérer un terme qui n’appartient peut-être pas au projet, soit noter une véritable lacune à traiter avec `/domain-modeling`.

## Signaler les conflits avec les ADR

Si une proposition contredit un ADR existant, le signaler explicitement au lieu de remplacer silencieusement la décision :

> _Contredit ADR-0007 (commandes fondées sur des événements), mais mérite d’être reconsidéré parce que…_
