## Problem Statement

Un run de génération qui établit une relation utile entre plusieurs Knowledge atomiques ne peut pas la conserver. Chaque run ultérieur relit les entrées séparées puis reconstruit leurs interactions : coût en tokens et perte de contexte, à chaque fois.

Le contrat actuel ne sait représenter que des entrées autonomes, sans dépendances. Un agent qui consolide n'a donc que deux gestes : créer une nouvelle atomique, qui duplique une partie de ce qu'il vient de lire, ou enrichir une atomique existante, qui ne dit rien de la relation. La connaissance transversale — celle qui explique *comment* deux mécanismes interagissent — n'a nulle part où aller, et elle est reperdue à la fin du run.

Il n'existe par ailleurs aucun moyen de déclarer « cette connaissance repose sur ces trois autres », donc aucun moyen de l'invalider quand une de ses sources change.

## Solution

Une **Knowledge composée** : une entrée Markdown autonome qui déclare au moins deux Knowledge filles et dont le corps mémorise l'interaction entre elles — ni concaténation, ni répétition de leur contenu.

Elle est produite pendant la consolidation existante, après la création d'un Tour : pas de nouvel agent, pas de harness, pas de phase supplémentaire, pas de moteur LLM dans le serveur MCP.

À la lecture, son corps n'est servi que si tout son graphe est valide : ses propres preuves, la révision de chaque fille, le contrat entier de chaque fille — preuves `symbol` comprises — puis, récursivement, les dépendances de ses filles. Elle se lit **seule** : le moteur valide les filles sans jamais transmettre leurs corps.

L'agent **nomme** les filles ; le moteur résout leur fichier dans le catalogue et épingle lui-même leur révision au moment de la publication.

## User Stories

