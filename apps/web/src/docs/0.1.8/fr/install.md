# Installation

L'installateur en une ligne crée un dossier `openldr/`, génère les secrets, télécharge les images et démarre la pile. À la fin, il affiche l'URL et les identifiants administrateur générés.

## Démarrage rapide (local / auto-signé)

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex
```

La pile démarre sur `https://localhost` avec un certificat auto-signé. Votre navigateur affiche un avertissement une fois. Acceptez-le pour continuer.

## Domaine public et TLS de confiance (Let's Encrypt)

Pour servir un vrai domaine avec un certificat reconnu par les navigateurs, en une seule étape, passez votre nom d'hôte et une adresse e-mail. L'installateur démarre la pile, demande un certificat Let's Encrypt par HTTP-01 et l'installe dans la passerelle. Il met aussi en place le **renouvellement automatique** (une tâche cron qui renouvelle le certificat et recharge la passerelle).

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --server-name your.domain.com --letsencrypt you@email.com
```

Faites d'abord pointer `your.domain.com` vers l'hôte et ouvrez les ports entrants **TCP 80 et 443**. Let's Encrypt valide par le port 80. Si l'émission échoue, la pile reste active avec le certificat auto-signé. Relancez la même commande quand le DNS et les ports sont prêts.

> **Astuce :** ajoutez `--staging` la première fois pour utiliser l'autorité de certification de test de Let's Encrypt. Elle évite les limites de débit de production pendant que vous vérifiez le DNS et le pare-feu. Relancez ensuite sans `--staging` pour obtenir le vrai certificat.

> L'émission et le renouvellement automatique Let's Encrypt fonctionnent uniquement sous Linux. Sous Windows, l'installateur configure un certificat auto-signé. Placez devant votre propre proxy inverse ou votre propre certificat si vous avez besoin d'un TLS de confiance.

## Utiliser votre propre certificat

Vous avez déjà un certificat : un `fullchain.pem` et un `privkey.pem` obtenus ailleurs, un certificat générique (wildcard) ou une autorité de certification interne ? Préparez l'installation sans démarrer, déposez les fichiers, puis démarrez :

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --server-name your.domain.com --no-start
cp /path/to/fullchain.pem openldr/config/nginx/certs/fullchain.pem
cp /path/to/privkey.pem   openldr/config/nginx/certs/privkey.pem
cd openldr && docker compose up -d
```

`--server-name` définit le domaine dans le `.env` généré et dans la redirection OIDC. Sous Windows, utilisez `install.ps1 -ServerName your.domain.com -NoStart`, copiez les deux fichiers dans `openldr\config\nginx\certs\`, puis lancez `docker compose up -d`. La pile tourne déjà avec le certificat auto-signé ? Remplacez les deux fichiers et lancez `docker compose restart gateway`.

## SQL Server comme base analytique

OpenLDR conserve les données opérationnelles dans une base **PostgreSQL** interne (toujours). Il écrit les données d'analyse et de rapport, mises à plat, dans une base **externe** distincte. Cette base externe est **PostgreSQL par défaut**, ou un **Microsoft SQL Server auto-hébergé**, au choix lors de l'installation. Les tableaux de bord, les rapports, les requêtes personnalisées et le concepteur de rapports la lisent tous. Les écrans de requête prennent en charge SQL Server.

**Versions de SQL Server prises en charge :** 2017, 2019 et 2022, en auto-hébergement uniquement. 2017 est le minimum (la mise à niveau la plus proche pour les sites encore en 2014).

> **Aucune base de données dans le cloud, jamais.** Azure SQL, Managed Instance, AWS RDS et tout SQL hébergé ne sont **pas pris en charge**, pour aucune des deux bases. Les données du ministère de la Santé et des laboratoires doivent rester sur une infrastructure que l'opérateur contrôle. C'est une contrainte permanente de souveraineté des données. SQL Server 2016 et les versions antérieures ne sont pas prises en charge (fin de vie, pas de conteneur Linux officiel). Passez à 2017.

Choisissez la cible avec `--target-db` (par défaut `postgres`). Il existe deux options pour SQL Server.

### Démo / évaluation

Démarrez un conteneur SQL Server 2022 fourni, à côté de la pile. L'installateur génère son mot de passe SA et crée automatiquement la base `openldr_target`.

```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --mssql-demo
```

Sous Windows : `install.ps1 -MssqlDemo`.

> Les éditions Developer et Express de SQL Server **n'ont pas de licence pour la production**. Le conteneur fourni sert donc uniquement à l'évaluation. Il ne doit jamais servir de base à un déploiement en production.

### Production (votre propre SQL Server)

Connectez OpenLDR à votre propre SQL Server auto-hébergé. **La base cible doit déjà exister.**

```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --target-db mssql \
      --mssql-host sql.internal --mssql-user openldr --mssql-password 'YourStrongPassword1'
