# Interface en ligne de commande (CLI)

OpenLDR fournit une interface en ligne de commande (CLI) d'exploitation, `openldr`, pour les tâches de base de données, de terminologie, d'ingestion, de plugins, de rapports, d'utilisateurs et de marketplace. Elle couvre tout ce que vous pouvez faire dans l'application, plus des opérations de plus bas niveau.

## L'exécuter

**Sur une pile installée**, l'installateur place un script `openldr` dans votre dossier d'installation. Lancez-le depuis ce dossier :

```
./openldr <command>
./openldr --help           # list every command group
./openldr db --help        # drill into a group
```

Sous Windows, utilisez `.\openldr.ps1` à la place.

Le script exécute la CLI dans le conteneur `api`. Cela a une conséquence à connaître : **les commandes qui lisent ou écrivent des fichiers ne voient que le dossier `data`.** Placez un fichier dans `./data`, à côté du script, et nommez-le avec le préfixe `data/` :

```
./openldr ingest data/bundle.json
./openldr sync export --out data/export.ndjson
```

Un chemin hors de `data/` ne sera pas trouvé. Un chemin `--out` hors de ce dossier échoue maintenant en général avec une erreur de permission, au lieu d'écrire dans le conteneur et de disparaître au redémarrage.

Le script s'exécute sous l'utilisateur qui le lance. Cet utilisateur doit donc pouvoir écrire dans `./data`. Si l'installation a tourné avec `sudo`, `./data` appartient à root, et un `./openldr sync export --out data/x.ndjson` lancé plus tard sans root échoue avec `EACCES`. Pour corriger, donnez la propriété du dossier à l'utilisateur qui lance le script, ou lancez le script sous l'utilisateur propriétaire du dossier.

Un opérateur sans accès au groupe `docker` doit lancer `sudo ./openldr`, ce qui fait tourner le processus du conteneur en root. Root peut écrire partout dans le conteneur. Un `--out` sans préfixe écrit alors en silence et se perd au redémarrage. C'est exactement l'échec que la règle `data/` doit empêcher. Préfixez toujours les chemins de sortie par `data/`.

**Depuis une copie des sources**, lancez-la plutôt par l'espace de travail :

```
pnpm openldr <command>
```

La plupart des commandes de lecture acceptent `--json` pour une sortie lisible par une machine. Dans une pile déployée, les étapes courantes du cycle de vie (migration du schéma et chargement des données de départ) s'exécutent automatiquement au démarrage. Les actions d'administration et de la zone dangereuse sont aussi disponibles dans l'interface Studio, sous Paramètres.

### Choisir le véritable dossier d'installation

Exécutez la CLI installée sur l'ordinateur hébergeant OpenLDR. À distance, utilisez l'accès SSH ou le terminal distant que vous avez configuré. Ouvrir Studio avec Tailscale n'ouvre pas un terminal sur cet ordinateur.

Si vous avez téléchargé et installé OpenLDR dans `~/Downloads/openldr_ce` sous Linux ou macOS :

```sh
cd ~/Downloads/openldr_ce
ls
./openldr --help
./openldr ingest --help
```

Si vous l'avez installé dans `C:\openldr_ce` sous Windows, ouvrez PowerShell et exécutez :

```powershell
cd C:\openldr_ce
Get-ChildItem -Name
.\openldr.ps1 --help
.\openldr.ps1 ingest --help
```

Remplacez ce dossier d'exemple par le vôtre. Il contient `docker-compose.yml`, `data` et le lanceur. Exécutez une commande à la fois. Les commandes d'aide ne modifient aucun dossier. Le guide **Commencer ici** de l'application illustre chaque étape avec des images du terminal et du gestionnaire de fichiers.

### Utiliser une copie du code source

Utilisez la racine du dépôt, qui contient `package.json`, `pnpm-workspace.yaml`, `apps` et `packages`. Les mêmes chemins d'exemple s'appliquent au code source. Sous Linux ou macOS :

```sh
cd ~/Downloads/openldr_ce
pnpm openldr --help
pnpm openldr ingest --help
```

Sous Windows, utilisez `cd C:\openldr_ce`, puis les mêmes commandes `pnpm openldr`. Configurez d'abord les dépendances et `.env`, comme indiqué dans [Développement](/docs/development).