1. En tant que générateur de Tour, je veux conserver dans une entrée unique la conclusion transversale que j'ai tirée de plusieurs Knowledge, afin de ne pas la reconstruire au run suivant.
2. En tant que générateur de Tour, je veux déclarer qu'une Knowledge repose sur deux autres sans recopier leur contenu, afin que ma synthèse reste courte et non redondante.
3. En tant que générateur de Tour, je veux ne fournir que les **noms** des filles, afin de n'avoir aucun digest à calculer ni à recopier.
4. En tant que générateur de Tour, je veux lire une composée seule, sans charger les corps de ses filles, afin de ne pas payer leur contexte.
5. En tant que lecteur d'un run ultérieur, je veux qu'une composée dont une fille a changé soit refusée, afin de ne jamais lire une synthèse qui décrit du code disparu.
6. En tant que lecteur, je veux qu'une fille dont le code cité a changé invalide la composée alors même que son Markdown est intact, afin que la fraîcheur de la relation ne dépende pas d'une réédition manuelle.
7. En tant que lecteur, je veux qu'une invalidation en profondeur — composée vers composée vers atomique — refuse la mère, afin qu'aucune synthèse ne survive à la mort de sa source.
8. En tant que lecteur, je veux qu'un refus ne contienne aucun corps, afin de ne jamais recevoir un texte non vérifié.
9. En tant que lecteur d'une composée refusée, je veux savoir **laquelle** de ses filles est KO, afin de savoir quoi réparer sans deviner.
10. En tant qu'agent de consolidation, je veux pouvoir descendre la chaîne en lisant la fille nommée, afin d'atteindre la vraie cause en au plus deux appels.
11. En tant qu'auteur d'une Knowledge simple, je veux que rien ne change pour moi, afin qu'aucune migration ni réécriture ne soit nécessaire.
12. En tant qu'auteur, je veux que l'absence de `dependencies` signifie « atomique », afin qu'il n'existe qu'une seule façon de dire chaque chose.
13. En tant qu'auteur, je veux que le parseur refuse une déclaration d'une seule fille, afin qu'une relation entre une chose et elle-même ne passe pas pour une composée.
14. En tant qu'auteur, je veux que le parseur refuse une liste malformée — digest de mauvaise forme, doublon, nom non canonique, champ inconnu — afin que le catalogue ne contienne jamais un contrat ambigu.
15. En tant qu'auteur, je veux que l'écriture refuse une fille absente ou déjà invalide, afin de ne pas publier une composée morte-née.
16. En tant qu'auteur, je veux qu'un `append` ne puisse jamais changer les filles d'une entrée, afin qu'un enrichissement ne change pas ce qu'est l'entrée.
17. En tant qu'auteur, je veux qu'un `replace` puisse convertir une atomique en composée, afin de ne pas avoir à supprimer et recréer le fichier à la main.
18. En tant que mainteneur, je veux qu'une composée ne puisse pas être rétrogradée silencieusement, afin qu'une structure perdue soit toujours une action explicite.
19. En tant que mainteneur, je veux des bornes de profondeur et de nombre de nœuds, afin qu'une chaîne forgée ne fasse pas lire tout le catalogue pour servir un seul corps.
20. En tant que mainteneur, je veux un refus distinct et explicite au dépassement d'une borne, afin qu'un catalogue piégé produise un diagnostic et jamais une boucle.
21. En tant que générateur de Tour, je veux que le prompt de génération me dise quand composer et quand m'abstenir, afin de ne pas fabriquer une composée pour deux consultations qui n'ont rien produit de transversal.
22. En tant que générateur de Tour, je veux qu'une investigation sans découverte transversale puisse se conclure par `completed_zero` ou `skipped`, afin qu'un run honnête ne soit pas poussé à inventer une Knowledge.
23. En tant que mainteneur, je veux que la consolidation ne reçoive toujours que l'identifiant, le nom et la description des Knowledge consultées, afin qu'aucun corps ne soit injecté dans le rappel.
24. En tant que mainteneur, je veux que la surface MCP et le run-state restent inchangés dans leur forme, afin qu'aucun client existant ne casse.
25. En tant que générateur de Tour, je veux voir sur la ligne d'une composée qu'elle est composée et de quoi elle dépend, afin de choisir la mère pour une demande transversale et la fille pour une demande ciblée sans lire deux fois la même chose.
26. En tant que mainteneur, je veux que cette relation reste bornée par ligne, afin qu'une entrée à cinquante filles ne fasse pas exploser le catalogue servi.

## Implementation Decisions

### Contrat (module Knowledge)

- Le frontmatter accepte un second bloc `dependencies`, dont chaque item porte **exactement** `name` et `sha256` : le nom canonique de la fille et le SHA-256 des octets complets de son fichier Markdown (la Knowledge Revision).
- `dependencies` reste **distinct** de `evidence`. Une preuve `file` citant le Markdown d'une fille atteste des octets de ce fichier, jamais la validité du contrat de la fille.
- **Aucun champ `kind`.** La composition est dérivée de la présence de `dependencies`. Absent = atomique. Présent avec une seule fille ou zéro = contrat malformé.
- `evidence` devient conditionnel : au moins **deux** preuves directes pour une composée, au moins **une** pour une atomique. Le comptage porte sur le nombre de preuves ; l'avertissement `insufficient_backing` existant reste, lui, indexé sur les chemins distincts.
- Le fichier publié porte `name` + `sha256` par fille. La **proposition d'écriture** ne porte que les `name` : le moteur résout le fichier dans le catalogue, vérifie le contrat de la fille et épingle sa révision sous le verrou catalogue (ADR 0054). Un digest fourni par l'appelant est un champ inconnu, donc refusé.
- **Aucune rétrocompatibilité à négocier** : une entrée sans `dependencies` se parse, se sérialise et se vérifie exactement comme avant, sans un octet modifié et sans migration.
- Le parseur doit passer d'une séquence unique codée en dur à une **map de séquences par clé**, avec validation croisée : une clé séquence sans item, un item avant sa clé, un item `- name:` dans `evidence` sont des contrats malformés. Sans cela, un bloc `dependencies` se rattacherait silencieusement à `evidence`.

