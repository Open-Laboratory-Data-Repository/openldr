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

## Les quatre étapes de l'assistant d'importation

L'assistant d'importation a quatre étapes, numérotées en haut : Source, Données, Mappage et
Vérification. Cliquez sur une étape dans cette bande pour passer de l'une à l'autre. Il n'y a pas
de bouton Retour séparé.

- **Source.** Choisissez le fichier et le registre auquel il appartient. Si cette installation n'a
  encore aucun registre, le bouton affiche ici « Enregistrer un registre » au lieu de « Continuer ».
  Quitter Source envoie le fichier au serveur. Il est seulement stocké, pas encore vérifié, car
  aucune correspondance de colonnes n'existe encore.
- **Données.** Montre le fichier stocké sous forme de tableau, en lecture seule. Rien n'est
  modifiable à cette étape. Le tableau est paginé depuis le serveur, une page à la fois, et
  fonctionne de la même façon pour un fichier CSV et pour une version JSONL. Continuer passe au
  Mappage. Rien n'est envoyé : le fichier est déjà stocké.
- **Mappage.** Toutes les décisions se prennent ici : la correspondance de colonnes, les valeurs
  fixes, que faire des conflits, des absences et des suppressions, et quels mots du registre
  correspondent au vocabulaire. Chaque ligne porte aussi sa propre icône d'état, décrite plus bas,
  pour vérifier une seule colonne rapidement. Son action principale, Tout valider, lance la
  première vérification complète sur le fichier déjà stocké à l'étape Source. Elle ne renvoie pas
  le fichier une deuxième fois.
- **Vérification.** Rapporte ce que la vérification a trouvé et propose une seule action,
  Appliquer. Rien n'y est modifiable.

### Le mappage décide, la vérification rapporte

Si la vérification révèle quelque chose que vous voulez changer, revenez au Mappage, changez-le,
puis avancez de nouveau. Cet aller-retour est voulu. Une liste nationale d'établissements engage
trop de choses pour qu'il vaille la peine d'échanger l'exactitude contre la vitesse.

Au premier passage, le Mappage n'affiche aucune liste de valeurs non reconnues, car rien n'a encore
lu le fichier. Cliquez sur Tout valider, laissez la vérification s'exécuter, et la liste vous
attend à votre retour. Il en va de même des options qui laissent passer un problème : aucune ne
vous est proposée tant que rien ne vous a dit que le problème existe.

**Changer quoi que ce soit au Mappage supprime la dernière Vérification.** C'est délibéré. Un
résumé qui ne correspond plus à ce que vous allez importer est pire que pas de résumé : l'assistant
le retire plutôt que de laisser à l'écran un chiffre qui n'est plus vrai. La Vérification est soit
à jour, soit absente.

Deux choses ne la suppriment volontairement **pas**, car elles ne changent rien à ce que la
vérification a trouvé : les choix conflits, absences et suppressions, qui s'appliquent au moment de
l'import et non à la lecture du fichier, et l'option d'importer malgré des lignes illisibles, qui
décide seulement si l'import peut se poursuivre.

Les valeurs non reconnues d'un champ apparaissent sous sa propre ligne de mappage, chacune avec sa
liste de choix, au lieu d'une seule zone plus bas. La liste est conservée pendant que vous la
traitez : enregistrer une correspondance ne fait pas disparaître les lignes restantes, et ne
relance plus la vérification tout seul. Demandez la vérification suivante quand vous êtes prêt.

**Une valeur de niveau qui n'appartient à aucun type peut être ignorée.** Choisissez **Ignorer
cette valeur** en haut de la liste. La valeur est importée exactement comme écrite, ce qui est déjà
le cas d'une valeur que personne n'a mappée, et la ligne cesse de la compter. La décision est
enregistrée pour ce registre, donc le prochain import du même fichier ne la redemande pas. Elle
n'est proposée que pour `level` : `status` et `country` ont de petits vocabulaires fermés, sans
rien à y ignorer.

