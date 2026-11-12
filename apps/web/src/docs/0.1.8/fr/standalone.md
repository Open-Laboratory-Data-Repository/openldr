# Exécuter sans Docker

Faites tourner OpenLDR sur un seul ordinateur, sans Docker. Une seule commande démarre une base Postgres 16 fournie avec OpenLDR, puis le serveur OpenLDR. Toutes vos données restent dans un seul dossier. C'est utile pour essayer OpenLDR, ou pour un petit laboratoire équipé d'un seul ordinateur.

Seul Linux a été testé. macOS et Windows peuvent fonctionner, mais personne ne les a encore vérifiés.

Vous l'exécutez depuis une copie du code source, compilée sur votre propre ordinateur. Il n'existe pas encore d'installateur. Les messages du lanceur l'appellent `openldr-standalone`. Dans une copie du dépôt, cette commande n'est pas dans votre PATH. Ajoutez `pnpm` devant et lancez-la depuis la racine du dépôt, par exemple `pnpm openldr-standalone start`.

## Ce qu'il vous faut

- Git, Node.js 22.13 ou plus récent, et pnpm. Le dépôt impose pnpm 11.22.0. La page [Développement](/docs/development) explique comment les installer.
- Ni Docker ni base de données. Postgres arrive avec les dépendances.
- Un accès réseau pour le premier `pnpm install`. Il télécharge les programmes Postgres, environ 59 Mo sous Linux.

## Le compiler

Lancez toutes les commandes de cette page depuis la racine du dépôt, là où se trouve `package.json`.

### 1. Récupérer le code source

```sh
git clone https://github.com/Open-Laboratory-Data-Repository/openldr.git ~/Downloads/openldr_ce
cd ~/Downloads/openldr_ce
```

### 2. Installer les dépendances

```sh
pnpm install --frozen-lockfile
```

Cette commande télécharge aussi Postgres 16.15 depuis le paquet npm `embedded-postgres`. Le dépôt fixe sa version exacte, `16.15.0-beta.19`. Chaque installation reçoit donc le même Postgres.

### 3. Compiler Studio et le lanceur

```sh
pnpm --filter @openldr/studio build
pnpm --filter @openldr/standalone build
```

Recompilez les deux après chaque récupération de nouveau code. Le démarrage suivant met alors la base à jour. Si Studio n'a pas été compilé, `start` s'arrête avec `The studio is not built. Run: pnpm --filter @openldr/studio build`.

## Démarrer OpenLDR

### 1. Le démarrer

```sh
pnpm openldr-standalone start
```

Le premier démarrage affiche ceci :

```text
$ node apps/standalone/dist/index.js start
(node:12345) ExperimentalWarning: WASI is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
[seed] created default connector "Target Warehouse (Postgres)"
[seed] imported 672 FHIR R4 value set(s) (0 already present)
No administrator exists yet. Open the address and enter this setup code: XXXX-XXXX-XXXX
The setup code is valid for 30 minutes. For a new one run: openldr-standalone cli -- auth setup-code
OpenLDR is running at http://localhost:3000/studio/
Server log: /home/you/.local/share/openldr/logs/server.log
```

La première ligne vient de pnpm. Node avertit ensuite au sujet de WASI, une fonction utilisée par les plugins. Vous pouvez ignorer cet avertissement. Les deux lignes `[seed]` n'apparaissent qu'au premier démarrage. Elles ajoutent les jeux de valeurs FHIR standard et un connecteur vers la base d'analyse. OpenLDR démarre sans données d'exemple.

Gardez ce terminal ouvert. OpenLDR ne tourne que pendant que cette commande tourne.

### 2. Créer le premier administrateur

Ouvrez `http://localhost:3000/studio/` dans un navigateur de cet ordinateur. Studio affiche **Create the administrator**. Saisissez le code de configuration affiché dans le terminal, puis choisissez un nom d'utilisateur et un mot de passe. La page [Installation](/docs/install) montre chaque écran dans la partie sur le premier administrateur.

Le code est valable 30 minutes. Chaque démarrage affiche un nouveau code tant qu'aucun administrateur n'existe. Pour obtenir un nouveau code pendant qu'OpenLDR tourne, ouvrez un second terminal dans le dépôt et lancez :

```sh
pnpm openldr-standalone cli -- auth setup-code
```

Le code de configuration ne s'affiche que dans le terminal. Le lanceur ne l'écrit jamais dans un journal.

### 3. Choisir d'autres options au besoin

