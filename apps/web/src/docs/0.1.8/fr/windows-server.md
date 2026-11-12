# Windows Server

Préparez un environnement Linux sur Windows Server, puis installez OpenLDR à l'intérieur. Les images fournies ciblent Linux AMD64. Docker Desktop ne prend pas en charge Windows Server.

Choisissez un seul parcours. Avec une VM Ubuntu et Docker déjà prêts, passez à **Installer OpenLDR dans Linux**. Les données d'exemple sont facultatives. Consultez le [parcours de connexion illustré](/docs/install).

| Votre serveur | Parcours |
| --- | --- |
| Server 2022 ou 2025 à jour avec WSL2 disponible | WSL2 ou VM Linux Hyper-V. |
| Server 2019 | VM Linux Hyper-V. WSL1 ne suffit pas pour les conteneurs Linux. |
| Serveur sans intervention après redémarrage | Préférez une VM Hyper-V avec démarrage automatique. WSL nécessite un mécanisme séparé. |

Lisez [Prérequis](/docs/requirements). Il faut les droits administrateur Windows, la virtualisation matérielle et des ressources pour Windows et toute la pile Linux. Si Windows est lui-même une VM, son hyperviseur doit exposer la virtualisation imbriquée.

Les exemples utilisent `Ubuntu-24.04`, la VM `OpenLDR` et le dossier Linux `~/Downloads/openldr_ce`. Remplacez `openldr.example.org` par une adresse accessible aux utilisateurs. Les images sont des illustrations vectorielles des commandes, pas des captures d'une installation Windows Server terminée. Sélectionnez une image pour l'agrandir.

Le texte bleu terminé par `$` ou `>` est l'**invite**. Le terminal l'affiche ; ne le saisissez pas. Saisissez la commande après l'invite et appuyez sur **Entrée**. Les lignes plus discrètes dessous sont la **sortie** du programme ; lisez-les sans les saisir. Par exemple, `docker --version` est une commande et `Docker version 29.5.2, build 79eb04c` est sa réponse. Les blocs à copier contiennent uniquement les commandes. Noms, chemins et versions peuvent différer. Certaines illustrations montrent les commandes sans leur sortie ; attendez la fin de chacune avant la suivante.

## Vérifier Windows avant de choisir

Ouvrez PowerShell en tant qu'administrateur sur le serveur. Utilisez une console ou une connexion de gestion permettant de reprendre après un redémarrage.

### 1. Lire la version et les informations de virtualisation

```powershell
{{server:host-check}}
```

