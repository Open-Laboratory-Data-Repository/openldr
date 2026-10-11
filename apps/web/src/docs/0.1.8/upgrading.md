# Planned upgrades


## English

Schedule downtime for a Compose upgrade. Schema changes can prevent old and new versions from writing safely together. This procedure keeps the database engine version unchanged. A database engine upgrade needs its own tested procedure.

### Prepare the release

Work in the installed Compose project directory. Use the same project name, environment file and Compose overlays throughout. Record the current image tags and IDs with `docker compose images`. Keep the previous images and Compose files available. Read the target release notes and migration requirements.

Save the current `.env` and configuration privately before editing them. Pin `OPENLDR_VERSION` to the chosen release in `.env`. Download only the application images needed by that release before downtime. Do not blindly pull every service: the storage services have separate versions. Preserve the current PostgreSQL, storage service and external database versions.

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

Stop Keycloak and the storage service after the API stops, and stop any other writers to their stores. Keep PostgreSQL running for logical backups. Keep all writers stopped through backup verification and migrations. Queued webhook receipts may remain for the new worker. Record their IDs and investigate running or interrupted work before resuming deliveries.

### Back up one stopped-write state

Store the backup privately, outside the deployment's volumes. Capture all of these from the same period without writes:

- The internal database, configured target database and Keycloak database, plus required database roles.
- Every blob bucket or volume, including files referenced by workflow receipts.
- `.env`, Compose files and overlays, mounted configuration, encryption and signing keys, certificates and local `data` files.
- The image inventory and exact previous application release.

For PostgreSQL, identify the real database names and account first. Run `pg_dump -Fc -f /tmp/DB.dump -U USER DB` inside the PostgreSQL container with `docker compose exec -T postgres`. Replace `DB` and `USER` with deployment values. Copy each completed dump out with `docker compose cp postgres:/tmp/DB.dump ./PRIVATE_BACKUP/DB.dump`. The destination directory must already exist. Repeat for each database. Check every exit code.

Save roles separately with `pg_dumpall --globals-only -f /tmp/globals.sql -U USER`, then copy that file out. Use the same container execution pattern. Protect these files because they can contain credentials. Using `-f` and `compose cp` avoids binary shell redirection in Windows PowerShell.

For MySQL, SQL Server or externally managed stores, use the database administrator's native backup and restore procedure. PostgreSQL dumps do not cover those databases. For the storage service, use a tested bucket backup or copy its volume while the service is stopped. Do not copy a live PostgreSQL data volume as a logical backup. Never run `docker compose down -v` during an upgrade.

### Prove the backup restores

Restore into separate database and blob destinations that cannot contact production services or senders. Restore roles and each database with errors treated as failures. Resolve bootstrap role conflicts explicitly. Compare representative row counts and saved records. Restore blob files and compare their checksums against the backup.

Use the preserved encryption keys to decrypt representative saved secrets in the isolated environment. Confirm that restored records can find their restored blobs. A successful dump, archive listing or health response alone does not prove recoverability. Do not migrate production until this restore check succeeds.

### Migrate before starting the new API

An install from before 0.1.11 must do steps 1 to 4 of the section "Moving from MinIO to Garage" below first. The new compose file refuses to run without `GARAGE_RPC_SECRET` and `GARAGE_ADMIN_TOKEN`.

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

### Moving from MinIO to Garage (installs from before 0.1.11)

MinIO removed its images from Docker Hub on 2026-09-11. From 0.1.11 the `storage` service runs Garage instead. An install that already holds files must copy them across once. A fresh install does not need this.

1. Note the current MinIO key and secret from `.env` (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). Step 4 overwrites them.
2. Back up `.env` and `docker-compose.yml`.
3. Download the 0.1.11 files:
   - `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/v0.1.11/deploy/install/docker-compose.yml`, saved as `docker-compose.yml`
   - `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/v0.1.11/deploy/install/garage.toml`, saved as `config/garage.toml`

   Then add the old `minio` service back into `docker-compose.yml` from your backup. This keeps MinIO running beside Garage. Give it the old key and secret as literal values, not `${S3_...}`. Step 4 changes those variables, and MinIO would then reject the old login.

   ```yaml
     minio:
       image: minio/minio:latest
       command: server /data --console-address ':9001'
       environment:
         MINIO_ROOT_USER: <old key>
         MINIO_ROOT_PASSWORD: <old secret>
       volumes:
         - miniodata:/data
   ```

   Add `miniodata:` under the top-level `volumes:` too. The MinIO image is still on the machine from the old install, so this works without Docker Hub.
