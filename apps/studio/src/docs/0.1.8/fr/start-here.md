# Commencer ici

OpenLDR Studio est l'application web pour les dossiers de votre laboratoire. Utilisez les tableaux de bord, les rapports et les formulaires.

Ouvrez d'abord Studio. Si un guide vous demande d'exécuter une commande, suivez les instructions ci-dessous. Aucune donnée d'exemple n'est nécessaire.

La configuration des établissements, du catalogue de tests et des paramètres des patients est facultative. OpenLDR peut recevoir et traiter les données avant leur configuration. Nous recommandons fortement de les configurer au cours de l'utilisation du système. Commencez par consulter [Terminologie](/docs/terminology), puis suivez **Configurer votre système** dans le menu de la documentation.

## Ouvrir Studio

Ouvrez l'adresse Studio de votre installation dans votre navigateur, puis connectez-vous avec votre compte.

Vous pouvez ouvrir Studio depuis un autre ordinateur ou un téléphone. Connectez-vous d'abord à Tailscale ou au VPN si votre organisation l'exige.

Vous pouvez ensuite [consulter le guide des tableaux de bord](/docs/dashboard), ou découvrir la ligne de commande ci-dessous.

## Utiliser la ligne de commande

L'interface en ligne de commande, ou CLI, exécute des tâches OpenLDR à partir de commandes saisies dans un terminal.

