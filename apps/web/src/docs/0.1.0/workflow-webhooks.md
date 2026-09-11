# Workflow webhooks

## English


Save a webhook path or secret change before sending requests with the new value. Every upgraded API instance reads the current path and secret from the shared database. No restart is needed after a workflow save. Requests authenticated before the save may finish.

Send the secret only in the `x-webhook-token` header. The old path returns 404 after a path change. An old or unreadable secret returns 401. Disabled or deleted workflows return 404. Each enabled trigger needs a unique path, including triggers within the same workflow. Conflicting paths return 503 and execute nothing. Database lookup failures also return 503; instances never use cached credentials as a fallback.

Stop every old API instance and any old workflow writers before running migration 096 with `openldr db migrate`. Then start the upgraded instances. Old writers cannot maintain the new path index. This deployment requires downtime; do not mix versions while accepting writes. All instances must use the same database and encryption key.


### Durable webhook requests

OpenLDR stores a receipt and dispatch event in one database transaction before accepting a webhook. If acceptance cannot reach the database, the request fails without an accepted receipt. An error or lost connection does not prove nothing ran. Retry with the same idempotency key and input.

Send an optional `Idempotency-Key` header for each logical request. Within one workflow, the same key and execution input reuse the original receipt. Different input with the same key returns 409. Input includes body, query, forwarded headers and binary content. Authentication and transport headers do not define identity. Without a key, each POST creates a new request and retries can duplicate effects.

OpenLDR waits up to 10 seconds after acceptance. Completed work preserves existing 200 response fields. A duplicate completed request returns 200 even with `Prefer: respond-async`. Recorded execution failure returns generic 500 with `requestId`, without raw error details. Interrupted and cancelled receipts return 409. Queued or running work returns 202 with `accepted: true`, `requestId`, `status` and `statusUrl`. `Location` and `Retry-After` supply the polling address and interval. A 202 means accepted, not completed. `Prefer: respond-async` skips waiting. Disconnecting does not cancel accepted work.

#### Sender example

A completed 200 response can be `{"ok":true,"runId":"run-id","correlationId":"correlation-id"}`. Keys must contain 1 to 200 printable ASCII characters without spaces.

Send `POST /api/workflows/hooks/example` with headers `x-webhook-token: CURRENT_SECRET`, `Idempotency-Key: sender-request-123` and `Prefer: respond-async`. Send the same key and input if retrying that request.

An example pending 202 body is:

```json
{"accepted":true,"requestId":"request-id","status":"queued","statusUrl":"/api/workflows/hooks/example?requestId=request-id"}
```

Poll the returned URL using `GET /api/workflows/hooks/example?requestId=request-id` and the current `x-webhook-token`. Respect `Retry-After`. Polling returns only `requestId`, `status` and `runId`. Polling omits payloads and raw errors. The request ID alone grants no access. Rotated tokens stop authorizing old secrets. Renamed or deleted paths may remove sender access; operators can still inspect receipts by workflow and request ID.

#### Operator inspection and recovery

The Webhook receipts tab in workflow history shows queued, running, completed, failed, interrupted and cancelled requests. Operator routes are `GET /api/workflows/:id/receipts?limit=25&offset=0` and `GET /api/workflows/:id/receipts/:requestId`.

```sh
openldr workflows receipts list WORKFLOW_ID --limit 25 --offset 0 --json
openldr workflows receipts show REQUEST_ID --json
```

Limits range from 1 to 100; offsets start at zero. CLI and API use the same receipt service. Neither offers replay.

Queued work can resume after restart. A workflow disabled, deleted or changed before execution cancels queued work. An `interrupted` receipt means the outcome is uncertain. OpenLDR never automatically replays started work. Confirm the original worker stopped and reconcile external effects before submitting a new identity. External effects have no automatic rollback. Receipt and idempotency records survive workflow deletion. No automatic expiry or retention cleanup exists, so storage grows.

Migration 097 adds receipt storage. Deployment still follows P14: stop old API instances and workflow writers, run `openldr db migrate`, then start upgraded instances. Do not mix writers across versions. Actual CDR client compatibility remains unproven because its source was not verified.


## Français


Enregistrez le nouveau chemin ou secret avant d'envoyer des requêtes avec cette valeur. Chaque instance API mise à jour lit le chemin et le secret actuels dans la base partagée. Aucun redémarrage n'est nécessaire après l'enregistrement. Les requêtes déjà authentifiées peuvent se terminer.

Envoyez le secret uniquement dans l'en-tête `x-webhook-token`. L'ancien chemin renvoie 404 après un changement. Un secret ancien ou illisible renvoie 401. Un flux désactivé ou supprimé renvoie 404. Chaque déclencheur actif doit avoir un chemin unique, même dans un seul flux. Un conflit de chemins renvoie 503 sans exécuter le flux. Une erreur de lecture de la base renvoie aussi 503. Aucune instance ne réutilise des identifiants en cache.

