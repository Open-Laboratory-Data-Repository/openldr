# Requêtes personnalisées

L'espace Query permet d'écrire et d'enregistrer des requêtes SQL. Les rapports peuvent utiliser ces requêtes enregistrées.

![Explorateur des connecteurs et des requêtes personnalisées](query-workbench.png)

## Enregistrer une requête

1. Ouvrez **Query**, puis sélectionnez **+** dans la barre des onglets.
2. Le nouvel onglet reçoit un nom généré, par exemple `Query #1`.
3. Choisissez un connecteur et saisissez votre requête `SELECT`.
4. Ouvrez le menu des actions de la requête et choisissez Enregistrer. Au premier enregistrement, le panneau demande un Nom unique. Saisissez-le, puis choisissez Enregistrer dans le menu du panneau.
5. Rouvrez la requête depuis **Custom Queries** dans l'explorateur. Un nouvel enregistrement met à jour cette même requête.

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