La CLI source s'exécute sur l'ordinateur et utilise les bases et le stockage de `.env`. Ces services doivent être démarrés pour importer. Les serveurs de développement Studio et API ne sont pas nécessaires. La CLI source lit les fichiers locaux hors du dossier partagé `data`. Pour votre fichier JSON FHIR valide dans `files/my-file.json` :

```sh
pnpm openldr fhir validate files/my-file.json
```

Cette validation n'importe rien. Pour écrire le fichier dans la base de développement, vérifiez `.env`, puis exécutez :

```sh
pnpm openldr ingest files/my-file.json
pnpm openldr pipeline status
```

L'essai Linux a importé une ressource Organization et indiqué un lot terminé. Votre identifiant et votre nombre de ressources dépendent du fichier.

## Corriger une erreur de la CLI installée

Ces cas ont été reproduits sous Linux avec le lanceur installé et la véritable CLI dans une installation isolée. Windows et macOS n'ont pas été testés nativement. Commencez dans votre dossier d'installation et identifiez l'erreur.

| Erreur | Correction vérifiée pendant l'essai |
| --- | --- |
| `./openldr: not found` ou `no configuration file provided: not found` | Revenez dans le véritable dossier d'installation, puis exécutez `./openldr --help`. Vérifiez la présence du lanceur et du fichier Compose. |
| `failed to connect to the docker API` avec une adresse `DOCKER_HOST` incorrecte | Exécutez `docker info`. Si cette valeur forcée est incorrecte, retirez-la avec `unset DOCKER_HOST`, puis réessayez `docker info` et l'aide CLI. Sous PowerShell : `$env:DOCKER_HOST = $null`. Cela ne démarre pas Docker. |
| `service "api" is not running` | Vérifiez `docker compose ps -a api`, exécutez `docker compose up -d api`, puis réessayez l'aide. L'essai prouve la reprise du lanceur, pas le démarrage HTTP complet de l'application. |
| `ingest failed: ENOENT` avec un fichier à côté du lanceur | Déplacez le fichier dans le dossier `data` de l'installation. Exécutez `./openldr fhir validate data/my-file.json`, puis importez ce chemin si vous le souhaitez. La CLI de développement lit les chemins locaux ordinaires. |

## Groupes de commandes

| Groupe | Ce qu'il fait |
| --- | --- |
| `health` | Indique l'état des services (authentification, stockage, événements, stockage cible). |
| `db` | Applique les migrations (`migrate`), réinitialise (`reset`) et remplit (`seed`) la base de données ; reconstruit le modèle de lecture de l'entrepôt (`reproject`). |
| `patients` | Liste (`list`) et affiche (`show`) les patients (masqués sauf avec `--identifiers`, ce qui est audité) ; `identifier-systems list` et `set` pour les libellés. |
| `settings` | `flags list` / `flags set` pour les fonctionnalités, `danger <action>`, et `sync show` / `sync set` (configuration de la synchronisation laboratoire⇄central). |
| `terminology` | Importe et interroge des CodeSystems, ValueSets, ConceptMaps et ontologies. |
| `fhir` | Valide des ressources FHIR R4. |
| `forms` | Liste les définitions de formulaires ; extrait les réponses d'une QuestionnaireResponse. |
| `ingest` | Ingère un fichier par le pipeline (en option via un plugin). |
| `facilities` | Importe un registre national d'établissements : `suggest-map`, `suggest-values`, `import` (correspondance des colonnes et des valeurs, voir **Établissements** dans la documentation du studio). |
| `test-catalog` | Le catalogue national des examens : `list` liste les examens, `import` importe une liste depuis un fichier CSV ou Excel, `export` l'exporte en CSV, `enable` ou `disable` active ou désactive un examen dans ce laboratoire, et `retire` ou `restore` retire ou rétablit un examen là où cette installation possède le catalogue. |
| `query` | Requêtes personnalisées : `export` les exporte dans un fichier JSON, `import` les importe depuis un fichier (`--force` remplace les noms existants). |
| `pipeline` | Examine les lots d'ingestion : `status`, `retry`, `logs`. |
| `queue` | Examine la file d'événements. |
| `provenance` | Outils d'audit de provenance. |
| `plugin` | Gère les plugins d'ingestion WASM : `install`, `list`, `test`, `run`, `remove`. |
| `report` | `list` et `run` pour les rapports analytiques ; `glass-export`. |
| `audit` | Lit le journal d'audit, en ajout seul. |
| `user` | Gère les utilisateurs : `list`, `show`, `create`, `set-role`, `activate`, `deactivate`. Les changements de statut mettent aussi à jour les comptes liés chez le fournisseur. `export` est une commande de jeu de données de premier niveau. |
| `market` | Artefacts de la marketplace : `verify`, `install`, `update`, `list`, `rollback`, `enable`, `disable`, `remove`. |
| `artifact` | Création d'artefacts : `keygen`, `new`, `build`, `pack`, `sign`, `test`, `publish`. |
| `sync` | Synchronisation distribuée (laboratoire⇄central) : `status`, `now`, et côté central `enroll`, `list`, `rotate`, `revoke`. |
| `errors` | Liste le catalogue des codes d'erreur. |
| `update` | `check` vérifie si une version plus récente d'OpenLDR a été publiée (code de sortie 0 = à jour, 1 = une mise à jour est disponible, 2 = la vérification a échoué). |
| `storage` | `copy` copie les objets d'un autre compartiment S3 dans le stockage de cette installation. |
| `target-store` | Teste la connexion à l'entrepôt cible. |