**Une valeur de niveau absente de la liste peut y être ajoutée.** Choisissez **Ajouter « … » comme
nouveau type** en haut de la liste. Une confirmation s'ouvre avec le nom, que vous pouvez corriger,
et le code qu'il recevra, que vous ne pouvez pas. Le type est ajouté à ce registre seulement :
chaque autre registre garde la liste qu'il a. Si le nom tapé correspond déjà à quelque chose dans
la liste, l'ajout est refusé et nomme ce qu'il a rencontré, car deux entrées qui se lisent pareil
empêcheraient les deux de se résoudre. Ajouter un type demande la capacité `terminology.manage` en
plus de `facilities.manage` ; sans elle, l'option est désactivée et vous pouvez toujours mapper ou
ignorer.

### L'icône d'état sur chaque ligne

Chaque ligne de mappage porte une petite icône à côté de son sélecteur de champ. Elle a quatre
états :

- Un cercle d'information ambre signifie que la ligne n'a pas encore été vérifiée.
- Une coche verte dans un cercle signifie qu'elle a été vérifiée et que rien ne cloche.
- Un cercle rouge signifie qu'un problème existe. La ligne dit lequel, juste en dessous.
- Une flèche circulaire grise signifie que le mappage a changé depuis sa dernière vérification.
- Un cercle discret barré d'un tiret signifie que la colonne est gardée en données supplémentaires.
  Elle ne revendique aucun champ du contrat, il n'y a donc rien à vérifier et l'icône ne fait rien.
  La plupart des colonnes d'un export réel sont dans ce cas, ce qui laisse ressortir les autres.

Chaque état a sa propre forme, pas seulement sa propre couleur, pour qu'ils restent distincts sur
un téléphone, où l'infobulle ne s'ouvre pas du tout.

L'icône reste cliquable dans tous les états. Une nouvelle vérification n'est jamais refusée.

Aucune ligne ne devient verte toute seule, même quand le champ suggéré paraît juste. La suggestion
note le NOM de la colonne. Elle ne peut pas savoir ce que la colonne contient, et les noms qu'elle
reconnaît le plus sûrement sont souvent ceux des champs contrôlés dont les valeurs demandent le
plus de vérification. Le vert veut dire qu'une vérification a lu la colonne.

Cliquer sur l'icône ne vérifie que cette colonne. Elle lit les valeurs de cette colonne dans le
fichier déjà envoyé à l'étape Source, sans revérifier tout le fichier. Utilisez Tout valider quand
vous voulez une vérification complète de toutes les colonnes à la fois.

### L'orthographe n'est pas votre problème

Une valeur qui ne diffère du vocabulaire que par les majuscules, ou parce qu'elle écrit Centre là où
le vocabulaire écrit Center, se résout toute seule et n'atteint jamais cette liste. Le
`Health Centre` de votre registre est importé comme `health-center`, et les mots que votre fichier a
réellement employés sont conservés à côté de la ligne.

Un nom réellement différent vous parvient toujours. `1st Level Hospital` n'est l'orthographe de rien
dans le vocabulaire : il attend donc votre décision, et c'est bien le but.

**Une correspondance que vous avez faite à la main l'emporte toujours.** Rien de décidé
automatiquement ne passe outre une décision que vous avez prise.

Chaque étape affiche un seul bouton, celui qui fait avancer. Toute autre action, dont les trois
options de nouvelle vérification et Fermer, reste dans le menu `⋯` de la page.

**Il n'y a pas de bouton Enregistrer. L'icône d'état est l'enregistrement.** Choisissez les valeurs
dans les listes sous une ligne, puis appuyez sur l'icône de cette ligne : elle enregistre vos choix,
relit la colonne et passe la ligne au vert s'il ne reste rien. Tout valider fait la même chose pour
toutes les lignes avant de vérifier le fichier entier. D'ici là, la ligne dit ce qui attend, par
exemple « 4 valeur(s) non reconnue(s). 2 choisie(s), pas encore enregistrée(s) ».

