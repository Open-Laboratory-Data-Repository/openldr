# Dashboard query limits

## English

Builder widgets use the dashboard SQL timeout and row cap settings. Defaults are 5,000 milliseconds and 10,000 groups. Administrators can change these existing settings.

The cap counts database groups before date bucketing, breakdown totals, and top-N selection. If the query exceeds it, the widget returns an error instead of partial totals. Narrow the filters or reduce grouping. A small top-N does not bypass this cap.

PostgreSQL, MySQL, MariaDB, and SQL Server cancel database work at the configured timeout. SQL Server also resets pooled connections after each query so row and lock limits cannot affect the next request.

## Français

Les widgets Builder utilisent le délai maximal SQL et la limite de lignes du tableau de bord. Les valeurs par défaut sont de 5 000 millisecondes et 10 000 groupes. Les administrateurs peuvent modifier ces paramètres existants.

La limite compte les groupes de la base avant le regroupement par période, les totaux par série et la sélection des premiers résultats. En cas de dépassement, le widget affiche une erreur au lieu de totaux partiels. Précisez les filtres ou réduisez le regroupement. Demander moins de premiers résultats ne contourne pas cette limite.

PostgreSQL, MySQL, MariaDB et SQL Server annulent le travail de la base au délai configuré. SQL Server réinitialise aussi les connexions partagées après chaque requête. Les limites de lignes et de verrous ne touchent donc pas la requête suivante.

## Português

Os widgets Builder usam o tempo máximo SQL e o limite de linhas do painel. Os valores predefinidos são 5 000 milissegundos e 10 000 grupos. Os administradores podem alterar estas definições existentes.

O limite conta os grupos da base antes do agrupamento por período, dos totais por série e da seleção dos primeiros resultados. Se a consulta exceder o limite, o widget apresenta um erro em vez de totais parciais. Restrinja os filtros ou reduza o agrupamento. Pedir menos primeiros resultados não evita este limite.

O PostgreSQL, o MySQL, o MariaDB e o SQL Server cancelam o trabalho da base no tempo configurado. O SQL Server também repõe as ligações partilhadas após cada consulta. Assim, os limites de linhas e bloqueios não afetam o pedido seguinte.
