# Application de bureau

L'application de bureau OpenLDR fait tourner OpenLDR sur un seul ordinateur, dans sa propre fenêtre. Il ne faut ni Docker ni terminal. L'application démarre la base Postgres fournie et le serveur OpenLDR, affiche Studio, et arrête les deux quand vous quittez. Elle utilise le même lanceur que la page [Exécuter sans Docker](/docs/standalone), avec le même dossier de données.

Il existe des paquets pour Linux x64, macOS sur Apple silicon et Windows x64. Seul Linux a été essayé. Les paquets Windows et macOS sont nouveaux. Ils sont construits sous Linux, et personne ne les a encore lancés sous Windows ou macOS.

## Installer

L'installateur cherche la version d'OpenLDR la plus récente qui a un paquet pour votre système. Il télécharge le paquet, le vérifie avec le fichier `SHA256SUMS` de la version, et place l'application dans vos propres dossiers. Il lui faut 2 Go libres sur le disque. Chaque paquet pèse environ 500 à 600 Mo, car Studio contient les images de ses guides intégrés. Sur une connexion lente, le téléchargement prend quelques minutes.

### Linux et macOS

```sh
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.sh | bash
```

Pour installer une version précise, ajoutez-la à la fin : `| bash -s -- --version 0.1.12`.

### Windows

Lancez ceci dans PowerShell. Il ne faut pas de droits d'administrateur.

```powershell
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1 | iex
```

`irm | iex` ne transmet aucune option. Pour installer une version précise, utilisez plutôt cette forme :

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1))) -Version 0.1.12
```

L'installateur place l'application ici :

| Système | L'application | Comment la démarrer |
| --- | --- | --- |
| Linux | `~/.local/share/openldr-desktop` | **OpenLDR** dans le menu des applications |
| macOS | `~/Applications/OpenLDR.app` | Launchpad, ou ouvrez-la dans le Finder |
| Windows | `%LOCALAPPDATA%\Programs\OpenLDR` | **OpenLDR** dans le menu Démarrer |

### Le mot de passe administrateur sous Linux

L'application affiche Studio dans un bac à sable, qui tient les pages web à l'écart du reste de votre ordinateur. Sous Ubuntu 24.04 et versions suivantes, le système ne laisse pas une application démarrer ce bac à sable sans profil AppArmor. AppArmor est la partie de Linux qui limite ce que chaque programme peut faire. Dans ce cas, l'installateur installe un petit profil avec `sudo` et demande une fois le mot de passe administrateur. Il le dit avant de le demander :

```text
→ This system does not let an app start its sandbox without an AppArmor profile.
→ This script will install a small profile for OpenLDR at /etc/apparmor.d/openldr-desktop-1000 with sudo, which asks for the administrator password once.
```

Le nombre à la fin du nom de fichier est votre numéro d'utilisateur. Si vous refusez, rien n'est installé, et l'installateur se termine par `✗ The sandbox profile was not installed, so OpenLDR was not installed.` L'application installée ne peut pas tourner avec son bac à sable désactivé.

Sur un système sans cette règle, l'installateur ne demande rien. La règle est active quand `/proc/sys/kernel/apparmor_restrict_unprivileged_userns` contient `1`. Une mise à jour ne redemande le mot de passe que si le profil doit changer.

### L'application n'est pas signée

macOS et Windows peuvent vérifier qui a fait un programme avant de l'ouvrir. L'application OpenLDR ne porte la signature d'aucun éditeur sur ces deux systèmes. Personne ne l'a encore ouverte sous macOS ou Windows, donc cette page ne dit pas ce qu'ils affichent.

Sous macOS, l'installateur signe l'application sur votre Mac avec `codesign`, avec une signature qui ne nomme aucun éditeur. Il n'est pas prouvé que macOS l'ouvre ensuite.

## Le premier démarrage

1. Démarrez l'application. La fenêtre affiche **Démarrage d'OpenLDR** pendant que la base de données et le serveur démarrent.
2. Studio affiche **Créer l'administrateur**. L'application remplit **Code de configuration**, et l'indication sous le champ dit **Rempli par l'application OpenLDR.**
3. Choisissez un nom d'utilisateur et un mot de passe, puis sélectionnez **Créer l'administrateur**.
4. Trois étapes suivent. Nommez le laboratoire, chargez des données d'exemple, puis voyez quelles vérifications demandent encore votre attention. Vous pouvez passer les deux premières.

Le guide de Studio, **Premier démarrage**, décrit ces trois étapes. Les données d'exemple ne sont proposées que tant que l'installation ne contient aucune donnée de laboratoire. Si vous les passez, Paramètres, Vérifications d’installation peut les charger plus tard, depuis son menu à points.

L'application ouvre Studio à `http://127.0.0.1:3000/studio/`. Elle prend le port 3000 s'il est libre. Sinon, elle choisit un autre port libre et le retient. L'adresse reste alors la même tant que ce port reste libre.

