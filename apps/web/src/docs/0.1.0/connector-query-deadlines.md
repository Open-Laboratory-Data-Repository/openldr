# Connector query deadlines

## English

PostgreSQL and MySQL connector queries have a 30-second execution limit. A slow query fails instead of keeping the workflow or report waiting indefinitely. PostgreSQL cancels the statement on the server. MySQL uses a second connection with the same credentials to terminate the query connection. Cancellation may take one additional second. Connection setup has a separate 30-second limit.

If a query exceeds this limit, narrow its date range or filters and check its database execution plan. Retry after correcting the query. There is no timeout field in the connector form.

If the error says `server cancellation failed`, OpenLDR closed its local connection but could not confirm server cancellation. Ask the database operator to check active queries. The MySQL account must be able to open another connection and terminate its own sessions.

## Français

Les requêtes des connecteurs PostgreSQL et MySQL ont une limite d'exécution de 30 secondes. Une requête lente échoue au lieu de bloquer indéfiniment le workflow ou le rapport. PostgreSQL annule la requête sur le serveur. MySQL utilise une seconde connexion avec les mêmes identifiants pour terminer la connexion de la requête. Cette annulation peut prendre une seconde supplémentaire. La connexion initiale a une limite distincte de 30 secondes.

Si une requête dépasse cette limite, réduisez la période ou affinez les filtres, puis vérifiez son plan d'exécution. Réessayez après correction. Le formulaire du connecteur ne propose aucun champ de délai.

Si l'erreur indique `server cancellation failed`, OpenLDR a fermé sa connexion locale sans pouvoir confirmer l'annulation sur le serveur. Demandez à l'administrateur de vérifier les requêtes actives. Le compte MySQL doit pouvoir ouvrir une autre connexion et terminer ses propres sessions.

## Português

As consultas dos conectores PostgreSQL e MySQL têm um limite de execução de 30 segundos. Uma consulta lenta falha em vez de bloquear o workflow ou o relatório indefinidamente. O PostgreSQL cancela a consulta no servidor. O MySQL usa uma segunda ligação com as mesmas credenciais para terminar a ligação da consulta. O cancelamento pode demorar mais um segundo. A ligação inicial tem um limite separado de 30 segundos.

Se uma consulta ultrapassar este limite, reduza o intervalo de datas ou ajuste os filtros e verifique o plano de execução. Tente novamente depois de corrigir a consulta. O formulário do conector não tem um campo para alterar este limite.

Se o erro indicar `server cancellation failed`, o OpenLDR fechou a ligação local sem confirmar o cancelamento no servidor. Peça ao administrador para verificar as consultas ativas. A conta MySQL deve poder abrir outra ligação e terminar as suas próprias sessões.
