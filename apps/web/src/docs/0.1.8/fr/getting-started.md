# Bien démarrer

OpenLDR reçoit les données de laboratoire et les rend disponibles pour les tableaux de bord et les rapports. Il est gratuit. Tous les niveaux proposent les mêmes fonctions de l'application. Choisissez le parcours qui correspond à votre besoin.

## Commencer avec l'application de bureau

Choisissez l'application de bureau pour exécuter OpenLDR sur un seul ordinateur. Elle inclut sa propre base de données et ne nécessite aucun conteneur Docker. Des paquets existent pour Linux x64, Windows x64 et macOS sur Apple silicon.

1. Suivez le [guide de l'application de bureau](/docs/desktop-app) pour votre système.
2. Ouvrez OpenLDR depuis le menu des applications de votre ordinateur.
3. Créez le premier administrateur, puis suivez les étapes du premier démarrage dans Studio. Les données d'exemple sont facultatives.
4. Continuez avec [Utiliser Studio](/docs/using-studio) pour trouver les guides de votre travail quotidien.

L'installateur nécessite actuellement une commande de terminal. Le guide de l'application de bureau donne celle de votre système. Après l'installation, utilisez OpenLDR dans sa propre fenêtre.

## Utiliser l'installation de votre laboratoire

Si votre laboratoire utilise déjà OpenLDR, demandez à son administrateur l'adresse de Studio et votre compte. Ouvrez cette adresse dans un navigateur sur votre ordinateur ou votre téléphone.

Une autre installation n'est pas nécessaire. [Utiliser Studio](/docs/using-studio) explique où trouver les guides après la connexion.

## Administrer un serveur partagé

Ce parcours s'adresse à la personne qui installe et entretient OpenLDR pour les autres utilisateurs. Ils ouvrent Studio dans un navigateur. Le serveur utilise des conteneurs Docker.

Commencez par les [prérequis du serveur](/docs/requirements), puis suivez [Installation](/docs/install). Sur Windows Server, préparez d'abord l'environnement Linux décrit dans [Windows Server](/docs/windows-server).

Pour la maintenance, utilisez [Mises à niveau planifiées](/docs/upgrading), [Variables d'environnement](/docs/environment) et [Fournisseurs d'authentification](/docs/auth-providers). Les instructions détaillées de terminal restent dans ces guides.

## Utiliser la ligne de commande ou modifier le code

Ces guides servent à automatiser les tâches, exécuter les commandes d'administration ou développer OpenLDR :

- [Connexion CLI et clés d'accès](/docs/cli-access) explique les accès pour les personnes et les scripts.
- [Interface en ligne de commande](/docs/cli) répertorie les commandes et les tâches d'administration.
- [Exécuter sans Docker](/docs/standalone) permet de compiler et de lancer le lanceur autonome depuis les sources.
- [Développement](/docs/development) prépare un environnement de développement séparé.

## État du niveau Entreprise

Entreprise repose sur Serveur, avec un déploiement prévu pour plusieurs machines, la répartition de charge et les sauvegardes redondantes. Ce niveau reste en développement et en test. Il n'existe pas encore d'installateur Entreprise. Utilisez l'[installation Serveur](/docs/install) pour le déploiement partagé disponible.
