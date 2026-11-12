# Variables d'environnement

<!-- operator-platform -->

Effectuez la maintenance sur l'hôte OpenLDR, dans le dossier Compose installé. Les exemples utilisent `~/Downloads/openldr_ce` sous Linux/macOS et `C:\openldr_ce` dans PowerShell. Remplacez ces chemins. Le terminal affiche déjà l'invite bleue ; saisissez seulement la commande. Les extraits de configuration indiquent le fichier à modifier ; ce ne sont pas des commandes. Ces images ne prouvent pas une opération réussie. Les données de démonstration sont facultatives.

## Modifier un paramètre API

Cet exemple change le niveau des journaux. Prévoyez une interruption pour recréer l’API. Les valeurs sont lues au démarrage. Un simple redémarrage ne remplace pas l’environnement du conteneur. Ne changez pas clés, émetteur ou moteur de base dans cet exemple.

### 1. Trouver l’installation et son fichier caché

Utilisez le vrai dossier sur l’hôte, pas celui de l’appareil de lecture. Conservez toutes les surcharges Compose.

```sh
{{operator:env-folder}}
```

![Trouver l’installation et son fichier caché.](guide:operator-env-folder)

### 2. Conserver une copie privée

La copie contient aussi des secrets. Limitez les accès et ne versionnez aucun des fichiers. Ne remplacez pas une sauvegarde utile.

```sh
{{operator:env-backup}}
```

![Conserver une copie privée.](guide:operator-env-backup)

### 3. Modifier la ligne LOG_LEVEL existante

Ouvrez .env dans l’éditeur. Modifiez cette valeur sans remplacer le fichier ni dupliquer la clé. Revenez à info ensuite. Ne changez pas SECRETS_ENCRYPTION_KEY sans procédure ; les identifiants chiffrés en dépendent.

```text
{{operator:env-loglevel}}
```

![Modifier la ligne LOG_LEVEL existante.](guide:operator-env-loglevel)

### 4. Vérifier Compose sans afficher les secrets

Exigez code 0. Cela vérifie Compose, pas chaque valeur applicative. Ne partagez pas la sortie complète de docker compose config, qui peut révéler les identifiants.

```sh
{{operator:env-check}}
```

![Vérifier Compose sans afficher les secrets.](guide:operator-env-check)

### 5. Recréer le service concerné

Pour LOG_LEVEL, recréez api et lisez son journal. Les paramètres de passerelle ou Keycloak nécessitent leurs propres services. Hôte public et certificats suivent les procédures Installation ; une seule variable ne suffit pas.

```sh
{{operator:env-recreate}}
```

![Recréer le service concerné.](guide:operator-env-recreate)

### 6. Lire la valeur appliquée et la santé

Attendez debug pour cet exemple et examinez la santé réelle. Cela ne prouve pas une intégration modifiée. Revenez à info avec les mêmes étapes.

```sh
{{operator:env-verify}}
```

![Lire la valeur appliquée et la santé.](guide:operator-env-verify)

La référence décrit l’installation fournie lorsque précisé. Les valeurs du code diffèrent : MIGRATE_ON_START et SEED_ON_START absents valent false. L’installateur active les migrations et choisit les exemples selon ses options. Les définitions système essentielles restent installées sans exemples. TLS_MODE et LETSENCRYPT_EMAIL enregistrent des choix ; les modifier ne délivre pas de certificat. Suivez Installation.

## Exécution

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `NODE_ENV` | `production` | Mode d'exécution. Gardez `production` pour les déploiements. |
| `PORT` | `3000` | Port interne de l'API derrière la passerelle. |
| `LOG_LEVEL` | `info` | Niveau de détail des journaux (`debug`, `info`, `warn`, `error`). |
| `OPENLDR_VERSION` | `latest` | Étiquette d'image que la pile télécharge et exécute. |
| `TRUST_PROXY` | non définie | Nombre de proxys devant l'API auxquels faire confiance pour l'IP du client. Mettez `1` derrière la passerelle fournie, pour que les entrées d'audit montrent la vraie adresse du client. Ne la définissez que si un proxy de confiance se trouve vraiment devant l'API. Sinon, un client peut falsifier sa propre IP. |

## Adresse publique et TLS

