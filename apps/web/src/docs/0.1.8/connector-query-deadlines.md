# Connector query deadlines

## English

The Allowed plugin host column shows the network host permitted for a plugin connector. It is not the stored connection address. Host connectors do not use this plugin restriction. Open the row's Edit action to inspect their saved address and ordinary configuration.

PostgreSQL, MySQL, and Microsoft SQL connector queries have a 30-second execution limit. A slow query fails instead of keeping the workflow or report waiting indefinitely. PostgreSQL and Microsoft SQL cancel the active request. MySQL uses a second connection with the same credentials to terminate the query connection. MySQL cancellation may take one additional second. Connection setup has a separate 30-second limit.

If a query exceeds this limit, narrow its date range or filters and check its database execution plan. Retry after correcting the query. There is no timeout field in the connector form.

If the error says `server cancellation failed`, OpenLDR closed its local connection but could not confirm server cancellation. Ask the database operator to check active queries. The MySQL account must be able to open another connection and terminate its own sessions.

## Français

La colonne Hôte autorisé du plugin indique l'hôte réseau permis pour un connecteur de plugin. Ce n'est pas l'adresse de connexion enregistrée. Les connecteurs hôtes n'utilisent pas cette restriction de plugin. Ouvrez Modifier dans le menu de la ligne pour consulter leur adresse et leurs paramètres ordinaires enregistrés.

Les requêtes des connecteurs PostgreSQL, MySQL et Microsoft SQL ont une limite d'exécution de 30 secondes. Une requête lente échoue au lieu de bloquer indéfiniment le workflow ou le rapport. PostgreSQL et Microsoft SQL annulent la requête active. MySQL utilise une seconde connexion avec les mêmes identifiants pour terminer la connexion de la requête. L'annulation MySQL peut prendre une seconde supplémentaire. La connexion initiale a une limite distincte de 30 secondes.

Si une requête dépasse cette limite, réduisez la période ou affinez les filtres, puis vérifiez son plan d'exécution. Réessayez après correction. Le formulaire du connecteur ne propose aucun champ de délai.

Si l'erreur indique `server cancellation failed`, OpenLDR a fermé sa connexion locale sans pouvoir confirmer l'annulation sur le serveur. Demandez à l'administrateur de vérifier les requêtes actives. Le compte MySQL doit pouvoir ouvrir une autre connexion et terminer ses propres sessions.

## Português

A coluna Host permitido do plugin indica o host de rede permitido para um conector de plugin. Não é o endereço de ligação guardado. Os conectores host não usam esta restrição de plugin. Abra Editar no menu da linha para consultar o endereço e as configurações normais guardadas.

As consultas dos conectores PostgreSQL, MySQL e Microsoft SQL têm um limite de execução de 30 segundos. Uma consulta lenta falha em vez de bloquear o workflow ou o relatório indefinidamente. O PostgreSQL e o Microsoft SQL cancelam o pedido ativo. O MySQL usa uma segunda ligação com as mesmas credenciais para terminar a ligação da consulta. O cancelamento do MySQL pode demorar mais um segundo. A ligação inicial tem um limite separado de 30 segundos.

Se uma consulta ultrapassar este limite, reduza o intervalo de datas ou ajuste os filtros e verifique o plano de execução. Tente novamente depois de corrigir a consulta. O formulário do conector não tem um campo para alterar este limite.

Se o erro indicar `server cancellation failed`, o OpenLDR fechou a ligação local sem confirmar o cancelamento no servidor. Peça ao administrador para verificar as consultas ativas. A conta MySQL deve poder abrir outra ligação e terminar as suas próprias sessões.