4. Generate new values and write them to `.env`:
   - `S3_ACCESS_KEY_ID`: `GK` followed by 24 hex characters (`echo GK$(openssl rand -hex 12)`)
   - `S3_SECRET_ACCESS_KEY`, `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`: 64 hex characters each (`openssl rand -hex 32`)
   - `S3_ENDPOINT=http://storage:3900`
5. Start MinIO and the new services: `docker compose up -d minio storage api`.
6. Copy the files:
   `./openldr storage copy --from-endpoint http://minio:9000 --from-key <old key> --from-secret <old secret> --from-bucket openldr`
   It prints object counts and bytes for both sides, then checks that every source object is on Garage at the same size. It exits non-zero if any is missing. Extra objects on Garage are expected while the api runs, because it keeps writing new files there. They do not fail the check. Run it again to resume after a failure. It skips objects already on Garage with the same size. It does not replace an object whose size is unchanged but whose content differs. It never changes MinIO.
7. When it reports `every source object is on the target`, open a few uploaded files in the studio.
8. Remove the `minio` service from `docker-compose.yml` and run `docker compose up -d --remove-orphans`. Keep the `miniodata` volume until you are sure. Then delete it with `docker volume rm <project>_miniodata`.

Without the `./openldr` wrapper, run `docker compose run --rm --no-deps api node /app/cli/dist/index.js storage copy` with the same flags.

The `--from-secret` value shows in your shell history and in the process list while the command runs. Clear that history line afterwards, or run the command in a throwaway shell.

If you run from source, the compose file (`docker-compose.prod.yml`) and `deploy/install/garage.toml` arrive with the new checkout. Skip the downloads in step 3, but still add the old `minio` service back with its old login. Your `.env.prod` came from an earlier `pnpm run init`. Its `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` are not in Garage's format. Replace both as in step 4 (`GK` plus `openssl rand -hex 12`, and `openssl rand -hex 32`). Then add `GARAGE_RPC_SECRET` and `GARAGE_ADMIN_TOKEN`. Compose refuses to run until both exist. In step 5, start the services with `docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr up -d --build minio storage api`. In step 6, run the copy inside the api container with `docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr exec api node /app/cli/dist/index.js storage copy` and the same flags. In step 8, use the same `--env-file`, `-f` and `-p` options.

### When a third-party image disappears

Every third-party image an install pulls comes from the OpenLDR copy on GHCR, pinned by digest. The list is `deploy/third-party-images.json`. If a vendor removes an image, existing installs and new installs keep working, because the copy stays. The one exception is SQL Server, whose image stays on Microsoft's registry.

To replace a vendor:

1. Pick a replacement that speaks the same protocol.
2. Add it to `deploy/third-party-images.json` and run `pnpm images:mirror <name>`. It copies linux/amd64 and linux/arm64 only.
3. Make the new GHCR package public in its settings page.
4. Swap it in behind the same compose service name.
5. If the data format differs, move the data. The MinIO to Garage section above is the worked example.

### References

