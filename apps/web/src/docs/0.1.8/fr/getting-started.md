# Bien démarrer

Installez OpenLDR sur un ordinateur contrôlé par votre organisation, puis ouvrez Studio dans un navigateur. OpenLDR reçoit les données de laboratoire, les convertit en FHIR R4, un format standard pour les données de santé, et les rend disponibles pour les tableaux de bord et les rapports.

Ces guides web couvrent l'installation, la configuration du serveur et le dépannage. Les guides intégrés à Studio expliquent comment utiliser l'application. Vous pouvez utiliser vos propres données. Les données d'exemple sont facultatives.

## Choisir où exécuter OpenLDR

Choisissez l'ordinateur qui stockera les données et exécutera OpenLDR. Il doit rester allumé pendant l'utilisation de Studio. Un ordinateur portable ou un téléphone qui ouvre Studio dans un navigateur n'a pas besoin de sa propre installation.

| Votre hôte | Par où commencer |
| --- | --- |
| Linux, macOS ou Windows 10/11 | Lisez les [Prérequis](/docs/requirements), puis suivez [Installation](/docs/install). |
| Windows Server | Suivez [Windows Server](/docs/windows-server) pour préparer un environnement Linux, puis installez-y OpenLDR. |
| Code source pour le développement | Suivez [Développement](/docs/development). Cette méthode utilise les commandes du projet plutôt que la CLI installée. |
| Installation OpenLDR existante | Suivez [Mises à niveau planifiées](/docs/upgrading). Une nouvelle installation n'est pas nécessaire. |

## Installer et vérifier le résultat

L'installateur crée la configuration, génère les mots de passe et démarre les services. Exécutez-le sur l'hôte choisi.

1. Ouvrez le guide adapté à votre hôte ci-dessus. Vérifiez ses prérequis avant de lancer les commandes.
2. Suivez ses étapes d'installation. Attendez que les services soient prêts.
3. Conservez l'adresse et le code **Setup code** affichés à la fin. Le code de configuration est valable 30 minutes.

![Illustration de la sortie de l'installateur. Les lignes encadrées montrent l'adresse et le code de configuration. Le code est un espace réservé.](guide:install-result)

**Résultat attendu :** L'installateur affiche **OpenLDR is ready** et l'adresse à ouvrir. S'il affiche **OpenLDR is starting**, certains services ne sont pas encore prêts. Examinez `docker compose ps` et `docker compose logs` depuis le dossier d'installation avant de continuer.

L'adresse illustrée est celle d'une installation locale par défaut. Pour un accès depuis d'autres ordinateurs, configurez un nom d'hôte avec [Installation](/docs/install). Sur un autre ordinateur, `localhost` désigne cet ordinateur, pas votre hôte OpenLDR.

## Se connecter à Studio

Créez le premier administrateur avec le code de configuration. Ce compte vous connecte à Studio.

1. Ouvrez l'adresse affichée par l'installateur. Pour une installation distante, utilisez le nom d'hôte configuré. Studio affiche la page **Créer l'administrateur**.
2. Saisissez le code dans **Code de configuration**. S'il a expiré, lancez `./openldr auth setup-code` dans le dossier `openldr/` pour en obtenir un nouveau. Sous Windows, lancez `.\openldr.ps1 auth setup-code`.
3. Choisissez un nom d'utilisateur et un mot de passe, puis sélectionnez **Créer l'administrateur**. Vous êtes alors connecté en tant qu'administrateur.

Une installation faite avec `--auth keycloak` n'a pas de code de configuration. Son installateur affiche à la place un mot de passe administrateur Keycloak et une ligne **App sign-in**. Connectez-vous avec `labadmin` et le mot de passe de la ligne **App sign-in**, puis choisissez un nouveau mot de passe quand il vous est demandé. Le mot de passe administrateur Keycloak sert séparément à gérer l'authentification.

**Résultat attendu :** Studio s'ouvre. Une nouvelle installation comprend un tableau de bord d'exemple, sauf si vous avez choisi l'option sans données initiales. Après une mise à niveau, les données et les droits existants déterminent ce qui s'affiche.

L'installation locale par défaut utilise un certificat auto-signé. Un avertissement du navigateur est attendu dans ce cas. Vérifiez que vous avez ouvert l'adresse de votre propre installation avant de l'accepter. Consultez [Installation](/docs/install) pour un certificat reconnu par les navigateurs.

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