Vous ne pouvez pas cliquer sur une étape que vous n'avez pas encore atteinte, ni revenir à une
étape antérieure pendant qu'une vérification en arrière-plan est en cours. Cliquer sur Tout valider
au Mappage vous amène tout seul à Vérification dès que la vérification démarre, avant même qu'elle
ne se termine. Si la vérification trouve un problème dans la correspondance de colonnes,
l'assistant vous ramène à Mappage et affiche les erreurs à cet endroit, pour que vous puissiez
corriger la correspondance sur place.

### Corriger une cellule à l'étape Données

L'étape Données montre votre fichier sous forme de tableau. Cliquez sur une cellule pour changer ce
qu'elle dit.

Vos changements ne sont pas réécrits dans le fichier importé. Ils sont enregistrés à part, contre
le fichier lui-même, donc un nouvel import du même fichier garde chaque correction faite. Si le
fichier change, les corrections cessent de s'appliquer, car les numéros de ligne qu'elles nomment
ne veulent plus rien dire.

Une cellule corrigée porte un trait ambre sur son bord gauche, et un bouton pour annuler. Annuler
remet la valeur du fichier. Annuler une correction sur toute la colonne remet chaque ligne que
cette correction a changée, pas seulement la cellule cliquée.

Corriger une cellule dans une colonne mappée sur `level`, `status` ou `country` pose une question, sauf si
la cellule est vide : changer cette ligne, ou changer toutes les lignes qui disent la même chose.
Une cellule vide n'est pas une catégorie, donc la remplir ne change que cette ligne. Les catégories
se répètent souvent, donc une valeur corrigée une fois est en général fausse partout où elle
apparaît.

Deux choses qu'une correction ne peut pas faire. Elle ne peut pas sauver une ligne dont le nombre de
colonnes ne correspond pas à l'en-tête : cette ligne est mise de côté avant qu'aucune cellule
n'existe, donc corrigez-la dans le CSV. Et elle ne peut ni ajouter ni retirer une ligne. Une ligne
qui ne doit pas être importée est une ligne à retirer du CSV.

Corriger une cellule rend votre dernière vérification périmée. Vérifiez de nouveau la colonne, puis
validez, avant de passer à l'étape Vérification.

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
  donc `country` est généralement une valeur fixe plutôt qu'une colonne mappée.

  `level`, `status` et `country` sont liés à des jeux de valeurs, donc leur valeur fixe se choisit
  dans une liste au lieu de se saisir. Le choix écrit le code, c'est-à-dire la même chaîne que
  l'importateur produit pour une valeur mappée à la Révision, donc une valeur choisie n'a besoin
  d'aucun mappage. Vous pouvez toujours saisir une valeur absente de la liste. Le panneau vous le
  signale, et cette valeur est importée telle quelle puis apparaît à la Révision pour être mappée.
  Si une installation n'a aucune liste de valeurs pour un champ, le panneau le dit aussi, et rien
  n'est vérifié.
- **La garder comme donnée supplémentaire.** La colonne est quand même importée, transportée dans
  le champ `extras` de l'enregistrement, mais elle n'est pas traitée comme l'un des champs du
  contrat.

Vous n'êtes pas obligé de décider pour chaque en-tête. Laissez-en un tel quel et il réclame quand
même son champ tout seul, tant qu'il orthographie déjà exactement le nom d'un champ du contrat.
L'analyseur appelle cela une colonne **passthrough**. Un en-tête laissé tel quel qui n'orthographie
rien du contrat est refusé, sauf si vous activez **Autoriser les colonnes non reconnues**, ce qui
la transporte dans `extras` de la même façon que le choix « la garder comme donnée
supplémentaire ».

