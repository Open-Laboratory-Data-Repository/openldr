# Activity and payload history

## English

Studio's Activity page groups workflow history by payload identifier. Search an identifier, source, status, or stage, then select a row to inspect recorded timestamps and details. Close the details, choose ⋯ → Refresh, and reopen the row to update them. Use workflow run history to investigate failures.

The page loads the 200 most recent groups. Search and pagination cover only those loaded rows. An empty result does not prove that no data was received. Clear filters, refresh, and inspect workflow history; data without associated workflow history may not appear here.

Complete means a persistence event exists and no associated run failed. It does not require a Pushed stage or prove delivery to every destination. Failed means a workflow run failed. Stuck means the recorded events establish neither state, so inspect the runs before diagnosing a stalled process. Activity has no retry-processing action. Studio's Activity guide explains the stages and loading limitations.

Each event bus instance processes one event handler at a time. A slow handler can delay later events. Repeated queue notifications do not start additional handlers while its current batch runs. Pending events remain queued for a later batch. Separate server processes can still handle events concurrently.

## Français

La page Activité de Studio regroupe l'historique des workflows par identifiant de données reçues. Recherchez un identifiant, une source, un statut ou une étape, puis ouvrez une ligne pour consulter les heures et détails. Fermez, actualisez depuis ⋯ et rouvrez la ligne. Consultez l'historique du workflow pour examiner les échecs.

La page charge les 200 groupes les plus récents. Recherche et pagination portent uniquement sur ces lignes. Un résultat vide ne prouve pas l'absence de données reçues. Effacez les filtres, actualisez et consultez les workflows. Des données sans historique de workflow associé peuvent manquer.

Le statut complet exige un événement de persistance sans exécution associée en échec. Il ne garantit pas une sortie vers toutes les destinations. Un échec indique une exécution échouée. Le statut bloqué indique que les événements n'établissent aucun de ces états. Consultez les exécutions avant de diagnostiquer un arrêt. Activité ne propose pas de relance ; son guide dans Studio explique les étapes et les limites de chargement.

Chaque instance du bus d'événements exécute un seul gestionnaire à la fois. Un gestionnaire lent peut retarder les événements suivants. Les notifications répétées ne lancent pas d'autres gestionnaires pendant le lot en cours. Les événements en attente restent en file pour un lot ultérieur. Des processus serveur distincts peuvent toujours traiter des événements simultanément.

## Português

A página Atividade do Studio agrupa o histórico de workflows pelo identificador dos dados recebidos. Pesquise um identificador, origem, estado ou etapa e abra uma linha para consultar horas e detalhes. Feche, atualize pelo menu ⋯ e abra novamente a linha. Consulte o histórico do workflow para investigar falhas.

A página carrega os 200 grupos mais recentes. Pesquisa e paginação abrangem apenas essas linhas. Um resultado vazio não prova que não chegaram dados. Limpe os filtros, atualize e consulte os workflows. Dados sem histórico de workflow associado podem não aparecer.

O estado completo exige um evento de persistência sem execuções associadas falhadas. Não garante o envio para todos os destinos. Uma falha indica uma execução falhada. O estado bloqueado significa que os eventos não estabelecem nenhum desses estados. Consulte as execuções antes de diagnosticar uma paragem. A Atividade não permite repetir o processamento; o guia do Studio explica as etapas e os limites de carregamento.

Cada instância do barramento de eventos executa um único processador de eventos de cada vez. Um processador lento pode atrasar os eventos seguintes. As notificações repetidas não iniciam outros processadores durante o lote atual. Os eventos pendentes ficam em fila para um lote posterior. Processos de servidor separados podem continuar a tratar eventos em simultâneo.

## Queue ownership

The worker renews leases for running events and events waiting in its claimed batch. A replacement worker gets a new claim token. An older worker cannot overwrite that claim with completion, failure, or retry updates. After a crash, an expired claim still counts as a failed attempt and can be retried. Handlers must tolerate repeated delivery: a database outage or paused process can still allow another worker to run the event. Stop old workers before upgrading; workers without claim-token checks cannot provide this protection.

## Propriété des événements en file

Le worker renouvelle les baux des événements en cours et de ceux qui attendent dans son lot. Un worker de remplacement reçoit un nouveau jeton. Un ancien worker ne peut plus modifier cet événement pour le terminer, le déclarer en échec ou le relancer. Après un arrêt brutal, un bail expiré compte toujours comme une tentative échouée et permet une reprise. Les traitements doivent accepter les livraisons répétées. Une panne de base ou un processus suspendu peut permettre une autre exécution. Arrêtez les anciens workers avant la mise à niveau. Les workers sans contrôle du jeton ne garantissent pas cette protection.

## Propriedade dos eventos na fila

O worker renova os prazos dos eventos em execução e dos que aguardam no seu lote. Um worker substituto recebe um novo token. Um worker anterior não pode alterar essa atribuição para concluir, falhar ou repetir o evento. Após uma interrupção, um prazo expirado continua a contar como tentativa falhada e permite nova tentativa. Os processos devem aceitar entregas repetidas. Uma falha da base de dados ou um processo suspenso pode permitir outra execução. Pare os workers antigos antes da atualização. Workers sem verificação do token não garantem esta proteção.
