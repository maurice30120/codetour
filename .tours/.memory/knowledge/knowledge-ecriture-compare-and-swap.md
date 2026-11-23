---
name: knowledge-ecriture-compare-and-swap
description: Règle générale : toute écriture Knowledge passe par une section critique unique sous le verrou du catalogue ; create publie par lien dur exclusif et ne peut pas écraser, replace et append sont des compare-and-swap sur la Knowledge Revision et refusent par conflict sans rien écrire quand la révision a bougé.
evidence:
  - type: file
    path: packages/knowledge/src/persistence.ts
    sha256: adfa39b0135c07fa6329cc23c05321b1a23bc60ecfcd84e8cc7f173094c80f4b
  - type: file
    path: docs/adr/0050-compare-and-swap-knowledge-writes-under-one-catalogue-lock.md
    sha256: 51842efec4153cace00b2d5aaf14212f5df4953c896f0b2e86abc37b0359f79a
  - type: file
    path: CONTEXT.md
    sha256: fac28bfbe62e77504cbaa83cbcb5e220201c09b4b54eefc764a98e587ae6ac0a
---
**Règle générale — une section critique.** Les trois modes de persistance (`create`, `append`, `replace`) exécutent sous un verrou de catalogue unique (`withCatalogueLock`, fichier `.catalogue.lock`) la relecture de l'entrée, la comparaison de révision, la seconde vérification des preuves, l'écriture du fichier temporaire et la publication (`packages/knowledge/src/persistence.ts`). Aucun lecteur ne prend de verrou.

**Règle générale — publication atomique.** `create` publie par lien dur exclusif (`link`) et ne peut donc pas écraser une entrée existante ; là où le lien n'est pas supporté, il retombe sur une copie exclusive. Un conflit découvert après une publication partielle annule ce que l'appel venait de publier, jamais une entrée antérieure. `replace` relit l'entrée, refuse par `unknown_entry` plutôt que d'en créer une, publie par `rename` atomique.

**Règle générale — compare-and-swap.** `replace` et `append` exigent le `expectedRevision` que l'appelant a lu ; une révision absente ou différente rend un `conflict` (`revision_conflict`) et n'écrit rien. C'est la Knowledge Revision (SHA-256 des octets du fichier) qui sert de jeton, conformément à `CONTEXT.md` et à l'ADR 0050.

**Exceptions vérifiées.** Un changement d'identité du canonicaliseur ne refuse que les écritures portant des preuves `symbol` (`engine_changed`) : les preuves `file` n'en dépendent pas. Une entrée publiée dont les preuves citent moins de deux fichiers distincts est publiée quand même, mais signalée par l'avertissement `insufficient_backing` ; l'avertissement ne refuse jamais et ne nomme ni chemin ni empreinte.

**Portée vérifiée.** Lecture de `persistence.ts` (validation, modes, verrou, publication, avertissements) au commit analysé. Le point de reprise d'autorité du verrou après 15 s (`CATALOGUE_LOCK_STALE_MS`) n'est pas couvert par cette règle : il reste une prise de risque, pas une garantie.