- [Docker Compose service shutdown grace](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)
- [Docker Compose one-off commands](https://docs.docker.com/reference/cli/docker/compose/run/)
- [PostgreSQL 16 backup and restore](https://www.postgresql.org/docs/16/backup-dump.html)

## Français

Prévoyez une interruption pour une mise à niveau Compose. Des changements de schéma peuvent empêcher les anciennes et nouvelles versions d'écrire ensemble sans risque. Cette procédure conserve la version du moteur de base de données. Sa mise à niveau exige une procédure distincte et testée.

### Préparer la version

Travaillez dans le répertoire du projet Compose installé. Gardez le même nom de projet, fichier d'environnement et fichiers Compose complémentaires. Relevez les étiquettes et identifiants des images avec `docker compose images`. Conservez les anciennes images et les fichiers Compose. Lisez les notes de la version cible et les exigences de migration.

Sauvegardez les fichiers `.env` et de configuration actuels dans un emplacement privé avant toute modification. Fixez `OPENLDR_VERSION` à la version choisie dans `.env`. Téléchargez uniquement les images applicatives nécessaires avant l'interruption. Ne téléchargez pas toutes les nouvelles images sans contrôle. Les services de stockage ont leurs propres versions. Conservez les versions actuelles de PostgreSQL, du service de stockage et des bases externes.

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

Arrêtez Keycloak et le service de stockage après l'API, ainsi que les autres processus écrivant dans leurs stockages. Gardez PostgreSQL actif pour les sauvegardes logiques. Maintenez toutes les écritures arrêtées pendant la vérification des sauvegardes et les migrations. Des reçus webhook en attente peuvent rester pour le nouveau traitement. Notez leurs identifiants. Examinez les travaux actifs ou interrompus avant de reprendre les envois.

### Sauvegarder un même état sans écritures

Placez la sauvegarde dans un emplacement privé, hors des volumes du déploiement. Capturez tous ces éléments pendant la même période sans écritures :

- La base interne, la base cible configurée et la base Keycloak, avec les rôles nécessaires.
- Tous les compartiments ou volumes de fichiers, dont les fichiers référencés par les reçus webhook.
- `.env`, les fichiers Compose complémentaires, la configuration montée, les clés de chiffrement et signature, les certificats et les fichiers locaux de `data`.
- L'inventaire des images et la version applicative précédente exacte.

Pour PostgreSQL, identifiez d'abord les vrais noms des bases et le compte. Exécutez `pg_dump -Fc -f /tmp/DB.dump -U USER DB` dans le conteneur PostgreSQL avec `docker compose exec -T postgres`. Remplacez `DB` et `USER` par les valeurs du déploiement. Copiez chaque sauvegarde terminée avec `docker compose cp postgres:/tmp/DB.dump ./PRIVATE_BACKUP/DB.dump`. Créez le répertoire de destination au préalable. Répétez pour chaque base. Vérifiez chaque code de sortie.

Sauvegardez les rôles avec `pg_dumpall --globals-only -f /tmp/globals.sql -U USER`, puis copiez ce fichier. Utilisez le même mode d'exécution dans le conteneur. Protégez ces fichiers car ils peuvent contenir des identifiants. L'emploi de `-f` et `compose cp` évite la redirection binaire dans Windows PowerShell.

Pour MySQL, SQL Server ou les stockages externes, suivez la procédure native de sauvegarde et restauration de l'administrateur. Les sauvegardes PostgreSQL ne couvrent pas ces bases. Pour le service de stockage, utilisez une sauvegarde de compartiments testée ou copiez son volume après son arrêt. Ne copiez pas un volume PostgreSQL actif comme sauvegarde logique. N'exécutez jamais `docker compose down -v` pendant une mise à niveau.

### Vérifier la restauration

Restaurez dans des bases et stockages distincts, sans accès aux services de production ni aux émetteurs. Restaurez les rôles et chaque base en traitant toute erreur comme un échec. Résolvez explicitement les conflits de rôles initiaux. Comparez des nombres de lignes et des enregistrements représentatifs. Restaurez les fichiers et comparez leurs sommes de contrôle à la sauvegarde.

Utilisez les clés conservées pour déchiffrer des secrets enregistrés représentatifs dans cet environnement isolé. Vérifiez que les enregistrements restaurés retrouvent leurs fichiers. Une sauvegarde réussie, une liste d'archive ou une réponse de santé ne prouve pas la récupération. Ne migrez pas la production avant la réussite de cette restauration.

### Migrer avant de démarrer la nouvelle API

Une installation antérieure à 0.1.11 doit d'abord faire les étapes 1 à 4 de la section « Passer de MinIO à Garage » plus bas. Le nouveau fichier Compose refuse de s'exécuter sans `GARAGE_RPC_SECRET` et `GARAGE_ADMIN_TOKEN`.

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

### Passer de MinIO à Garage (installations antérieures à 0.1.11)

MinIO a retiré ses images de Docker Hub le 2026-09-11. Depuis 0.1.11, le service `storage` exécute Garage à la place. Une installation qui contient déjà des fichiers doit les copier une fois. Une nouvelle installation n'en a pas besoin.

1. Notez la clé et le secret MinIO actuels dans `.env` (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). L'étape 4 les remplace.
2. Sauvegardez `.env` et `docker-compose.yml`.
3. Téléchargez les fichiers de la version 0.1.11 :
   - `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/v0.1.11/deploy/install/docker-compose.yml`, à enregistrer sous `docker-compose.yml`
   - `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/v0.1.11/deploy/install/garage.toml`, à enregistrer sous `config/garage.toml`

   Remettez ensuite l'ancien service `minio` dans `docker-compose.yml` à partir de votre sauvegarde. MinIO reste ainsi actif à côté de Garage. Donnez-lui l'ancienne clé et l'ancien secret en valeurs littérales, pas en `${S3_...}`. L'étape 4 modifie ces variables, et MinIO refuserait alors l'ancien identifiant.

   ```yaml
     minio:
       image: minio/minio:latest
       command: server /data --console-address ':9001'
       environment:
         MINIO_ROOT_USER: <ancienne clé>
         MINIO_ROOT_PASSWORD: <ancien secret>
       volumes:
         - miniodata:/data
   ```

   Ajoutez aussi `miniodata:` sous le bloc `volumes:` de premier niveau. L'image MinIO est encore sur la machine depuis l'ancienne installation, donc cela fonctionne sans Docker Hub.
4. Générez de nouvelles valeurs et écrivez-les dans `.env` :
   - `S3_ACCESS_KEY_ID` : `GK` suivi de 24 caractères hexadécimaux (`echo GK$(openssl rand -hex 12)`)
   - `S3_SECRET_ACCESS_KEY`, `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN` : 64 caractères hexadécimaux chacun (`openssl rand -hex 32`)
   - `S3_ENDPOINT=http://storage:3900`
5. Démarrez MinIO et les nouveaux services : `docker compose up -d minio storage api`.
6. Copiez les fichiers :
   `./openldr storage copy --from-endpoint http://minio:9000 --from-key <ancienne clé> --from-secret <ancien secret> --from-bucket openldr`
   La commande affiche le nombre d'objets et d'octets des deux côtés, puis vérifie que chaque objet de la source est dans Garage avec la même taille. Elle se termine avec un code non nul s'il en manque un. Des objets en plus dans Garage sont normaux tant que l'api tourne, car elle y écrit de nouveaux fichiers. Ils ne font pas échouer la vérification. Relancez-la pour reprendre après un échec. Elle ignore les objets déjà présents dans Garage avec la même taille. Elle ne remplace pas un objet de même taille mais de contenu différent. Elle ne modifie jamais MinIO.
7. Quand elle affiche `every source object is on the target`, ouvrez quelques fichiers téléversés dans le studio.
8. Retirez le service `minio` de `docker-compose.yml` et lancez `docker compose up -d --remove-orphans`. Gardez le volume `miniodata` tant que vous n'êtes pas sûr. Supprimez-le ensuite avec `docker volume rm <projet>_miniodata`.

Sans le script `./openldr`, lancez `docker compose run --rm --no-deps api node /app/cli/dist/index.js storage copy` avec les mêmes options.

La valeur de `--from-secret` apparaît dans l'historique du shell et dans la liste des processus pendant l'exécution. Effacez ensuite cette ligne de l'historique, ou lancez la commande dans un shell jetable.

Si vous exécutez depuis les sources, le fichier Compose (`docker-compose.prod.yml`) et `deploy/install/garage.toml` arrivent avec la nouvelle copie du dépôt. Ignorez donc les téléchargements de l'étape 3, mais remettez quand même l'ancien service `minio` avec son ancien identifiant. Votre `.env.prod` vient d'un ancien `pnpm run init`. Ses `S3_ACCESS_KEY_ID` et `S3_SECRET_ACCESS_KEY` n'ont pas le format de Garage. Remplacez-les comme à l'étape 4 (`GK` plus `openssl rand -hex 12`, et `openssl rand -hex 32`). Ajoutez ensuite `GARAGE_RPC_SECRET` et `GARAGE_ADMIN_TOKEN`. Compose refuse de s'exécuter tant que ces deux valeurs manquent. À l'étape 5, démarrez les services avec `docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr up -d --build minio storage api`. À l'étape 6, lancez la copie dans le conteneur api avec `docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr exec api node /app/cli/dist/index.js storage copy` et les mêmes options. À l'étape 8, utilisez les mêmes options `--env-file`, `-f` et `-p`.

### Quand une image tierce disparaît

Chaque image tierce qu'une installation télécharge provient de la copie OpenLDR sur GHCR, fixée par son digest. La liste se trouve dans `deploy/third-party-images.json`. Si un éditeur retire une image, les installations existantes et nouvelles continuent de fonctionner, car la copie reste. La seule exception est SQL Server, dont l'image reste sur le registre de Microsoft.

Pour remplacer un éditeur :

1. Choisissez un remplaçant qui parle le même protocole.
2. Ajoutez-le à `deploy/third-party-images.json` et lancez `pnpm images:mirror <nom>`. La commande copie seulement linux/amd64 et linux/arm64.
3. Rendez le nouveau paquet GHCR public dans la page de ses paramètres.
4. Branchez-le sous le même nom de service Compose.
5. Si le format des données diffère, déplacez les données. La section sur le passage de MinIO à Garage, plus haut, en donne l'exemple détaillé.

### Références

- [Délai d'arrêt des services Docker Compose](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)
- [Commandes ponctuelles Docker Compose](https://docs.docker.com/reference/cli/docker/compose/run/)
- [Sauvegarde et restauration PostgreSQL 16](https://www.postgresql.org/docs/16/backup-dump.html)

## Português

Reserve uma interrupção para atualizar uma instalação Compose. Alterações do esquema podem impedir escritas seguras entre versões antigas e novas. Este procedimento mantém a versão do motor de base de dados. A atualização desse motor exige um procedimento separado e testado.

### Preparar a versão

Trabalhe no diretório do projeto Compose instalado. Use sempre o mesmo nome de projeto, ficheiro de ambiente e ficheiros Compose complementares. Registe as etiquetas e identificadores das imagens com `docker compose images`. Guarde as imagens anteriores e os ficheiros Compose. Leia as notas da versão pretendida e os requisitos de migração.

Guarde os ficheiros `.env` e de configuração atuais num local privado antes de os alterar. Defina `OPENLDR_VERSION` com a versão escolhida em `.env`. Descarregue apenas as imagens aplicacionais necessárias antes da interrupção. Não atualize todas as imagens sem análise. Os serviços de armazenamento têm versões próprias. Mantenha as versões atuais de PostgreSQL, do serviço de armazenamento e das bases externas.

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

Pare o Keycloak e o serviço de armazenamento após a API, assim como outros processos que escrevam nos seus armazenamentos. Mantenha o PostgreSQL ativo para cópias lógicas. Mantenha todas as escritas paradas durante a verificação das cópias e as migrações. Podem ficar recibos webhook em fila para o novo processo. Registe os identificadores. Investigue trabalhos ativos ou interrompidos antes de retomar os envios.

### Copiar um mesmo estado sem escritas

Guarde a cópia num local privado, fora dos volumes do sistema. Copie todos estes elementos durante o mesmo período sem escritas:

- A base interna, a base de destino configurada e a base Keycloak, com os papéis necessários.
- Todos os buckets ou volumes de ficheiros, incluindo ficheiros referenciados pelos recibos webhook.
- `.env`, ficheiros Compose complementares, configuração montada, chaves de cifra e assinatura, certificados e ficheiros locais de `data`.
- O inventário de imagens e a versão aplicacional anterior exata.

Para PostgreSQL, identifique primeiro os nomes reais das bases e a conta. Execute `pg_dump -Fc -f /tmp/DB.dump -U USER DB` dentro do contentor PostgreSQL com `docker compose exec -T postgres`. Substitua `DB` e `USER` pelos valores da instalação. Copie cada ficheiro concluído com `docker compose cp postgres:/tmp/DB.dump ./PRIVATE_BACKUP/DB.dump`. Crie primeiro o diretório de destino. Repita para cada base. Verifique todos os códigos de saída.

Guarde os papéis com `pg_dumpall --globals-only -f /tmp/globals.sql -U USER` e copie o ficheiro. Use o mesmo modo de execução no contentor. Proteja estes ficheiros porque podem conter credenciais. Usar `-f` e `compose cp` evita redirecionamento binário no Windows PowerShell.

Para MySQL, SQL Server ou armazenamento externo, siga o procedimento nativo de cópia e restauro do administrador. As cópias PostgreSQL não incluem essas bases. Para o serviço de armazenamento, use uma cópia de buckets testada ou copie o volume enquanto o serviço está parado. Não copie um volume PostgreSQL ativo como cópia lógica. Nunca execute `docker compose down -v` durante uma atualização.

### Verificar o restauro

Restaure para bases e armazenamento separados, sem acesso aos serviços de produção ou emissores. Restaure papéis e todas as bases, tratando qualquer erro como falha. Resolva explicitamente conflitos com papéis iniciais. Compare contagens de linhas e registos representativos. Restaure ficheiros e compare as somas de verificação com a cópia.

Use as chaves preservadas para decifrar segredos guardados representativos no ambiente isolado. Confirme que os registos restaurados encontram os seus ficheiros. Uma cópia concluída, uma listagem do arquivo ou uma resposta de saúde não prova a recuperação. Não migre a produção antes de este restauro passar.

### Migrar antes de iniciar a nova API

Uma instalação anterior à 0.1.11 deve primeiro fazer os passos 1 a 4 da secção "Passar do MinIO para o Garage" mais abaixo. O novo ficheiro Compose recusa-se a correr sem `GARAGE_RPC_SECRET` e `GARAGE_ADMIN_TOKEN`.

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

### Passar do MinIO para o Garage (instalações anteriores à 0.1.11)

O MinIO retirou as suas imagens do Docker Hub em 2026-09-11. A partir da 0.1.11, o serviço `storage` executa o Garage. Uma instalação que já tem ficheiros tem de os copiar uma vez. Uma instalação nova não precisa disto.

1. Anote a chave e o segredo atuais do MinIO em `.env` (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). O passo 4 substitui-os.
2. Faça cópia de segurança de `.env` e `docker-compose.yml`.
3. Descarregue os ficheiros da versão 0.1.11:
   - `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/v0.1.11/deploy/install/docker-compose.yml`, guardado como `docker-compose.yml`
   - `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/v0.1.11/deploy/install/garage.toml`, guardado como `config/garage.toml`

   Depois volte a juntar o antigo serviço `minio` ao `docker-compose.yml` a partir da sua cópia. Assim o MinIO continua ativo ao lado do Garage. Indique a chave e o segredo antigos como valores literais, não como `${S3_...}`. O passo 4 altera essas variáveis, e o MinIO passaria a recusar o login antigo.

   ```yaml
     minio:
       image: minio/minio:latest
       command: server /data --console-address ':9001'
       environment:
         MINIO_ROOT_USER: <chave antiga>
         MINIO_ROOT_PASSWORD: <segredo antigo>
       volumes:
         - miniodata:/data
   ```

   Junte também `miniodata:` sob o bloco `volumes:` de nível superior. A imagem do MinIO ainda está na máquina desde a instalação antiga, por isso isto funciona sem o Docker Hub.
4. Gere novos valores e escreva-os em `.env`:
   - `S3_ACCESS_KEY_ID`: `GK` seguido de 24 carateres hexadecimais (`echo GK$(openssl rand -hex 12)`)
   - `S3_SECRET_ACCESS_KEY`, `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`: 64 carateres hexadecimais cada (`openssl rand -hex 32`)
   - `S3_ENDPOINT=http://storage:3900`
5. Inicie o MinIO e os novos serviços: `docker compose up -d minio storage api`.
6. Copie os ficheiros:
   `./openldr storage copy --from-endpoint http://minio:9000 --from-key <chave antiga> --from-secret <segredo antigo> --from-bucket openldr`
   O comando mostra o número de objetos e de bytes dos dois lados e depois verifica se cada objeto da origem está no Garage com o mesmo tamanho. Termina com código diferente de zero se faltar algum. Objetos a mais no Garage são normais enquanto a api corre, porque ela continua a escrever ficheiros novos lá. Não fazem a verificação falhar. Execute-o de novo para retomar após uma falha. Ignora os objetos que já estão no Garage com o mesmo tamanho. Não substitui um objeto com o mesmo tamanho mas conteúdo diferente. Nunca altera o MinIO.
7. Quando mostrar `every source object is on the target`, abra alguns ficheiros carregados no studio.
8. Retire o serviço `minio` do `docker-compose.yml` e execute `docker compose up -d --remove-orphans`. Mantenha o volume `miniodata` até ter a certeza. Depois elimine-o com `docker volume rm <projeto>_miniodata`.

Sem o script `./openldr`, execute `docker compose run --rm --no-deps api node /app/cli/dist/index.js storage copy` com as mesmas opções.

O valor de `--from-secret` fica visível no histórico da shell e na lista de processos enquanto o comando corre. Apague depois essa linha do histórico, ou execute o comando numa shell descartável.

Se executa a partir do código-fonte, o ficheiro Compose (`docker-compose.prod.yml`) e o `deploy/install/garage.toml` chegam com a nova cópia do repositório. Dispense por isso os descarregamentos do passo 3, mas volte a juntar o antigo serviço `minio` com o seu login antigo. O seu `.env.prod` vem de um `pnpm run init` anterior. O `S3_ACCESS_KEY_ID` e o `S3_SECRET_ACCESS_KEY` não têm o formato do Garage. Substitua ambos como no passo 4 (`GK` mais `openssl rand -hex 12`, e `openssl rand -hex 32`). Depois adicione `GARAGE_RPC_SECRET` e `GARAGE_ADMIN_TOKEN`. O Compose recusa-se a correr até existirem os dois. No passo 5, inicie os serviços com `docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr up -d --build minio storage api`. No passo 6, execute a cópia dentro do contentor api com `docker compose --env-file .env.prod -f docker-compose.prod.yml -p openldr exec api node /app/cli/dist/index.js storage copy` e as mesmas opções. No passo 8, use as mesmas opções `--env-file`, `-f` e `-p`.

### Quando uma imagem de terceiros desaparece

Cada imagem de terceiros que uma instalação descarrega vem da cópia do OpenLDR no GHCR, fixada pelo digest. A lista está em `deploy/third-party-images.json`. Se um fornecedor retirar uma imagem, as instalações existentes e as novas continuam a funcionar, porque a cópia fica. A única exceção é o SQL Server, cuja imagem fica no registo da Microsoft.

Para substituir um fornecedor:

1. Escolha um substituto que fale o mesmo protocolo.
2. Adicione-o a `deploy/third-party-images.json` e execute `pnpm images:mirror <nome>`. O comando copia apenas linux/amd64 e linux/arm64.
3. Torne público o novo pacote GHCR na página de definições do pacote.
4. Ligue-o com o mesmo nome de serviço Compose.
5. Se o formato dos dados for diferente, mova os dados. A secção sobre a passagem do MinIO para o Garage, acima, é o exemplo concreto.

### Referências

- [Prazo de paragem de serviços Docker Compose](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)
- [Comandos pontuais Docker Compose](https://docs.docker.com/reference/cli/docker/compose/run/)
- [Cópia e restauro PostgreSQL 16](https://www.postgresql.org/docs/16/backup-dump.html)