| Option | Par défaut | Effet |
| --- | --- | --- |
| `--data-dir <folder>` | Voir la section suivante | Le dossier qui contient toutes les données de cette installation. |
| `--port <port>` | `3000` | Le port web. Si un autre programme l'occupe, `start` s'arrête avec `Port 3000 is already in use. Choose another with --port.` Il ne choisit jamais un autre port de lui-même. |
| `--host <address>` | `127.0.0.1` | L'adresse d'écoute d'OpenLDR. Par défaut, seul cet ordinateur y a accès. Voir **Ouvrir l'accès à un téléphone ou à un autre ordinateur** plus bas. |

Donnez à `--data-dir` un chemin complet. pnpm lance le lanceur depuis la racine du dépôt. Un chemin court comme `mydata` part donc de cette racine, et non du dossier où se trouve votre terminal.

## Emplacement du dossier de données

| Ordinateur | Dossier de données par défaut |
| --- | --- |
| Linux | `~/.local/share/openldr`. Si `XDG_DATA_HOME` contient un chemin complet, `$XDG_DATA_HOME/openldr` à la place. |
| macOS, non testé | `~/Library/Application Support/OpenLDR` |
| Windows, non testé | `%LOCALAPPDATA%\OpenLDR` |

Définissez `OPENLDR_HOME` dans le shell pour utiliser un autre dossier. `--data-dir` l'emporte sur les deux. Si vous avez démarré avec `--data-dir`, donnez le même dossier à `stop`, `status` et `cli`. Sinon, ils cherchent dans le dossier par défaut et indiquent qu'OpenLDR ne tourne pas.

Le dossier contient :

| Chemin | Contenu |
| --- | --- |
| `postgres/` | La base de données. |
| `blobs/` | Les fichiers stockés, comme les envois. |
| `logs/` | `server.log` et `postgres.log`. |
| `crash/` | Les notes écrites quand le serveur ou un plugin plante. |
| `work/` | Les fichiers temporaires, comme un téléchargement de terminologie pendant son import. |
| `standalone.json` | La clé des secrets, les deux mots de passe de la base et le port de la base. |
| `standalone.lock` | Présent tant qu'un lanceur tourne. Il indique le processus et l'adresse de ce lanceur. |

Sous Linux, seul votre utilisateur peut ouvrir le dossier. Le lanceur donne le mode 700 au dossier et le mode 600 aux deux fichiers. La base n'écoute que sur `127.0.0.1`. Son port est choisi au premier démarrage, 54320 s'il est libre, puis conservé dans `standalone.json`.

## Vérifier, arrêter et redémarrer

### 1. Vérifier qu'il tourne

```sh
pnpm openldr-standalone status
```

```text
Data folder: /home/you/.local/share/openldr
OpenLDR is running at http://localhost:3000/studio/
```

`status` se termine avec le code 0 quand OpenLDR tourne et 3 sinon. S'il ne tourne pas, vous voyez `OpenLDR is not running.`, et pnpm ajoute `[ELIFECYCLE] Command failed with exit code 3.` Cette ligne de pnpm rapporte seulement le code de sortie. Ce n'est pas une panne.

### 2. L'arrêter

Depuis un second terminal :

```sh
pnpm openldr-standalone stop
```

```text
Stopped.
```

`stop` demande l'arrêt au lanceur en cours par un petit port ouvert seulement sur cet ordinateur. Il n'envoie aucun signal à un numéro de processus. Si rien ne tourne, il affiche `OpenLDR is not running.`

Vous pouvez aussi appuyer sur Ctrl+C dans le terminal où tourne `start`. Fermer cette fenêtre de terminal a le même effet. Dans tous les cas, le serveur s'arrête d'abord, puis Postgres.

Le serveur dispose de 60 secondes pour finir le travail en cours. Ensuite, Postgres s'arrête quand même et vous voyez `Stopped, but the server did not finish in 60 seconds. Work in flight will be retried.` Un deuxième Ctrl+C saute ces 60 secondes. Un troisième termine le lanceur tout de suite. Postgres reçoit quand même l'ordre de s'arrêter à la sortie du lanceur.

### 3. Redémarrer après une coupure de courant ou un plantage

Relancez `pnpm openldr-standalone start`. Si un lanceur a été tué en laissant son Postgres actif, `start` vérifie d'abord, par une connexion à la base, que ce Postgres appartient bien à ce dossier. Il arrête ensuite ce Postgres, remplace l'ancien verrou et démarre normalement. Vous voyez les lignes de démarrage habituelles, rien de plus.

Nous l'avons testé en tuant le lanceur sous Linux. Une vraie coupure de courant n'a pas été testée.

