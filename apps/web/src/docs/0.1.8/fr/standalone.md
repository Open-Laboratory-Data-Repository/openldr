# Exécuter sans Docker

Faites tourner OpenLDR sur un seul ordinateur, sans Docker. Une seule commande démarre une base Postgres 16 fournie avec OpenLDR, puis le serveur OpenLDR. Toutes vos données restent dans un seul dossier. C'est utile pour essayer OpenLDR, ou pour un petit laboratoire équipé d'un seul ordinateur.

Seul Linux a été testé. macOS et Windows peuvent fonctionner, mais personne ne les a encore vérifiés.

Vous l'exécutez depuis une copie du code source, compilée sur votre propre ordinateur. Il n'existe pas encore d'installateur. Le lanceur est la commande `openldr-standalone`, et ses messages utilisent ce nom. Dans une copie du dépôt, cette commande n'est pas dans votre PATH. Ajoutez `pnpm` devant et lancez-la depuis la racine du dépôt, par exemple `pnpm openldr-standalone start`.

## Ce qu'il vous faut

- Git, Node.js 22.13 ou plus récent, et pnpm. Le dépôt impose pnpm 11.22.0. La page [Développement](/docs/development) explique comment les installer.
- Ni Docker ni base de données. Postgres est fourni avec les dépendances.
- Un accès réseau pour le premier `pnpm install`. Il télécharge les programmes Postgres, environ 59 Mo sous Linux.

## Le compiler

Lancez toutes les commandes de cette page depuis la racine du dépôt, là où se trouve `package.json`.

Quand une commande du lanceur se termine avec un code de sortie autre que 0, pnpm ajoute sa propre ligne. Il fait de même quand vous appuyez sur Ctrl+C. Cette ligne commence par `[ELIFECYCLE]`, par exemple `[ELIFECYCLE] Command failed.` Elle vient de pnpm. Ce n'est pas une erreur d'OpenLDR.

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

La première ligne vient de pnpm. Node avertit ensuite au sujet de WASI, une fonctionnalité utilisée par les plugins. Vous pouvez ignorer cet avertissement. Les deux lignes `[seed]` apparaissent tant qu'un démarrage ne les a pas menées à bout. En général, c'est le premier démarrage. Si le premier démarrage a été interrompu, le suivant affiche celles qui restent à faire. Elles ajoutent les jeux de valeurs FHIR standard et un connecteur vers la base d'analyse. OpenLDR démarre sans données d'exemple.

Gardez ce terminal ouvert. OpenLDR ne tourne que pendant que cette commande tourne.

### 2. Créer le premier administrateur

Ouvrez `http://localhost:3000/studio/` dans un navigateur de cet ordinateur. Studio affiche **Créer l'administrateur**. Saisissez le code de configuration affiché dans le terminal, puis choisissez un nom d'utilisateur et un mot de passe. La page [Installation](/docs/install) montre chaque écran dans la partie sur le premier administrateur.

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

Donnez à `--data-dir` un chemin complet. pnpm exécute le lanceur depuis la racine du dépôt. Un chemin court comme `mydata` désigne alors un dossier dans le dépôt, et non dans le dossier où se trouve votre terminal.

## Emplacement du dossier de données

| Ordinateur | Dossier de données par défaut |
| --- | --- |
| Linux | `~/.local/share/openldr`. Si `XDG_DATA_HOME` contient un chemin complet, `$XDG_DATA_HOME/openldr` à la place. |
| macOS, non testé | `~/Library/Application Support/OpenLDR` |
| Windows, non testé | `%LOCALAPPDATA%\OpenLDR` |

Définissez `OPENLDR_HOME` dans le shell pour utiliser un autre dossier. Donnez-lui aussi un chemin complet. `--data-dir` l'emporte sur les deux. Si vous avez démarré avec `--data-dir`, donnez le même dossier à `stop`, `status` et `cli`. Sinon, ils cherchent dans le dossier par défaut. `stop` et `status` affichent alors `OpenLDR is not running.`, et `cli` affiche `Start OpenLDR first: openldr-standalone start`.

Le dossier contient :

| Chemin | Contenu |
| --- | --- |
| `postgres/` | La base de données. |
| `blobs/` | Les fichiers stockés, comme les fichiers téléversés. |
| `logs/` | `server.log` et `postgres.log`. |
| `crash/` | Les notes écrites quand le serveur ou un plugin plante. |
| `work/` | Les fichiers temporaires, comme un téléchargement de terminologie pendant son import. |
| `standalone.json` | La clé des secrets, les deux mots de passe de la base et le port de la base. |
| `standalone.lock` | Présent tant qu'un lanceur tourne. Il indique le processus et l'adresse de ce lanceur. Il peut rester après un plantage ou un arrêt brutal. Le `start` suivant le remplace. |

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

`status` se termine avec le code 0 quand OpenLDR tourne et 3 sinon. S'il ne tourne pas, vous voyez `OpenLDR is not running.`, puis la ligne de pnpm `[ELIFECYCLE] Command failed with exit code 3.`