### Validation à la lecture

- Ordre imposé, à chaque lecture d'une composée : preuves directes de la composée, puis pour chaque fille sa présence au catalogue et l'égalité de la révision référencée avec le digest de son fichier, puis **toutes** les preuves `file` et `symbol` de la fille, puis récursion si la fille est elle-même composée.
- Le corps n'est servi que si l'ensemble du graphe est valide. Sinon refus explicite, sans corps.
- Cache des résultats **limité à une opération de validation** : aucune survie entre deux lectures, donc une modification entre deux lectures est vue.
- Bornes : **profondeur 2 niveaux de composition** (le cas `composée → composée → atomique` rendu légal par les critères d'acceptation, et rien de plus) et **64 entrées distinctes** vérifiées par opération. Dépassement ⇒ refus total et typé, jamais un service partiel. Les deux valeurs sont des constantes exportées.
- Cycles, références malformées, doublons incohérents et chemins hors workspace sont refusés ; la racine du catalogue reste confinée comme pour les atomiques.
- Contrôle **déterministe, sans appel LLM** : il certifie des révisions et des preuves, jamais la véracité sémantique de la relation décrite ni l'exhaustivité des interactions documentées.

### Vocabulaire de refus

- Quatre motifs neufs, tous sur l'étape dépendance, aucun doublon avec l'existant : `dependency_missing` (fille absente du catalogue), `dependency_invalid` (fille présente mais dont la propre lecture refuse), `dependency_cycle`, et les bornes (`dependency_depth_exceeded`, `dependency_node_limit_exceeded`).
- La raison d'un refus de composée décrit **l'étape dépendance**, jamais le motif de la fille : `unknown_entry` sur une entrée qui existe serait faux.
- Un refus de composée nomme la **fille KO** de ce niveau (`via`). Chaque refus nomme son propre enfant fautif, donc descendre la chaîne atteint la cause réelle en une lecture par niveau, bornée par la profondeur.
- Les lectures d'**atomiques ne changent pas** : ni `via`, ni motif neuf. Les motifs existants continuent de décrire le contrôle qui a échoué.
- Un refus ne transporte, comme aujourd'hui, aucun corps, aucun chemin cité et aucune valeur de hash.

### Publication

- Une composée se publie sous le verrou catalogue existant, dans la même section critique que la relecture de l'entrée, la comparaison de révision, la vérification de stabilité et le staging.
- Le moteur relit chaque fille sous le verrou, vérifie son contrat entier et refuse d'épingler une fille absente ou invalide : une composée ne peut pas naître morte. Le nom de la fille KO sort avant tout octet écrit, avec le même motif et le même champ que côté lecture.
- `append` n'accepte **pas** le champ `dependencies`, exactement comme il n'accepte ni `name` ni `description` : la liste historique est préservée telle quelle, comme le corps l'est octet pour octet.
- `replace` réécrit l'entrée en entier et **redéclare** la liste complète. Il peut promouvoir une atomique en composée. Il ne peut pas rétrograder : une liste absente (`dependencies_incomplete`) ou une liste qui retire une fille que l'entrée portait (`dependencies_removed`, la première fille retirée nommée dans `via`) est un refus typé, jamais complétée par le moteur. Ajouter une fille ou réordonner la liste reste libre ; tout retrait est intercepté, un remplacement compris, parce que le moteur ne peut pas distinguer un remplacement voulu d'un oubli. Retirer une fille n'a donc aucun chemin d'API : comme pour la rétrogradation, il faut supprimer le fichier à la main.
- Aucune écriture partielle, aucun staging orphelin : le refus précède toute écriture.

### Projection du catalogue — option A, retenue sans mesure

Le catalogue reste **plat** : chaque Knowledge apparaît une fois, par nom, description et révision. Une composée porte en plus, sur sa propre ligne, son type et les noms de ses filles, sous forme de références compactes. Les filles gardent chacune leur ligne : aucune n'est masquée.

La forme retenue est celle qui **étend** le format existant plutôt que de le remplacer — un champ dérivé et une liste de noms sur une ligne déjà servie. Une présentation hiérarchique a été écartée faute de mesure : elle occupe une surface plus large, avec indirection pour les filles partagées, pour exactement la même information.

Le nombre de filles affichées par ligne est **borné**, avec un marqueur d'omission explicite : le contrat ne plafonne pas le nombre de dépendances, donc une entrée à cinquante filles ne doit pas produire cinquante noms dans le catalogue servi. Une projection tronquée le dit.

Rien de tout cela n'a été mesuré. L'option est retenue sur le critère du plus petit écart au format existant, pas sur une comparaison chiffrée : aucune promesse de gain n'en découle, et la présentation hiérarchique redevient un candidat si une mesure ultérieure montre que la forme plate ne suffit pas.

### Surface servie

- La **projection du catalogue** est décrite juste au-dessus : plate, une ligne par entrée, une relation compacte et bornée sur les composées, aucune fille masquée, aucun corps ni preuve détaillée dans le catalogue.
- Le prompt de génération servi par `prompts/get` gagne les règles de décision de §6 : compléter ou corriger une atomique du même sujet ⇒ `append`/`replace` sur cette atomique ; découverte indépendante ⇒ atomique possible ; composée ⇒ au moins deux sources distinctes réellement pertinentes **et** une conclusion transversale nouvelle et réutilisable ; rien ⇒ `completed_zero` ou `skipped`. Il précise le format des dépendances — nommer les filles, ne fournir aucun digest — et l'interdiction d'injecter leurs corps.
- Le rappel des consultations ajouté après `create_project_tour` / `create_changes_tour` reste limité à l'identifiant, au nom et à la description, sans corps et sans rappel sur `dryRun` ou sur un échec.
- La **surface MCP** et le **run-state** gardent leur forme : `used` continue de compter les entrées dont une lecture a servi un corps valide — une composée compte, ses filles non, puisqu'aucun de leurs corps n'est servi.

## Testing Decisions

- **Tester le comportement externe seulement** : des fichiers écrits dans un workspace réel, des corps servis ou refusés, des motifs et des noms de filles observés, des clauses de prompt. Jamais un helper interne, jamais la formulation exacte d'un message.
- **Seam 1 — le module Knowledge sur un workspace temporaire réel.** La lecture passe par la bibliothèque du catalogue, l'écriture par le point d'entrée de sauvegarde de proposition. Tout le contrat, la validation récursive, les bornes et la publication s'y testent. Prior art : les tests de lecture, de persistance, `append` et `replace` existants.
- **Seam 2 — le protocole MCP servi**, sur un workspace tiers : les outils `knowledge_list`, `knowledge_read`, `knowledge_save` et les ressources `prompts/get`, comme le fera l'adaptateur Copilot. Le `via` du refus, la projection et les clauses du prompt s'y testent. Prior art : le test d'outils Knowledge et le test de prompt de génération existants.
- **Aucun seam nouveau.** La CLI `codetour knowledge` appelle le même point d'entrée que le seam 1, donc elle n'a pas de seam propre.
- **Fixtures déterministes** pour chaque état : composée valide, fille au Markdown modifié, fille dont un fichier source cité a changé sans que son Markdown bouge, fille supprimée, fille au contrat invalide, cycle, profondeur dépassée, nombre de nœuds dépassé, référence malformée, chemin hors workspace, symlink échappant à la racine.
- **Un test de rétrocompatibilité dédié** : une atomique sans `dependencies` reste lisible, sérialisable et vérifiable à l'identique, sans migration ; le catalogue et le prompt existants continuent de fonctionner.
- **Un test qui borde la frontière dangereuse** : une preuve `file` pointant le Markdown d'une fille ne satisfait pas le contrat de dépendance.
- **Un test de profondeur** : la chaîne `composée → composée → atomique` est légale et une invalidation à l'autre bout refuse la mère ; un cran de plus est refusé.
- **Ce qui n'est pas testable reste écrit** : le pin à la publication n'a rien à comparer, donc son écart avec un pin à la lecture est consigné comme limite assumée (ADR 0054), pas simulé par un test de course.

## Out of Scope

- **L'arbitrage chiffré de §7** — la comparaison A / B sur un catalogue réel, ses tokens et son taux de sélection correcte. La projection a été retenue sans mesure, sur le critère du plus petit écart au format existant (ADR 0055). La mesure reste possible plus tard, hors tracker, et ne conditionne plus rien.
- **La mesure** — coût de création, de maintenance et de réutilisation, en tokens, comparé aux atomiques seules et à un regroupement dynamique, ainsi que le taux d'invalidation en cascade comme coût. Produite par un humain, hors tracker : aucun agent ne peut piloter des sessions, compter des tokens ni tenir un protocole contrôlé.
- L'assemblage dynamique / regroupement, où la mère renvoie toujours ses filles.
- Un nouveau moteur de recherche sémantique ou vectorielle, une déduplication automatique par LLM, une compilation de Knowledge.
- Une garantie de correction sémantique, ou une preuve que la relation décrite est exhaustive.
- Le Research Harness, les Memory Functions, un serveur MCP supplémentaire, un second agent.
- Le remplacement ou la réécriture des contrats existants de consolidation et de preuves.
- La **rétrogradation** d'une composée en atomique : elle reste impossible par l'API. Le seul chemin est de supprimer le fichier à la main — comme pour toute Knowledge aujourd'hui, puisqu'aucun outil de suppression n'existe.
- Un outil de suppression de Knowledge.

## Further Notes

- **La décision ouverte de §4 est tranchée** : `append` n'a pas à redéclarer les dépendances, il n'a pas le droit de les toucher. Seul `replace` redéclare.
- **ADR 0054** consigne le pin à la publication et sa conséquence assumée : une fille modifiée entre la lecture et la publication est épinglée dans sa version publiée, et la mère peut naître en décrivant un texte que personne n'a lu. La fenêtre est étroite, la conséquence durable. L'écriture ne peut en revanche pas produire de composée morte-née, parce que le moteur vérifie chaque fille avant d'épingler.
- **Le vocabulaire est fixé** dans le contexte Memory : *Knowledge Dependency*, *Composed Knowledge Entry*, et l'entrée *Knowledge Entry* distingue désormais atomique et composée.
- **L'état vérifié du code** dont part cette spec : frontmatter à `name`, `description` et `evidence` (`file` ou `symbol`), aucune notion de dépendance ; lecture en échec fermé sur toutes les preuves déclarées ; catalogue plat ; run-state enregistrant les entrées dont un corps a été servi ; prompt de génération portant la méthode de décomposition et le choix du mode de consolidation, sans notion de composée.
- La projection du catalogue est plate, étendue d'une relation compacte sur les composées, et **adoptée sans mesure** : un lecteur qui se demande pourquoi aucune comparaison chiffrée n'a été faite trouvera la réponse dans l'ADR 0055, et la raison de ne pas rouvrir la question sans motif.
- **Ce que cette spec n'affirme pas** : que composer est plus économique. Les validations en cascade rendent parfois inutilement invalides des mères qu'un simple enrichissement de fille n'affecte pas. C'est le prix de la sécurité, et il est à mesurer, pas à supposer acceptable.
- La règle « au moins deux filles réellement pertinentes et une conclusion nouvelle » reste une règle d'agent : le moteur ne peut pas la vérifier, et ne prétend pas le faire.