> **Votre mappage de colonnes décide du sort de chaque colonne.** Si vous mappez cinq colonnes sur
> vingt, les quinze autres sont conservées en données supplémentaires et l'import se poursuit. On ne
> vous interroge pas à leur sujet et rien n'est perdu : chaque ligne les porte dans ses données
> supplémentaires, là où va aussi une colonne que vous choisissez explicitement de conserver ainsi.
>
> **Sans aucun mappage, une colonne non reconnue arrête toujours le fichier.** Rien n'a indiqué à
> l'importateur si vous vouliez cette colonne, et il ne devinera pas : une colonne perdue en silence
> est pire qu'un fichier refusé. Utilisez l'option proposée qui vérifie de nouveau le fichier en
> conservant les colonnes non reconnues en données supplémentaires. Cette option doit être activée
> avant la lecture du fichier, elle ne peut donc pas être ajoutée à l'étape de confirmation.
> **Le fichier déjà envoyé est réutilisé** : un registre national n'est jamais envoyé deux fois
> pour changer un réglage.
>
> Une version JSONL ne s'arrête jamais pour cela : chaque ligne nomme ses propres champs.

## Comment obtenir une correspondance suggérée

Vous avez rarement besoin de construire une correspondance de colonnes à la main. L'assistant et
la CLI peuvent tous deux examiner les en-têtes d'un fichier et proposer une correspondance hors
ligne, sans aller-retour serveur :

- **Dans l'assistant :** ouvrez **Établissements**, choisissez **Importer**, sélectionnez le fichier
  et choisissez le registre. Quittez l'étape Source pour envoyer et stocker le fichier. L'étape
  Données affiche le fichier sous forme de tableau en lecture seule. L'étape Mappage s'ouvre ensuite
  avec une suggestion déjà remplie. Chaque ligne démarre avec une icône d'état ambre, décrite plus
  haut, car rien n'a encore lu le fichier. Cliquez sur une icône pour vérifier cette colonne, ou
  sur Tout valider pour les vérifier toutes.
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
| `duplicate_target` | Deux en-têtes revendiquent le même champ du contrat. Un en-tête revendique un champ en y étant mappé, **ou simplement en portant son nom** — une colonne nommée `Zone` revendique `zone` même si le panneau affiche `Non mappé`. | Décidez quel en-tête est correct pour ce champ, puis mettez l'autre sur `Non mappé`, ce qui conserve ses valeurs en donnée supplémentaire. |
| `constant_collision` | Une valeur fixe et un en-tête mappé (ou laissé tel quel et déjà correspondant) réclament tous deux le même champ. | Gardez un seul des deux, la valeur fixe ou la correspondance de colonne, pour ce champ. |
| `unknown_target` | Un en-tête est mappé vers un nom qui n'est pas l'un des champs du contrat. | Corrigez la faute de frappe, ou faites-le correspondre à une donnée supplémentaire s'il n'appartient pas du tout au contrat. |
| `missing_required` | `national_code` ou `name` n'a ni colonne mappée ni valeur fixe. | Mappez une colonne, ou fournissez une valeur fixe, pour le champ obligatoire manquant. |

> **Une colonne qui porte le nom d'un champ du contrat le revendique.** Un fichier contenant à la
> fois `Province` et `Zone` est refusé si vous mappez `Province` vers `zone`, car `Zone` le
> revendique déjà par son nom. Mettez `Zone` sur `Non mappé` pour libérer la revendication. Ses
> valeurs sont conservées en donnée supplémentaire, jamais perdues. Il en va de même pour
> `Ownership`, `Ward`, `District`, `Latitude` et `Longitude`.

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

Un contrôle occupe sa propre ligne sous la barre d'outils, parce que ce n'est pas une colonne
ordinaire :