Les commandes CLI qui modifient des données (`sync enroll/rotate/revoke`, `user create/set-role/activate/deactivate`, `settings … set`, `settings danger …`, `db reset`, `db reproject`, `terminology import/create`, `query import`) enregistrent un événement d'audit. Le type d'acteur est **`cli`** et le nom d'acteur est recherché **dans le conteneur**, pas dans le nom d'utilisateur de l'opérateur. Sur une installation Docker, ce nom suit l'uid de l'hôte qui lance le script : l'uid 1000 correspond à `node`, et la plupart des autres uid n'ont aucun nom d'utilisateur dans le conteneur. C'est alors la valeur de repli `cli` qui est enregistrée. Utilisez l'option globale `--actor <name>` pour enregistrer le vrai nom de l'opérateur. Ces événements apparaissent sur la page Audit, à côté des actions faites dans l'interface.

## Tâches courantes

Mettre une base de données à jour après avoir récupéré de nouvelles migrations (non destructif, garde les données) :

```
./openldr db migrate
```

Réinitialiser et remplir une base de développement (`db reset` **supprime et recrée** le schéma) :

```
./openldr db reset
./openldr db seed
```

`db seed` refuse de s'exécuter quand des migrations sont en attente, et nomme ce qui manque. Lancez d'abord `db migrate`.

Reconstruire le modèle de lecture de l'entrepôt à partir du magasin FHIR canonique (`db reproject` **réécrit chaque ligne projetée**, donc la commande refuse de s'exécuter sans `--force`) :

```
./openldr db reproject --force
```

Elle affiche deux comptes distincts : les ressources canoniques réécrites, et les arrivées enregistrées dans le registre d'ingestion (une par version d'une ressource clinique). Ce sont des unités différentes, pas le même nombre. Comme `db seed`, elle refuse de s'exécuter quand des migrations sont en attente, au lieu d'aller jusqu'au bout sur un schéma en retard. Utilisez-la pour compléter les données après une mise à niveau qui ajoute une table à l'entrepôt.

`terminology reproject` est **obsolète**. Elle a toujours lancé la même reconstruction complète du modèle de lecture, jamais une reconstruction limitée à la terminologie. Elle fonctionne encore comme alias, affiche maintenant un avertissement d'obsolescence et hérite de la protection `--force`. Utilisez plutôt `db reproject`.

Installer et lancer un plugin d'ingestion, puis ingérer un fichier avec :

```
./openldr plugin install data/plugin.wasm
./openldr ingest data/results.sqlite --plugin whonet-sqlite
```

Créer un utilisateur local et lui attribuer des rôles :

```
./openldr user create --username alice --name "Alice" --email alice@example.org --role lab_technician
./openldr user set-role <id> lab_admin
```

Basculer un indicateur de fonctionnalité :

```
./openldr settings flags list
./openldr settings flags set dashboard.raw_sql true
```

Lancer un rapport :

```
./openldr report list
./openldr report run <id>

# PDF in the design's own text, then in French
./openldr report run <id> --format pdf --out report.pdf
./openldr report run <id> --format pdf --lang fr --out rapport.pdf
```

`--lang` imprime les traductions enregistrées dans la conception du rapport, y compris les dates. Les rapports intégrés sont fournis avec le français et le portugais, donc cela fonctionne pour eux sans configuration. Un texte sans traduction dans cette langue s'imprime tel qu'il a été écrit, et les données ne sont jamais traduites.

