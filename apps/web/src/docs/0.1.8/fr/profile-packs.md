# Packs de profil

Un pack de profil prépare une installation OpenLDR pour un métier précis : un site de prélèvement, un poste de paillasse ou un centre de données. Une seule installation signée crée le rôle de ce métier, sa disposition de la barre latérale et ses formulaires. Le pack peut aussi indiquer les plugins à installer avant lui.

Un pack de profil est un pack de contenu dont les étapes comprennent `needs`, `role`, `layout` ou `form`. Il n'existe pas de type de paquet à part. Il s'installe, se met à jour et se supprime comme tout pack de contenu. Une même installation peut accueillir plusieurs profils côte à côte.

Les capacités restent le seul verrou. Une disposition masque des pages et n'accorde rien. Une personne n'ouvre une page que si l'un de ses rôles a la capacité correspondante.

Le guide intégré **Packs de profil** montre à un administrateur comment installer un pack, lire son résumé et le supprimer. Cette page s'adresse à la personne qui écrit le pack.

## Le fichier du pack

Un pack de contenu est un fichier `pack.json` placé à côté de son `manifest.json`. Les étapes s'exécutent dans l'ordre de la liste. Un pack peut mélanger les étapes de profil et les étapes plus anciennes, comme `code-system` ou `datasets`.

Le fichier est un seul objet avec `"formatVersion": 1` et une liste `steps`. Chaque section ci-dessous montre une étape de profil telle qu'elle figure dans cette liste. Placez les étapes dans l'ordre où elles doivent s'exécuter : un rôle avant la disposition et les formulaires qui le nomment.

Un CE qui ne connaît pas un type d'étape refuse tout le pack avec `this pack needs a newer CE`, avant d'écrire quoi que ce soit. Un CE plus ancien n'installe donc jamais un profil à moitié.

L'identifiant d'un rôle (`slug`) et la clé d'une disposition ou d'un formulaire (`key`) sont les noms propres au pack pour ce qu'il installe. Chacun compte de 2 à 48 caractères : lettres minuscules, chiffres et traits d'union, en commençant par une lettre. Chaque clé n'apparaît qu'une fois par type. Gardez-les identiques d'une version à l'autre. La version suivante retrouve ce que la précédente a créé grâce à ces clés.

### L'étape needs

`needs` liste les plugins et les packs de contenu dont ce profil dépend. Chacun a un identifiant et un intervalle de versions.

```json
{
  "kind": "needs",
  "bundles": [
    { "id": "sample-tracking", "version": ">=0.1.0 <0.2.0" }
  ]
}
```

L'installation s'arrête avant toute écriture s'il en manque un, ou si sa version sort de l'intervalle. Le message est `this pack needs <id> <range>, which is not installed`, ou `this pack needs <id> <range>; <version> is installed`. Un pack de contenu ne compte que si sa dernière installation s'est terminée sans étape en échec.

Un intervalle est `*`, une version exacte, ou une comparaison avec `>=`, `<=`, `>` ou `<`. Une espace entre deux comparaisons veut dire que les deux doivent être vraies. `||` veut dire l'une ou l'autre. Ni `^` ni `~` ne sont acceptés.

L'installation ne touche pas aux paquets dont elle dépend, la suppression non plus.

### L'étape role

`role` crée un rôle, avec son nom, une description facultative et ses clés de capacités.

```json
{
  "kind": "role",
  "slug": "sample-clerk",
  "name": "Sample Clerk",
  "description": "Registers samples and sends them to the lab.",
  "capabilities": ["forms.view", "forms.submit", "patients.view"]
}
```

Chaque capacité doit être une clé que le CE en cours connaît. Les clés sont listées dans `packages/rbac/src/catalog.ts` dans les sources du CE, et la page Rôles montre la même liste par nom. Une clé inconnue fait échouer l'installation avec `unknown capability: <key>`.

L'identifiant doit déjà être sous sa forme finale : lettres minuscules, chiffres et traits d'union simples. Le CE refuse un identifiant qu'il modifierait en l'enregistrant.

