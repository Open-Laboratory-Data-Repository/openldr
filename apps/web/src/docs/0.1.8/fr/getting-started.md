# Bien démarrer

Installez OpenLDR sur un ordinateur contrôlé par votre organisation. Utilisez l'application de bureau ou ouvrez Studio dans un navigateur. OpenLDR reçoit les données de laboratoire, les convertit en FHIR R4, un format standard pour les données de santé, puis les rend disponibles pour les tableaux de bord et les rapports.

Ces guides web couvrent l'installation, la configuration du serveur et le dépannage. Les guides intégrés à Studio expliquent l'utilisation de l'application. Vous pouvez utiliser vos propres données. Les données d'exemple sont facultatives.

## Choisir où exécuter OpenLDR

Choisissez l'ordinateur qui conservera vos données et exécutera OpenLDR. Il doit rester allumé pendant l'utilisation de Studio. Un téléphone ou un autre ordinateur qui ouvre Studio dans un navigateur n'a pas besoin de sa propre installation.

OpenLDR est gratuit à tous les niveaux. Les niveaux décrivent comment exécuter le logiciel.

| Niveau | Fonctionnement | Par où commencer |
| --- | --- | --- |
| Autonome | Un ordinateur, avec PostgreSQL fourni et les fichiers dans un dossier local. Aucun conteneur Docker. | L'[application de bureau](/docs/desktop-app) s'installe sous Linux x64, Windows x64 ou macOS sur Apple silicon. Les développeurs peuvent [compiler le lanceur autonome](/docs/standalone) depuis le code source. |
| Serveur | Un serveur partagé avec des conteneurs Docker, PostgreSQL et un stockage de fichiers compatible S3. Les comptes locaux sont utilisés par défaut ; Keycloak est facultatif. | Lisez les [prérequis du serveur](/docs/requirements), puis suivez [Installation](/docs/install). Sur Windows Server, préparez d'abord l'environnement Linux décrit dans [Windows Server](/docs/windows-server). |
| Entreprise | Un déploiement fondé sur Serveur, prévu pour plusieurs machines, la répartition de charge et les sauvegardes redondantes. | Toujours en développement et en test. Il n'existe pas encore d'installateur Entreprise. Utilisez l'[installation Serveur](/docs/install) pour le déploiement partagé disponible. |

Le [développement depuis le code source](/docs/development) utilise les commandes du projet. Pour une installation Serveur existante, suivez [Mises à niveau planifiées](/docs/upgrading). Pour une application de bureau existante, suivez les étapes de mise à jour dans [Application de bureau](/docs/desktop-app).

## Installer et vérifier le résultat

Suivez le guide du niveau choisi.

1. Pour Autonome, installez et ouvrez l'[application de bureau](/docs/desktop-app). Elle démarre la base et le serveur, puis affiche Studio dans sa fenêtre.
2. Pour Serveur, suivez [Installation](/docs/install). L'installateur crée la configuration, génère les mots de passe et démarre les conteneurs.
3. Conservez le dossier de données et suivez les instructions de sauvegarde de votre guide.

L'illustration ci-dessous montre l'**installateur Serveur**. Elle ne décrit pas le démarrage de l'application de bureau.

![Illustration de la sortie de l'installateur. Les lignes encadrées montrent l'adresse du serveur et le code de configuration. Le code est un espace réservé.](guide:install-result)

**Résultat attendu :** L'application de bureau affiche Studio. L'installateur Serveur affiche **OpenLDR is ready** et l'adresse à ouvrir. S'il affiche **OpenLDR is starting**, examinez `docker compose ps` et `docker compose logs` depuis son dossier d'installation avant de continuer.

L'application de bureau s'ouvre uniquement sur son propre ordinateur par défaut. Pour une installation Serveur partagée, configurez un nom d'hôte avec [Installation](/docs/install). Sur un autre appareil, `localhost` désigne cet appareil.

## Première connexion

L'application de bureau saisit le code de configuration pour un OpenLDR qu'elle démarre elle-même. Choisissez le nom et le mot de passe du premier administrateur, puis suivez les étapes du premier démarrage de Studio. [Application de bureau](/docs/desktop-app) explique quoi faire si le champ du code est vide.

Pour Serveur ou le lanceur autonome compilé depuis les sources, saisissez le code affiché dans le terminal. Il est valable 30 minutes. [Installation](/docs/install) montre chaque écran de création de l'administrateur. Une installation Serveur utilisant Keycloak emploie les identifiants App sign-in générés.

## Continuer dans l'application

Ouvrez **Documentation** dans le menu principal de Studio et lisez **Commencer ici**. Ce guide explique la CLI installée et celle de développement, puis renvoie vers les guides illustrés.

Les établissements, le catalogue de tests et les paramètres des patients sont facultatifs. OpenLDR peut recevoir et traiter des données avant leur configuration. Nous recommandons de les configurer au cours de l'utilisation. Les guides intégrés **Configurer votre système** commencent par Terminologie.

Utilisez les guides des tableaux de bord et des rapports pour le travail quotidien. Ils acceptent vos propres données ; les fichiers de pratique sont facultatifs.

## Choisir la tâche suivante

- [Charger et envoyer des données](/docs/load-data) : importez vos premières données de laboratoire.
- [Interface en ligne de commande](/docs/cli) : lancez les commandes sur l'hôte OpenLDR.
- [Fournisseurs d'authentification](/docs/auth-providers) : configurez les personnes autorisées à se connecter.
- [Variables d'environnement](/docs/environment) : modifiez la configuration du serveur.
- [Mises à niveau planifiées](/docs/upgrading) : préparez une sauvegarde et passez à une nouvelle version.