Inscrire un laboratoire sur le serveur central, puis y connecter un laboratoire :

```
# On central: mint the lab's client + secret (printed once)
./openldr sync enroll lab-site-01 --central-url https://central.example.org

# On the lab: apply the credentials, then check status
./openldr settings sync set clientId sync-lab-site-01
./openldr settings sync set mode bidirectional
./openldr settings sync set enabled true
./openldr sync status
```

> La synchronisation distribuée relie des laboratoires à un serveur central : les données opérationnelles remontent vers un miroir en lecture seule, la configuration de référence et la terminologie descendent. L'inscription crée un client Keycloak par laboratoire. Elle exige que le compte de service d'administration du realm central ait `manage-clients`/`view-clients`.

> Tout ce qui se trouve sous `settings danger` est destructif (réinitialiser les tableaux de bord, effacer l'audit, réinitialisation d'usine). Ces commandes exigent `--force` et reprennent la zone dangereuse du Studio.

## Copier des fichiers entre stockages S3

`openldr storage copy` copie chaque objet d'un autre compartiment S3 dans le stockage de cette installation. Utilisez-la pour quitter MinIO, comme le décrit le [guide de mise à niveau](/docs/upgrading). Elle lit la source et ne la modifie jamais. Elle ignore une clé déjà présente sur la cible avec la même taille : vous pouvez donc la relancer pour reprendre. Un objet de même taille mais de contenu différent n'est pas recopié. Elle affiche le nombre d'objets et d'octets des deux côtés, puis vérifie que chaque objet de la source est sur la cible avec la même taille. Elle se termine avec un code non nul s'il en manque un. Des objets en plus sur la cible sont normaux tant que l'api tourne, car elle continue d'y écrire de nouveaux fichiers. Ils ne font pas échouer la vérification. La CLI enregistre l'acteur sous `cli`.

| Option | Ce qu'elle fait |
| --- | --- |
| `--from-endpoint <url>` | Point de terminaison du stockage source, par exemple `http://minio:9000`. |
| `--from-key <key>` | Clé d'accès du stockage source. |
| `--from-secret <secret>` | Clé secrète du stockage source. Elle apparaît dans l'historique du shell et dans la liste des processus. Effacez ensuite cette ligne de l'historique. |
| `--from-bucket <bucket>` | Compartiment à copier. |
| `--from-region <region>` | Région du stockage source. Par défaut `us-east-1`. |
| `--json` | Affiche le rapport en JSON. |

## Nouvelles tentatives de projection

Le worker de projection enregistre les écritures de ressources et du registre des arrivées qui ont échoué, pour les retenter automatiquement.
Les nouvelles tentatives survivent à un redémarrage et relisent la ressource canonique actuelle, suppressions comprises.
Un cycle retente au plus 100 ressources en file, puis traite les nouveaux changements.
Les échecs répétés attendent 1, 2, 4 secondes et ainsi de suite, jusqu'à cinq minutes.
Les tentatives continuent jusqu'à la réussite. Une ressource en échec ne bloque pas les changements valides suivants.
Un nouveau changement de cette ressource peut déclencher une tentative avant la fin du délai.
Si l'enregistrement d'une tentative échoue, le worker laisse son curseur inchangé.
Une projection réussie efface la tentative. Les erreurs des hooks de capture annexes sont journalisées sans planifier de nouvelle tentative.
Aucune action de l'opérateur n'est nécessaire une fois une panne temporaire terminée.
Pour une reconstruction complète volontaire, utilisez `openldr db reproject --force`.

## Désactiver ou activer l'accès

Ouvrez le menu **Actions** de la ligne du compte pour le désactiver ou l'activer. La désactivation écrit le blocage d'accès local avant de mettre à jour le fournisseur d'identité. La requête API authentifiée suivante renvoie `403 account disabled`, y compris pour les requêtes avec un jeton déjà émis. Un écran déjà chargé dans le navigateur peut rester visible.

Les comptes qui ne se sont jamais connectés reçoivent aussi un blocage local. L'activation met d'abord à jour le fournisseur, puis lève ce blocage. Si l'une des deux écritures échoue, l'action signale une erreur. Une désactivation échouée peut laisser le compte activé chez le fournisseur alors qu'OpenLDR bloque l'accès. Une activation échouée peut laisser le compte activé chez le fournisseur alors que le blocage local reste en place. Rétablissez la connexion en échec et relancez la même action. Les enregistrements d'audit utilisent `user.status.failed` pour les échecs et `user.status` pour les réussites.