### 2. L'arrêter

Depuis un second terminal :

```sh
pnpm openldr-standalone stop
```

```text
Stopped.
```

Si le serveur est encore occupé au bout de 60 secondes, Postgres s'arrête quand même. `stop` affiche alors cette ligne à la place, après environ une minute :

```text
Stopped, but the server did not finish in 60 seconds. Work in flight will be retried.
```

Dans les deux cas, le code de sortie est 0. `stop` demande l'arrêt au lanceur en cours par un petit port ouvert seulement sur cet ordinateur. Il n'envoie aucun signal à un numéro de processus. Si rien ne tourne, il affiche `OpenLDR is not running.`

Vous pouvez aussi appuyer sur Ctrl+C dans le terminal où tourne `start`. Fermer cette fenêtre de terminal est aussi un arrêt normal. Dans tous les cas, le serveur s'arrête d'abord, puis Postgres. Le terminal de `start` affiche la même ligne `Stopped.`, ou la ligne des 60 secondes ci-dessus.

Pour ne pas attendre les 60 secondes, patientez un instant, puis appuyez de nouveau sur Ctrl+C. Après un Ctrl+C, le lanceur ignore les appuis suivants pendant une seconde et demie. Il le fait parce que pnpm et le shell peuvent transmettre le même signal une deuxième fois. Un troisième Ctrl+C, là encore après un instant, termine le lanceur tout de suite avec le code de sortie 1. Postgres reçoit quand même l'ordre de s'arrêter à la sortie du lanceur. Fermer le terminal ne raccourcit jamais l'attente.

### 3. Redémarrer après une coupure de courant ou un plantage

Relancez `pnpm openldr-standalone start`. Si un lanceur a été tué, `start` remplace d'abord son ancien verrou. Si ce lanceur a laissé son Postgres actif, `start` se connecte à la base pour vérifier que ce Postgres appartient bien à ce dossier. Il arrête ensuite ce Postgres et démarre normalement. Vous voyez les lignes de démarrage habituelles, rien de plus.

Nous l'avons testé en tuant le lanceur sous Linux. Une vraie coupure de courant n'a pas été testée.

### 4. Un seul lanceur par dossier

Un second `start` sur le même dossier est refusé :

```text
OpenLDR is already running (process 12345) at http://localhost:3000/studio/.
```

Pour faire tourner deux installations en même temps, donnez à chacune son propre `--data-dir` et son propre `--port`.

## Lancer des commandes CLI

La CLI `openldr` passe par le lanceur, et OpenLDR doit tourner. `cli` dirige la CLI vers l'adresse du lanceur lui-même, sauf si vous définissez `OPENLDR_URL` ou passez `--server-url`. Il ne donne les réglages de base de données qu'à une commande de récupération, comme `doctor` ci-dessous. Toute autre commande passe par le serveur en marche, donc connectez-vous d'abord :

```sh
pnpm openldr-standalone cli -- login
```

