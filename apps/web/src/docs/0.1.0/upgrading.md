# Planned upgrades


## English

Schedule downtime for a Compose upgrade. Schema changes can prevent old and new versions from writing safely together. This procedure keeps the database engine version unchanged. A database engine upgrade needs its own tested procedure.

### Prepare the release

Work in the installed Compose project directory. Use the same project name, environment file and Compose overlays throughout. Record the current image tags and IDs with `docker compose images`. Keep the previous images and Compose files available. Read the target release notes and migration requirements.

Save the current `.env` and configuration privately before editing them. Pin `OPENLDR_VERSION` to the chosen release in `.env`. Download only the application images needed by that release before downtime. Do not blindly pull every service: the storage services have separate versions, and MinIO may use `latest`. Preserve the current PostgreSQL, MinIO and external database versions.

Save this guide outside Studio before stopping services. Confirm who can restore backups and how senders queue or retry during downtime.

### Stop writes and wait

Pause webhook senders, scheduled external writers, synchronization peers and operator writes. Block new incoming traffic. Stop every old API replica, including replicas outside this Compose project. Stop separate CLI jobs and other processes that write to the same databases or storage.

New installer Compose files set this API service property:

```yaml
stop_grace_period: ${OPENLDR_STOP_GRACE_PERIOD:-5m}
```

Existing installations must add this property under `services.api` in their local Compose file. Set `OPENLDR_STOP_GRACE_PERIOD` to allow the longest expected work to finish. An explicit stop timeout takes precedence:

```sh
docker compose stop -t 300 api
```

The example allows 300 seconds. Increase it when necessary. OpenLDR waits for active requests and workers during shutdown. Check container state and shutdown logs. A forced kill, timeout or exit code 137 does not prove work drained. Investigate before proceeding, including possible partial external effects.

Stop Keycloak and MinIO after the API stops, and stop any other writers to their stores. Keep PostgreSQL running for logical backups. Keep all writers stopped through backup verification and migrations. Queued webhook receipts may remain for the new worker. Record their IDs and investigate running or interrupted work before resuming deliveries.

### Back up one stopped-write state

Store the backup privately, outside the deployment's volumes. Capture all of these from the same period without writes:

- The internal database, configured target database and Keycloak database, plus required database roles.
- Every blob bucket or volume, including files referenced by workflow receipts.
- `.env`, Compose files and overlays, mounted configuration, encryption and signing keys, certificates and local `data` files.
- The image inventory and exact previous application release.

For PostgreSQL, identify the real database names and account first. Run `pg_dump -Fc -f /tmp/DB.dump -U USER DB` inside the PostgreSQL container with `docker compose exec -T postgres`. Replace `DB` and `USER` with deployment values. Copy each completed dump out with `docker compose cp postgres:/tmp/DB.dump ./PRIVATE_BACKUP/DB.dump`. The destination directory must already exist. Repeat for each database. Check every exit code.

Save roles separately with `pg_dumpall --globals-only -f /tmp/globals.sql -U USER`, then copy that file out. Use the same container execution pattern. Protect these files because they can contain credentials. Using `-f` and `compose cp` avoids binary shell redirection in Windows PowerShell.

For MySQL, SQL Server or externally managed stores, use the database administrator's native backup and restore procedure. PostgreSQL dumps do not cover those databases. For MinIO, use a tested bucket backup or copy its volume while MinIO is stopped. Do not copy a live PostgreSQL data volume as a logical backup. Never run `docker compose down -v` during an upgrade.

### Prove the backup restores

Restore into separate database and blob destinations that cannot contact production services or senders. Restore roles and each database with errors treated as failures. Resolve bootstrap role conflicts explicitly. Compare representative row counts and saved records. Restore blob files and compare their checksums against the backup.

Use the preserved encryption keys to decrypt representative saved secrets in the isolated environment. Confirm that restored records can find their restored blobs. A successful dump, archive listing or health response alone does not prove recoverability. Do not migrate production until this restore check succeeds.

### Migrate before starting the new API

Keep the databases available and every old writer stopped. Confirm the API image is the pinned new release. Run its bundled CLI once:

