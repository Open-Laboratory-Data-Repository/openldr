# Variables d'environnement

OpenLDR lit les variables d'environnement au démarrage du serveur. Dans une installation Docker, modifiez le fichier privé `.env` près du fichier Compose, puis recréez les services concernés.

Utilisez Settings pour les valeurs disposant de commandes dans l'application. Connectors conserve les identifiants des destinations. Marketplace gère les registres après leur premier démarrage. Distributed sync conserve sa configuration dans Settings. Ces paramètres enregistrés ne nécessitent aucune modification du fichier d'environnement.

Vous devez accéder au serveur et connaître le projet Compose, le fichier d'environnement et les fichiers complémentaires exacts. Gardez les mêmes options. Les images de terminal ci-dessous illustrent des commandes à adapter. Elles ne montrent pas votre serveur et ne prouvent aucune modification du déploiement.

Conservez `SECRETS_ENCRYPTION_KEY`. La remplacer après l'enregistrement d'identifiants les rend illisibles. Excluez les mots de passe, clés de signature, certificats privés et sauvegardes des captures et du contrôle de versions.

## Identifier l'installation en cours

Vérifiez l'application avant de choisir un fichier de configuration. Un dépôt source et un déploiement Compose installé utilisent des commandes de démarrage différentes.

### 1. Ouvrir General

Ouvrez **Settings**, puis **General**.

![Ouvrez Settings, puis General.](environment-guide-general.png)

### 2. Lire About

Notez Version et Environment de l'application en cours. Cette page identifie l'application sans exposer son fichier d'environnement privé.

![About identifie la version et l'environnement de l'application en cours.](environment-guide-about.png)

### 3. Trouver son répertoire Compose

Sur le serveur, ouvrez le répertoire contenant le fichier Compose et le .env de cette installation. Le chemin illustré `~/openldr_ce` est un exemple. Utilisez votre véritable répertoire de déploiement.

![Illustration. Travaillez dans le répertoire du projet Compose installé.](environment-guide-folder.png)

**Résultat attendu :** vous connaissez le déploiement actif et les fichiers de configuration concernés.

## Changer une valeur de démarrage

Convenez de l'interruption nécessaire pour cette valeur. Utilisez un éditeur privé et conservez les identifiants existants.

### 1. Sauvegarder la configuration

Sauvegardez le .env actuel en privé avant de le modifier. Conservez-le avec la sauvegarde du déploiement et limitez son accès.

![Illustration. Sauvegardez la configuration en privé avant modification.](environment-guide-backup.png)

### 2. Modifier uniquement la valeur voulue

Changez la valeur sélectionnée. L'illustration utilise LOG_LEVEL. Ne remplacez pas votre fichier complet par cet exemple.