Ces variables fixent l'URL que les utilisateurs atteignent et la façon dont la passerelle termine HTTPS. `SERVER_NAME` est le nom d'hôte public. `PUBLIC_ORIGIN` est l'origine complète utilisée pour les liens et les redirections OIDC. L'[installateur](/docs/install) les définit à partir de `--server-name` et `--letsencrypt`.

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `SERVER_NAME` | `localhost` | Nom d'hôte ou domaine public de ce déploiement. |
| `PUBLIC_ORIGIN` | `https://localhost` | Origine externe complète (`https://your.domain`). |
| `GATEWAY_HTTP_PORT` | `80` | Port de l'hôte sur lequel la passerelle sert HTTP. |
| `GATEWAY_HTTPS_PORT` | `443` | Port de l'hôte sur lequel la passerelle sert HTTPS. |
| `TLS_MODE` | `self-signed` | `self-signed` ou un certificat de confiance (Let's Encrypt). |
| `LETSENCRYPT_EMAIL` | non définie | Adresse e-mail de contact utilisée pour émettre un certificat de confiance. |

## Base de données

OpenLDR utilise toujours une base applicative Postgres interne. L'**entrepôt cible (analytique)** peut être Postgres (par défaut), SQL Server ou MySQL/MariaDB, au choix avec `TARGET_STORE_ADAPTER` (voir [Adaptateurs](#adaptateurs)). `TARGET_DATABASE_URL` s'applique à la cible Postgres. SQL Server et MySQL utilisent leurs propres variables `MSSQL_*` et `MYSQL_*`, plus bas.

| Variable | Rôle |
| --- | --- |
| `INTERNAL_DATABASE_URL` | Base applicative (utilisateurs, formulaires, flux de travail, audit). Toujours Postgres. |
| `TARGET_DATABASE_URL` | Entrepôt analytique dans lequel écrivent les pipelines, quand `TARGET_STORE_ADAPTER=pg`. |
| `POSTGRES_PASSWORD` | Mot de passe du conteneur Postgres fourni. |

## Adaptateurs

Les adaptateurs choisissent l'implémentation de chaque sous-système. Les valeurs par défaut correspondent aux conteneurs fournis. Ne les changez que pour utiliser une infrastructure externe.

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `AUTH_ADAPTER` | `keycloak` | Mode de connexion : `local`, `keycloak` ou `oidc`. Voir [Fournisseurs d'authentification](/docs/auth-providers). |
| `BLOB_ADAPTER` | `minio` | Stockage d'objets pour les fichiers envoyés et les artefacts. `minio` choisit l'adaptateur S3, qui fonctionne aussi avec Garage. `fs` range les fichiers dans un dossier de cette machine, indiqué par `BLOB_DIR`. |
| `BLOB_DIR` | non défini | Dossier qui contient les fichiers stockés. Obligatoire quand `BLOB_ADAPTER` vaut `fs`. |
| `EVENTING_ADAPTER` | `pg` | Magasin d'événements utilisé par les déclencheurs de flux de travail. |
| `TARGET_STORE_ADAPTER` | `pg` | Moteur de l'entrepôt analytique : `pg`, `mssql` ou `mysql`. |

## Stockage d'objets (S3)

Le service `storage` fourni exécute Garage, un serveur compatible S3. Pour utiliser un autre point de terminaison S3, faites pointer ces variables vers lui.

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://storage:3900` | URL du point de terminaison S3. |
| `S3_REGION` | `us-east-1` | Région S3. |
| `S3_ACCESS_KEY_ID` | générée | Clé d'accès. |
| `S3_SECRET_ACCESS_KEY` | générée | Clé secrète. |
| `S3_BUCKET` | `openldr` | Compartiment qui contient les fichiers envoyés et les artefacts. |
| `S3_FORCE_PATH_STYLE` | `true` | Adressage par chemin (exigé par le stockage fourni). |
| `GARAGE_RPC_SECRET` | généré | Secret interne de Garage, 64 caractères hexadécimaux. |
| `GARAGE_ADMIN_TOKEN` | généré | Jeton de l'API d'administration de Garage, 64 caractères hexadécimaux. |

Garage n'accepte qu'un identifiant de clé d'accès formé de `GK` suivi de 24 caractères hexadécimaux, et un secret hexadécimal de 64 caractères. L'installateur génère les deux.

## Authentification (Keycloak / OIDC)

Keycloak est le choix par défaut. L'OIDC générique utilise la découverte et des jetons d'accès JWT. Voir [Fournisseurs d'authentification](/docs/auth-providers) pour la configuration, les limites d'administration et la protection de l'émetteur.

| Variable | Rôle |
| --- | --- |
| `IDENTITY_ADMIN_ADAPTER` | `keycloak`, `local` ou `none`. Vaut `keycloak` par défaut avec l'authentification Keycloak, `local` avec la connexion locale, et `none` avec l'OIDC générique. |
| `OIDC_ISSUER_URL` | URL publique de l'émetteur. Obligatoire pour `keycloak` et `oidc`, inutilisée par `local`. Gardez la valeur existante lors d'une mise à niveau. Un changement ultérieur bloque le démarrage. |
| `OIDC_INTERNAL_ISSUER_URL` | URL de base interne du realm, pour Keycloak uniquement. L'OIDC générique ignore cette valeur. |
| `OIDC_INTERNAL_JWKS_URL` | Remplacement explicite du point de terminaison interne des clés de signature. Ne change pas l'émetteur attendu. |
| `TLS_CERT_PATH` | Chemin du certificat TLS public de ce serveur (PEM). Quand elle est définie, la page Sites peut proposer le certificat au téléchargement, pour qu'un laboratoire distant fasse confiance à un serveur central auto-signé. L'installateur monte le certificat et définit cette variable automatiquement. |
| `OIDC_AUDIENCE` | Audience attendue du jeton. |
| `OIDC_WEB_CLIENT_ID` | ID du client public avec lequel l'application studio s'authentifie. |
| `OIDC_SCOPES` | Portées demandées par l'application studio. Vaut `openid profile email` par défaut. Doit inclure `openid`. |
| `OIDC_RESOURCE` | URL de ressource à demander, pour les fournisseurs qui en ont besoin pour émettre le jeton d'accès à l'API. |
| `KC_HOSTNAME` | URL de base publique annoncée par Keycloak. |
| `KEYCLOAK_ADMIN` | Nom d'utilisateur de l'administrateur Keycloak. |
| `KEYCLOAK_ADMIN_PASSWORD` | Mot de passe de l'administrateur Keycloak (généré). |
| `KEYCLOAK_ADMIN_CLIENT_ID` | ID du client utilisé pour les appels à l'API d'administration. |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Secret du client pour les appels à l'API d'administration. |

## Réglages réservés au développement

Ces variables existent pour que le développement local et les tests de bout en bout puissent tourner sans Keycloak configuré ni paquets signés. Ne les définissez jamais dans un déploiement.

`AUTH_DEV_BYPASS` **désactive l'authentification**. Toute requête API sans jeton bearer est servie comme venant d'un administrateur de développement. Elle est **désactivée tant que vous ne la définissez pas explicitement**, et le serveur refuse de démarrer si elle est activée avec `NODE_ENV=production`. Quand elle est activée, Studio affiche un bandeau « Contournement d'authentification actif » et le serveur écrit un avertissement dans les journaux au démarrage.

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `AUTH_DEV_BYPASS` | `false` | Sert les requêtes API non authentifiées comme venant d'un administrateur de développement. |
| `AUTH_DEV_USERNAME` | `dev-admin` | Nom d'utilisateur de l'acteur de développement injecté. |
| `AUTH_DEV_ROLES` | `lab_admin` | Rôles accordés à l'acteur de développement injecté. |
| `MARKETPLACE_DEV_ALLOW_UNSIGNED` | `false` | Installe les paquets de la marketplace qui ne portent aucune signature. |

## Secrets

| Variable | Rôle |
| --- | --- |
| `SECRETS_ENCRYPTION_KEY` | Clé de 32 octets en Base64 qui chiffre les identifiants des connecteurs au repos. Générez-la avec `openssl rand -base64 32`. |

## Comportement au premier démarrage

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `MIGRATE_ON_START` | `true` | Exécute les migrations de base de données au démarrage de l'API. |
| `SEED_ON_START` | `true` | Charge les formulaires, les flux de travail et la terminologie par défaut au premier démarrage. |

## Importations de terminologie

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `TERMINOLOGY_WORK_DIR` | dossier temporaire du système | Dossier où une version de terminologie envoyée est décompressée pendant l'importation. Une version complète de SNOMED CT demande assez de place pour le zip et les fichiers décompressés en même temps. Faites pointer cette variable vers un disque plus grand quand le dossier temporaire du conteneur est petit. |

## Stockage cible SQL Server

À définir seulement quand `TARGET_STORE_ADAPTER=mssql`. Sur une pile déployée, l'[installateur](/docs/install) renseigne ces variables à partir de ses options `--mssql-demo` et `--mssql-*`. Le profil Compose `--profile mssql` seul n'existe que dans le fichier Compose de développement.

| Variable | Rôle |
| --- | --- |
| `MSSQL_HOST` | Hôte SQL Server. |
| `MSSQL_PORT` | Port SQL Server (par défaut `1433`). |
| `MSSQL_DATABASE` | Nom de la base cible. |
| `MSSQL_USER` | Identifiant de connexion. |
| `MSSQL_PASSWORD` | Mot de passe. |
| `MSSQL_ENCRYPT` | `true`/`false` : chiffrer la connexion. |
| `MSSQL_TRUST_SERVER_CERT` | `true`/`false` : faire confiance à un certificat de serveur auto-signé. |

## Stockage cible MySQL / MariaDB

À définir seulement quand `TARGET_STORE_ADAPTER=mysql`. Fonctionne avec MySQL 8.4+ et MariaDB 11.4+. Sur une pile déployée, l'[installateur](/docs/install) renseigne ces variables à partir de ses options `--mysql-demo` et `--mysql-*`.

| Variable | Rôle |
| --- | --- |
| `MYSQL_HOST` | Hôte MySQL/MariaDB. |
| `MYSQL_PORT` | Port du serveur (par défaut `3306`). |
| `MYSQL_DATABASE` | Nom de la base cible. |
| `MYSQL_USER` | Identifiant de connexion. |
| `MYSQL_PASSWORD` | Mot de passe. |
| `MYSQL_SSL` | `true`/`false` : se connecter en TLS. |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | `true`/`false` : refuser un certificat de serveur qui n'est pas de confiance. |

## Flux de travail

> `WORKFLOW_CODE_ENABLED` permet aux auteurs de flux de travail d'exécuter du JavaScript avec les mêmes accès que le serveur lui-même : ses fichiers, son réseau, son environnement et ses secrets. L'exécuteur de code n'est pas un bac à sable. Ne l'activez que si vous faites confiance à toutes les personnes qui peuvent modifier les flux de travail.

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `WORKFLOW_CODE_ENABLED` | `false` | Autorise l'exécution des nœuds Code. Si elle est désactivée, les nœuds Code refusent de s'exécuter. |
| `WORKFLOW_CODE_TIMEOUT_MS` | `5000` | Durée maximale d'une exécution de nœud Code, en millisecondes. |
| `WORKFLOW_CODE_MEMORY_MB` | `128` | Mémoire maximale d'une exécution de nœud Code, en Mo. |
| `WORKFLOW_HTTP_ALLOWLIST` | vide | Noms d'hôte, séparés par des virgules, que le nœud HTTP Request peut appeler. Vide signifie que tous les hôtes sont refusés. |
| `WORKFLOW_FILE_MAX_BYTES` | `52428800` (50 Mo) | Plus gros fichier accepté pour un envoi lors d'une exécution de flux, ou pour le corps d'un webhook. |
| `WORKFLOW_LOOP_MAX_ITEMS` | `100000` | Nombre maximal d'éléments qu'un seul nœud de boucle peut collecter. |
| `WORKFLOW_FILE_ACCESS_ENABLED` | `false` | Autorise le nœud Read/Write File à toucher des fichiers sur le serveur. |
| `WORKFLOW_FILE_ACCESS_ROOT` | vide | Le seul dossier auquel le nœud Read/Write File est limité. Le nœud échoue tant que cette valeur est vide. |
| `WORKFLOW_EMAIL_POLL_MIN_SECONDS` | `30` | Intervalle d'interrogation le plus court qu'un déclencheur e-mail peut utiliser, en secondes. |
| `WORKFLOW_EMAIL_MAX_PER_POLL` | `50` | Nombre maximal de messages non lus qu'un déclencheur e-mail traite par interrogation. |

## Importation du registre des établissements

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `FACILITY_IMPORT_MAX_UPLOAD_BYTES` | `67108864` (64 Mo) | Plus gros fichier de registre d'établissements que vous pouvez envoyer. Un envoi plus gros est arrêté en cours de transfert. 64 Mo représentent environ 20 fois un registre national de 13 000 lignes. Les valeurs au-delà d'environ 512 Mo ne peuvent pas fonctionner. |

## Plugins

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `PLUGIN_UI_ENABLED` | `true` | Affiche les écrans des plugins. Avec `false`, aucun élément de menu ni écran de plugin n'apparaît. |
| `PLUGIN_EGRESS_ENABLED` | `true` | Autorise les plugins à accéder au réseau. Avec `false`, tout appel réseau d'un plugin est refusé, quels que soient les droits accordés au plugin. |
| `PLUGIN_DATA_MAX_DOC_BYTES` | `8388608` (8 Mo) | Plus gros document qu'un plugin peut enregistrer ou envoyer en un appel. |
| `PLUGIN_CRASH_LOG_DIR` | `.openldr/crash` | Dossier des rapports de plantage des plugins. Le démarrage suivant les copie dans le journal d'audit. |

## Protection contre les boucles de plantage

Si le serveur plante `CRASH_LOOP_THRESHOLD` fois en `CRASH_LOOP_WINDOW_SEC`, le démarrage suivant écrit une entrée d'audit `system.crash_loop` et attend avant de quitter. L'attente s'allonge à chaque redémarrage. Cela ralentit une boucle de redémarrage au lieu de la laisser tourner à vide.

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `CRASH_LOOP_THRESHOLD` | `5` | Nombre de plantages dans la fenêtre avant que la protection s'active. |
| `CRASH_LOOP_WINDOW_SEC` | `60` | Durée de la fenêtre, en secondes. |
| `CRASH_LOOP_BACKOFF_MS` | `2000` | Première attente avant de quitter, en millisecondes. |
| `CRASH_LOOP_BACKOFF_CAP_MS` | `60000` | Attente la plus longue, en millisecondes. |

## Marketplace

Les deux variables de registre ne créent que le premier registre, au premier démarrage, s'il n'en existe aucun. Ensuite, gérez les registres dans la vue **Registres** de **Paramètres > Marketplace**.

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `MARKETPLACE_REGISTRY_URL` | registre fourni | Registre distant créé au premier démarrage quand aucun registre n'existe. |
| `MARKETPLACE_REGISTRY_DIR` | non définie | Dossier de registre local créé au premier démarrage quand `MARKETPLACE_REGISTRY_URL` n'est pas définie. La publication y prépare aussi les paquets. |
| `MARKETPLACE_LOCAL_REGISTRY_ROOT` | vide | Si elle est définie, un registre local ajouté dans les Paramètres doit être un dossier situé dans celui-ci. |
| `MARKETPLACE_PUBLISH_TOKEN` | non définie | Jeton GitHub avec accès en écriture au dépôt de publication. Gardez-le secret. |
| `MARKETPLACE_PUBLISH_REPO` | non définie | Dépôt qui reçoit les pull requests de publication, au format `owner/repo`. |
| `MARKETPLACE_PUBLISH_BRANCH` | `main` | Branche visée par les pull requests de publication. |

La publication n'est active que si `MARKETPLACE_PUBLISH_TOKEN`, `MARKETPLACE_PUBLISH_REPO` et `MARKETPLACE_REGISTRY_DIR` sont toutes définies.

## Synchronisation distribuée

| Variable | Par défaut | Rôle |
| --- | --- | --- |
| `OPENLDR_SITE_ID` | non définie | ID de site apposé sur les enregistrements écrits par ce serveur. Il sert quand l'Identifiant du site de l'onglet **Paramètres** de la synchronisation est vide. Le réglage enregistré l'emporte. |
| `SYNC_ALLOW_INSECURE_TRANSPORT` | `false` | Autorise la synchronisation vers un serveur central en `http://` simple. La synchronisation envoie un secret client et des données liées aux patients. N'utilisez donc cette option que sur un réseau local de confiance, pendant la mise en place. `localhost` fonctionne sans elle. |

## Arrêt du serveur

Sur SIGTERM ou SIGINT, l'API cesse d'accepter des requêtes et arrête l'interrogation de la file.
Elle attend les requêtes actives, le lot de file réclamé et le cycle de projection actif avant de fermer leurs bases de données.
Les signaux répétés ne lancent pas un autre arrêt.
Un gestionnaire qui ne rend jamais la main peut faire attendre l'arrêt indéfiniment.
Laissez assez de temps aux importations actives avant que le gestionnaire de services force l'arrêt.
L'arrêt du worker permet encore des vidages manuels ultérieurs. La fermeture du contexte met fin à cet accès.