L'application ne remplit le code de configuration que pour un OpenLDR qu'elle a démarré elle-même. OpenLDR peut déjà tourner quand l'application démarre. Vous l'avez peut-être lancé depuis un terminal. Ou une application arrêtée de force l'a laissé tourner. L'application affiche alors cet OpenLDR, et le champ du code reste vide.

Le plus simple est de sélectionner **Quitter** dans le menu de la zone de notification, puis de relancer l'application. Elle démarre alors OpenLDR elle-même et remplit le code. Vous pouvez aussi lancer la commande `openldr-standalone` de l'application, puis taper le code affiché :

| Système | Commande |
| --- | --- |
| Linux | `~/.local/share/openldr-desktop/openldr-standalone cli -- auth setup-code` |
| macOS | `~/Applications/OpenLDR.app/Contents/Resources/openldr-standalone cli -- auth setup-code` |
| Windows, dans PowerShell | `& "$env:LOCALAPPDATA\Programs\OpenLDR\openldr-standalone.cmd" cli -- auth setup-code` |

## La fenêtre et la zone de notification

Fermer la fenêtre laisse OpenLDR tourner. Pour arrêter OpenLDR, utilisez **Quitter**.

L'application a une icône dans la zone de notification, la partie de la barre des tâches ou de la barre du haut qui contient les petites icônes des programmes en cours. Son menu a quatre éléments :

| Élément | Effet |
| --- | --- |
| **Ouvrir OpenLDR** | Affiche de nouveau la fenêtre. |
| **Démarrer à la connexion** | Une case, décochée au départ. Cochée, l'application démarre quand vous vous connectez à l'ordinateur, sans ouvrir de fenêtre. |
| **Ouvrir le dossier des journaux** | Ouvre `logs` dans le dossier de données. |
| **Quitter** | Affiche **Arrêt d'OpenLDR**, arrête le serveur et la base de données, puis ferme l'application. |

**Quitter** arrête OpenLDR même quand l'application affichait un OpenLDR qu'elle n'avait pas démarré elle-même.

Relancer l'application pendant qu'elle tourne fait revenir sa fenêtre. Les liens qui sortent d'OpenLDR s'ouvrent dans votre navigateur. Les pages propres à l'application suivent la langue du système : anglais, français ou portugais.

### Quand aucune icône n'apparaît

Certains bureaux Linux n'affichent aucune icône de notification. Dans ce cas, relancez l'application depuis le menu des applications pour faire revenir sa fenêtre. Pour arrêter OpenLDR, appuyez sur Alt dans la fenêtre pour afficher sa barre de menus, et utilisez l'élément pour quitter dans son menu File. Ou lancez `openldr-standalone stop` dans un terminal.

## Mettre à jour

Quittez OpenLDR, puis relancez la ligne d'installation. Elle remplace l'application et ne touche pas au dossier de données. Le démarrage suivant met à jour la base de données.

L'installateur refuse tant qu'OpenLDR tourne, avant de télécharger quoi que ce soit. Sous Linux et macOS, il affiche :

```text
✗ OpenLDR is running. Quit it from its tray icon, or run: "/home/you/.local/share/openldr-desktop/openldr-standalone" stop. Then run this again.
```

Sous Windows, il affiche :