### 4. Un seul lanceur par dossier

Un second `start` sur le même dossier est refusé :

```text
OpenLDR is already running (process 619959) at http://localhost:3000/studio/.
```

Pour faire tourner deux installations en même temps, donnez à chacune son propre `--data-dir` et son propre `--port`.

## Lancer des commandes CLI

La CLI `openldr` passe par le lanceur. OpenLDR doit tourner, car la CLI se connecte à sa base.

```sh
pnpm openldr-standalone cli -- doctor
```

```text
PASS  Services
WARN  Sign-in
      No administrator exists yet. Run "openldr auth setup-code", then open studio to create one.
PASS  Secrets key
WARN  Laboratory name
      The laboratory name is empty or still the shipped default. Reports print it as the issuing laboratory. Set it in Settings, Laboratory.
WARN  Time zone
      No time zone is set. The monthly transmission report then counts days in UTC, which moves evening arrivals to the wrong day. Set it in Settings, Laboratory.
PASS  Connectors: 1 of 1
SKIP  Sync with central
SKIP  Facilities in the data

3 warnings.
```

Au-dessus de ces lignes s'affichent aussi la ligne de pnpm, l'avertissement WASI de Node et une ligne de journal. Quand OpenLDR ne tourne pas, vous voyez `Start OpenLDR first: openldr-standalone start`.

- Le `--` est facultatif. `cli doctor` lance la même commande.
- `--data-dir` se place avant le `--`, par exemple `pnpm openldr-standalone cli --data-dir /srv/openldr -- doctor`.
- Quand un message de la CLI vous demande de lancer une commande `openldr`, passez par le lanceur. `openldr auth setup-code` devient `pnpm openldr-standalone cli -- auth setup-code`.
- Une commande qui écrit un fichier, comme `sync export`, l'écrit à la racine du dépôt si vous ne donnez pas `--out`. Donnez à `--out` un chemin complet.

`pnpm openldr` dans une copie du dépôt n'atteint pas une installation autonome. Il lit le fichier `.env` du dépôt et se connecte aux bases qui y sont indiquées. Utilisez plutôt `pnpm openldr-standalone cli`. La [référence CLI](/docs/cli) liste toutes les commandes.

## Modifier un réglage

Le lanceur ne lit aucun fichier `.env`. Il définit lui-même ces réglages, et ils l'emportent toujours sur le shell :

| Réglage | Valeur |
| --- | --- |
| `NODE_ENV` | `production` |
| `TZ` | `UTC` |
| `OPENLDR_SKIP_ENV_FILE` | `true` |
| `PORT` | La valeur de `--port` |
| `LISTEN_HOST` | La valeur de `--host` |
| `ROOT_REDIRECT_TO_STUDIO` | `true` |
| `LOG_LEVEL` | `info` |
| `LOG_FILE` | `logs/server.log` dans le dossier de données |
| `AUTH_ADAPTER` | `local` |
| `AUTH_DEV_BYPASS` | `false` |
| `BLOB_ADAPTER` | `fs` |
| `BLOB_DIR` | `blobs/` dans le dossier de données |
| `EVENTING_ADAPTER` | `pg` |
| `TARGET_STORE_ADAPTER` | `pg` |
| `INTERNAL_DATABASE_URL`, `TARGET_DATABASE_URL` | Le Postgres fourni |
| `MIGRATE_ON_START` | `true` |
| `SEED_ON_START` | `false` |
| `SECRETS_ENCRYPTION_KEY` | La clé de `standalone.json` |
| `PLUGIN_CRASH_LOG_DIR` | `crash/` dans le dossier de données |
| `TERMINOLOGY_WORK_DIR` | `work/` dans le dossier de données |
| `WEB_DIST_DIR` | La compilation de Studio dans le dépôt |
| `APP_VERSION` | La version du lanceur |

`LOG_LEVEL` reste donc à `info`, et vous ne pouvez pas le changer.

Définissez tout autre réglage dans le shell avant `start`. Par exemple, cette commande bloque tous les appels réseau des plugins :

```sh
PLUGIN_EGRESS_ENABLED=false pnpm openldr-standalone start
```

Les réglages définis ainsi s'appliquent aussi à `cli`. La page [Variables d'environnement](/docs/environment) les liste tous.

Le lanceur retire les réglages des composants qu'une installation autonome n'a pas. Il ignore `OIDC_*`, `KEYCLOAK_*`, `S3_*`, `MSSQL_*`, `MYSQL_*`, `IDENTITY_ADMIN_ADAPTER`, `AUTH_DEV_USERNAME` et `AUTH_DEV_ROLES`.

