# Prérequis

Vérifiez l'ordinateur qui hébergera OpenLDR avant de lancer l'installateur. Les autres ordinateurs et téléphones ouvrent Studio dans un navigateur. Ils n'ont pas besoin de Docker ni de la CLI OpenLDR.

Cette page concerne l'installation avec les images fournies. Le [développement depuis le code source](/docs/development) a ses propres prérequis. Les données d'exemple sont facultatives.

## Choisir un hôte compatible

OpenLDR utilise des **conteneurs Linux**. Docker configuré pour les conteneurs Windows ne suffit pas.

La construction par défaut cible **Linux AMD64**, pour les processeurs Intel et AMD 64 bits. L'image publiée `openldr-api:latest` contient actuellement `linux/amd64` sans image ARM64 native. La compatibilité de Docker avec un ordinateur ARM ne prouve pas celle des images OpenLDR. Vérifiez séparément Apple Silicon et les autres hôtes ARM avant de les choisir pour cette installation.

| Hôte | Préparation |
| --- | --- |
| Linux sur Intel/AMD 64 bits | [Docker Engine](https://docs.docker.com/engine/install/) et le plugin Compose sur une distribution Linux prise en charge. |
| Windows client sur Intel/AMD 64 bits | [Docker Desktop](https://docs.docker.com/desktop/setup/install/windows-install/) sur une version de Windows actuellement prise en charge par Docker. Utilisez les conteneurs Linux et activez la virtualisation matérielle. |
| Mac Intel | [Docker Desktop pour Mac](https://docs.docker.com/desktop/setup/install/mac-install/) sur une version de macOS prise en charge. |
| Windows Server | Docker Engine dans un environnement Linux. Le [guide Windows Server](/docs/windows-server) couvre WSL2 sur Server 2022/2025 à jour et une VM Linux Hyper-V. Docker Desktop n'est pas pris en charge sur Windows Server. |

Microsoft décrit [WSL sur Server 2022 et 2025](https://learn.microsoft.com/en-us/windows/wsl/install-on-server). Pour les versions antérieures, utilisez la VM Linux de notre guide plutôt que de confondre WSL et WSL2.

## Préparer les logiciels et les accès

| Élément | Prérequis |
| --- | --- |
| Docker | Docker Engine ou Docker Desktop maintenu à jour. Le service doit fonctionner et être accessible au compte qui exécute l'installateur. |
| Compose | La commande `docker compose` doit fonctionner. L'ancienne commande `docker-compose` seule ne suffit pas. |
| Terminal Linux/macOS | Un interpréteur de commandes et `curl` pour télécharger et lancer l'installateur. |
| Terminal Windows | Windows PowerShell 5.1 ou ultérieur pour télécharger et lancer l'installateur PowerShell. |
| Dossier d'installation | Le compte doit pouvoir créer le dossier choisi et y écrire. Docker Desktop doit pouvoir le partager avec sa VM Linux. |
| Création du certificat | OpenSSL local est facultatif. En son absence, l'installateur tente de créer le certificat avec un conteneur Docker. Vous pouvez aussi fournir votre certificat. |

L'installation normale inclut PostgreSQL, le stockage de fichiers et le service de connexion. Il n'est **pas nécessaire** d'installer séparément Node.js, pnpm, Git, PostgreSQL ou SQL Server sur l'hôte. Une base analytique externe n'est nécessaire que si vous choisissez cette option.

## Prévoir processeur, mémoire et stockage

Les chiffres sont des **repères de dimensionnement, pas un minimum mesuré ni une capacité garantie**. Le [guide de VM Windows Server](/docs/windows-server) commence avec **4 processeurs virtuels, 8 Go de RAM et 100 Go de disque** pour une nouvelle VM Linux.

Les imports, terminologies, utilisateurs simultanés, rapports et fichiers conservés peuvent demander davantage.

- Allouez les ressources de l'hôte Linux Docker à toute la pile, pas seulement à l'API. Gardez aussi des ressources pour le système d'exploitation hôte.
- Avec Docker Desktop, vérifiez les limites de la VM Linux, pas seulement la RAM installée. Docker décrit les [réglages de ressources de la VM](https://docs.docker.com/desktop/settings-and-maintenance/settings/#vm-resources). WSL2 a ses propres limites.
- Prévoyez les images, les données PostgreSQL, les fichiers stockés, les journaux, les sauvegardes et la croissance. Les conteneurs de bases facultatifs ont leurs propres besoins.
- Les volumes Docker contiennent les données et les fichiers. De l'espace libre près de l'installateur ne prouve pas que le disque Docker ou celui de sa VM en dispose assez.

Docker Desktop impose ses propres prérequis. Par exemple, ses prérequis Windows actuels incluent 8 Go de RAM système. Ce chiffre ne mesure pas la capacité de traitement d'OpenLDR.

## Préparer l'accès réseau

Pour l'installateur normal, autorisez les téléchargements HTTPS sortants depuis GitHub et GitHub Container Registry, ainsi que les redirections des images. Le conteneur SQL Server d'évaluation utilise aussi le registre Microsoft. Configurez le proxy éventuel pour le terminal et Docker.

| Mode d'accès | Besoins |
| --- | --- |
| Sur l'hôte uniquement | `https://localhost` et le certificat auto-signé généré. Aucun domaine public n'est nécessaire. |
| Réseau privé ou Tailscale | Un nom ou une adresse IP accessible aux autres appareils. Configurez cette adresse à l'installation pour les redirections de connexion. Les appareils doivent atteindre le port HTTPS choisi. |
| Domaine public avec Let's Encrypt | Un domaine pointant vers l'hôte, les ports entrants TCP 80 et 443 et la configuration du certificat sous Linux décrite dans [Installation](/docs/install). |

La passerelle utilise les ports hôte **80 et 443 par défaut**. Ils doivent être disponibles, sinon choisissez d'autres ports avant l'installation. PostgreSQL, le stockage et Keycloak communiquent dans le réseau Docker. Il n'est pas nécessaire d'ouvrir leurs ports internes aux utilisateurs dans la pile par défaut.

## Vérifier l'hôte avant l'installation

Ces vérifications ne modifient rien. Ouvrez Terminal sur Linux/macOS ou PowerShell sur Windows. Exécutez-les sur l'ordinateur qui héberge Docker.

### 1. Vérifier le système et le processeur des conteneurs

```
docker info --format '{{.OSType}}/{{.Architecture}}'
```

Pour les images AMD64 fournies, attendez `linux/x86_64` ou `linux/amd64`. Si Docker indique des conteneurs Windows, passez aux conteneurs Linux. En cas d'erreur de connexion, démarrez le service et vérifiez l'accès Docker du compte actuel. S'il indique ARM, résolvez la compatibilité des images avant de continuer.

![Illustration de la vérification du moteur. L'exemple montre Linux sur Intel/AMD 64 bits.](guide:install-runtime)

### 2. Vérifier Compose

```
docker compose version
```

Une version doit s'afficher sans erreur. Elle peut différer de l'illustration. Si la commande est absente, installez le plugin Compose ou mettez Docker Desktop à jour.

![Illustration de la vérification de Compose. Votre version peut différer.](guide:install-compose)

### 3. Vérifier le stockage Docker et l'espace disque libre

```
docker system df
```

Cette commande indique **l'espace déjà utilisé par Docker**, pas l'espace libre. Vérifiez aussi l'espace libre du disque contenant les données Docker. Avec Docker Desktop, vérifiez l'allocation du disque de la VM et l'espace libre sur son disque hôte.

![Illustration de la commande d'utilisation du stockage Docker. Elle ne mesure pas l'espace libre.](guide:install-storage)

**Résultat attendu :** Docker répond en mode Linux, son processeur correspond à l'image et Compose fonctionne. Vous avez vérifié les limites de ressources, le disque libre et le réseau. Passez à [Installation](/docs/install).