- **État du mappage.** Si un établissement peut être une cible de mappage, et si quelque chose le
  mappe déjà. Mappé signifie qu'au moins un code observé s'y résout déjà. Non mappé signifie que
  l'établissement est prêt à être une cible mais que rien ne pointe encore vers lui. Non projeté
  signifie que l'établissement n'a pas encore atteint la table destinée aux rapports, donc il ne
  peut pas du tout être une cible de mappage. Cet état provient d'une jointure entre deux autres
  tables, pas d'une colonne stockée, il garde donc son propre menu déroulant au lieu de rejoindre
  la liste Filtrer.

Registre national occupait cette ligne comme deuxième zone. C'est une colonne de Filtrer
maintenant, sous le nom Registre national, car elle a toujours filtré une colonne stockée comme
tous les autres filtres. Filtrer lui donne des opérateurs que la zone n'avait pas : la zone exigeait
l'URI complète du registre, et « contient » en trouve une partie, vous pouvez donc taper `hfr` au
lieu de `urn:openldr:cs:facility-register:hfr` en entier. Les valeurs restent du texte libre plutôt
qu'une liste de choix, car un établissement peut porter un code de registre que votre installation
ne liste plus comme source active, et une liste de choix masquerait ces lignes.

Une vue filtrée et triée peut être partagée. Les filtres et tris apparaissent dans l'URL de la
page, donc copier le lien et l'envoyer à quelqu'un rouvre la même vue. Les anciens liens qui
utilisaient un seul paramètre de requête, comme `?zone=Central`, fonctionnent toujours.

Dans le studio, Filtrer et Trier peuvent utiliser ces colonnes : code, nom, région, district,
statut, source, zone, conseil, pays, niveau, propriété, origine gérée, état du registre et registre
national.

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

La CLI peut aussi filtrer et trier par `id`, la seule colonne que la barre d'outils du studio
laisse de côté. `health` n'a pas de forme `--where` : elle est calculée, pas stockée, donc
filtrez-la plutôt via le menu déroulant État du mappage du studio. Utilisez `facilitySystem` pour
le registre national, le nom de colonne qu'emploie aussi le filtre Registre national du studio.

Une colonne inconnue, ou un opérateur que cette colonne n'autorise pas, est rejeté avec un message
qui nomme précisément l'erreur, la même validation qu'utilise la barre d'outils. Un indicateur mal
saisi échoue de la même façon qu'un filtre mal saisi dans le navigateur.

## Guides associés

- [Terminologie](/docs/terminology)
- [Audit](/docs/audit)

## Supprimer des établissements en masse

Le menu de ligne supprime un établissement. Un registre national en compte des milliers, donc un
import mal mappé a besoin d'une sortie autre qu'une ligne à la fois. **Supprimer ces
établissements…**, dans le menu `⋯` de la page, retire tout ce que le filtre courant du tableau
sélectionne.

Lisez la confirmation avant de l'accepter. Elle nomme trois choses, chacune répondant à une question
différente :

- **Le nombre.** C'est ce qui autorise la suppression. Si la sélection change entre la confirmation
  et votre clic, l'opération est refusée et rien n'est supprimé.
- **Combien sont utilisés par des rapports.** Les supprimer change ce que montrent les rapports. Si
  l'entrepôt est injoignable, la fenêtre le dit plutôt que d'annoncer zéro.
- **Quelques établissements par leur nom.** C'est la seule protection contre un filtre qui
  sélectionne des lignes non voulues. Si vous ne les reconnaissez pas, annulez et vérifiez le filtre.

Le filtre par état de mappage est le seul qu'une suppression en masse ne peut pas utiliser :
l'action est donc indisponible tant qu'il est actif. Effacez-le et sélectionnez plutôt par registre
ou par zone administrative.

Depuis un terminal :

```
openldr facilities delete --where facilitySystem:eq:urn:zmb:mfl --force
```

`--force` est obligatoire, tout comme un `--where` ou un `--all` explicite : oublier le filtre ne
doit jamais signifier silencieusement tout le registre.
