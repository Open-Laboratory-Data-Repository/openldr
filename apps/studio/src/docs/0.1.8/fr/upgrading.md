# Mises à niveau planifiées

Prévoyez une interruption pour une mise à niveau Compose. Des changements de schéma peuvent empêcher les anciennes et nouvelles versions d'écrire ensemble sans risque. Cette procédure conserve la version du moteur de base de données. Sa mise à niveau exige une procédure distincte et testée.

## Préparer la version

Travaillez dans le répertoire du projet Compose installé. Gardez le même nom de projet, fichier d'environnement et fichiers Compose complémentaires. Relevez les étiquettes et identifiants des images avec `docker compose images`. Conservez les anciennes images et les fichiers Compose. Lisez les notes de la version cible et les exigences de migration.

Sauvegardez les fichiers `.env` et de configuration actuels dans un emplacement privé avant toute modification. Fixez `OPENLDR_VERSION` à la version choisie dans `.env`. Téléchargez uniquement les images applicatives nécessaires avant l'interruption. Ne téléchargez pas toutes les nouvelles images sans contrôle. Les services de stockage ont leurs propres versions. Conservez les versions actuelles de PostgreSQL, du service de stockage et des bases externes.

Enregistrez ce guide hors de Studio avant l'arrêt. Identifiez la personne chargée de restaurer les sauvegardes. Vérifiez comment les émetteurs mettent leurs envois en attente ou les réessaient.

## Arrêter les écritures et attendre

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

## Sauvegarder un même état sans écritures

Placez la sauvegarde dans un emplacement privé, hors des volumes du déploiement. Capturez tous ces éléments pendant la même période sans écritures :

- La base interne, la base cible configurée et la base Keycloak, avec les rôles nécessaires.
- Tous les compartiments ou volumes de fichiers, dont les fichiers référencés par les reçus webhook.
- `.env`, les fichiers Compose complémentaires, la configuration montée, les clés de chiffrement et signature, les certificats et les fichiers locaux de `data`.
- L'inventaire des images et la version applicative précédente exacte.

Pour PostgreSQL, identifiez d'abord les vrais noms des bases et le compte. Exécutez `pg_dump -Fc -f /tmp/DB.dump -U USER DB` dans le conteneur PostgreSQL avec `docker compose exec -T postgres`. Remplacez `DB` et `USER` par les valeurs du déploiement. Copiez chaque sauvegarde terminée avec `docker compose cp postgres:/tmp/DB.dump ./PRIVATE_BACKUP/DB.dump`. Créez le répertoire de destination au préalable. Répétez pour chaque base. Vérifiez chaque code de sortie.

Sauvegardez les rôles avec `pg_dumpall --globals-only -f /tmp/globals.sql -U USER`, puis copiez ce fichier. Utilisez le même mode d'exécution dans le conteneur. Protégez ces fichiers car ils peuvent contenir des identifiants. L'emploi de `-f` et `compose cp` évite la redirection binaire dans Windows PowerShell.

Pour MySQL, SQL Server ou les stockages externes, suivez la procédure native de sauvegarde et restauration de l'administrateur. Les sauvegardes PostgreSQL ne couvrent pas ces bases. Pour le service de stockage, utilisez une sauvegarde de compartiments testée ou copiez son volume après son arrêt. Ne copiez pas un volume PostgreSQL actif comme sauvegarde logique. N'exécutez jamais `docker compose down -v` pendant une mise à niveau.

## Vérifier la restauration

Restaurez dans des bases et stockages distincts, sans accès aux services de production ni aux émetteurs. Restaurez les rôles et chaque base en traitant toute erreur comme un échec. Résolvez explicitement les conflits de rôles initiaux. Comparez des nombres de lignes et des enregistrements représentatifs. Restaurez les fichiers et comparez leurs sommes de contrôle à la sauvegarde.

Utilisez les clés conservées pour déchiffrer des secrets enregistrés représentatifs dans cet environnement isolé. Vérifiez que les enregistrements restaurés retrouvent leurs fichiers. Une sauvegarde réussie, une liste d'archive ou une réponse de santé ne prouve pas la récupération. Ne migrez pas la production avant la réussite de cette restauration.