### L'étape layout

`layout` crée une barre latérale nommée. `roles` liste les rôles qui la reçoivent par défaut.

```json
{
  "kind": "layout",
  "key": "collection-site",
  "name": "Collection site",
  "startPage": "/forms",
  "pages": ["/forms", "/patients", "/docs"],
  "roles": ["sample-clerk"]
}
```

`name` compte de 1 à 60 caractères, et aucune autre disposition de l'installation ne doit le porter. `pages` liste de 1 à 50 chemins du studio, chacun une seule fois. `startPage` est l'une des `pages`, ou `null` pour ouvrir la page par défaut.

### L'étape form

`form` installe un Questionnaire FHIR comme formulaire, le publie, et définit qui peut l'ouvrir et le soumettre.

```json
{
  "kind": "form",
  "key": "sample-dispatch",
  "questionnaire": {
    "resourceType": "Questionnaire",
    "title": "Sample dispatch",
    "status": "active",
    "item": [
      { "linkId": "batch", "text": "Batch number", "type": "string", "required": true },
      { "linkId": "sent-on", "text": "Date sent", "type": "date" }
    ]
  },
  "open": ["sample-clerk"],
  "submit": ["sample-clerk"]
}
```

Le formulaire prend son nom dans le `title` du Questionnaire. Son libellé de version est la version du pack. `open` et `submit` prennent des identifiants de rôle, que le CE convertit en identifiants internes de l'installation où il s'exécute. Une liste vide veut dire tous les rôles qui ont la permission, comme dans le panneau **Accès** du constructeur de formulaires. Pour soumettre, une personne doit aussi pouvoir ouvrir le formulaire.

Les codes et les jeux de valeurs d'un Questionnaire appartiennent au pack. Gardez-les dans le dépôt du pack, jamais dans le CE.

## Les règles qu'un pack doit suivre

OpenLDR vérifie toutes les étapes avant d'en écrire une seule. Un pack qui enfreint l'une de ces règles n'installe rien.

- **Un pack ne modifie que ce qu'il a créé.** Le CE enregistre quel pack a créé chaque rôle, disposition et formulaire. Si un rôle avec le même identifiant, ou une disposition avec le même nom, existe déjà sans venir de ce pack, l'installation s'arrête et le nomme.
- **Une disposition ou un formulaire ne nomme que les rôles du pack.** Chaque identifiant dans `roles`, `open` ou `submit` doit appartenir à une étape `role` placée plus tôt dans le même pack. Un pack ne peut pas rattacher sa disposition ou ses formulaires à un rôle créé par un administrateur, car faire d'une disposition le défaut d'un rôle modifierait ce rôle.
- **La personne qui installe doit avoir roles.manage.** Installer un paquet demande `marketplace.manage`. Un pack avec une étape de rôle demande aussi `roles.manage`. C'est aussi le cas de toute mise à jour d'un pack qui a créé un rôle, même si la nouvelle version n'a plus d'étape de rôle, et de la suppression d'un tel pack. Les messages sont `installing this pack needs the roles.manage capability` et `removing this pack needs the roles.manage capability`.
- **Un pack n'accorde pas plus que ce que détient la personne qui l'installe.** Si une étape de rôle liste une capacité que cette personne n'a pas, l'installation s'arrête avec `you cannot install a role that grants <key>, because you do not hold it`. Lancée sur la machine elle-même, la CLI n'est pas limitée par ces deux contrôles.

Les étapes écrivent une à une, sans transaction autour. Si une étape de formulaire échoue après qu'une étape de rôle a écrit, le rôle reste. Réinstaller le même pack retrouve ce rôle par son identifiant et le met à jour. Chaque étape de profil peut s'exécuter deux fois sans dommage.

## Mises à jour et suppression

Une version plus récente du pack met à jour le rôle, la disposition et le formulaire qu'il a créés. Une modification faite par un administrateur sur l'un d'eux est perdue à la mise à jour suivante. Les pages Rôles et Dispositions affichent **Du pack** et l'identifiant du pack sous chaque élément créé par un pack, pour que ce ne soit pas une surprise.