![Illustration. Modifiez uniquement la valeur d'environnement voulue.](environment-guide-edit.png)

### 3. Valider la configuration Compose

Exécutez `docker compose config --quiet` avec les options habituelles de projet, env-file et fichiers complémentaires. Exigez un code de sortie 0. N'affichez pas la configuration développée dans des journaux partagés.

![Illustration. Validez la configuration Compose sans afficher de secrets.](environment-guide-validate.png)

### 4. Recréer les services concernés

Utilisez `docker compose up -d` pour les services concernés. Un simple redémarrage conserve l'environnement d'un conteneur existant. Changer l'origine publique ou l'identité peut affecter plusieurs services.

![Illustration. Recréez les services concernés pour appliquer les paramètres de démarrage.](environment-guide-apply.png)

### 5. Vérifier le résultat

Vérifiez les conteneurs, la santé de l'application, les journaux et le comportement modifié. Une API saine ne prouve pas le fonctionnement des bases externes, des retours de connexion ou des destinations de fichiers.

![Illustration. Vérifiez l'état des services et la santé de l'application.](environment-guide-health.png)

**Résultat attendu :** le nouveau processus lit la valeur voulue. Conservez l'ancienne configuration jusqu'à la vérification du comportement.

## Exécution et adresse de déploiement

L'analyseur de l'application et l'installateur ont des valeurs par défaut différentes. L'analyseur utilise development pour NODE_ENV. Une installation déployée doit utiliser explicitement production. Les valeurs propres à Compose configurent la passerelle et les étiquettes d'images.

| Variable | Valeur par défaut ou source | Signification |
| --- | --- | --- |
| `NODE_ENV` | Analyseur : development | Utilisez production pour les services déployés. |
| `PORT` | 3000 | Port d'écoute interne de l'API. |
| `LOG_LEVEL` | info | Niveau des journaux du serveur. |
| `TRUST_PROXY` | Non défini | Proxys de confiance pour attribuer l'IP du client. Utilisez uniquement la chaîne de proxys réellement fiable. |
| `OPENLDR_VERSION` | Étiquette d'image du déploiement | Fixez la version approuvée pour les mises à niveau. |
| `SERVER_NAME`, `PUBLIC_ORIGIN` | Valeurs du déploiement | Nom d'hôte public et origine externe complète. |
| `GATEWAY_HTTP_PORT`, `GATEWAY_HTTPS_PORT` | 80, 443 | Ports publiés de la passerelle. |
| `TLS_MODE`, `LETSENCRYPT_EMAIL` | Valeurs de l'installateur | Mode de certificat de la passerelle et contact du certificat. |
| `MIGRATE_ON_START`, `SEED_ON_START` | Analyseur : false, false | Migrations au démarrage et chargement facultatif d'exemples. La mise à niveau utilise une étape de migration distincte. |

## Bases de données et stockage objet

La base interne utilise toujours Postgres. Choisissez le moteur d'entrepôt avec TARGET_STORE_ADAPTER. Ces variables configurent l'entrepôt lui-même. Les connexions supplémentaires de rapports et de sources se configurent dans Connectors.

| Variable | Valeur par défaut ou source | Signification |
| --- | --- | --- |
| `INTERNAL_DATABASE_URL` | Obligatoire | Base de l'application, comprenant comptes, audit et ressources canoniques. |
| `TARGET_STORE_ADAPTER` | pg | Moteur d'entrepôt : pg, mssql ou mysql. |
| `TARGET_DATABASE_URL` | Obligatoire pour pg | Connexion à l'entrepôt Postgres. |
| `MSSQL_HOST`, `MSSQL_DATABASE`, `MSSQL_USER`, `MSSQL_PASSWORD` | Obligatoires pour mssql | Connexion à l'entrepôt SQL Server. |
| `MSSQL_PORT` | 1433 | Port de l'entrepôt SQL Server. |
| `MSSQL_ENCRYPT`, `MSSQL_TRUST_SERVER_CERT` | false, true | Options de transport de l'entrepôt. Vérifiez les exigences du certificat serveur réel. |
| `MYSQL_HOST`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | Obligatoires pour mysql | Connexion à l'entrepôt MySQL ou MariaDB. |
| `MYSQL_PORT` | 3306 | Port de l'entrepôt MySQL. |
| `MYSQL_SSL`, `MYSQL_SSL_REJECT_UNAUTHORIZED` | false, false | Options TLS et de vérification des certificats de l'entrepôt. |
| `BLOB_ADAPTER` | minio | Sélecteur d'adaptateur S3. Prend aussi en charge le service Garage fourni. |
| `S3_ENDPOINT`, `S3_BUCKET` | Obligatoires | Adresse du service objet et compartiment. |
| `S3_REGION`, `S3_FORCE_PATH_STYLE` | us-east-1, true | Région S3 et adressage par chemin. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Identifiants privés | Accès au stockage objet. Garage exige son format de clé pris en charge. |
| `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN` | Générés par l'installateur | Secrets du service Garage. Conservez-les avec sa configuration. |
| `EVENTING_ADAPTER` | pg | Implémentation du stockage des événements de l'application. |

## Authentification et secrets

Consultez [Fournisseurs d'authentification](/docs/auth-providers) avant de changer d'émetteur. La base de l'application est liée à son espace d'identité. OIDC générique n'administre ni les utilisateurs Keycloak ni les clients de synchronisation.

| Variable | Valeur par défaut ou source | Signification |
| --- | --- | --- |
| `AUTH_ADAPTER` | keycloak | Connexion keycloak ou oidc générique. |
| `IDENTITY_ADMIN_ADAPTER` | Dépend de AUTH_ADAPTER | keycloak ou none. L'oidc générique exige none. |
| `OIDC_ISSUER_URL` | Obligatoire | Émetteur attendu des jetons. Conservez-le pour un espace d'identité existant. |
| `OIDC_WEB_CLIENT_ID` | openldr-web | Identifiant du client public du navigateur. |
| `OIDC_AUDIENCE` | Facultatif | Audience exigée du jeton d'accès API si configurée. |
| `OIDC_SCOPES` | openid profile email | Portées demandées par le navigateur. Doit inclure openid. |
| `OIDC_RESOURCE` | Facultatif | Indicateur de ressource du fournisseur si nécessaire. |
| `OIDC_INTERNAL_JWKS_URL` | Facultatif | Adresse explicite des clés de signature côté serveur. L'émetteur attendu ne change pas. |
| `OIDC_INTERNAL_ISSUER_URL` | Facultatif | Adresse du realm Keycloak côté serveur. OIDC générique n'en déduit pas les adresses. |
| `KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET` | Valeurs privées du déploiement | Compte de service pour administrer le fournisseur. |
| `TLS_CERT_PATH` | Facultatif | Certificat public du serveur proposé au téléchargement du certificat central. |
| `SECRETS_ENCRYPTION_KEY` | Base64, 32 octets décodés | Clé de chiffrement des identifiants enregistrés. Conservez la valeur existante. |
| `AUTH_DEV_BYPASS` | false | Contournement explicite de l'authentification en développement. Production refuse true. |
| `AUTH_DEV_USERNAME`, `AUTH_DEV_ROLES` | dev-admin, lab_admin | Acteur du contournement de développement explicitement activé. |

## Limites des workflows, plugins et importations

Activez les capacités de l'hôte uniquement pour les utilisateurs et installations qui en ont besoin. WORKFLOW_CODE_ENABLED permet d'exécuter du JavaScript avec accès à l'hôte. Ce n'est pas un environnement isolé de sécurité. Les limites SQL des tableaux de bord, les écouteurs de workflow et la publication de jeux de données ont des commandes dans Settings.

| Variable | Valeur par défaut de l'analyseur | Signification |
| --- | --- | --- |
| `WORKFLOW_CODE_ENABLED` | false | Autorise l'exécution du nœud Code avec accès à l'hôte. |
| `WORKFLOW_CODE_TIMEOUT_MS`, `WORKFLOW_CODE_MEMORY_MB` | 5000, 128 | Limites de temps et de mémoire du nœud Code. |
| `WORKFLOW_HTTP_ALLOWLIST` | Vide | Noms d'hôte autorisés pour les requêtes HTTP des workflows. |
| `WORKFLOW_FILE_MAX_BYTES` | 52428800 | Limite de fichier envoyé au workflow ou au webhook. |
| `WORKFLOW_LOOP_MAX_ITEMS` | 100000 | Nombre maximal d'éléments accumulés en sortie de boucle. |
| `WORKFLOW_FILE_ACCESS_ENABLED`, `WORKFLOW_FILE_ACCESS_ROOT` | false, vide | Accès aux fichiers de l'hôte et répertoire racine obligatoire. |
| `WORKFLOW_EMAIL_POLL_MIN_SECONDS`, `WORKFLOW_EMAIL_MAX_PER_POLL` | 30, 50 | Intervalle minimal des déclencheurs de courriel et limite de messages par interrogation. |
| `FACILITY_IMPORT_MAX_UPLOAD_BYTES` | 67108864 | Taille maximale d'envoi d'un registre d'établissements. L'augmenter exige aussi assez de mémoire pour le traitement. |
| `TERMINOLOGY_WORK_DIR` | Facultatif | Répertoire de téléchargement et d'extraction de terminologie. |
| `PLUGIN_UI_ENABLED`, `PLUGIN_EGRESS_ENABLED` | true, true | Interrupteurs généraux des pages et de l'intermédiaire des plugins, et de leur accès réseau. |
| `PLUGIN_DATA_MAX_DOC_BYTES` | 8388608 | Taille maximale d'un document de l'intermédiaire. |
| `PLUGIN_CRASH_LOG_DIR` | .openldr/crash | Répertoire persistant des marqueurs de plantage des plugins. |
| `CRASH_LOOP_THRESHOLD`, `CRASH_LOOP_WINDOW_SEC` | 5, 60 | Nombre de plantages et fenêtre de mesure. |
| `CRASH_LOOP_BACKOFF_MS`, `CRASH_LOOP_BACKOFF_CAP_MS` | 2000, 60000 | Délais initial et maximal entre reprises après plantage. |

## Configuration de Marketplace et de la synchronisation

MARKETPLACE_REGISTRY_URL ou MARKETPLACE_REGISTRY_DIR initialise le premier registre seulement si aucun n'existe. Ensuite, utilisez Marketplace, Registries. La publication exige ensemble le jeton, le dépôt et le répertoire local de préparation.

`OPENLDR_SITE_ID` fournit un identifiant de site de secours si aucun Site ID n'est enregistré. Les paramètres de synchronisation enregistrés ont priorité. `SYNC_ALLOW_INSECURE_TRANSPORT` vaut false par défaut. Utilisez HTTPS pour un central actif.

| Variable | Valeur par défaut ou source | Signification |
| --- | --- | --- |
| `MARKETPLACE_REGISTRY_URL`, `MARKETPLACE_REGISTRY_DIR` | Source initiale | Registre distant ou répertoire local de paquets utilisé au premier démarrage. |
| `MARKETPLACE_LOCAL_REGISTRY_ROOT` | Vide | Racine autorisée facultative pour les répertoires de registres locaux. |
| `MARKETPLACE_PUBLISH_TOKEN`, `MARKETPLACE_PUBLISH_REPO` | Configuration privée | Identifiants et destination de publication GitHub. |
| `MARKETPLACE_PUBLISH_BRANCH` | main | Branche cible des propositions de publication. |
| `MARKETPLACE_DEV_ALLOW_UNSIGNED` | false | Autorisation de paquets non signés limitée au développement. |

## Dépannage

**Une valeur de démarrage n'a pas changé.** Redémarrez les processus concernés après modification de leur environnement. Avec Docker, recréez les services concernés car un redémarrage conserve l'environnement du conteneur.

**Une commande CLI échoue.** Suivez [Commencer ici](/docs/start-here) pour configurer la CLI installée ou de développement.

## Guides associés

[Paramètres](/docs/settings), [Connecteurs](/docs/connectors), [Synchronisation distribuée](/docs/sync), [Fournisseurs d'authentification](/docs/auth-providers) et [Mises à niveau planifiées](/docs/upgrading).