```text
X OpenLDR is running. Quit it from its tray icon, or run: & "C:\Users\you\AppData\Local\Programs\OpenLDR\openldr-standalone.cmd" stop. Then run this again.
```

Le chemin du message est la commande `openldr-standalone` de votre installation. Quittez OpenLDR depuis son icône de notification, ou lancez cette ligne `stop`. Relancez ensuite la ligne d'installation.

Si l'installateur refuse encore, une base de données laissée par un OpenLDR arrêté de force tourne peut-être toujours. `stop` dit alors `OpenLDR is not running.`, car seule la base de données reste. Démarrez l'application une fois et attendez Studio. Quand l'application démarre OpenLDR, OpenLDR arrête d'abord une base de données restée en marche sur le même dossier de données. Sélectionnez ensuite **Quitter** dans le menu de la zone de notification, puis relancez la ligne d'installation.

## Désinstaller

Quittez d'abord OpenLDR. Si l'installateur refuse avec `OpenLDR is running.`, suivez les étapes de **Mettre à jour**. Sous Linux et macOS :

```sh
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.sh | bash -s -- --uninstall
```

Sous Windows :

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/desktop.ps1))) -Uninstall
```

Cela supprime l'application et son propre dossier `OpenLDR Desktop`. Cela supprime aussi :

- sous Linux, l'entrée de menu, l'entrée de démarrage à la connexion, le lien `openldr-standalone` dans `~/.local/bin` et le profil AppArmor s'il a été installé, ce qui redemande le mot de passe administrateur ;
- sous macOS, le lien `openldr-standalone` dans `~/.local/bin` ;
- sous Windows, le raccourci du menu Démarrer et l'entrée de démarrage à la connexion.

Sous macOS, si vous aviez réglé l'application pour démarrer à la connexion, retirez-la vous-même des éléments de connexion dans Réglages Système.

Le dossier de données reste. La dernière ligne dit où il se trouve, par exemple `Your data was left alone. It is in /home/you/.local/share/openldr`. Pour supprimer aussi les données, supprimez ce dossier vous-même. Il contient des données de patients.

## Emplacement des données

| Système | Dossier de données | Dossier propre à l'application |
| --- | --- | --- |
| Linux | `~/.local/share/openldr`, ou `$XDG_DATA_HOME/openldr` quand `XDG_DATA_HOME` contient un chemin complet | `~/.config/OpenLDR Desktop` |
| macOS | `~/Library/Application Support/OpenLDR` | `~/Library/Application Support/OpenLDR Desktop` |
| Windows | `%LOCALAPPDATA%\OpenLDR` | `%APPDATA%\OpenLDR Desktop` |

Le dossier de données contient la base de données, les fichiers stockés, les journaux et la clé des secrets. [Exécuter sans Docker](/docs/standalone) détaille son contenu. Le dossier propre à l'application contient ses réglages, son journal `desktop.log` et les données de navigateur de la fenêtre. Les réglages sont le port, le démarrage à la connexion et la taille de la fenêtre. Ils ne contiennent aucun secret.

Le dossier de données est le même que celui de `openldr-standalone`. L'application fournit cette commande :

| Système | La commande |
| --- | --- |
| Linux | `~/.local/share/openldr-desktop/openldr-standalone` |
| macOS | `~/Applications/OpenLDR.app/Contents/Resources/openldr-standalone` |
| Windows | `%LOCALAPPDATA%\Programs\OpenLDR\openldr-standalone.cmd` |

Sous Linux et macOS, l'installateur la relie en `~/.local/bin/openldr-standalone` quand ce dossier existe et se trouve dans votre PATH. `openldr-standalone` fonctionne alors dans un nouveau terminal. Sous Windows, rien n'est ajouté à votre PATH, donc lancez-la par son chemin complet.

Elle accepte les commandes de la page [Exécuter sans Docker](/docs/standalone), sans `pnpm` devant : `openldr-standalone status`, `openldr-standalone stop` et `openldr-standalone cli -- doctor`. Un seul lanceur tourne par dossier de données. Si vous démarrez d'abord OpenLDR depuis un terminal, l'application affiche celui-là.

## Quand elle ne démarre pas

L'application affiche alors **OpenLDR n'est pas en cours d'exécution**, le dernier message d'OpenLDR et **Réessayer**. La plupart des erreurs affichent aussi **Les journaux se trouvent dans :** avec les fichiers journaux. Les fichiers journaux sont :

| Fichier | Emplacement |
| --- | --- |
| `server.log` | `logs` dans le dossier de données |
| `postgres.log` | `logs` dans le dossier de données |
| `desktop.log` | Le dossier propre à l'application |

Lisez d'abord le message, puis les journaux. `desktop.log` est le journal de l'application. Il montre ce qu'elle a fait, et les événements et lignes d'erreur reçus d'OpenLDR.

| Message | Que faire |
| --- | --- |
| `This data folder was last used by OpenLDR <newer>. This is OpenLDR <older>, which is older and cannot open it. Install OpenLDR <newer> or newer.` | Installez cette version ou une plus récente. Voir plus bas. |
| `OpenLDR is not running. A recovery command is using the database (process <n>). Try again when it has finished.` | Une commande comme `openldr-standalone cli -- doctor` tient le dossier de données. Attendez qu'elle se termine, puis sélectionnez **Réessayer**. |
| `OpenLDR n'a pas répondu quand l'application a vérifié s'il est en cours d'exécution.` | Sélectionnez **Réessayer**. Si le message revient, lisez `desktop.log`. |
| `OpenLDR s'est arrêté de façon inattendue.` | Lisez `server.log` et `postgres.log`, puis sélectionnez **Réessayer**. |
| `OpenLDR n'est plus en cours d'exécution.` | Quelque chose a arrêté OpenLDR en dehors de l'application, comme `openldr-standalone stop` dans un terminal. Sélectionnez **Réessayer**. |
| `OpenLDR n'est pas compilé. Compilez-le, puis relancez l'application.` | Dans une application installée, cela veut dire que des fichiers manquent. Relancez la ligne d'installation. |