## Migrer avant de démarrer la nouvelle API

Une installation antérieure à 0.1.10 doit d'abord faire les étapes 1 à 4 de la section « Passer de MinIO à Garage » plus bas. Le nouveau fichier Compose refuse de s'exécuter sans `GARAGE_RPC_SECRET` et `GARAGE_ADMIN_TOKEN`.

Gardez les bases disponibles et tous les anciens processus d'écriture arrêtés. Vérifiez que l'image API correspond à la version cible. Exécutez une fois sa CLI intégrée :

```sh
docker compose run --rm --no-deps api node /app/cli/dist/index.js db migrate
```

Cette commande remplace la commande de démarrage API. Elle ne démarre aucune dépendance et ne sert aucune requête. Exigez le code de sortie 0 et la réussite des migrations interne et cible avant de démarrer les nouveaux services.

Si la migration échoue, arrêtez-vous. Certains changements de schéma peuvent déjà être validés. Ne démarrez pas les anciens binaires sur ce schéma. Analysez l'échec, ou restaurez ensemble les bases, fichiers, configuration, clés et images de la même sauvegarde. Si le trafic avait repris, rapprochez les envois et leurs effets externes avant de restaurer un état antérieur.

## Vérifier avant de reprendre le trafic

Démarrez d'abord les services existants de stockage et d'identité, puis les services applicatifs de la version cible. Conservez leurs versions de moteurs de bases. Vérifiez `docker compose ps`, la santé de l'API et les journaux. Lisez des données représentatives dans Studio ou la CLI. Vérifiez les reçus webhook et leurs exécutions liées avant de rouvrir le trafic.

HTTP 202 signifie que le webhook a été accepté, pas terminé. Consultez les reçus en attente. Examinez les reçus interrompus et les effets externes avant de soumettre un travail de remplacement. Réessayez la même requête logique avec son `Idempotency-Key` et son contenu d'origine. Ne rejouez pas en masse les requêtes interrompues avec de nouvelles clés.

Reprenez les envois seulement après ces vérifications. Conservez la sauvegarde vérifiée et les anciennes images selon la politique du site.

## Passer de MinIO à Garage (installations antérieures à 0.1.10)

MinIO a retiré ses images de Docker Hub le 2026-09-11. Depuis 0.1.10, le service `storage` exécute Garage à la place. Une installation qui contient déjà des fichiers doit les copier une fois. Une nouvelle installation n'en a pas besoin.

1. Notez la clé et le secret MinIO actuels dans `.env` (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). L'étape 4 les remplace.
2. Sauvegardez `.env` et `docker-compose.yml`.
3. Téléchargez les fichiers de la version 0.1.10 :
   - `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/v0.1.10/deploy/install/docker-compose.yml`, à enregistrer sous `docker-compose.yml`
   - `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/v0.1.10/deploy/install/garage.toml`, à enregistrer sous `config/garage.toml`

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

## Quand une image tierce disparaît

Chaque image tierce qu'une installation télécharge provient de la copie OpenLDR sur GHCR, fixée par son digest. La liste se trouve dans `deploy/third-party-images.json`. Si un éditeur retire une image, les installations existantes et nouvelles continuent de fonctionner, car la copie reste. La seule exception est SQL Server, dont l'image reste sur le registre de Microsoft.

Pour remplacer un éditeur :

1. Choisissez un remplaçant qui parle le même protocole.
2. Ajoutez-le à `deploy/third-party-images.json` et lancez `pnpm images:mirror <nom>`. La commande copie seulement linux/amd64 et linux/arm64.
3. Rendez le nouveau paquet GHCR public dans la page de ses paramètres.
4. Branchez-le sous le même nom de service Compose.
5. Si le format des données diffère, déplacez les données. La section sur le passage de MinIO à Garage, plus haut, en donne l'exemple détaillé.

## Références

- [Délai d'arrêt des services Docker Compose](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)
- [Commandes ponctuelles Docker Compose](https://docs.docker.com/reference/cli/docker/compose/run/)
- [Sauvegarde et restauration PostgreSQL 16](https://www.postgresql.org/docs/16/backup-dump.html)
