# Établissements

La page Établissements contient votre liste maîtresse des établissements, chaque site auquel un
résultat peut être attribué, ainsi que les outils pour en importer une depuis un registre national
dont le fichier ne correspond pas déjà aux noms de colonnes d'OpenLDR.

## Résultat

Vous pouvez importer une liste nationale d'établissements dont les en-têtes de colonnes et le
vocabulaire ne correspondent pas à ceux d'OpenLDR, à l'aide d'une correspondance de colonnes et
d'une correspondance de valeurs, depuis l'assistant d'importation ou la CLI `openldr`.

## Avant de commencer

- Connaître le registre national auquel appartient le fichier (son URI canonique, par exemple
  `urn:zm:mfl`). L'identifiant permanent de chaque ligne importée est dérivé de cet URI et de la
  colonne de code du fichier, donc le même registre doit toujours porter le même nom.
- Garder le fichier source ouvert quelque part pour comparer sa ligne d'en-têtes aux champs du
  contrat ci-dessous.

## Ce qu'est une correspondance de colonnes

Le contrat d'import d'OpenLDR a un ensemble fixe de champs : `national_code` et `name`
(obligatoires), plus `level`, `ownership`, `status`, `country`, `zone`, `region`, `district`,
`council`, `ward`, `village`, `address`, `phone`, `latitude` et `longitude` (facultatifs). Un
fichier national n'orthographie presque jamais ses colonnes ainsi : il peut appeler la colonne de
code `MFL Code`, ou la colonne de région `Province`.

Une **correspondance de colonnes** est la traduction entre les deux. Ses clés sont **les en-têtes
du fichier lui-même, exactement comme ils apparaissent dans le fichier**, et non les noms du
contrat. Pour chaque en-tête, vous avez trois choix :

- **La faire correspondre** à un champ du contrat. Deux en-têtes ne peuvent jamais correspondre au
  même champ. L'analyseur ne peut pas deviner lequel doit l'emporter, il refuse donc plutôt que de
  deviner.
- **Lui donner une valeur fixe.** À utiliser quand le contrat a besoin d'un champ pour lequel le
  fichier n'a aucune colonne. Un fichier national porte rarement son propre pays, par exemple,
  donc `country` est généralement une valeur fixe (`ZMB`, `TZA`, etc.) plutôt qu'une colonne
  mappée. Les valeurs fixes sont le code ISO, jamais une étiquette saisie à la main.
- **La garder comme donnée supplémentaire.** La colonne est quand même importée, transportée dans
  le champ `extras` de l'enregistrement, mais elle n'est pas traitée comme l'un des champs du
  contrat.

Vous n'êtes pas obligé de décider pour chaque en-tête. Laissez-en un tel quel et il réclame quand
même son champ tout seul, tant qu'il orthographie déjà exactement le nom d'un champ du contrat.
L'analyseur appelle cela une colonne **passthrough**. Un en-tête laissé tel quel qui n'orthographie
rien du contrat est refusé, sauf si vous activez **Autoriser les colonnes non reconnues**, ce qui
la transporte dans `extras` de la même façon que le choix « la garder comme donnée
supplémentaire ».

## Comment obtenir une correspondance suggérée

Vous avez rarement besoin de construire une correspondance de colonnes à la main. L'assistant et
la CLI peuvent tous deux examiner les en-têtes d'un fichier et proposer une correspondance hors
ligne, sans aller-retour serveur :

- **Dans l'assistant :** ouvrez **Établissements**, choisissez **Importer**, et sélectionnez le
  fichier. L'étape de correspondance des colonnes s'ouvre avec une suggestion déjà remplie. Une
  coche à côté d'une ligne signifie que la suggestion est sûre, et un badge **À vérifier** signifie
  qu'elle doit être revue avant de continuer.
- **Depuis la CLI :** exécutez `openldr facilities suggest-map <path>`. Elle affiche la même
  correspondance suggérée sous forme de tableau, signale toute collision que la suggestion
  provoquerait elle-même, et indique comment réinjecter le résultat :
  `openldr facilities import <path> --column-map <file.json>`.

Dans les deux cas, vérifiez la suggestion. C'est un point de départ, pas une réponse que vous
pouvez éviter de contrôler.

## Refus et comment les corriger

Un import avec des problèmes de correspondance de colonnes n'écrit rien. Chaque problème est
signalé en une seule fois, pour qu'une seule passe de correction répare le fichier, au lieu de
découvrir les erreurs une par une. Quatre choses peuvent mal tourner :

