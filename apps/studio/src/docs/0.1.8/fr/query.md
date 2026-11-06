# Requêtes personnalisées

L'espace Query permet d'écrire et d'enregistrer des requêtes SQL. Les rapports peuvent utiliser ces requêtes enregistrées.

![Explorateur des connecteurs et des requêtes personnalisées](query-workbench.png)

## Enregistrer une requête

1. Ouvrez **Query**, puis sélectionnez **+** dans la barre des onglets.
2. Le nouvel onglet reçoit un nom généré, par exemple `Query #1`.
3. Choisissez un connecteur et saisissez votre requête `SELECT`.
4. Ouvrez le menu des actions de la requête et choisissez Enregistrer. Au premier enregistrement, le panneau demande un Nom unique. Saisissez-le, puis choisissez Enregistrer dans le menu du panneau.
5. Rouvrez la requête depuis **Custom Queries** dans l'explorateur. Un nouvel enregistrement met à jour cette même requête.

Si la requête a des paramètres, un panneau les demande au lancement : choisissez Exécuter avec ces valeurs dans le menu d'actions du panneau. Un paramètre facultatif laissé vide vaut une chaîne vide. Il ne filtre donc rien si le SQL teste `''`.

Pour lire le registre des établissements, interrogez la table `facility_registry` de l'entrepôt. Voir [Établissements](/docs/facilities).

![Éditeur SQL avec une requête enregistrée et ses résultats](query-sql-editor.png)

## Renommer une requête

Renommer modifie uniquement le nom enregistré. Les modifications du SQL, du connecteur et des paramètres restent dans l'onglet jusqu'à Enregistrer dans le menu de la requête.

Choisissez Renommer dans le menu des actions. Modifiez le Nom, puis enregistrez depuis le menu du panneau. La requête conserve son identifiant et ses références dans les rapports. Si le nom existe déjà, le panneau conserve votre saisie et demande un autre nom.

Conservez les requêtes utilisées par des rapports. Les supprimer ne constitue pas une solution pour changer leur nom.

## Guides associés

- [Rapports](/docs/reports)
- [Concepteur de rapports](/docs/report-designer)
- [Connecteurs](/docs/connectors)

## Pagination SQL Server

La consultation des tables et les résultats des requêtes acceptent PostgreSQL, MySQL/MariaDB et SQL Server.
Les pages SQL Server affichent une plage et « total inconnu » : le nombre total de résultats n'a pas été calculé.
Next est disponible seulement si le serveur a trouvé une ligne au-delà de la page actuelle. Previous revient à la page précédente.
Une dernière page exactement pleine désactive aussi Next. Modifier Rows per page revient à la première page.
PostgreSQL et MySQL/MariaDB conservent leurs totaux calculés.

Pour une pagination reproductible, ouvrez SQL dans l'onglet de table et ajoutez ORDER BY avec une clé unique en dernier.
Par exemple, si id est unique dans votre table, ORDER BY created_at, id départage les horodatages identiques.
Dans un onglet de requête, ajoutez cet ordre avant Run. L'espace ne peut pas déduire une clé unique pour toute requête SQL.
La consultation simple d'une table ne garantit aucun ordre. Des lignes peuvent se répéter ou manquer sans ordre unique, ou si les données changent entre les demandes.
SQL Server lit jusqu'au décalage demandé ; les pages éloignées peuvent prendre plus de temps. La pagination ne crée pas d'instantané de la base.


## Exporter et importer des requêtes

Utilisez le menu d'actions dans l'en-tête de l'Explorateur. Choisissez Exporter les requêtes ou Importer des requêtes. Le même menu propose Actualiser, qui recharge l'Explorateur quand des requêtes changent ailleurs, par exemple depuis la CLI ou un pack de contenu.

Le fichier contient le nom, le SQL et les paramètres de chaque requête, ainsi que le nom de son groupe s'il en a un. Il ne contient ni l'identifiant ni le connecteur.

L'importation suit ces règles :

- Un nouveau nom est créé.
- Un nom qui existe déjà est ignoré, sauf si vous choisissez de le remplacer.
- Le remplacement conserve l'identifiant et le connecteur de la requête. Les rapports qui l'utilisent continuent donc de fonctionner.
- Remplacer une requête intégrée livrée avec CE est annulé la prochaine fois que CE recharge ses requêtes intégrées.
- Si une requête remplacée change l'identifiant d'un paramètre, les rapports qui définissent l'ancien paramètre le perdent.
- Une seule requête invalide arrête tout le fichier. Rien n'est écrit.

Les nouvelles requêtes utilisent `Target Warehouse (Postgres)`, sauf si vous choisissez un autre connecteur.

En ligne de commande :

```
openldr query export --out queries.json [--name <name>...]
openldr query import queries.json [--connector <name>] [--force]
```

`--out` écrase un fichier existant. `--force` remplace les requêtes qui existent déjà.

Le contenu écrit pour un système de laboratoire est partagé sous forme de ces fichiers. Ils sont gardés dans le dossier `packs/` de l'opérateur, pas dans CE.

## Grouper les requêtes

Un pack de contenu peut ajouter beaucoup de requêtes d'un coup. Les groupes gardent la liste de l'Explorateur lisible.

- Pour créer un groupe, ouvrez le menu d'actions de **Requêtes personnalisées** et choisissez **Nouveau groupe**. Saisissez un nom, puis choisissez Enregistrer dans le menu du panneau.
- Pour mettre une requête dans un groupe, faites-la glisser sur le groupe. Sur un téléphone, appuyez longuement sur la requête d'abord, ou utilisez **Déplacer vers le groupe** dans le menu d'actions de la requête.
- Pour sortir une requête de son groupe, faites-la glisser sur **Requêtes personnalisées**, ou choisissez **Déplacer vers le groupe**, puis **Aucun groupe**.
- Chaque ligne de requête a un menu d'actions avec **Renommer**, **Déplacer vers le groupe** et **Supprimer la requête**. Il n'est pas nécessaire d'ouvrir la requête dans un onglet pour la renommer.
- Chaque ligne de groupe a un menu d'actions avec **Renommer le groupe** et **Supprimer le groupe**. Supprimer un groupe conserve ses requêtes. Elles sortent du groupe.

Les groupes ne font que ranger la liste. Déplacer une requête ne change ni son nom, ni son SQL, ni son identifiant. Les rapports qui l'utilisent continuent donc de fonctionner.

Les groupes appartiennent à cette installation. La synchronisation du central vers les laboratoires ne les envoie ni ne les modifie.

Un fichier d'export porte le nom du groupe de chaque requête. À l'importation, et quand un pack de contenu installe des requêtes :

- Une requête qui porte un nom de groupe va dans le groupe de ce nom. Le groupe est créé s'il n'existe pas.
- Une nouvelle requête rejoint toujours son groupe.
- Une requête remplacée ne rejoint son groupe que si elle n'a pas encore de groupe. Une requête que vous avez déjà déplacée reste où vous l'avez mise.
