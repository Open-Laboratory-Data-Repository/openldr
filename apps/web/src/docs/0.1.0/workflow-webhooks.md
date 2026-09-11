# Workflow webhooks

## English


Save a webhook path or secret change before sending requests with the new value. Every upgraded API instance reads the current path and secret from the shared database. No restart is needed after a workflow save. Requests authenticated before the save may finish.

Send the secret only in the `x-webhook-token` header. The old path returns 404 after a path change. An old or unreadable secret returns 401. Disabled or deleted workflows return 404. Each enabled trigger needs a unique path, including triggers within the same workflow. Conflicting paths return 503 and execute nothing. Database lookup failures also return 503; instances never use cached credentials as a fallback.

Stop every old API instance and any old workflow writers before running migration 096 with `openldr db migrate`. Then start the upgraded instances. Old writers cannot maintain the new path index. This deployment requires downtime; do not mix versions while accepting writes. All instances must use the same database and encryption key. This change does not make workflow execution durable; senders must still handle interrupted requests and possible duplicate side effects.

## Français


Enregistrez le nouveau chemin ou secret avant d'envoyer des requêtes avec cette valeur. Chaque instance API mise à jour lit le chemin et le secret actuels dans la base partagée. Aucun redémarrage n'est nécessaire après l'enregistrement. Les requêtes déjà authentifiées peuvent se terminer.

Envoyez le secret uniquement dans l'en-tête `x-webhook-token`. L'ancien chemin renvoie 404 après un changement. Un secret ancien ou illisible renvoie 401. Un flux désactivé ou supprimé renvoie 404. Chaque déclencheur actif doit avoir un chemin unique, même dans un seul flux. Un conflit de chemins renvoie 503 sans exécuter le flux. Une erreur de lecture de la base renvoie aussi 503. Aucune instance ne réutilise des identifiants en cache.

Arrêtez toutes les anciennes instances API et tous les anciens processus qui modifient les flux. Appliquez ensuite la migration 096 avec `openldr db migrate`, puis démarrez les instances mises à jour. Les anciens processus ne maintiennent pas le nouvel index des chemins. Ce déploiement exige une interruption ; ne mélangez pas les versions pendant les écritures. Les instances doivent partager la base et la clé de chiffrement. Cette modification ne rend pas l'exécution durable. Les émetteurs doivent toujours gérer les requêtes interrompues et les effets potentiellement répétés.

## Português


Guarde a alteração do caminho ou segredo antes de enviar pedidos com o novo valor. Cada instância atualizada lê o caminho e o segredo atuais na base de dados partilhada. Não é necessário reiniciar após guardar o fluxo. Os pedidos já autenticados podem terminar.

Envie o segredo apenas no cabeçalho `x-webhook-token`. O caminho antigo devolve 404 após uma alteração. Um segredo antigo ou ilegível devolve 401. Um fluxo desativado ou eliminado devolve 404. Cada acionador ativo precisa de um caminho único, mesmo dentro do mesmo fluxo. Caminhos em conflito devolvem 503 sem executar o fluxo. Uma falha na consulta da base também devolve 503. As instâncias nunca recorrem a credenciais em cache.

Pare todas as instâncias API antigas e todos os processos antigos que alteram fluxos. Aplique a migração 096 com `openldr db migrate` e inicie as instâncias atualizadas. Os processos antigos não mantêm o novo índice de caminhos. Esta implementação exige uma interrupção; não misture versões durante as escritas. As instâncias devem partilhar a base e a chave de encriptação. Esta alteração não torna a execução durável. Os emissores ainda precisam de tratar pedidos interrompidos e possíveis efeitos duplicados.