| Raison | Ce que cela signifie | Comment le corriger |
|---|---|---|
| `duplicate_target` | Deux en-têtes correspondent au même champ du contrat. | Décidez quel en-tête est correct pour ce champ et déplacez l'autre vers une valeur fixe ou une donnée supplémentaire. |
| `constant_collision` | Une valeur fixe et un en-tête mappé (ou laissé tel quel et déjà correspondant) réclament tous deux le même champ. | Gardez un seul des deux, la valeur fixe ou la correspondance de colonne, pour ce champ. |
| `unknown_target` | Un en-tête est mappé vers un nom qui n'est pas l'un des champs du contrat. | Corrigez la faute de frappe, ou faites-le correspondre à une donnée supplémentaire s'il n'appartient pas du tout au contrat. |
| `missing_required` | `national_code` ou `name` n'a ni colonne mappée ni valeur fixe. | Mappez une colonne, ou fournissez une valeur fixe, pour le champ obligatoire manquant. |

## La distinction qui pose souvent problème

Une correspondance de colonnes décide où va chaque **colonne**. Une correspondance de valeurs
décide ce que signifie chaque **valeur** dans un champ contrôlé (`level`, `status`, `country`). Les
deux se comportent très différemment quand elles sont incomplètes :

- **Une valeur non mappée est importée quand même.** Si un fichier orthographie un niveau
  d'établissement `"Health Centre"` et que votre jeu de valeurs ne reconnaît pas exactement cette
  orthographe, la ligne est importée quand même. Le texte brut est conservé, et la valeur est
  signalée pour que vous puissiez la mapper plus tard. Rien ne bloque là-dessus.
- **Une colonne obligatoire non mappée bloque tout l'import.** Si `national_code` ou `name` n'a
  nulle part d'où venir, l'analyseur refuse de deviner, et aucun enregistrement n'est écrit tant
  que vous n'avez pas corrigé la correspondance.

En résumé : un problème de colonne arrête l'import avant qu'il ne commence ; un problème de valeur
est enregistré et peut être corrigé après coup.

## Enregistrer un établissement à la main

La plupart des établissements arrivent par import. Vous pouvez aussi en ajouter un depuis la page
Établissements, et un établissement qui existe dans votre liste nationale devrait être enregistré
comme tel plutôt que comme un établissement purement local.

### Les deux codes

Une ligne d'établissement a de la place pour deux codes, et ce ne sont pas la même chose :

- **Code national.** Le code que porte votre liste nationale ou maîtresse des établissements.
  Facultatif, car un site qui n'est qu'un laboratoire n'en a pas.
- **Code local.** Votre propre numérotation, quel que soit le nom que votre LIS donne au site.
  Également facultatif.

Au moins l'un des deux doit être présent. La colonne CODE du tableau Établissements affiche le
code local s'il existe, et revient au code national sinon, la même règle que le reste du système
utilise pour donner à un établissement son code public.

### Pourquoi le registre compte

L'identifiant permanent d'un établissement est dérivé de son **registre d'établissements plus son
code national**. Fournissez les deux et l'établissement est classé sous exactement l'identité qu'un
import CSV de ce registre lui donnerait, donc un import ultérieur de la même liste met à jour votre
ligne au lieu d'en créer une seconde.

Laissez le code national vide et l'établissement garde un identifiant privé. C'est correct pour un
site qui n'est vraiment pas dans la liste nationale.

Le registre doit déjà exister sur cette installation. Un registre inconnu ou désactivé est refusé,
avec un message nommant lequel. Les registres sont la même liste que propose l'assistant
d'importation.

### Ce que vous ne pouvez pas changer après coup

**Le code national et le registre de l'établissement sont fixés une fois l'établissement créé.**
Ils font partie de son identité, pas des champs ordinaires. Modifier l'un ou l'autre laisserait la
ligne classée sous un identifiant que son propre code ne produit plus, et le prochain import de ce
registre ne la retrouverait pas.

Un établissement créé sans code national ne peut donc pas en acquérir un plus tard. Si vous devez
en ajouter un, supprimez l'établissement et enregistrez-le à nouveau.

### Champs obligatoires

Les marqueurs d'obligation du formulaire sont vérifiés à l'enregistrement, et le serveur les
vérifie aussi.

Deux champs sont délibérément **non** obligatoires, car aucun registre national ne peut être
supposé les fournir : le code local (un import n'en produit jamais) et la région (tous les pays
n'ont pas ce niveau intermédiaire ; la liste zambienne n'a rien entre Province et District). Quand
vous modifiez un établissement existant, seuls les champs que vous changez réellement sont
revérifiés, donc un établissement importé avec une lacune reste modifiable.

## Filtrage, tri et recherche

Le tableau Établissements utilise la même barre d'outils qu'Audit : une zone de recherche, et les
boutons Filtrer, Trier, Colonnes et Réinitialiser.

- Rechercher vérifie le nom, le code, la région, le district et le conseil, côté serveur, en une
  seule requête. Elle trouve du texte dans n'importe laquelle de ces cinq colonnes, même celles que
  le tableau n'affiche pas actuellement.
- Filtrer ajoute une règle : choisissez une colonne, un opérateur et une valeur. Vous pouvez ajouter
  plus d'une règle.
