# Query result paging

## English

### SQL Server paging

Table browsing and query results support PostgreSQL, MySQL/MariaDB, and SQL Server connectors.
SQL Server pages show a row range and "total unknown". This means the workbench did not count the full result.
Next is available only when the server found one more row beyond the current page. Previous returns to the preceding page.
An exactly full final page still disables Next. Changing Rows per page returns to the first page.
PostgreSQL and MySQL/MariaDB continue to show their counted totals.

For repeatable paging, open SQL in a table tab and add an ORDER BY that ends with a unique key.
For example, if id is unique in your table, ORDER BY created_at, id breaks timestamp ties.
Write the corresponding order in a query tab before Run. The workbench cannot infer a unique key for arbitrary SQL.
A plain table browse has no guaranteed order. Rows may repeat or be missed without a unique order, or if data changes between requests.
SQL Server reads through the requested offset, so later pages can take longer. Paging does not create a database snapshot.

## Français

### Pagination SQL Server

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

## Português

### Paginação SQL Server

A consulta de tabelas e os resultados aceitam conectores PostgreSQL, MySQL/MariaDB e SQL Server.
As páginas SQL Server mostram um intervalo e "total desconhecido": o total dos resultados não foi calculado.
Next fica disponível apenas quando o servidor encontra mais uma linha além da página atual. Previous volta à página anterior.
Uma última página completamente preenchida também desativa Next. Alterar Rows per page volta à primeira página.
PostgreSQL e MySQL/MariaDB continuam a mostrar os totais calculados.

Para repetir a paginação com a mesma ordem, abra SQL no separador da tabela e adicione ORDER BY terminando numa chave única.
Por exemplo, se id for único na tabela, ORDER BY created_at, id desempata datas iguais.
Num separador de consulta, acrescente essa ordem antes de Run. O editor não pode deduzir uma chave única para qualquer SQL.
A consulta simples de uma tabela não garante uma ordem. Podem aparecer linhas repetidas ou faltar linhas sem uma ordem única, ou se os dados mudarem entre pedidos.
SQL Server lê até ao deslocamento pedido, pelo que páginas distantes podem demorar mais. A paginação não cria uma cópia estável da base de dados.