```sh
docker compose run --rm --no-deps api node /app/cli/dist/index.js db migrate
```

This command overrides the API start command. It does not start dependencies or serve requests. Require exit code 0 and successful internal and target database migrations before starting the new services.

If migration fails, stop here. Some schema changes may already have committed. Do not start old binaries against that schema. Diagnose the failure, or restore the matching database, blob, configuration, keys and image snapshot together. If traffic was reopened, reconcile deliveries and external effects before restoring an older snapshot.

### Check before resuming traffic

Start the existing storage and identity services first, then the pinned new application services. Preserve their database engine versions. Check `docker compose ps`, API health and logs. Read representative saved data through Studio or the CLI. Check workflow receipts and their linked runs before reopening incoming traffic.

An HTTP 202 means the webhook was accepted, not completed. Poll outstanding receipts. Investigate interrupted receipts and external effects before deciding whether to submit replacement work. Retry the same logical request with its original `Idempotency-Key` and input. Do not bulk replay interrupted requests with fresh keys.

Resume senders only after these checks pass. Keep the verified backup and previous images according to the site's retention policy.

### References

- [Docker Compose service shutdown grace](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)
- [Docker Compose one-off commands](https://docs.docker.com/reference/cli/docker/compose/run/)
- [PostgreSQL 16 backup and restore](https://www.postgresql.org/docs/16/backup-dump.html)

## Français

Prévoyez une interruption pour une mise à niveau Compose. Des changements de schéma peuvent empêcher les anciennes et nouvelles versions d'écrire ensemble sans risque. Cette procédure conserve la version du moteur de base de données. Sa mise à niveau exige une procédure distincte et testée.

### Préparer la version

Travaillez dans le répertoire du projet Compose installé. Gardez le même nom de projet, fichier d'environnement et fichiers Compose complémentaires. Relevez les étiquettes et identifiants des images avec `docker compose images`. Conservez les anciennes images et les fichiers Compose. Lisez les notes de la version cible et les exigences de migration.

Sauvegardez les fichiers `.env` et de configuration actuels dans un emplacement privé avant toute modification. Fixez `OPENLDR_VERSION` à la version choisie dans `.env`. Téléchargez uniquement les images applicatives nécessaires avant l'interruption. Ne téléchargez pas toutes les nouvelles images sans contrôle. Les services de stockage ont leurs propres versions et MinIO peut utiliser `latest`. Conservez les versions actuelles de PostgreSQL, MinIO et des bases externes.

Enregistrez ce guide hors de Studio avant l'arrêt. Identifiez la personne chargée de restaurer les sauvegardes. Vérifiez comment les émetteurs mettent leurs envois en attente ou les réessaient.

### Arrêter les écritures et attendre

Suspendez les émetteurs webhook, les écritures externes planifiées, les pairs de synchronisation et les écritures des opérateurs. Bloquez les nouvelles requêtes entrantes. Arrêtez toutes les anciennes répliques API, y compris hors de ce projet Compose. Arrêtez les tâches CLI séparées et tout processus écrivant dans les mêmes bases ou stockages.

Les nouveaux fichiers Compose de l'installateur définissent cette propriété du service API :

```yaml
stop_grace_period: ${OPENLDR_STOP_GRACE_PERIOD:-5m}
```

Les installations existantes doivent l'ajouter sous `services.api` dans leur fichier Compose local. Adaptez `OPENLDR_STOP_GRACE_PERIOD` à la durée du travail le plus long. Un délai explicite dans la commande d'arrêt est prioritaire :

```sh
docker compose stop -t 300 api
```

Cet exemple accorde 300 secondes. Augmentez ce délai si nécessaire. OpenLDR attend les requêtes et traitements actifs pendant l'arrêt. Consultez l'état du conteneur et les journaux. Un arrêt forcé, un délai dépassé ou le code 137 ne prouve pas leur achèvement. Examinez la situation avant de continuer, notamment les effets externes partiels.

Arrêtez Keycloak et MinIO après l'API, ainsi que les autres processus écrivant dans leurs stockages. Gardez PostgreSQL actif pour les sauvegardes logiques. Maintenez toutes les écritures arrêtées pendant la vérification des sauvegardes et les migrations. Des reçus webhook en attente peuvent rester pour le nouveau traitement. Notez leurs identifiants. Examinez les travaux actifs ou interrompus avant de reprendre les envois.

### Sauvegarder un même état sans écritures

Placez la sauvegarde dans un emplacement privé, hors des volumes du déploiement. Capturez tous ces éléments pendant la même période sans écritures :

- La base interne, la base cible configurée et la base Keycloak, avec les rôles nécessaires.
- Tous les compartiments ou volumes de fichiers, dont les fichiers référencés par les reçus webhook.
- `.env`, les fichiers Compose complémentaires, la configuration montée, les clés de chiffrement et signature, les certificats et les fichiers locaux de `data`.
- L'inventaire des images et la version applicative précédente exacte.

Pour PostgreSQL, identifiez d'abord les vrais noms des bases et le compte. Exécutez `pg_dump -Fc -f /tmp/DB.dump -U USER DB` dans le conteneur PostgreSQL avec `docker compose exec -T postgres`. Remplacez `DB` et `USER` par les valeurs du déploiement. Copiez chaque sauvegarde terminée avec `docker compose cp postgres:/tmp/DB.dump ./PRIVATE_BACKUP/DB.dump`. Créez le répertoire de destination au préalable. Répétez pour chaque base. Vérifiez chaque code de sortie.

Sauvegardez les rôles avec `pg_dumpall --globals-only -f /tmp/globals.sql -U USER`, puis copiez ce fichier. Utilisez le même mode d'exécution dans le conteneur. Protégez ces fichiers car ils peuvent contenir des identifiants. L'emploi de `-f` et `compose cp` évite la redirection binaire dans Windows PowerShell.

Pour MySQL, SQL Server ou les stockages externes, suivez la procédure native de sauvegarde et restauration de l'administrateur. Les sauvegardes PostgreSQL ne couvrent pas ces bases. Pour MinIO, utilisez une sauvegarde de compartiments testée ou copiez son volume après son arrêt. Ne copiez pas un volume PostgreSQL actif comme sauvegarde logique. N'exécutez jamais `docker compose down -v` pendant une mise à niveau.

### Vérifier la restauration

Restaurez dans des bases et stockages distincts, sans accès aux services de production ni aux émetteurs. Restaurez les rôles et chaque base en traitant toute erreur comme un échec. Résolvez explicitement les conflits de rôles initiaux. Comparez des nombres de lignes et des enregistrements représentatifs. Restaurez les fichiers et comparez leurs sommes de contrôle à la sauvegarde.

Utilisez les clés conservées pour déchiffrer des secrets enregistrés représentatifs dans cet environnement isolé. Vérifiez que les enregistrements restaurés retrouvent leurs fichiers. Une sauvegarde réussie, une liste d'archive ou une réponse de santé ne prouve pas la récupération. Ne migrez pas la production avant la réussite de cette restauration.

### Migrer avant de démarrer la nouvelle API

Gardez les bases disponibles et tous les anciens processus d'écriture arrêtés. Vérifiez que l'image API correspond à la version cible. Exécutez une fois sa CLI intégrée :

```sh
docker compose run --rm --no-deps api node /app/cli/dist/index.js db migrate
```

Cette commande remplace la commande de démarrage API. Elle ne démarre aucune dépendance et ne sert aucune requête. Exigez le code de sortie 0 et la réussite des migrations interne et cible avant de démarrer les nouveaux services.

Si la migration échoue, arrêtez-vous. Certains changements de schéma peuvent déjà être validés. Ne démarrez pas les anciens binaires sur ce schéma. Analysez l'échec, ou restaurez ensemble les bases, fichiers, configuration, clés et images de la même sauvegarde. Si le trafic avait repris, rapprochez les envois et leurs effets externes avant de restaurer un état antérieur.

### Vérifier avant de reprendre le trafic

Démarrez d'abord les services existants de stockage et d'identité, puis les services applicatifs de la version cible. Conservez leurs versions de moteurs de bases. Vérifiez `docker compose ps`, la santé de l'API et les journaux. Lisez des données représentatives dans Studio ou la CLI. Vérifiez les reçus webhook et leurs exécutions liées avant de rouvrir le trafic.

HTTP 202 signifie que le webhook a été accepté, pas terminé. Consultez les reçus en attente. Examinez les reçus interrompus et les effets externes avant de soumettre un travail de remplacement. Réessayez la même requête logique avec son `Idempotency-Key` et son contenu d'origine. Ne rejouez pas en masse les requêtes interrompues avec de nouvelles clés.

Reprenez les envois seulement après ces vérifications. Conservez la sauvegarde vérifiée et les anciennes images selon la politique du site.

### Références

- [Délai d'arrêt des services Docker Compose](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)
- [Commandes ponctuelles Docker Compose](https://docs.docker.com/reference/cli/docker/compose/run/)
- [Sauvegarde et restauration PostgreSQL 16](https://www.postgresql.org/docs/16/backup-dump.html)

## Português

Reserve uma interrupção para atualizar uma instalação Compose. Alterações do esquema podem impedir escritas seguras entre versões antigas e novas. Este procedimento mantém a versão do motor de base de dados. A atualização desse motor exige um procedimento separado e testado.

### Preparar a versão

Trabalhe no diretório do projeto Compose instalado. Use sempre o mesmo nome de projeto, ficheiro de ambiente e ficheiros Compose complementares. Registe as etiquetas e identificadores das imagens com `docker compose images`. Guarde as imagens anteriores e os ficheiros Compose. Leia as notas da versão pretendida e os requisitos de migração.

Guarde os ficheiros `.env` e de configuração atuais num local privado antes de os alterar. Defina `OPENLDR_VERSION` com a versão escolhida em `.env`. Descarregue apenas as imagens aplicacionais necessárias antes da interrupção. Não atualize todas as imagens sem análise. Os serviços de armazenamento têm versões próprias e o MinIO pode usar `latest`. Mantenha as versões atuais de PostgreSQL, MinIO e bases externas.

Guarde este guia fora do Studio antes de parar os serviços. Confirme quem pode restaurar as cópias de segurança. Verifique como os emissores guardam envios pendentes ou repetem pedidos durante a interrupção.

### Parar as escritas e aguardar

Suspenda emissores webhook, escritas externas agendadas, parceiros de sincronização e escritas dos operadores. Bloqueie novos pedidos. Pare todas as réplicas API antigas, incluindo as que estão fora deste projeto Compose. Pare tarefas CLI separadas e outros processos que escrevam nas mesmas bases ou armazenamento.

Os novos ficheiros Compose do instalador definem esta propriedade no serviço API:

```yaml
stop_grace_period: ${OPENLDR_STOP_GRACE_PERIOD:-5m}
```

As instalações existentes devem adicioná-la em `services.api` no ficheiro Compose local. Ajuste `OPENLDR_STOP_GRACE_PERIOD` ao trabalho mais demorado. Um prazo explícito na paragem tem prioridade:

```sh
docker compose stop -t 300 api
```

O exemplo permite 300 segundos. Aumente o prazo quando necessário. O OpenLDR aguarda pedidos e tarefas ativos durante a paragem. Consulte o estado do contentor e os registos. Uma terminação forçada, prazo excedido ou código 137 não prova que o trabalho terminou. Investigue antes de continuar, incluindo possíveis efeitos externos parciais.

Pare o Keycloak e o MinIO após a API, assim como outros processos que escrevam nos seus armazenamentos. Mantenha o PostgreSQL ativo para cópias lógicas. Mantenha todas as escritas paradas durante a verificação das cópias e as migrações. Podem ficar recibos webhook em fila para o novo processo. Registe os identificadores. Investigue trabalhos ativos ou interrompidos antes de retomar os envios.

### Copiar um mesmo estado sem escritas

Guarde a cópia num local privado, fora dos volumes do sistema. Copie todos estes elementos durante o mesmo período sem escritas:

- A base interna, a base de destino configurada e a base Keycloak, com os papéis necessários.
- Todos os buckets ou volumes de ficheiros, incluindo ficheiros referenciados pelos recibos webhook.
- `.env`, ficheiros Compose complementares, configuração montada, chaves de cifra e assinatura, certificados e ficheiros locais de `data`.
- O inventário de imagens e a versão aplicacional anterior exata.

Para PostgreSQL, identifique primeiro os nomes reais das bases e a conta. Execute `pg_dump -Fc -f /tmp/DB.dump -U USER DB` dentro do contentor PostgreSQL com `docker compose exec -T postgres`. Substitua `DB` e `USER` pelos valores da instalação. Copie cada ficheiro concluído com `docker compose cp postgres:/tmp/DB.dump ./PRIVATE_BACKUP/DB.dump`. Crie primeiro o diretório de destino. Repita para cada base. Verifique todos os códigos de saída.

Guarde os papéis com `pg_dumpall --globals-only -f /tmp/globals.sql -U USER` e copie o ficheiro. Use o mesmo modo de execução no contentor. Proteja estes ficheiros porque podem conter credenciais. Usar `-f` e `compose cp` evita redirecionamento binário no Windows PowerShell.

Para MySQL, SQL Server ou armazenamento externo, siga o procedimento nativo de cópia e restauro do administrador. As cópias PostgreSQL não incluem essas bases. Para MinIO, use uma cópia de buckets testada ou copie o volume enquanto o serviço está parado. Não copie um volume PostgreSQL ativo como cópia lógica. Nunca execute `docker compose down -v` durante uma atualização.

### Verificar o restauro

Restaure para bases e armazenamento separados, sem acesso aos serviços de produção ou emissores. Restaure papéis e todas as bases, tratando qualquer erro como falha. Resolva explicitamente conflitos com papéis iniciais. Compare contagens de linhas e registos representativos. Restaure ficheiros e compare as somas de verificação com a cópia.

Use as chaves preservadas para decifrar segredos guardados representativos no ambiente isolado. Confirme que os registos restaurados encontram os seus ficheiros. Uma cópia concluída, uma listagem do arquivo ou uma resposta de saúde não prova a recuperação. Não migre a produção antes de este restauro passar.

### Migrar antes de iniciar a nova API

Mantenha as bases disponíveis e todos os processos antigos de escrita parados. Confirme que a imagem API corresponde à versão escolhida. Execute uma vez a CLI incluída:

```sh
docker compose run --rm --no-deps api node /app/cli/dist/index.js db migrate
```

Este comando substitui o arranque da API. Não inicia dependências nem atende pedidos. Exija código de saída 0 e migrações interna e de destino concluídas antes de iniciar os novos serviços.

Se a migração falhar, pare aqui. Algumas alterações do esquema podem já estar gravadas. Não inicie binários antigos nesse esquema. Investigue a falha ou restaure em conjunto bases, ficheiros, configuração, chaves e imagens da mesma cópia. Se o tráfego já retomou, reconcilie os envios e efeitos externos antes de restaurar um estado anterior.

### Verificar antes de retomar o tráfego

Inicie primeiro os serviços existentes de armazenamento e identidade, depois os serviços aplicacionais da versão escolhida. Preserve as versões dos motores de bases. Verifique `docker compose ps`, a saúde da API e os registos. Leia dados representativos no Studio ou na CLI. Verifique os recibos webhook e as execuções associadas antes de reabrir o tráfego.

HTTP 202 significa que o webhook foi aceite, não concluído. Consulte os recibos pendentes. Investigue recibos interrompidos e efeitos externos antes de decidir submeter trabalho de substituição. Repita o mesmo pedido lógico com o `Idempotency-Key` e conteúdo originais. Não repita em massa pedidos interrompidos com novas chaves.

Retome os emissores apenas após estas verificações. Guarde a cópia verificada e imagens anteriores conforme a política de retenção local.

### Referências

- [Prazo de paragem de serviços Docker Compose](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)
- [Comandos pontuais Docker Compose](https://docs.docker.com/reference/cli/docker/compose/run/)
- [Cópia e restauro PostgreSQL 16](https://www.postgresql.org/docs/16/backup-dump.html)