Si la nouvelle version ne contient plus un rôle ou une disposition créé par l'ancienne, la mise à jour le supprime. Si quelqu'un a encore ce rôle, la mise à jour s'arrête avant toute écriture et nomme chaque rôle avec ses utilisateurs. Un formulaire absent de la nouvelle version reste tel quel et n'appartient plus au pack.

Supprimer le pack efface ses dispositions, puis ses rôles. Si le pack a créé un rôle, la suppression demande `roles.manage`. Sans elle, le message est `removing this pack needs the roles.manage capability`. La suppression refuse tant que quelqu'un a l'un de ses rôles, et liste ces personnes. Elle laisse ses formulaires publiés, avec toutes leurs réponses, pour qu'un administrateur les archive à la main. Supprimer un rôle le retire de la liste d'accès de chaque formulaire. Si ces formulaires étaient réservés aux rôles du pack, toute personne qui a `forms.view` pourra les ouvrir après la suppression. Elle ne touche pas aux systèmes de codes, requêtes, jeux de données et correspondances installés par le pack, ni aux paquets nommés dans `needs`.

Sur un serveur central, un pack n'agit que sur ce serveur. Ses rôles et ses dispositions y restent. Ses formulaires rejoignent les laboratoires comme n'importe quel formulaire.

## La liste des étapes dans le manifeste

`manifest.json` reprend chaque étape sur une ligne `kind`, `label` et `count`, dans `payload.steps`. L'écran d'installation lit cette liste. Le CE la recalcule à partir de `pack.json` et refuse le pack avec `step list does not match pack.json` quand les deux diffèrent. Pour les étapes de profil :

| Étape | `label` | `count` |
| --- | --- | --- |
| `needs` | Les identifiants des paquets, séparés par `, ` | Le nombre de paquets |
| `role` | Le `name` du rôle | Le nombre de capacités |
| `layout` | Le `name` de la disposition | Le nombre de pages |
| `form` | Le `title` du Questionnaire, sinon la `key` du formulaire | 1 |

Pour l'exemple du site de prélèvement ci-dessus, la liste est :

```json
[
  { "kind": "role", "label": "Sample Clerk", "count": 3 },
  { "kind": "layout", "label": "Collection site", "count": 3 },
  { "kind": "form", "label": "Sample dispatch", "count": 1 }
]
```

La liste doit avoir une ligne par étape du pack, dans le même ordre. Sinon, l'installation échoue avec `step list does not match pack.json`.

Un pack de contenu ne déclare aucune capacité dans son manifeste et doit nommer un éditeur.

## Construire, signer et installer

Un pack de profil se construit et se signe comme tout pack de contenu. `openldr artifact keygen --out <dir>` crée une clé d'éditeur dans ce dossier. `openldr artifact pack <dir> --key <key>` remplit l'empreinte de `pack.json` et celle de la clé, signe le manifeste et écrit le paquet. [Interface en ligne de commande (CLI)](/docs/cli) liste les commandes `artifact` et `market`.

Avant de publier, essayez le paquet sur une installation de test :

```sh
openldr market install <bundle-directory> --dry-run
openldr market install <bundle-directory>
openldr market update <bundle-directory>
openldr market remove <pack-id> --force
```

`--dry-run` n'écrit rien. Il fait les contrôles comme si vous déteniez toutes les capacités. Il ne teste donc ni la règle `roles.manage`, ni si vous détenez chaque capacité qu'un rôle accorde. `market update` installe une version plus récente d'un pack déjà installé. Sans `--force`, `market remove` affiche les rôles et les dispositions qu'il supprimerait, les formulaires qu'il garde, et les personnes qui ont encore l'un des rôles du pack. Il ne change rien.

Connectez-vous ensuite au studio avec un compte qui a le rôle, et vérifiez que la barre latérale montre les pages de la disposition et que les formulaires s'ouvrent.
