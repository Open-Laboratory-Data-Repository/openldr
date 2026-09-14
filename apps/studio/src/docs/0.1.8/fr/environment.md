# Variables d'environnement

OpenLDR se configure par des variables d'environnement lues au démarrage. Dans un
déploiement Docker, elles se trouvent dans le fichier `.env` placé à côté de
`docker-compose.yml` (le fichier généré par l'installateur). Modifiez une valeur, puis
recréez la pile pour l'appliquer :

```
docker compose up -d
```

La plupart des opérateurs ne modifient jamais ces valeurs à la main. L'installateur écrit
des valeurs par défaut adaptées et génère tous les secrets. Cette page sert de référence
pour les valeurs utiles au-delà d'une installation sur un seul hôte : un domaine public,
une base de données externe, ou SQL Server comme entrepôt analytique.

> Les secrets (`*_PASSWORD`, `*_SECRET_*`, `SECRETS_ENCRYPTION_KEY`) sont générés à la
> première installation. Ne les partagez jamais et ne les versionnez jamais. Changer
> `SECRETS_ENCRYPTION_KEY` après la création de connecteurs rend leurs identifiants
> enregistrés illisibles. Considérez cette clé comme définitive une fois la pile en service.

## Exécution

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `NODE_ENV` | `production` | Mode d'exécution. Gardez `production` pour un déploiement. |
| `PORT` | `3000` | Port interne de l'API derrière la passerelle. |
| `LOG_LEVEL` | `info` | Niveau de détail des journaux (`debug`, `info`, `warn`, `error`). |
| `OPENLDR_VERSION` | `latest` | Étiquette d'image que la pile télécharge et exécute. |
| `TRUST_PROXY` | non défini | Nombre de proxys devant l'API auxquels se fier pour l'adresse IP du client. Mettez `1` derrière la passerelle fournie, pour que le journal d'audit montre la vraie adresse du client. Ne le définissez que si un proxy de confiance se trouve vraiment devant l'API. Sinon, un client peut falsifier sa propre adresse IP. |

## Adresse publique et TLS

Ces valeurs fixent l'URL que les utilisateurs atteignent et la façon dont la passerelle
termine HTTPS. `SERVER_NAME` est le nom d'hôte public. `PUBLIC_ORIGIN` est l'origine
complète utilisée pour les liens et les redirections OIDC.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `SERVER_NAME` | `localhost` | Nom d'hôte ou domaine public du déploiement. |
| `PUBLIC_ORIGIN` | `https://localhost` | Origine externe complète (`https://votre.domaine`). |
| `GATEWAY_HTTP_PORT` | `80` | Port de l'hôte sur lequel la passerelle sert HTTP. |
| `GATEWAY_HTTPS_PORT` | `443` | Port de l'hôte sur lequel la passerelle sert HTTPS. |
| `TLS_MODE` | `self-signed` | `self-signed` ou un certificat reconnu (Let's Encrypt). |
| `LETSENCRYPT_EMAIL` | non défini | Adresse de contact utilisée pour émettre un certificat reconnu. |

## Base de données

OpenLDR utilise toujours une base Postgres interne pour l'application. L'entrepôt cible
(analytique) peut être Postgres, SQL Server ou MySQL/MariaDB, selon
`TARGET_STORE_ADAPTER`. `TARGET_DATABASE_URL` s'applique à une cible Postgres. SQL Server et
MySQL ont leurs propres variables, décrites plus bas.

| Variable | Rôle |
| --- | --- |
| `INTERNAL_DATABASE_URL` | Base de l'application (utilisateurs, formulaires, workflows, audit). Toujours Postgres. |
| `TARGET_DATABASE_URL` | Entrepôt analytique alimenté par les pipelines, quand `TARGET_STORE_ADAPTER=pg`. |
| `POSTGRES_PASSWORD` | Mot de passe du conteneur Postgres fourni. |

## Adaptateurs

Les adaptateurs choisissent l'implémentation de chaque sous-système. Les valeurs par
défaut correspondent aux conteneurs fournis. Ne les changez que pour utiliser une
infrastructure externe.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `AUTH_ADAPTER` | `keycloak` | Mode de connexion : `keycloak` ou `oidc`. Voir [Fournisseurs d'authentification](/docs/auth-providers). |
| `BLOB_ADAPTER` | `minio` | Stockage objet des téléversements et des artefacts. |
| `EVENTING_ADAPTER` | `pg` | Magasin d'événements utilisé par les déclencheurs de workflow. |
| `TARGET_STORE_ADAPTER` | `pg` | Moteur de l'entrepôt analytique : `pg`, `mssql` ou `mysql`. |

Une cible de rapport externe ne se choisit plus ici par un adaptateur. Créez plutôt un
connecteur dans **Paramètres > Connecteurs**. Le plugin de destination est déterminé à
partir de ce connecteur.

## Stockage objet (S3 / MinIO)

Le conteneur MinIO fourni est compatible S3. Pointez ces variables vers n'importe quel
point d'accès S3 pour utiliser un stockage externe.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://minio:9000` | URL du point d'accès S3. |
| `S3_REGION` | `us-east-1` | Région S3. |
| `S3_ACCESS_KEY_ID` | générée | Clé d'accès. |
| `S3_SECRET_ACCESS_KEY` | générée | Clé secrète. |
| `S3_BUCKET` | `openldr` | Bucket qui contient les téléversements et les artefacts. |
| `S3_FORCE_PATH_STYLE` | `true` | Adressage par chemin (requis par MinIO). |

## Authentification (Keycloak / OIDC)

Keycloak est le mode par défaut. OIDC générique utilise la découverte et des jetons
d'accès JWT. Voir [Fournisseurs d'authentification](/docs/auth-providers) pour la mise en
place, les limites d'administration et la protection de l'émetteur.

| Variable | Rôle |
| --- | --- |
| `IDENTITY_ADMIN_ADAPTER` | `keycloak` ou `none`. Vaut `keycloak` par défaut avec Keycloak, `none` avec OIDC générique. |
| `OIDC_ISSUER_URL` | URL publique de l'émetteur. Gardez la valeur existante lors d'une mise à jour. Un changement ultérieur bloque le démarrage. |
| `OIDC_INTERNAL_ISSUER_URL` | URL interne de base du realm, pour Keycloak uniquement. OIDC générique ignore cette valeur. |
| `OIDC_INTERNAL_JWKS_URL` | Remplace l'adresse interne des clés de signature. Ne change pas l'émetteur attendu. |
| `OIDC_AUDIENCE` | Audience attendue du jeton. |
| `OIDC_WEB_CLIENT_ID` | Identifiant du client public avec lequel Studio s'authentifie. |
| `OIDC_SCOPES` | Scopes demandés par Studio. Vaut `openid profile email` par défaut. Doit inclure `openid`. |
| `OIDC_RESOURCE` | URL de ressource à demander, pour les fournisseurs qui en exigent une pour émettre le jeton d'accès API. |
| `TLS_CERT_PATH` | Chemin du certificat TLS public de ce serveur (PEM). S'il est défini, la page Sites propose de le télécharger, pour qu'un laboratoire distant puisse faire confiance à un serveur central auto-signé. L'installateur le définit pour vous. |
| `KC_HOSTNAME` | URL publique de base annoncée par Keycloak. |
| `KEYCLOAK_ADMIN` | Nom d'utilisateur de l'administrateur Keycloak. |
| `KEYCLOAK_ADMIN_PASSWORD` | Mot de passe de l'administrateur Keycloak (généré). |
| `KEYCLOAK_ADMIN_CLIENT_ID` | Identifiant du client utilisé pour les appels à l'API d'administration. |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Secret du client utilisé pour les appels à l'API d'administration. |

## Réglages réservés au développement

Ces variables servent au développement local et aux tests automatisés. Ne les définissez
jamais dans un déploiement.

`AUTH_DEV_BYPASS` **désactive l'authentification**. Toute requête API sans jeton est
traitée comme venant d'un administrateur de développement. Elle reste désactivée tant que
vous ne la définissez pas, et le serveur refuse de démarrer si elle est active avec
`NODE_ENV=production`. Quand elle est active, Studio affiche un bandeau de contournement
de l'authentification et le serveur écrit un avertissement au démarrage.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `AUTH_DEV_BYPASS` | `false` | Traiter les requêtes API non authentifiées comme venant d'un administrateur de développement. |
| `AUTH_DEV_USERNAME` | `dev-admin` | Nom d'utilisateur de l'acteur de développement injecté. |
| `AUTH_DEV_ROLES` | `lab_admin` | Rôles attribués à l'acteur de développement injecté. |
| `MARKETPLACE_DEV_ALLOW_UNSIGNED` | `false` | Installer des paquets du Marketplace qui ne portent aucune signature. |

## Secrets

| Variable | Rôle |
| --- | --- |
| `SECRETS_ENCRYPTION_KEY` | Clé de 32 octets en base64 qui chiffre les identifiants des connecteurs au repos. Générez-la avec `openssl rand -base64 32`. |

## Premier démarrage

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `MIGRATE_ON_START` | `true` | Appliquer les migrations de base de données au démarrage de l'API. |
| `SEED_ON_START` | `true` | Charger les formulaires, workflows et terminologies par défaut au premier démarrage. |

## Imports de terminologie

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `TERMINOLOGY_WORK_DIR` | dossier temporaire du système | Dossier où une version de terminologie téléversée est décompressée pendant l'import. Une version complète de SNOMED CT a besoin de place pour le zip et les fichiers décompressés en même temps. Pointez-le vers un disque plus grand quand le dossier temporaire du conteneur est petit. |

## Entrepôt cible SQL Server

À définir seulement quand `TARGET_STORE_ADAPTER=mssql`. Démarrez le profil SQL Server avec
`docker compose --profile mssql up -d`.

| Variable | Rôle |
| --- | --- |
| `MSSQL_HOST` | Hôte SQL Server. |
| `MSSQL_PORT` | Port SQL Server (par défaut `1433`). |
| `MSSQL_DATABASE` | Nom de la base cible. |
| `MSSQL_USER` | Identifiant de connexion. |
| `MSSQL_PASSWORD` | Mot de passe. |
| `MSSQL_ENCRYPT` | `true`/`false` : chiffrer la connexion. |
| `MSSQL_TRUST_SERVER_CERT` | `true`/`false` : faire confiance à un certificat serveur auto-signé. |

## Entrepôt cible MySQL / MariaDB

À définir seulement quand `TARGET_STORE_ADAPTER=mysql`. Fonctionne avec MySQL 8.4+ et
MariaDB 11.4+.

| Variable | Rôle |
| --- | --- |
| `MYSQL_HOST` | Hôte MySQL/MariaDB. |
| `MYSQL_PORT` | Port du serveur (par défaut `3306`). |
| `MYSQL_DATABASE` | Nom de la base cible. |
| `MYSQL_USER` | Identifiant de connexion. |
| `MYSQL_PASSWORD` | Mot de passe. |
| `MYSQL_SSL` | `true`/`false` : se connecter en TLS. |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | `true`/`false` : refuser un certificat serveur non reconnu. |

## Workflows

Voir [Workflows](/docs/workflows) pour les nœuds concernés par ces réglages.

> `WORKFLOW_CODE_ENABLED` permet aux auteurs de workflows d'exécuter du JavaScript avec
> les mêmes accès que le serveur : ses fichiers, son réseau, son environnement et ses
> secrets. L'exécuteur de code n'est pas un bac à sable. Ne l'activez que si vous faites
> confiance à toutes les personnes qui peuvent modifier des workflows.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `WORKFLOW_CODE_ENABLED` | `false` | Autoriser l'exécution des nœuds Code. Désactivé, un nœud Code refuse de s'exécuter. |
| `WORKFLOW_CODE_TIMEOUT_MS` | `5000` | Durée maximale d'une exécution de nœud Code, en millisecondes. |
| `WORKFLOW_CODE_MEMORY_MB` | `128` | Mémoire maximale d'une exécution de nœud Code, en Mo. |
| `WORKFLOW_HTTP_ALLOWLIST` | vide | Noms d'hôte, séparés par des virgules, que le nœud HTTP Request peut appeler. Vide, tous les hôtes sont refusés. |
| `WORKFLOW_FILE_MAX_BYTES` | `52428800` (50 Mo) | Taille maximale d'un fichier envoyé à une exécution de workflow ou d'un corps de webhook. |
| `WORKFLOW_LOOP_MAX_ITEMS` | `100000` | Nombre maximal d'éléments qu'un nœud de boucle peut collecter. |
| `WORKFLOW_FILE_ACCESS_ENABLED` | `false` | Autoriser le nœud Read/Write File à accéder aux fichiers du serveur. |
| `WORKFLOW_FILE_ACCESS_ROOT` | vide | Le seul dossier auquel le nœud Read/Write File est limité. Tant qu'il est vide, le nœud échoue. |
| `WORKFLOW_EMAIL_POLL_MIN_SECONDS` | `30` | Intervalle minimal de relève d'un déclencheur e-mail, en secondes. |
| `WORKFLOW_EMAIL_MAX_PER_POLL` | `50` | Nombre maximal de messages non lus traités par relève. |

## Import du registre des établissements

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `FACILITY_IMPORT_MAX_UPLOAD_BYTES` | `67108864` (64 Mo) | Taille maximale d'un fichier de registre des établissements à téléverser. Un envoi plus gros est interrompu en cours de transfert. 64 Mo représentent environ 20 fois un registre national de 13 000 lignes. Une valeur au-delà d'environ 512 Mo ne peut pas fonctionner. |

## Plugins

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `PLUGIN_UI_ENABLED` | `true` | Afficher les écrans des plugins. Avec `false`, aucun menu ni écran de plugin n'apparaît. |
| `PLUGIN_EGRESS_ENABLED` | `true` | Autoriser les plugins à accéder au réseau. Avec `false`, tout appel réseau d'un plugin est refusé, quelles que soient ses permissions. |
| `PLUGIN_DATA_MAX_DOC_BYTES` | `8388608` (8 Mo) | Taille maximale d'un document qu'un plugin peut enregistrer ou envoyer en un appel. |
| `PLUGIN_CRASH_LOG_DIR` | `.openldr/crash` | Dossier des traces de plantage des plugins. Le démarrage suivant les copie dans le journal d'audit. |

## Protection contre les boucles de plantage

Si le serveur plante `CRASH_LOOP_THRESHOLD` fois en `CRASH_LOOP_WINDOW_SEC` secondes, le
démarrage suivant écrit une entrée d'audit `system.crash_loop` et attend avant de
s'arrêter. L'attente s'allonge à chaque redémarrage, ce qui ralentit une boucle de
redémarrage au lieu de la laisser tourner.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `CRASH_LOOP_THRESHOLD` | `5` | Nombre de plantages dans la fenêtre avant que la protection s'active. |
| `CRASH_LOOP_WINDOW_SEC` | `60` | Durée de la fenêtre, en secondes. |
| `CRASH_LOOP_BACKOFF_MS` | `2000` | Première attente avant l'arrêt, en millisecondes. |
| `CRASH_LOOP_BACKOFF_CAP_MS` | `60000` | Attente la plus longue, en millisecondes. |

## Marketplace

Les deux variables de registre ne créent que le premier registre, au premier démarrage
quand il n'en existe aucun. Ensuite, gérez-les dans la vue **Registres** de
**Paramètres > Marketplace**. Voir [Marketplace](/docs/marketplace).

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `MARKETPLACE_REGISTRY_URL` | registre fourni | Registre distant créé au premier démarrage quand aucun registre n'existe. |
| `MARKETPLACE_REGISTRY_DIR` | non défini | Dossier de registre local créé au premier démarrage quand `MARKETPLACE_REGISTRY_URL` n'est pas défini. La publication y prépare aussi les paquets. |
| `MARKETPLACE_LOCAL_REGISTRY_ROOT` | vide | S'il est défini, un registre local ajouté dans les Paramètres doit être un dossier situé à l'intérieur de celui-ci. |
| `MARKETPLACE_PUBLISH_TOKEN` | non défini | Jeton GitHub avec droit d'écriture sur le dépôt de publication. Gardez-le secret. |
| `MARKETPLACE_PUBLISH_REPO` | non défini | Dépôt qui reçoit les pull requests de publication, sous la forme `owner/repo`. |
| `MARKETPLACE_PUBLISH_BRANCH` | `main` | Branche visée par les pull requests de publication. |

La publication n'est active que si `MARKETPLACE_PUBLISH_TOKEN`, `MARKETPLACE_PUBLISH_REPO`
et `MARKETPLACE_REGISTRY_DIR` sont tous définis.

## Synchronisation distribuée

Voir [Synchronisation distribuée](/docs/sync) pour inscrire un laboratoire.

| Variable | Défaut | Rôle |
| --- | --- | --- |
| `OPENLDR_SITE_ID` | non défini | Identifiant de site apposé sur les enregistrements écrits par ce serveur, utilisé quand l'identifiant de site de l'onglet **Paramètres** de la synchronisation est vide. La valeur enregistrée l'emporte. |
| `SYNC_ALLOW_INSECURE_TRANSPORT` | `false` | Autoriser la synchronisation vers un serveur central en `http://` simple. La synchronisation envoie un secret client et des données liées aux patients. Ne l'utilisez que sur un réseau local de confiance, pendant la mise en place. `localhost` fonctionne sans elle. |

## Guides associés

- [Paramètres](/docs/settings)
- [Connecteurs](/docs/connectors)