[Connexion du CLI et clés d'accès](/docs/cli-access) explique la connexion, les clés d'accès et les commandes de récupération. Une commande de récupération ne demande aucune connexion :

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

Au-dessus de ces lignes s'affichent aussi la ligne de pnpm, l'avertissement WASI de Node et une ligne de journal. Quand OpenLDR ne tourne pas, une commande de récupération comme `doctor` démarre elle-même la base de données. Elle affiche `OpenLDR is not running. Starting its database for this command.`, s'exécute, puis arrête la base de données. Vous pouvez ainsi réparer une installation qui ne démarre plus. Toute autre commande affiche `Start OpenLDR first: openldr-standalone start`.

- Le `--` est facultatif. `cli doctor` lance la même commande.
- `--data-dir` se place avant le `--`, par exemple `pnpm openldr-standalone cli --data-dir /srv/openldr -- doctor`.
- Quand un message de la CLI vous demande de lancer une commande `openldr`, passez par le lanceur. `openldr auth setup-code` devient `pnpm openldr-standalone cli -- auth setup-code`.
- `sync export` demande `--out`. Un chemin relatif part de la racine du dépôt, donc donnez à `--out` un chemin complet.

`pnpm openldr` dans une copie du dépôt n'est pas la même chose. Pour une commande de récupération, il lit le fichier `.env` du dépôt et se connecte aux bases qui y sont indiquées. Il envoie toute autre commande à `OPENLDR_URL`, par défaut `http://127.0.0.1:3000`. Utilisez plutôt `pnpm openldr-standalone cli`, pour que chaque commande atteigne cette installation. La [référence CLI](/docs/cli) liste toutes les commandes.

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
| `CLI_ENTRY` | `dist/cli.js` dans le dossier du lanceur |

`LOG_LEVEL` reste donc à `info`, et vous ne pouvez pas le changer.

Définissez tout autre réglage dans le shell avant `start`. Par exemple, cette commande bloque tous les appels réseau des plugins :

```sh
PLUGIN_EGRESS_ENABLED=false pnpm openldr-standalone start
```

Un réglage donné ainsi ne vaut que pour cette commande. Si une commande CLI en a aussi besoin, placez-le également devant cette commande `cli`. La page [Variables d'environnement](/docs/environment) les liste tous.

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

En HTTP sans chiffrement, le navigateur désactive une fonctionnalité qu'utilise Studio. Certains écrans peuvent alors échouer, notamment les pages de plugins et la modification des tableaux de bord. Cela se produit sur le téléphone, et aussi sur cet ordinateur quand vous ouvrez l'adresse donnée à `--host`. Ces écrans fonctionnent quand vous ouvrez Studio à l'adresse `http://localhost:3000/studio/` sur l'ordinateur qui exécute OpenLDR. Cette adresse répond quand vous démarrez sans `--host`, ou avec `--host localhost`, `0.0.0.0`, `::1` ou `::`.

La dernière ligne est un avertissement. Une installation autonome n'a pas de TLS. Les noms d'utilisateur, les mots de passe et les données des patients circulent en clair sur le réseau. Toute personne qui peut observer ce réseau peut les lire. Ne le faites que sur un réseau de confiance. Tailscale chiffre le trafic entre vos propres appareils. N'ouvrez jamais ce port sur Internet. Votre pare-feu devra peut-être autoriser le port.

## Sauvegarder et restaurer

Une sauvegarde est une copie du dossier de données entier, faite pendant qu'OpenLDR est arrêté. La copie d'une base en marche peut ne pas s'ouvrir.

```sh
pnpm openldr-standalone stop
cp -a ~/.local/share/openldr /media/backup/openldr-2026-11-13
```

Gardez `standalone.json` avec le reste. Sans lui, le lanceur refuse de démarrer sur cette base. Sans la clé qu'il contient, les secrets stockés dans la base ne peuvent pas être lus.

La copie contient des données de patients. Elle contient aussi le fichier d'état, `standalone.json`, avec le mot de passe administrateur de la base et la clé des secrets stockés. Gardez la copie dans un dossier que seul votre utilisateur peut ouvrir. Un disque FAT ou exFAT ne conserve pas les permissions du dossier. Toute personne qui peut lire ce disque peut lire la copie.

Pour restaurer, arrêtez OpenLDR, remettez le dossier copié à son emplacement d'origine et redémarrez. Vous pouvez aussi démarrer avec `--data-dir` pointant vers la copie.

## Limites

- Pas de TLS. OpenLDR sert du HTTP en clair.
- Pas encore d'installateur. Vous l'exécutez depuis une copie compilée du dépôt.
- Postgres seulement. Le Postgres fourni contient les deux bases. SQL Server et MySQL ne peuvent pas servir de base d'analyse.
- Un seul lanceur par dossier de données.
- Seul Linux a été testé. Windows et macOS ne sont pas testés.
- La synchronisation avec un serveur central qui utilise un certificat auto-signé n'est pas prise en charge.
- En HTTP sans chiffrement, certains écrans de Studio ont besoin d'une adresse que le navigateur considère comme locale : `localhost` ou `127.0.0.1`. Les pages de plugins et la modification des tableaux de bord en font partie. À toute autre adresse, ils peuvent échouer. `http://localhost:3000/studio/` répond quand vous démarrez sans `--host`, ou avec `--host localhost`, `0.0.0.0`, `::1` ou `::`.
- Le Postgres fourni ne peut pas passer à une nouvelle version majeure. Le dossier de données ne fonctionne qu'avec Postgres 16.
- Sauvegarder veut dire arrêter, puis copier le dossier. Il n'existe pas d'outil de sauvegarde.
- Le journal du serveur et celui de Postgres ne font l'objet d'aucune rotation. Ils grossissent jusqu'à ce que vous les supprimiez pendant qu'OpenLDR est arrêté.
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
| `The database is recovering after an unclean stop. This can take a few minutes.` | Attendez. Le démarrage reprend de lui-même quand Postgres a fini sa réparation. |
| `WORKFLOW_FILE_ACCESS_ROOT must not be the OpenLDR data folder, hold it, or sit inside it.` | Donnez à `WORKFLOW_FILE_ACCESS_ROOT` un dossier hors du dossier de données, puis redémarrez. |
| `OpenLDR stopped after an error. See <path>.` | Le lanceur s'est arrêté. Le journal du serveur en donne la raison. Relancez `start`. |
| `The database stopped by itself. OpenLDR has stopped. See <path>.` | Le lanceur s'est arrêté. Le journal de Postgres en donne la raison. Relancez `start`. |

Si la base s'arrête pendant qu'OpenLDR tourne, OpenLDR s'arrête aussi. Vous pouvez voir l'une ou l'autre des deux dernières lignes.

## Guides associés

- [Bien démarrer](/docs/getting-started)
- [Installation](/docs/install)
- [Variables d'environnement](/docs/environment)
- [Référence CLI](/docs/cli)
- [Développement](/docs/development)