Pour la CLI, utilisez `openldr user deactivate <local-id>` ou `openldr user activate <local-id>`. Trouvez l'ID local avec `openldr users list`. Les comptes liés mettent à jour les deux systèmes avec leur identifiant chez le fournisseur. Les comptes créés uniquement dans le stockage local changent localement. Les enregistrements d'audit de statut de la CLI identifient l'acteur comme `cli`.

Si un autre changement de statut est en cours pour ce compte, l'API renvoie `409`. Attendez la fin de cette action, puis réessayez. Cela s'applique aussi quand Studio et la CLI modifient le même compte.

## Comptes de la connexion locale

Ces commandes servent à une installation avec `AUTH_ADAPTER=local`. Voir [Fournisseurs d'authentification](/docs/auth-providers). Les lignes d'usage ci-dessous sont copiées du `--help` de chaque commande :

```text
Usage: openldr auth setup-code [options]
Usage: openldr user create [options]
Usage: openldr user assign-role [options] <subject> <slug>
Usage: openldr user reset-password [options] <username>
Usage: openldr user end-sessions [options] <username>
```

- `openldr auth setup-code` affiche un code à usage unique pour créer le premier administrateur dans Studio. Il est valable 30 minutes, et un nouveau code remplace le précédent. Dès qu'un administrateur existe, la commande refuse avec `an administrator already exists`. Le code n'est jamais écrit dans le journal d'audit.
- `openldr user create --username <u>` crée un compte qui peut se connecter. La commande affiche l'ID du nouvel utilisateur et un mot de passe temporaire, une seule fois. La personne doit changer ce mot de passe à la première connexion. `--role` prend l'identifiant d'un rôle comme `lab_technician`. Un rôle qui n'existe pas fait refuser la commande avec `no role named <slug>`, et rien n'est créé. Tant que le premier administrateur n'existe pas, la commande refuse et vous dit de lancer `openldr auth setup-code`.
- `openldr user assign-role <subject> <slug>` ajoute un rôle. En connexion locale, le sujet est l'ID de l'utilisateur affiché par `user create`. Avec un nom d'utilisateur, la commande annonce un succès et n'accorde rien.
- `openldr user reset-password <username> --force` définit un nouveau mot de passe temporaire, l'affiche une seule fois et ferme les sessions de l'utilisateur. Celui-ci doit choisir un nouveau mot de passe à la connexion suivante. Sans `--force`, la commande refuse et ne change rien. C'est ainsi qu'on récupère le mot de passe oublié d'un administrateur.
- `openldr user end-sessions <username>` déconnecte l'utilisateur partout. Le mot de passe ne change pas.

`reset-password` et `end-sessions` comparent le nom d'utilisateur exactement, majuscules comprises. Avec Keycloak ou OIDC, elles refusent avec `local sign-in is not enabled`. `user create`, `reset-password` et `end-sessions` écrivent un événement d'audit avec le type d'acteur `cli`. Un mot de passe temporaire n'apparaît jamais dans le journal d'audit.

```
./openldr user create --username amina --name "Amina Hassan" --role lab_technician
./openldr user reset-password amina --force
./openldr user end-sessions amina
```

`user create` affiche trois lignes : `created amina (<id>)`, `temporary password: <password>` et `amina must change it at first sign-in.` Donnez le mot de passe directement à la personne.

## Pagination de l'annuaire des utilisateurs

Utilisateurs affiche d'abord les comptes actifs. La recherche porte sur les noms d'utilisateur du fournisseur, les noms et les adresses e-mail de tout l'annuaire. Choisissez Tous les statuts pour inclure les comptes désactivés. Changer la recherche, le statut ou la taille de page ramène à la première page.

Utilisez Suivant pour atteindre les comptes au-delà des 100 premiers. Chaque requête renvoie au plus 100 comptes. Le pied de tableau affiche la plage visible sans annoncer de total. Les colonnes restent configurables. Les filtres de colonne libres et le tri ne sont pas disponibles, car le fournisseur ne les prend pas en charge. Le fournisseur contrôle l'ordre. Des comptes ajoutés ou supprimés entre deux requêtes peuvent décaler les pages.

Pour un accès sans interface, lancez :

```sh
openldr user directory-list --offset 100 --limit 25 --search Ada --enabled true --json
```

Le JSON contient `rows`, `offset`, `limit`, `total: null` et `hasMore`. Ajoutez `limit` à `offset` tant que `hasMore` vaut true. Omettez `--enabled` pour inclure les deux statuts. `openldr user list` liste toujours les comptes locaux.

Quand l'administration du fournisseur n'est pas configurée, la liste de l'annuaire utilise les comptes locaux. La recherche locale trouve le nom d'utilisateur, le nom affiché et l'e-mail comme sous-chaînes. Les résultats locaux sont triés par nom d'utilisateur puis par ID. La recherche chez le fournisseur suit les règles de recherche du fournisseur d'identité.

## Catalogue des examens

Le catalogue des examens est la liste nationale des examens. C'est un système de codes de la page Terminologie, **Test catalog**. Ses catégories forment un second système de codes, **Test categories**, avec cinq catégories au départ : Chemistry, Haematology, Microbiology, Serology et Molecular. Modifiez les catégories sur la page Terminologie.

Le central conserve le catalogue. Un laboratoire le reçoit par la synchronisation de la terminologie et ne peut pas modifier ses examens. Chaque laboratoire enregistre ses propres réglages pour un examen : s'il le réalise, une liste de prélèvements plus courte et un nom local. La synchronisation n'envoie jamais ces réglages.

Lister le catalogue en ligne de commande :

```sh
openldr test-catalog list --search viral --category MOL --loinc linked --enabled on --json
```

Les examens retirés sont masqués, sauf si vous passez `--status retired` ou `--status all`. `--loinc none` liste les examens sans code LOINC. `--limit` vaut 25 par défaut et 200 au plus. Paginez avec `--offset`. Le JSON contient `rows`, `total` et `ownedHere`. `ownedHere` vaut false quand cette installation a reçu son catalogue du central.

Activer ou désactiver un examen dans ce laboratoire, ou le retirer et le rétablir, par son code :

```sh
openldr test-catalog enable HIVVL
openldr test-catalog retire HIVVL --json
```

`enable` et `disable` fonctionnent sur toute installation. `retire` et `restore` ne fonctionnent que là où cette installation possède le catalogue. Le retrait est réversible, donc aucune de ces commandes ne prend `--force`. Chacune est enregistrée dans le journal d'audit au nom de l'utilisateur CLI.

Importer une liste d'examens depuis un fichier CSV ou Excel (.xlsx) :

```sh
openldr test-catalog import national-tests.xlsx
openldr test-catalog import national-tests.xlsx --value-map answers.json --apply
```

Sans `--apply`, rien n'est écrit. La commande affiche le nombre de lignes nouvelles, modifiées, inchangées et refusées, chaque refus avec son numéro de ligne, ainsi que tout texte de catégorie ou de prélèvement qui ne correspond à rien. Les colonnes sont reconnues par leur en-tête. Pour les nommer vous-même, passez `--column-map` avec un fichier JSON comme `{"code": "Test code", "name": "Test name"}`. Répondez au texte non reconnu avec `--value-map` :

```json
{
  "categories": [{ "text": "Virology", "kind": "new", "code": "VIRO", "display": "Virology" }],
  "specimens": [{ "text": "Plasma", "system": "urn:openldr:cs:local", "code": "BLD" }]
}
```

Une réponse de catégorie est `"kind": "existing"` avec un `code`, ou `"kind": "new"` avec un `code` et un `display`. Seule une installation qui possède le catalogue peut importer. Un import appliqué est enregistré dans le journal d'audit au nom de l'utilisateur CLI. Exportez les examens actifs en CSV, vers la sortie standard ou vers un fichier :

```sh
openldr test-catalog export --out catalog.csv
```

Associer les codes d'examen du laboratoire aux examens du catalogue. Voir **Associer les codes de test du laboratoire** dans le guide Catalogue des examens de l'application. Le système est une URN, comme le montre la colonne Système de l'onglet Observés. Pour les données DISA, c'est `urn:openldr:disa` :

```sh
openldr test-catalog map list --status unmapped --json
openldr test-catalog map set urn:openldr:disa POCVR HIVVL
openldr test-catalog map clear urn:openldr:disa POCVR --force
openldr test-catalog map export --out mappings.csv
openldr test-catalog map import mappings.csv
openldr test-catalog map import mappings.csv --apply --force
openldr test-catalog map rebuild --apply
```

- `map list` liste les codes d'examen du laboratoire présents dans l'entrepôt, avec leur correspondance dans le catalogue. `--status` accepte `unmapped`, `mapped`, `ambiguous` ou `all`. `--search`, `--limit` (de 1 à 200, 25 par défaut) et `--offset` filtrent et paginent la liste.
- `map set <system> <code> <catalog-code>` associe un code à un examen du catalogue.
- `map clear <system> <code>` supprime une correspondance. La commande refuse de s'exécuter sans `--force`.
- `map export` écrit en CSV chaque code observé et sa correspondance, dans le format que lit `map import`. `--out` nomme un fichier. Sans cette option, le CSV va vers la sortie standard.
- `map import <file>` montre ce qui changerait et n'écrit rien. `--apply --force` écrit les changements. La commande refuse d'écrire sans les deux.
- `map rebuild` montre ce que contiendrait la copie `test_map` de l'entrepôt. `--apply` l'écrit.

Les codes de résultat utilisent les mêmes commandes avec `--level result`. La cible est un code de champ de résultat :

```sh
openldr test-catalog map list --level result --status unmapped
openldr test-catalog map set urn:openldr:disa HIVVC HIVVL --level result
openldr test-catalog map match urn:openldr:disa
openldr test-catalog map match urn:openldr:disa --apply --force
```

- `--level result` sur `map list`, `set`, `clear`, `export` et `import` agit sur les codes de résultat. Le CSV des résultats a les colonnes `system, code, description, results, parameter_code, loinc`.
- `map match <system>` liste chaque code de résultat non associé de ce système de laboratoire qui est égal à un code de champ de résultat. `--apply --force` les associe. La commande refuse `--apply` sans `--force`.

Lier les champs de résultat à LOINC :

```sh
openldr test-catalog result-fields list --loinc none
openldr test-catalog result-fields link HIVVL 20447-9
openldr test-catalog result-fields unlink HIVVL --force
openldr test-catalog result-fields export --out result-fields.csv
openldr test-catalog result-fields import result-fields.csv --apply --force
```

- `result-fields list` liste les champs avec leur rôle, leurs unités et leur lien LOINC. `--loinc` accepte `linked`, `none` ou `all`, et `--role` accepte `result`, `specimen`, `metadata` ou `admin`.
- `result-fields unlink` refuse de s'exécuter sans `--force`. `result-fields import` affiche un aperçu, sauf si `--apply --force` est donné. Un laboratoire qui reçoit son dictionnaire du central ne peut pas modifier les liens.
- `openldr terminology import parameters <file>` reconstruit `test_map` après avoir chargé le dictionnaire.

Chaque changement est enregistré dans le journal d'audit au nom de l'utilisateur CLI.

## Installer un pack de contenu

```sh
openldr market install <bundle-dir> --dry-run
openldr market install <bundle-dir>
```

`--dry-run` lance les vérifications et affiche les étapes. Pour chaque étape de liaison de codes, elle affiche combien de codes elle lierait. Pour chaque étape test-mappings ou result-mappings, elle liste les correspondances qu'elle créerait, garderait et ignorerait. Elle n'écrit rien. Un pack de contenu doit être signé par un éditeur. Réinstaller un pack déjà installé demande `--force`. Un pack dont la dernière installation a échoué s'installe de nouveau sans cette option. `openldr market update` accepte les mêmes options. Elle installe une version plus récente d'un pack installé sans `--force`. Elle refuse la même version ou une version plus ancienne, ainsi qu'un pack non installé, sauf si vous passez `--force`. `--json` affiche une sortie lisible par une machine. `openldr market list` affiche les packs avec leur statut. La CLI enregistre l'acteur sous `cli`.

## Préférences personnelles

Le guide **Vos préférences** de Studio se trouve dans **Préférences personnelles**. Il montre les choix de langue, thème, page de démarrage et barre latérale, avec une capture pour chaque étape. Les préférences sont enregistrées dans le compte de chaque utilisateur. Une page de démarrage personnelle passe avant celle de la disposition. Le tableau de bord est le dernier choix par défaut.

Pour les opérateurs, `user preferences show <user-id>` lit les valeurs enregistrées et `user preferences set <user-id> startPage none` efface le choix personnel de page de démarrage. Utilisez la commande de l'installation ou de développement décrite plus haut. Effacer le choix permet de réutiliser la page de démarrage de la disposition lorsqu'elle est configurée.