Arrêtez toutes les anciennes instances API et tous les anciens processus qui modifient les flux. Appliquez ensuite la migration 096 avec `openldr db migrate`, puis démarrez les instances mises à jour. Les anciens processus ne maintiennent pas le nouvel index des chemins. Ce déploiement exige une interruption ; ne mélangez pas les versions pendant les écritures. Les instances doivent partager la base et la clé de chiffrement.


### Requêtes webhook durables

OpenLDR enregistre un reçu et un événement dans une seule transaction avant d'accepter le webhook. Si la base est indisponible avant l'acceptation, la requête échoue sans reçu accepté. Une erreur ou connexion perdue ne prouve pas l'absence d'exécution. Réessayez avec la même clé d'idempotence et les mêmes données.

L'en-tête facultatif `Idempotency-Key` identifie une requête logique. Dans un même flux, la même clé et les mêmes données réutilisent le reçu initial. Des données différentes avec la même clé renvoient 409. Les données comprennent corps, paramètres, en-têtes transmis et contenu binaire. Les en-têtes d'authentification et de transport sont exclus. Sans clé, chaque POST crée une requête et peut répéter des effets.

OpenLDR attend au maximum 10 secondes après l'acceptation. Une exécution terminée conserve les champs de réponse 200 existants. Une requête répétée déjà terminée renvoie 200 même avec `Prefer: respond-async`. Un échec enregistré renvoie 500 avec `requestId`, sans erreur brute. Les reçus interrompus ou annulés renvoient 409. Une requête en attente ou en cours renvoie 202 avec `accepted: true`, `requestId`, `status` et `statusUrl`. `Location` et `Retry-After` donnent l'adresse et le délai de consultation. 202 signifie acceptée, pas terminée. `Prefer: respond-async` supprime l'attente. Une déconnexion n'annule pas le travail accepté.

### Exemple d'envoi

Une réponse 200 terminée peut être `{"ok":true,"runId":"run-id","correlationId":"correlation-id"}`. Les clés doivent contenir 1 à 200 caractères ASCII imprimables sans espaces.

Envoyez `POST /api/workflows/hooks/example` avec `x-webhook-token: CURRENT_SECRET`, `Idempotency-Key: sender-request-123` et `Prefer: respond-async`. Réutilisez la même clé et les mêmes données pour réessayer cette requête.

Exemple de corps de réponse 202 :

```json
{"accepted":true,"requestId":"request-id","status":"queued","statusUrl":"/api/workflows/hooks/example?requestId=request-id"}
```

Consultez l'adresse renvoyée avec `GET /api/workflows/hooks/example?requestId=request-id` et le secret actuel dans `x-webhook-token`. Respectez `Retry-After`. La consultation renvoie seulement `requestId`, `status` et `runId`, sans données ni erreurs brutes. L'identifiant seul n'autorise rien. Après rotation, l'ancien secret ne donne plus accès. Renommer ou supprimer le chemin peut empêcher cette consultation. Les opérateurs peuvent toujours consulter le reçu par identifiant de flux et de requête.

### Consultation et reprise

L'onglet Reçus webhook dans l'historique affiche `queued`, `running`, `completed`, `failed`, `interrupted` et `cancelled`. Les routes opérateur sont `GET /api/workflows/:id/receipts?limit=25&offset=0` et `GET /api/workflows/:id/receipts/:requestId`.

```sh
openldr workflows receipts list WORKFLOW_ID --limit 25 --offset 0 --json
openldr workflows receipts show REQUEST_ID --json
```

La limite va de 1 à 100 et le décalage commence à zéro. Ces commandes utilisent le même service que l'API. Aucune relance n'est proposée.

Les requêtes en attente peuvent reprendre après redémarrage. Un flux désactivé, supprimé ou modifié avant l'exécution annule le travail en attente. `interrupted` indique un résultat incertain. OpenLDR ne relance jamais automatiquement une exécution commencée. Vérifiez l'arrêt du processus initial et rapprochez les effets externes avant d'envoyer une nouvelle identité. Aucun retour arrière automatique des effets externes n'existe. Les reçus et clés survivent à la suppression du flux. Aucune expiration ni purge automatique ne limite leur stockage.

La migration 097 ajoute le stockage des reçus. Le déploiement suit toujours P14. Arrêtez les anciennes instances API et les processus qui modifient les flux. Exécutez `openldr db migrate`, puis démarrez les instances mises à jour. Ne mélangez pas les versions pendant les écritures. La compatibilité réelle du client CDR reste non prouvée, car son code source n'a pas été vérifié.


## Português


Guarde a alteração do caminho ou segredo antes de enviar pedidos com o novo valor. Cada instância atualizada lê o caminho e o segredo atuais na base de dados partilhada. Não é necessário reiniciar após guardar o fluxo. Os pedidos já autenticados podem terminar.