- Trier ordonne le tableau par n'importe quelle colonne triable, en ordre croissant ou décroissant.
- Colonnes affiche ou masque des colonnes.
- Réinitialiser efface tous les filtres, tris, termes de recherche et choix de colonnes, et remet
  le tableau à ses réglages par défaut. Ce bouton n'apparaît qu'une fois un filtre ou un tri
  appliqué. Chaque contrôle s'efface aussi tout seul, vous pouvez donc annuler une chose sans
  annuler le reste.

Les filtres actifs apparaissent sous forme de puces amovibles sous la barre d'outils.

Deux contrôles occupent leur propre ligne sous la barre d'outils, parce que ce ne sont pas des
colonnes ordinaires :

- **État du mappage.** Si un établissement peut être une cible de mappage, et si quelque chose le
  mappe déjà. Mappé signifie qu'au moins un code observé s'y résout déjà. Non mappé signifie que
  l'établissement est prêt à être une cible mais que rien ne pointe encore vers lui. Non projeté
  signifie que l'établissement n'a pas encore atteint la table destinée aux rapports, donc il ne
  peut pas du tout être une cible de mappage. Cet état provient d'une jointure entre deux autres
  tables, pas d'une colonne stockée, il garde donc son propre menu déroulant au lieu de rejoindre
  la liste Filtrer.
- **Registre national.** Une zone de texte libre qui filtre sur le registre dont un établissement a
  été importé. Texte libre, car un établissement peut porter un code de registre que votre
  installation ne liste plus comme source active.

Une vue filtrée et triée peut être partagée. Les filtres et tris apparaissent dans l'URL de la
page, donc copier le lien et l'envoyer à quelqu'un rouvre la même vue. Les anciens liens qui
utilisaient un seul paramètre de requête, comme `?zone=Central`, fonctionnent toujours.

Dans le studio, Filtrer et Trier peuvent utiliser ces colonnes : code, nom, région, district,
statut, source, zone, conseil, pays, niveau, propriété, origine gérée et état du registre.

### Deux choses à savoir

Rechercher vérifie chaque ligne directement au lieu d'utiliser un index. Sur un grand registre
national, cela peut prendre plus de temps que filtrer par une valeur de colonne exacte. Si une
recherche semble lente, restreignez d'abord avec Filtrer, puis recherchez dans le résultat plus
petit.

L'ordre par défaut du tableau et un tri explicite par nom peuvent classer les noms différemment.
Ils comparent la casse et les lettres accentuées selon des règles différentes. Si un rapport
dépend d'un ordre précis, appliquez un tri explicite plutôt que de vous fier à la vue par défaut.

## Ligne de commande : lister les établissements

`openldr facilities list` prend en charge la même grammaire de filtre et de tri que la barre
d'outils, ce qui permet à un script de reproduire n'importe quelle vue construite dans le
navigateur.

- `--where column:operator:value`. Répétable. Seuls les deux premiers deux-points sont des
  délimiteurs, une valeur peut donc elle-même contenir un deux-points.
- `--sort column` trie en ordre croissant. `--sort -column`, avec un tiret en préfixe, trie en
  ordre décroissant. Répétable.
- `--limit <n>` limite le nombre de lignes renvoyées. Sans cet indicateur, la commande renvoie au
  plus 200 lignes. Dans la vue tableau, la dernière ligne indique combien vous en voyez sur le
  total. Avec `--json`, le total voyage dans la réponse à la place, et cette ligne ne s'affiche pas.
- `--json` affiche une sortie exploitable par machine au lieu d'un tableau.

```bash
openldr facilities list --sort -name --limit 10
```

Cette commande liste les dix derniers établissements par nom, de Z à A. Elle n'applique aucun
filtre, donc elle renvoie des lignes partout où le registre en a.

```bash
openldr facilities list --where level:eq:hospital --sort -name
```

Cette commande liste les établissements dont la colonne level correspond exactement à
« hospital », triés par nom de Z à A. `eq` exige une correspondance exacte, et la casse compte,
vérifiez donc d'abord les valeurs de niveau réelles de votre propre registre. Les registres
stockent souvent des valeurs comme « Health Post », « Health Centre » ou « 1st Level Hospital », et
une valeur qui ne correspond pas exactement ne renvoie rien.

La CLI peut aussi filtrer et trier par `id` et `facilitySystem` (le code du registre national),
deux colonnes que la barre d'outils du studio laisse de côté parce que `facilitySystem` y a déjà
sa propre zone de texte. `health` n'a pas de forme `--where` : elle est calculée, pas stockée,
donc filtrez-la plutôt via le menu déroulant État du mappage du studio.

Une colonne inconnue, ou un opérateur que cette colonne n'autorise pas, est rejeté avec un message
qui nomme précisément l'erreur, la même validation qu'utilise la barre d'outils. Un indicateur mal
saisi échoue de la même façon qu'un filtre mal saisi dans le navigateur.

## Guides associés

- [Terminologie](/docs/terminology)
- [Audit](/docs/audit)