Utilisez-la pour importer des fichiers et entretenir votre installation. Si vous utilisez le code source, passez aux [instructions de développement](#exemple-1-utiliser-la-cli-dans-un-environnement-de-developpement).

Vous allez ouvrir un terminal et demander de l'aide à OpenLDR. Ces commandes d'aide ne modifient aucun dossier.

### Avant de commencer

Utilisez l'ordinateur hébergeant OpenLDR et son véritable dossier d'installation. Ce dossier contient `docker-compose.yml` et le fichier de commande OpenLDR. Docker et OpenLDR doivent être démarrés. Votre compte doit pouvoir utiliser Docker.

Si vous travaillez à distance, connectez-vous à cet ordinateur avant d'exécuter les commandes.

### Se connecter à un serveur distant

Tailscale permet d'ouvrir Studio dans le navigateur. Pour les commandes, utilisez votre accès SSH ou votre terminal distant habituel.

SSH ouvre un terminal sécurisé sur un autre ordinateur. Utilisez l'adresse, le compte et le mode de connexion que vous avez configurés. Par exemple :

```sh
ssh username@server-address
```

Remplacez `username` et `server-address` par vos informations. Suivez ensuite les instructions du système du serveur.

<!-- cli-platform -->

Si vous avez téléchargé et installé OpenLDR dans `~/Downloads/openldr_ce`, les commandes suivantes utilisent cet emplacement.

Remplacez ce chemin d'exemple par votre véritable dossier dans tout le guide.

<!-- cli:linux -->Le symbole ~ désigne votre dossier personnel. Le dossier openldr_ce de cet exemple se trouve dans Downloads.<!-- /cli -->
<!-- cli:mac -->Le symbole ~ désigne votre dossier personnel. Le dossier openldr_ce de cet exemple se trouve dans Downloads.<!-- /cli -->
<!-- cli:windows -->C:\openldr_ce désigne le dossier openldr_ce à la racine du disque C:.<!-- /cli -->

Ces illustrations partagent le même style de fenêtre. Les commandes et les chemins suivent le système choisi. Sélectionnez une image pour l'agrandir.

### 1. Ouvrir un terminal

<!-- cli:linux -->Appuyez sur Super, souvent la touche portant le logo Windows. Recherchez Terminal dans les applications, puis ouvrez-le.<!-- /cli -->
<!-- cli:mac -->Appuyez sur Commande et Espace pour ouvrir Spotlight. Saisissez Terminal, puis appuyez sur Retour.<!-- /cli -->
<!-- cli:windows -->Appuyez sur la touche Windows. Recherchez PowerShell, sélectionnez Windows PowerShell, puis Ouvrir.<!-- /cli -->

La ligne terminée par <!-- cli:linux -->`$`<!-- /cli --><!-- cli:mac -->`%`<!-- /cli --><!-- cli:windows -->`>`<!-- /cli --> est l'invite. Le trait vertical est le curseur. Saisissez votre commande après l'invite, sans recopier celle-ci.

![Illustration d'un terminal ouvert, avec son invite et son curseur.](start-terminal-linux-ready.png)

Votre nom et celui de l'ordinateur peuvent différer. Utilisez Retour arrière pour corriger une faute avant d'appuyer sur Entrée.

### 2. Aller dans le dossier d'installation

Ouvrir un terminal ne vous place pas automatiquement dans le dossier OpenLDR. Cet exemple utilise `~/Downloads/openldr_ce`.

![Illustration du dossier d'installation et de ses fichiers.](start-terminal-linux-folder.png)

Le véritable dossier doit contenir les fichiers créés par votre installation.

La commande `cd` change de dossier. Saisissez la commande suivante et appuyez sur Entrée. Adaptez le chemin à votre installation.

```sh
cd ~/Downloads/openldr_ce
```

![Illustration de la commande cd avant son exécution.](start-terminal-linux-cd.png)

Laissez une espace après `cd`. Le reste est le chemin du dossier.

Une nouvelle invite apparaît généralement sans message de réussite. Si une erreur apparaît, vérifiez le chemin avant de continuer.

![Illustration de l'invite après le changement de dossier.](start-terminal-linux-changed.png)

Vérifiez maintenant les fichiers du dossier.

### 3. Vérifier le dossier

Saisissez cette commande et appuyez sur Entrée :

```sh
ls
```

![Illustration de la liste des fichiers nécessaires à l'installation.](start-terminal-linux-files.png)

Vérifiez la présence de `docker-compose.yml`, du dossier `data` et de `openldr`. Votre dossier peut contenir d'autres fichiers. Si ces éléments manquent, retrouvez le dossier créé par l'installateur.

### 4. Demander de l'aide à OpenLDR

Restez dans le dossier vérifié à l'étape 3. Exécutez votre première commande OpenLDR :

```sh
./openldr --help
```

Appuyez sur Entrée. Conservez l'espace avant `--help` et les deux traits d'union.

![Illustration de la commande d'aide, prête à être exécutée.](start-terminal-linux-help.png)

**Résultat attendu :** le terminal affiche l'utilisation, les options et les commandes disponibles.

![Illustration d'un extrait de l'aide OpenLDR.](start-terminal-linux-help-result.png)

Faites défiler le terminal pour lire toute l'aide. Quand l'invite revient, vous pouvez saisir une autre commande.

### 5. Consulter l'aide d'une commande

La commande `ingest` importe un fichier. Ajoutez `--help` pour lire ses instructions sans rien importer.

```sh
./openldr ingest --help
```

Saisissez la commande et appuyez sur Entrée.

![Illustration de la commande ingest --help.](start-terminal-linux-ingest.png)

**Résultat attendu :** la ligne d'utilisation indique `ingest`. Les options suivantes concernent cette commande.

![Illustration de l'aide de la commande ingest.](start-terminal-linux-ingest-result.png)

`<file>` désigne un chemin obligatoire. `[options]` désigne des paramètres facultatifs. Ne saisissez pas ces crochets. Aucun fichier n'a été importé pendant ces étapes.

Pour ouvrir un terminal : [Ubuntu](https://ubuntu.com/desktop/docs/en/26.04/tutorial/the-linux-command-line-for-beginners/), [Spotlight sur macOS](https://support.apple.com/guide/mac-help/mchlp1008/mac), [Windows PowerShell](https://learn.microsoft.com/en-us/powershell/scripting/windows-powershell/starting-windows-powershell).

## Exemple 1 : utiliser la CLI dans un environnement de développement

Ces étapes concernent une copie du code source. Vous utiliserez `pnpm` pour demander de l'aide, vérifier un fichier et l'importer lorsque vous le souhaitez.

Les dépendances et le fichier `.env` doivent déjà être configurés. Les commandes ont été vérifiées avec Node.js 24 et pnpm 11.22.0, la version indiquée par le dépôt.

La CLI de développement utilise les bases de données et le stockage configurés dans `.env`. Les serveurs de développement Studio et API n'ont pas besoin d'être démarrés.

Le choix du système ci-dessus modifie aussi les chemins et les illustrations de cette section.

### 1. Ouvrir le dossier du code source

L'exemple utilise `~/Downloads/openldr_ce`. Remplacez-le par le dossier où vous avez cloné le dépôt.

```sh
cd ~/Downloads/openldr_ce
```

Ce dossier contient `package.json`, `pnpm-workspace.yaml`, `apps` et `packages`. Exécutez les commandes suivantes depuis cette racine du dépôt.

![Illustration du terminal dans le dossier du code source.](start-terminal-linux-dev-root.png)

### 2. Exécuter la CLI de développement

Exécutez les commandes l'une après l'autre :

```sh
pnpm openldr --help
pnpm openldr ingest --help
```

![Illustration de l'aide de la CLI de développement.](start-terminal-linux-dev-help.png)

Ces commandes affichent l'aide sans importer de données. Le préfixe `pnpm openldr` exécute `packages/cli/dev.mjs` depuis ce dépôt. Conservez ce préfixe pendant le développement.

### 3. Vérifier un fichier local

La CLI de développement lit les chemins locaux ordinaires. Le dossier partagé `data` de Docker n'est pas obligatoire.

Si votre fichier JSON FHIR se trouve dans `~/Downloads/openldr_ce/files/my-file.json`, vérifiez-le depuis la racine du dépôt :

```sh
pnpm openldr fhir validate files/my-file.json
```

![Illustration de la validation d'un fichier local en développement.](start-terminal-linux-dev-file.png)

Le fichier testé était valide. Votre résultat dépend du contenu de votre fichier. Cette validation n'importe rien.

### 4. Importer dans la base de développement

Exécutez cette étape lorsque vous voulez importer le fichier. Vérifiez que `.env` désigne vos bases et votre stockage de développement. Ces services doivent être démarrés. L'API doit aussi tourner, car `ingest` et `pipeline status` passent par elle. Avec `AUTH_DEV_BYPASS=true`, elle connecte ces commandes.

```sh
pnpm openldr ingest files/my-file.json
pnpm openldr pipeline status
```

![Illustration d'un import et du statut du lot en développement.](start-terminal-linux-dev-import.png)

Le fichier testé a créé un lot terminé contenant une ressource. Votre identifiant de lot et votre nombre de ressources différeront. Pour les autres commandes, conservez `pnpm openldr` et utilisez les chemins de votre ordinateur.

## Utiliser les chemins dans une installation

Cet exemple explique le chemin du fichier. Remplacez le nom par celui de votre fichier réel :

```sh
./openldr ingest data/my-file.json
```

- `openldr` lance la CLI installée.
- `ingest` importe le fichier.
- `data/my-file.json` désigne le fichier à importer.

Placez-le dans le dossier d'installation utilisé précédemment :

```text
~/Downloads/openldr_ce/
  docker-compose.yml
  openldr
  data/
    my-file.json
```

Exécutez la commande depuis `~/Downloads/openldr_ce`. Gardez le préfixe `data/`, car le chemin est relatif à ce dossier.

La CLI installée s'exécute dans le conteneur API. Le dossier `data` est partagé avec ce conteneur. Sur un serveur distant, placez le fichier dans le dossier de ce serveur. Un fichier enregistré sur votre portable n'y est pas automatiquement copié.

La plupart des commandes, dont `ingest`, passent par le serveur OpenLDR en marche. Connectez-vous d'abord avec `./openldr login`, ou définissez une clé d'accès dans `OPENLDR_KEY`. Lisez [Utilisateurs](/docs/users) pour créer une clé d'accès.

Utilisez également `data/` pour les fichiers de sortie. Mettez les chemins contenant des espaces entre guillemets, comme `"data/my file.json"`. Chaque guide explique le format attendu. Exécuter un import écrit des dossiers.

## Dépannage

Commencez dans votre véritable dossier d'installation. Les erreurs et les corrections suivantes ont été reproduites sous Linux. Les images illustrent ces essais. Les messages peuvent différer sous Windows et macOS.

### Le lanceur ou la configuration Compose est introuvable

Vous pouvez voir `./openldr: not found` ou `no configuration file provided: not found`.

La première erreur indique que le lanceur manque dans le dossier courant. La seconde s'est produite en lançant la commande depuis un autre dossier, où Compose ne trouvait pas la configuration.

Revenez dans votre dossier d'installation. Dans cet exemple :

```sh
cd ~/Downloads/openldr_ce
./openldr --help
```

L'aide confirme que le lanceur s'est exécuté. Si le problème persiste, listez les fichiers comme à l'étape 3 et cherchez `openldr` et `docker-compose.yml`.

![Transcription illustrée du retour au bon dossier et de l'aide obtenue.](start-proof-wrong-folder.png)

### Docker utilise une adresse de connexion inaccessible

L'essai a renvoyé `failed to connect to the docker API`. La variable `DOCKER_HOST` désignait un socket inexistant. OpenLDR n'avait pas encore démarré.

Exécutez `docker info` et lisez l'adresse indiquée dans l'erreur. Si vous avez défini `DOCKER_HOST` et que sa valeur est incorrecte, retirez cette valeur du terminal courant :

```sh
unset DOCKER_HOST
```

Cela retire uniquement cette valeur forcée. Cela ne démarre pas Docker. Utilisez cette correction seulement si cette variable cause le problème.

```sh
docker info
./openldr --help
```

![Transcription illustrée de l'adresse Docker incorrecte et de sa correction.](start-proof-docker.png)

L'essai a réussi après le retrait de l'adresse incorrecte. Si `docker info` échoue encore, lisez son erreur avant de réessayer OpenLDR.

### Docker indique que le service api est arrêté

L'erreur testée était `service "api" is not running`. Docker était accessible, mais le conteneur API était arrêté. La CLI installée s'exécute dans ce conteneur.

Depuis le dossier d'installation, vérifiez le conteneur et redémarrez-le :

```sh
docker compose ps -a api
docker compose up -d api
```

Réessayez ensuite :

```sh
./openldr --help
```

![Transcription illustrée du redémarrage du conteneur API et de l'aide obtenue.](start-proof-api.png)

L'essai a retrouvé l'aide après le démarrage du conteneur. Il n'a pas vérifié le démarrage HTTP complet de l'application.

### L'import indique ENOENT pour mon fichier

L'erreur testée était `ingest failed: ENOENT: no such file or directory, open 'my-file.json'`. Ce test date d'avant le passage des commandes par le serveur. Maintenant la CLI vérifie d'abord le fichier et affiche `Cannot find my-file.json.` La correction ci-dessous reste la même.

Le fichier existait à côté du lanceur. Le conteneur ne pouvait pas le lire, car seul le dossier `data` était partagé.

Déplacez-le dans `~/Downloads/openldr_ce/data/my-file.json`. Vérifiez-le sans l'importer :

```sh
./openldr fhir validate data/my-file.json
```

Pour un fichier JSON FHIR valide, la sortie contient `all valid`. Si vous souhaitez l'importer, utilisez le chemin partagé :

```sh
./openldr ingest data/my-file.json
```

![Transcription illustrée du déplacement du fichier, de sa validation et de son import.](start-proof-file.png)

Cette règle concerne le lanceur Docker installé. La CLI de développement lit les chemins locaux ordinaires.

## Guides associés

Le [guide des tableaux de bord](/docs/dashboard) explique comment créer un tableau et ajouter des widgets avec vos propres données. Les exercices facultatifs viennent ensuite.