Vérifiez le produit, la version et les informations Hyper-V. Mettez Windows à jour avant WSL2. Consultez les [instructions Microsoft pour WSL sur Server](https://learn.microsoft.com/en-us/windows/wsl/install-on-server) en cas d'erreur. Aucun seuil de mise à jour cumulative non vérifié n'est imposé ici.

![Illustration de commande: Lire la version et les informations de virtualisation.](guide:server-host-check)

## Parcours A : préparer WSL2

Exécutez les commandes Windows dans PowerShell administrateur et les commandes Linux dans Ubuntu. La distribution appartient au compte Windows qui l'installe. Réutilisez ce compte ensuite.

### 1. Installer Ubuntu sous WSL2

```powershell
{{server:wsl-install}}
```

Redémarrez Windows si demandé, puis rouvrez PowerShell avec le même compte. Si ce nom manque, vérifiez `wsl --list --online` et les instructions Microsoft. Ne remplacez pas cette distribution par WSL1.

![Illustration de commande: Installer Ubuntu sous WSL2.](guide:server-wsl-install)

### 2. Mettre WSL à jour et vérifier la version

```powershell
{{server:wsl-version}}
```

La ligne Ubuntu doit indiquer **VERSION 2**. Si elle indique 1, lancez `wsl --set-version Ubuntu-24.04 2`, puis vérifiez à nouveau. Résolvez les erreurs avant de continuer.

![Illustration de commande: Mettre WSL à jour et vérifier la version.](guide:server-wsl-version)

### 3. Ouvrir Ubuntu et créer son compte Linux

```powershell
{{server:wsl-open}}
```

Au premier lancement, créez le nom et le mot de passe Linux demandés. Ce mot de passe est distinct de Windows. La saisie reste normalement invisible. Utilisez le dossier personnel Linux, pas `/mnt/c`, pour Docker et OpenLDR.

![Illustration de commande: Ouvrir Ubuntu et créer son compte Linux.](guide:server-wsl-open)

### 4. Vérifier le gestionnaire de services Linux

```bash
{{server:systemd-check}}
```

Dans Ubuntu, attendez `systemd`. Ubuntu WSL peut déjà l'activer. Dans ce cas, sautez les deux étapes suivantes et passez à **Installer Docker dans Linux**.

![Illustration de commande: Vérifier le gestionnaire de services Linux.](guide:server-systemd-check)

### 5. Activer systemd seulement si nécessaire

```bash
{{server:systemd-edit}}
```

Dans Ubuntu, conservez les autres paramètres du fichier. Dans la section `[boot]` existante, définissez `systemd=true`. Si elle manque, ajoutez :

```ini
[boot]
systemd=true
```

Enregistrez avec **Ctrl+O**, puis **Entrée**, et quittez avec **Ctrl+X**. Ne remplacez pas tout le fichier. Microsoft détaille les [prérequis systemd](https://learn.microsoft.com/en-us/windows/wsl/systemd), dont WSL 0.67.6 ou ultérieur.

![Illustration de commande: Activer systemd seulement si nécessaire.](guide:server-systemd-edit)

### 6. Redémarrer WSL et répéter la vérification

```powershell
{{server:wsl-restart}}
```

Terminez les travaux en cours et fermez Ubuntu. Lancez ces commandes dans PowerShell. `--shutdown` arrête toutes les distributions de ce compte. Dans Ubuntu rouvert, `ps -p 1 -o comm=` doit afficher `systemd`. Activer Docker dans Ubuntu ne configure pas son lancement au démarrage de Windows.

![Illustration de commande: Redémarrer WSL et répéter la vérification.](guide:server-wsl-restart)

## Parcours B : préparer une VM Linux Hyper-V

La VM a sa propre adresse réseau. L'exemple utilise **4 processeurs virtuels, 8 Go de RAM et 100 Go de disque**, comme repères et non comme minimums mesurés. Réservez des ressources à Windows. Si une VM adaptée existe déjà, passez à Docker. Installer Hyper-V redémarre le serveur. Créer un commutateur externe peut interrompre le réseau. Prévoyez un accès console.

### 1. Activer Hyper-V

```powershell
{{server:hyperv-enable}}
```

Dans PowerShell administrateur sur Windows Server, lancez la commande. Le serveur redémarre. Rouvrez PowerShell ensuite. En cas d'échec, suivez le [guide Microsoft Hyper-V](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/install-hyper-v).

![Illustration de commande: Activer Hyper-V.](guide:server-hyperv-enable)

### 2. Trouver un commutateur ou la bonne carte physique

```powershell
{{server:switch-list}}
```

Réutilisez un commutateur externe adapté. Sinon, identifiez la carte du réseau voulu. `Ethernet` à l'étape suivante est un exemple, pas un nom à recopier sans vérification.

![Illustration de commande: Trouver un commutateur ou la bonne carte physique.](guide:server-switch-list)

### 3. Créer un commutateur externe si nécessaire

```powershell
{{server:switch-create}}
```

Remplacez `Ethernet` par le nom identifié. Utilisez une console tolérant une coupure réseau. Si vous réutilisez un commutateur, remplacez `OpenLDR-External` dans les commandes suivantes. Voir les [commutateurs externes Microsoft](https://learn.microsoft.com/en-us/windows-server/virtualization/hyper-v/get-started/create-a-virtual-switch-for-hyper-v-virtual-machines).

![Illustration de commande: Créer un commutateur externe si nécessaire.](guide:server-switch-create)

### 4. Télécharger et localiser l'ISO Ubuntu Server

```powershell
{{server:iso-check}}
```

Téléchargez une image AMD64 Ubuntu Server LTS depuis [Ubuntu](https://ubuntu.com/download/server). Cet exemple utilise Ubuntu 24.04 LTS. Placez-la dans `C:\iso\ubuntu-server-amd64.iso`, ou corrigez le chemin. Attendez `True`. Gardez cette fenêtre ouverte pour réutiliser `$iso`.

![Illustration de commande: Télécharger et localiser l'ISO Ubuntu Server.](guide:server-iso-check)

### 5. Créer une nouvelle VM et son disque

```powershell
{{server:vm-create}}
```

Dans la même fenêtre PowerShell, utilisez un nouveau nom et un nouveau disque. Ne réutilisez pas le disque d'une VM existante. Adaptez les ressources à la charge. La capacité virtuelle ne prouve pas que le disque physique a assez d'espace libre.

![Illustration de commande: Créer une nouvelle VM et son disque.](guide:server-vm-create)

### 6. Monter l'ISO et configurer le démarrage

```powershell
{{server:vm-boot}}
```

Le modèle Secure Boot compatible Linux permet à Ubuntu de démarrer. Le démarrage automatique concerne la VM après Windows. Vérifiez séparément le démarrage de Docker et des conteneurs.

![Illustration de commande: Monter l'ISO et configurer le démarrage.](guide:server-vm-boot)

### 7. Ouvrir la console et installer Ubuntu

```powershell
{{server:vm-console}}
```

Cette commande suppose un bureau Windows et les outils Hyper-V. Sur Server Core, utilisez Hyper-V Manager depuis un poste de gestion. Suivez le [tutoriel illustré Ubuntu](https://ubuntu.com/tutorials/install-ubuntu-server). Sélectionnez uniquement le nouveau disque, créez un compte Linux, activez OpenSSH si vous prévoyez SSH, terminez et redémarrez. L'image ci-dessous illustre l'ouverture de la console, pas les écrans de l'installateur Ubuntu.

![Illustration de commande: Ouvrir la console et installer Ubuntu.](guide:server-vm-console)

### 8. Retirer l'ISO et prévoir une adresse stable

```powershell
{{server:vm-eject}}
```

Dans PowerShell Windows, éjectez l'ISO et relevez l'adresse MAC. Réservez une adresse DHCP pour cette MAC, ou configurez une adresse statique adaptée dans Linux. Vérifiez avec `hostname -I` dans Ubuntu. Le nom OpenLDR doit pointer vers cette VM. Continuez dans Ubuntu, par console ou SSH.

![Illustration de commande: Retirer l'ISO et prévoir une adresse stable.](guide:server-vm-eject)

## Installer Docker dans Linux

Les deux parcours se rejoignent ici. Exécutez ces commandes **dans Ubuntu**, pas dans PowerShell. Elles suivent le [dépôt Ubuntu de Docker](https://docs.docker.com/engine/install/ubuntu/). Le script de commodité est destiné aux tests et au développement. Sur un environnement existant, vérifiez les conflits Docker/containerd dans cette documentation avant de modifier des paquets utilisés ailleurs.

### 1. Vérifier Ubuntu, le processeur et les services

```bash
{{server:linux-check}}
```

Cet exemple attend Ubuntu 24.04, `amd64` et `systemd`. Les limites d'architecture des images sont dans [Prérequis](/docs/requirements).

![Illustration de commande: Vérifier Ubuntu, le processeur et les services.](guide:server-linux-check)

### 2. Ajouter la clé de signature Docker

```bash
{{server:docker-key}}
```

Exécutez tout le bloc dans Ubuntu. Arrêtez-vous si un téléchargement ou une commande de paquets échoue.

![Illustration de commande: Ajouter la clé de signature Docker.](guide:server-docker-key)

### 3. Ajouter le dépôt de paquets Docker

```bash
{{server:docker-repo}}
```

Incluez la dernière ligne `EOF`. Ce fichier est propre à Docker et ne remplace pas les sources principales Ubuntu.

![Illustration de commande: Ajouter le dépôt de paquets Docker.](guide:server-docker-repo)

### 4. Installer Docker Engine et Compose

```bash
{{server:docker-install}}
```

La commande installe le moteur, les outils et le module Compose, puis active et démarre Docker.

![Illustration de commande: Installer Docker Engine et Compose.](guide:server-docker-install)

### 5. Donner l'accès Docker au compte d'installation

```bash
{{server:docker-access}}
```

`newgrp` ouvre un shell avec les nouveaux groupes. Le groupe Docker donne des privilèges root sur Linux. Utilisez le compte de maintenance OpenLDR. Voir les [étapes Docker après installation](https://docs.docker.com/engine/install/linux-postinstall/).

![Illustration de commande: Donner l'accès Docker au compte d'installation.](guide:server-docker-access)

### 6. Vérifier le moteur, Compose et un conteneur de test

```bash
{{server:docker-check}}
```

Attendez un moteur Linux AMD64, une version Compose et le succès `hello-world`. La dernière commande télécharge une petite image et supprime le conteneur terminé. Résolvez toute erreur avant OpenLDR.

![Illustration de commande: Vérifier le moteur, Compose et un conteneur de test.](guide:server-docker-check)

## Installer OpenLDR dans Linux

Choisissez le nom **avant la première installation**. Sur Hyper-V, il doit atteindre la VM Ubuntu. Sur WSL2 avec le transfert ci-dessous, il doit atteindre Windows. Remplacez `openldr.example.org` par ce nom ou une IP accessible. Un réseau privé ou Tailscale peut utiliser le certificat auto-signé généré.

### 1. Télécharger l'installateur Linux

```bash
{{server:install-download}}
```

Le fichier est enregistré dans `~/Downloads/openldr-install.sh`, dans Ubuntu. N'utilisez pas l'installateur PowerShell Windows ici.

![Illustration de commande: Télécharger l'installateur Linux.](guide:server-install-download)

### 2. Installer avec l'adresse accessible aux utilisateurs

```bash
{{server:install-run}}
```

Remplacez le nom d'exemple. `--seedless` exclut tableaux de bord et données de démonstration. Omettez cette option si vous les souhaitez sur cette installation neuve. Vos données ne dépendent pas des exemples. Gardez les identifiants privés. Un certificat public nécessite la tâche séparée dans [Installation](/docs/install), avec le port 80 accessible. Consultez le [parcours de connexion illustré](/docs/install).

![Illustration de commande: Installer avec l'adresse accessible aux utilisateurs.](guide:server-install-run)

### 3. Vérifier l'état réel des services

```bash
{{server:install-status}}
```

Vérifiez les conteneurs et la santé de l'API. `-k` sert ici au certificat auto-signé local. Cela ne prouve ni l'accès distant ni la connexion Studio. En cas d'erreur, consultez `docker compose logs --tail 100` dans ce dossier. Le code de sortie de l'installateur seul ne prouve pas la disponibilité.

![Illustration de commande: Vérifier l'état réel des services.](guide:server-install-status)

## Permettre aux autres postes de joindre WSL2

Ignorez cette tâche pour Hyper-V. Sa VM a un accès LAN, mais routage et pare-feu doivent autoriser les ports de la passerelle. Pour le NAT WSL2, le [guide réseau Microsoft](https://learn.microsoft.com/en-us/windows/wsl/networking) décrit le transfert explicite. Ses instructions de réseau en miroir visent Windows 11, pas ce parcours Server.

### 1. Lire l'adresse Ubuntu et vérifier les ports Windows

```powershell
{{server:wsl-address}}
```

Dans PowerShell administrateur du compte propriétaire de WSL, relevez l'IPv4 Ubuntu. Vérifiez que IIS ou un autre service n'occupe pas 80/443. Une liste vide signifie qu'aucun écouteur TCP correspondant n'a été trouvé. Ne stoppez pas un service existant sans en vérifier l'usage.

![Illustration de commande: Lire l'adresse Ubuntu et vérifier les ports Windows.](guide:server-wsl-address)

### 2. Transférer les ports vers Ubuntu

```powershell
{{server:wsl-proxy}}
```

Vérifiez que `$wslIp` correspond à l'IPv4 relevée. Les règles écoutent sur toutes les interfaces IPv4 Windows. Elles ne transfèrent que les ports de passerelle, pas ceux des services internes. Si vous utilisez d'autres ports, adaptez les deux extrémités.

![Illustration de commande: Transférer les ports vers Ubuntu.](guide:server-wsl-proxy)

### 3. Autoriser les clients prévus et examiner les règles

```powershell
{{server:wsl-firewall}}
```

Cet exemple autorise HTTPS au sous-réseau local sur un profil Windows Domain ou Private. Pour Tailscale ou un réseau routé, remplacez `LocalSubnet` par la plage cliente voulue et choisissez le profil actif. Ajoutez une règle TCP 80 similaire seulement pour les redirections HTTP ou la validation publique du certificat. Après redémarrage WSL, vérifiez son IP et répétez les transferts si elle change. Ces règles ne démarrent pas Ubuntu.

![Illustration de commande: Autoriser les clients prévus et examiner les règles.](guide:server-wsl-firewall)

## Vérifier l'accès distant et le redémarrage

Faites le test réseau depuis un autre ordinateur. Un test local au serveur ne prouve pas l'accès des utilisateurs.

### 1. Tester l'adresse depuis un autre poste Windows

```powershell
{{server:remote-check}}
```

Remplacez le nom par celui de l'installation. Attendez `TcpTestSucceeded: True`, qui prouve seulement la connexion TCP. Ouvrez `https://VOTRE_HOTE` pour tester la passerelle. Confiance du certificat et connexion sont distinctes. Ne désactivez pas durablement les contrôles de certificat.

![Illustration de commande: Tester l'adresse depuis un autre poste Windows.](guide:server-remote-check)

### 2. Vérifier le démarrage prévu

```powershell
{{server:vm-reboot-check}}
```

Pour Hyper-V, la propriété doit indiquer `Start`. Lors d'un redémarrage de maintenance, revérifiez VM, Docker, santé des conteneurs et accès distant. Pour WSL2, prévoyez et testez un mécanisme de démarrage sous le compte propriétaire. Un service systemd ne démarre pas WSL avec Windows. Sans ce mécanisme testé, ne considérez pas l'installation comme autonome. Préférez Hyper-V si le démarrage automatique est requis.

![Illustration de commande: Vérifier le démarrage prévu.](guide:server-vm-reboot-check)

**Résultat attendu :** Docker Linux exécute OpenLDR, le nom configuré atteint la passerelle depuis le réseau voulu et le retour après redémarrage a été vérifié. La connexion Studio reste une tâche séparée sur installation neuve.