## Ouvrir l'accès à un téléphone ou à un autre ordinateur

Par défaut, seul cet ordinateur peut ouvrir OpenLDR. Pour laisser entrer un téléphone du même réseau ou de Tailscale, démarrez avec l'adresse de cet ordinateur sur ce réseau :

```sh
pnpm openldr-standalone start --host 100.64.0.10
```

```text
OpenLDR is running at http://100.64.0.10:3000/studio/
Server log: /home/you/.local/share/openldr/logs/server.log
Listening on 100.64.0.10. Sign-in travels over plain HTTP on this network.
```

Remplacez `100.64.0.10` par l'adresse privée ou Tailscale de votre ordinateur. Ouvrez l'adresse affichée sur le téléphone. `--host 0.0.0.0` écoute sur toutes les adresses de cet ordinateur. Le lanceur affiche alors `http://localhost:3000/studio/`, qui ne fonctionne que sur cet ordinateur. Sur le téléphone, utilisez plutôt l'adresse de l'ordinateur.

Lisez la dernière ligne avant de le faire. Une installation autonome n'a pas de TLS. Les noms d'utilisateur, les mots de passe et les données des patients circulent en clair sur le réseau. Toute personne qui peut observer ce réseau peut les lire. Ne le faites que sur un réseau de confiance. Tailscale chiffre le trafic entre vos propres appareils. N'ouvrez jamais ce port sur Internet. Votre pare-feu devra peut-être autoriser le port.

## Sauvegarder et restaurer

Une sauvegarde est une copie du dossier de données entier, faite pendant qu'OpenLDR est arrêté. La copie d'une base en marche peut ne pas s'ouvrir.

```sh
pnpm openldr-standalone stop
cp -a ~/.local/share/openldr /media/backup/openldr-2026-11-13
```

Gardez `standalone.json` avec le reste. Sans lui, personne ne peut ouvrir la base ni lire les secrets qu'elle contient. La copie contient des données de patients et des mots de passe. Gardez-la privée.

Pour restaurer, arrêtez OpenLDR, remettez le dossier copié à son emplacement d'origine et redémarrez. Vous pouvez aussi démarrer avec `--data-dir` pointant vers la copie.

## Limites

- Pas de TLS. OpenLDR sert du HTTP en clair.
- Pas encore d'installateur. Vous l'exécutez depuis une copie compilée du dépôt.
- Postgres seulement. Le Postgres fourni contient les deux bases. SQL Server et MySQL ne peuvent pas servir de base d'analyse.
- Un seul lanceur par dossier de données.
- Seul Linux a été testé. Windows et macOS ne sont pas testés.
- La synchronisation avec un serveur central qui utilise un certificat auto-signé ne fonctionne pas.
- Le Postgres fourni ne peut pas passer à une nouvelle version majeure. Le dossier de données ne fonctionne qu'avec Postgres 16.
- Sauvegarder veut dire arrêter, puis copier le dossier. Il n'existe pas d'outil de sauvegarde.
- Vous ne pouvez pas déplacer les données entre une installation autonome et une installation Docker.
- Il ne démarre pas avec l'ordinateur. Il ne tourne que pendant que `start` tourne dans un terminal.

## Messages qui demandent une action

| Message | Que faire |
| --- | --- |
| `Port 3000 is already in use. Choose another with --port.` | Arrêtez l'autre programme sur ce port, ou démarrez avec un autre `--port`. |
| `Port 54320 on 127.0.0.1 is in use by another program. This install's database always uses port 54320. Free that port, then start again.` | Arrêtez le programme qui a pris le port de la base. Ce port est fixe pour chaque dossier de données. |
| `A Postgres for <folder> is running as process <n> but does not accept this install's login. Stop that process, then start again.` | Un Postgres que cette installation n'a pas lancé utilise son dossier de base. Arrêtez-le, puis redémarrez. |
| `The state file <file> is missing, but a database already exists in <folder>.` | Restaurez `standalone.json` depuis votre sauvegarde. Ne supprimez pas la base pour contourner ce message. |
| `Could not confirm that OpenLDR stopped: ...` | Lancez `status`. S'il tourne encore, appuyez sur Ctrl+C dans son terminal. |

## Guides associés

- [Bien démarrer](/docs/getting-started)
- [Installation](/docs/install)
- [Variables d'environnement](/docs/environment)
- [Référence CLI](/docs/cli)
- [Développement](/docs/development)