Envie o segredo apenas no cabeçalho `x-webhook-token`. O caminho antigo devolve 404 após uma alteração. Um segredo antigo ou ilegível devolve 401. Um fluxo desativado ou eliminado devolve 404. Cada acionador ativo precisa de um caminho único, mesmo dentro do mesmo fluxo. Caminhos em conflito devolvem 503 sem executar o fluxo. Uma falha na consulta da base também devolve 503. As instâncias nunca recorrem a credenciais em cache.

Pare todas as instâncias API antigas e todos os processos antigos que alteram fluxos. Aplique a migração 096 com `openldr db migrate` e inicie as instâncias atualizadas. Os processos antigos não mantêm o novo índice de caminhos. Esta implementação exige uma interrupção; não misture versões durante as escritas. As instâncias devem partilhar a base e a chave de encriptação.

### Pedidos webhook duráveis

O OpenLDR guarda um recibo e um evento numa única transação antes de aceitar o webhook. Se a base estiver indisponível antes da aceitação, o pedido falha sem recibo aceite. Um erro ou ligação perdida não prova que nada foi executado. Repita com a mesma chave de idempotência e os mesmos dados.

O cabeçalho opcional `Idempotency-Key` identifica um pedido lógico. No mesmo fluxo, a mesma chave e os mesmos dados reutilizam o recibo original. Dados diferentes com a mesma chave devolvem 409. Os dados incluem corpo, parâmetros, cabeçalhos encaminhados e conteúdo binário. Cabeçalhos de autenticação e transporte ficam excluídos. Sem chave, cada POST cria um pedido e pode duplicar efeitos.

O OpenLDR espera até 10 segundos após aceitar. Uma execução concluída mantém os campos existentes da resposta 200. Um pedido repetido já concluído devolve 200 mesmo com `Prefer: respond-async`. Uma falha registada devolve 500 com `requestId`, sem erros brutos. Recibos interrompidos ou cancelados devolvem 409. Um pedido em espera ou em execução devolve 202 com `accepted: true`, `requestId`, `status` e `statusUrl`. `Location` e `Retry-After` indicam o endereço e o intervalo de consulta. 202 significa aceite, não concluído. `Prefer: respond-async` dispensa a espera. Desligar a ligação não cancela trabalho aceite.

### Exemplo de envio

Uma resposta 200 concluída pode ser `{"ok":true,"runId":"run-id","correlationId":"correlation-id"}`. As chaves devem conter entre 1 e 200 caracteres ASCII imprimíveis sem espaços.

Envie `POST /api/workflows/hooks/example` com `x-webhook-token: CURRENT_SECRET`, `Idempotency-Key: sender-request-123` e `Prefer: respond-async`. Use a mesma chave e os mesmos dados ao repetir esse pedido.

Exemplo de corpo da resposta 202:

```json
{"accepted":true,"requestId":"request-id","status":"queued","statusUrl":"/api/workflows/hooks/example?requestId=request-id"}
```

Consulte o endereço devolvido com `GET /api/workflows/hooks/example?requestId=request-id` e o segredo atual em `x-webhook-token`. Respeite `Retry-After`. A consulta devolve apenas `requestId`, `status` e `runId`, sem dados ou erros brutos. O identificador sozinho não dá acesso. Após rotação, o segredo antigo deixa de autorizar consultas. Mudar ou eliminar o caminho pode impedir esta consulta. Os operadores continuam a consultar recibos por identificador do fluxo e do pedido.

### Consulta e recuperação

O separador Recibos webhook no histórico mostra `queued`, `running`, `completed`, `failed`, `interrupted` e `cancelled`. Os endpoints de operador são `GET /api/workflows/:id/receipts?limit=25&offset=0` e `GET /api/workflows/:id/receipts/:requestId`.

```sh
openldr workflows receipts list WORKFLOW_ID --limit 25 --offset 0 --json
openldr workflows receipts show REQUEST_ID --json
```

O limite vai de 1 a 100 e o deslocamento começa em zero. Estes comandos usam o mesmo serviço da API. Não permitem repetir a execução.

Pedidos em espera podem continuar após reiniciar. Desativar, eliminar ou alterar o fluxo antes da execução cancela trabalho em espera. `interrupted` indica um resultado incerto. O OpenLDR nunca repete automaticamente trabalho já iniciado. Confirme que o processo original parou e confira os efeitos externos antes de enviar uma nova identidade. Não há reversão automática dos efeitos externos. Os recibos e as chaves sobrevivem à eliminação do fluxo. Não existe expiração nem limpeza automática, por isso o armazenamento cresce.

A migração 097 adiciona o armazenamento de recibos. A implementação continua a seguir P14. Pare as instâncias API e os processos antigos que alteram fluxos. Execute `openldr db migrate` e inicie as instâncias atualizadas. Não misture versões durante as escritas. A compatibilidade real do cliente CDR continua por provar, pois o seu código fonte não foi verificado.
