# Mises à niveau planifiées

Prévoyez une interruption pour une mise à niveau Compose. Des changements de schéma peuvent empêcher les anciennes et nouvelles versions d'écrire ensemble sans risque. Cette procédure conserve la version du moteur de base de données. Sa mise à niveau exige une procédure distincte et testée.

## Préparer la version

Travaillez dans le répertoire du projet Compose installé. Gardez le même nom de projet, fichier d'environnement et fichiers Compose complémentaires. Relevez les étiquettes et identifiants des images avec `docker compose images`. Conservez les anciennes images et les fichiers Compose. Lisez les notes de la version cible et les exigences de migration.

Sauvegardez les fichiers `.env` et de configuration actuels dans un emplacement privé avant toute modification. Fixez `OPENLDR_VERSION` à la version choisie dans `.env`. Téléchargez uniquement les images applicatives nécessaires avant l'interruption. Ne téléchargez pas toutes les nouvelles images sans contrôle. Les services de stockage ont leurs propres versions et MinIO peut utiliser `latest`. Conservez les versions actuelles de PostgreSQL, MinIO et des bases externes.

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

Arrêtez Keycloak et MinIO après l'API, ainsi que les autres processus écrivant dans leurs stockages. Gardez PostgreSQL actif pour les sauvegardes logiques. Maintenez toutes les écritures arrêtées pendant la vérification des sauvegardes et les migrations. Des reçus webhook en attente peuvent rester pour le nouveau traitement. Notez leurs identifiants. Examinez les travaux actifs ou interrompus avant de reprendre les envois.

## Sauvegarder un même état sans écritures

Placez la sauvegarde dans un emplacement privé, hors des volumes du déploiement. Capturez tous ces éléments pendant la même période sans écritures :

- La base interne, la base cible configurée et la base Keycloak, avec les rôles nécessaires.
- Tous les compartiments ou volumes de fichiers, dont les fichiers référencés par les reçus webhook.
- `.env`, les fichiers Compose complémentaires, la configuration montée, les clés de chiffrement et signature, les certificats et les fichiers locaux de `data`.
- L'inventaire des images et la version applicative précédente exacte.

Pour PostgreSQL, identifiez d'abord les vrais noms des bases et le compte. Exécutez `pg_dump -Fc -f /tmp/DB.dump -U USER DB` dans le conteneur PostgreSQL avec `docker compose exec -T postgres`. Remplacez `DB` et `USER` par les valeurs du déploiement. Copiez chaque sauvegarde terminée avec `docker compose cp postgres:/tmp/DB.dump ./PRIVATE_BACKUP/DB.dump`. Créez le répertoire de destination au préalable. Répétez pour chaque base. Vérifiez chaque code de sortie.

Sauvegardez les rôles avec `pg_dumpall --globals-only -f /tmp/globals.sql -U USER`, puis copiez ce fichier. Utilisez le même mode d'exécution dans le conteneur. Protégez ces fichiers car ils peuvent contenir des identifiants. L'emploi de `-f` et `compose cp` évite la redirection binaire dans Windows PowerShell.

Pour MySQL, SQL Server ou les stockages externes, suivez la procédure native de sauvegarde et restauration de l'administrateur. Les sauvegardes PostgreSQL ne couvrent pas ces bases. Pour MinIO, utilisez une sauvegarde de compartiments testée ou copiez son volume après son arrêt. Ne copiez pas un volume PostgreSQL actif comme sauvegarde logique. N'exécutez jamais `docker compose down -v` pendant une mise à niveau.

## Vérifier la restauration

Restaurez dans des bases et stockages distincts, sans accès aux services de production ni aux émetteurs. Restaurez les rôles et chaque base en traitant toute erreur comme un échec. Résolvez explicitement les conflits de rôles initiaux. Comparez des nombres de lignes et des enregistrements représentatifs. Restaurez les fichiers et comparez leurs sommes de contrôle à la sauvegarde.

Utilisez les clés conservées pour déchiffrer des secrets enregistrés représentatifs dans cet environnement isolé. Vérifiez que les enregistrements restaurés retrouvent leurs fichiers. Une sauvegarde réussie, une liste d'archive ou une réponse de santé ne prouve pas la récupération. Ne migrez pas la production avant la réussite de cette restauration.

## Migrer avant de démarrer la nouvelle API

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

## Références

- [Délai d'arrêt des services Docker Compose](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)
- [Commandes ponctuelles Docker Compose](https://docs.docker.com/reference/cli/docker/compose/run/)
- [Sauvegarde et restauration PostgreSQL 16](https://www.postgresql.org/docs/16/backup-dump.html)