Le dossier de données contient `last-version.json`, qui indique la version d'OpenLDR qui l'a démarré en dernier. Une version plus récente peut modifier la base de données d'une façon qu'une plus ancienne ne sait pas lire. Une application plus ancienne refuse donc le dossier avec le premier message ci-dessus, et ne démarre rien.

Chaque démarrage écrit `last-version.json` juste avant que le serveur démarre, car le serveur peut modifier la base même s'il échoue ensuite. Supprimer ce fichier laisse démarrer l'application plus ancienne. Ce n'est sûr que si la version plus récente n'a jamais modifié la base. Dans le doute, supposez qu'elle l'a fait. L'application plus ancienne échoue alors plus tard avec une erreur de base de données. La seule voie sûre est d'installer la version plus récente.

Sous Windows, le Postgres fourni peut avoir besoin du runtime Microsoft Visual C++, que le paquet ne contient pas. Ce n'est pas encore confirmé.

## Limites

- Cet ordinateur seulement. L'application démarre OpenLDR sur `127.0.0.1`, donc un téléphone ou un autre ordinateur ne peut pas l'atteindre. [Exécuter sans Docker](/docs/standalone) montre comment ouvrir OpenLDR à d'autres appareils.
- L'application ne se met pas à jour elle-même. Relancez la ligne d'installation.
- L'application ne porte la signature d'aucun éditeur sous macOS ni sous Windows.
- Les paquets Windows et macOS sont construits sous Linux, et personne ne les a encore lancés.
- Sous macOS, la fenêtre peut s'ouvrir quand l'application démarre à la connexion. Ce n'est pas prouvé.
- `desktop.log` grossit sans limite, comme `server.log` et `postgres.log`. Supprimez-le après avoir sélectionné **Quitter**.
- Les limites de la page [Exécuter sans Docker](/docs/standalone) s'appliquent aussi, comme l'absence de TLS et la sauvegarde par copie du dossier de données arrêté.

## Guides associés

- [Exécuter sans Docker](/docs/standalone)
- [Installation](/docs/install)
- [Bien démarrer](/docs/getting-started)
- [Référence CLI](/docs/cli)