```

Sous Windows : `install.ps1 -TargetDb mssql -MssqlHost sql.internal -MssqlUser openldr -MssqlPassword '...'`.
Options facultatives : `--mssql-port` (par défaut `1433`), `--mssql-database` (`openldr_target`), `--mssql-encrypt` (`false`), `--mssql-trust-cert` (`true`).

> N'utilisez pas `#`, d'espaces ni de guillemets dans le mot de passe SQL Server. Ils perturbent la lecture du `.env` par Docker Compose.

Ces options correspondent à `TARGET_STORE_ADAPTER=mssql` et aux [variables d'environnement](/docs/environment) `MSSQL_*`. Vous pouvez aussi les définir directement dans `.env`.

## MySQL/MariaDB comme base analytique

OpenLDR peut aussi écrire les données d'analyse et de rapport dans une base **MySQL auto-hébergée** ou **MariaDB**, au choix lors de l'installation. Les tableaux de bord, les rapports, les requêtes personnalisées et le concepteur de rapports la lisent tous.

**Versions prises en charge :** MySQL 8.4 LTS et MariaDB 11.4 LTS, en auto-hébergement uniquement.

> **Aucune base de données dans le cloud, jamais.** Azure Database for MySQL, AWS RDS et tout MySQL/MariaDB hébergé ne sont **pas pris en charge**. Les données du ministère de la Santé et des laboratoires doivent rester sur une infrastructure que l'opérateur contrôle. C'est une contrainte permanente de souveraineté des données.

Choisissez la cible avec `--target-db` (par défaut `postgres`). Il existe deux options pour MySQL/MariaDB.

### Démo / évaluation

Démarrez un conteneur MySQL 8.4 fourni, à côté de la pile. L'installateur génère le mot de passe et crée automatiquement la base `openldr_target`.

```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --mysql-demo
```

Sous Windows : `install.ps1 -MysqlDemo`.

> Le conteneur MySQL fourni sert uniquement à l'évaluation. Il ne doit jamais servir de base à un déploiement en production.

### Production (votre propre MySQL/MariaDB)

Connectez OpenLDR à votre propre MySQL ou MariaDB auto-hébergé. **La base cible doit déjà exister.**

```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --target-db mysql \
      --mysql-host mysql.internal --mysql-user openldr --mysql-password 'YourStrongPassword1'
```

Sous Windows : `install.ps1 -TargetDb mysql -MysqlHost mysql.internal -MysqlUser openldr -MysqlPassword '...'`.
Options facultatives : `--mysql-port` (par défaut `3306`), `--mysql-database` (`openldr_target`), `--mysql-ssl` (`false`).

> N'utilisez pas `#`, d'espaces ni de guillemets dans le mot de passe MySQL/MariaDB. Ils perturbent la lecture du `.env` par Docker Compose.

Ces options correspondent à `TARGET_STORE_ADAPTER=mysql` et aux [variables d'environnement](/docs/environment) `MYSQL_*`. Vous pouvez aussi les définir directement dans `.env`.

## Options de l'installateur

| Option | Par défaut | Rôle |
| --- | --- | --- |
| `--dir <path>` | `./openldr` | Dossier où créer la pile. |
| `--version <tag>` | `latest` | Étiquette d'image à télécharger et exécuter. |
| `--server-name <host>` | `localhost` | Nom d'hôte ou domaine public de ce déploiement. |
| `--letsencrypt <email>` | aucune | Émet un certificat Let's Encrypt de confiance pour `--server-name`. |
| `--staging` | désactivé | Utilise l'autorité de certification de test de Let's Encrypt (pour les essais, évite les limites de débit). |
| `--no-start` | désactivé | Prépare et configure seulement, sans démarrer la pile. |
| `--no-pull` | désactivé | Ne télécharge pas les images (utilise celles déjà présentes). |
| `--seedless` | désactivé (avec données d'exemple) | Premier démarrage vide : sans le tableau de bord d'exemple ni les données de démonstration (installés par défaut). Windows : `-Seedless`. Nouvelle installation uniquement. |
| `--auth <mode>` | demande, sinon `local` | Connexion d'une nouvelle installation : `local` ou `keycloak`. `local` garde les comptes propres à OpenLDR et ne lance pas Keycloak. Sans l'option, l'installateur pose la question s'il a un terminal, et prend `local` sinon. Une nouvelle exécution garde le mode choisi à l'installation. Windows : `-Auth`. |
| `--target-db <db>` | `postgres` | Base analytique externe : `postgres`, `mssql` ou `mysql`. |
| `--mssql-demo` | désactivé | Ajoute un conteneur SQL Server 2022 (évaluation uniquement). Implique `--target-db mssql`. |
| `--mssql-host <host>` | aucune | Hôte de votre SQL Server (obligatoire pour `--target-db mssql` sans `--mssql-demo`). |
| `--mssql-port <n>` | `1433` | Port de votre SQL Server. |
| `--mssql-database <name>` | `openldr_target` | Nom de la base cible (doit déjà exister sur votre propre serveur). |
| `--mssql-user <user>` | aucune | Identifiant de connexion de votre SQL Server. |
| `--mssql-password <pw>` | aucune | Mot de passe de votre SQL Server (évitez `#`, les espaces et les guillemets). |
| `--mssql-encrypt <bool>` | `false` | Chiffre la connexion SQL Server. |
| `--mssql-trust-cert <bool>` | `true` | Fait confiance au certificat TLS du serveur (auto-signé, sur site). |
| `--mysql-demo` | désactivé | Ajoute un conteneur MySQL 8.4 (évaluation uniquement). Implique `--target-db mysql`. |
| `--mysql-host <host>` | aucune | Hôte de votre MySQL/MariaDB (obligatoire pour `--target-db mysql` sans `--mysql-demo`). |
| `--mysql-port <n>` | `3306` | Port de votre MySQL/MariaDB. |
| `--mysql-database <name>` | `openldr_target` | Nom de la base cible (doit déjà exister sur votre propre serveur). |
| `--mysql-user <user>` | aucune | Identifiant de connexion de votre MySQL/MariaDB. |
| `--mysql-password <pw>` | aucune | Mot de passe de votre MySQL/MariaDB (évitez `#`, les espaces et les guillemets). |
| `--mysql-ssl <bool>` | `false` | Active SSL/TLS pour la connexion MySQL/MariaDB. |

Une fois l'installation terminée, gérez la pile depuis le dossier `openldr/` :

```
docker compose ps            # status
docker compose logs -f       # follow logs
docker compose down          # stop
docker compose up -d         # start
```

L'installateur dépose aussi un script `openldr` dans le dossier d'installation, à côté de `docker-compose.yml`. Il exécute la CLI d'exploitation dans le conteneur `api` :

```
./openldr --help
```

Sous Windows, utilisez `.\openldr.ps1` à la place. Le script ne voit que les fichiers sous `./data`, un dossier créé lui aussi à côté de lui. Placez-y un fichier et nommez-le avec le préfixe `data/`, par exemple `./openldr ingest data/bundle.json`. Voir [Référence de la CLI](/docs/cli) pour la liste complète des commandes.

Voir [Variables d'environnement](/docs/environment) pour les valeurs du `.env` généré, ou [Windows Server (WSL2)](/docs/windows-server) pour déployer sur Windows Server.

## Installer depuis les sources (pour le développement)

Lancez OpenLDR depuis les sources avec le script d'amorçage développeur. Il clone le dépôt, installe les dépendances, démarre les services de support et initialise la base de données. Il indique ensuite comment lancer les serveurs de développement.

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.ps1 | iex
```

Nécessite git, Node.js 20+, pnpm (ou Corepack) et Docker. Démarrez ensuite l'application dans deux terminaux : `pnpm -C apps/server dev` et `pnpm -C apps/studio dev` (interface Studio sur http://localhost:5173).
