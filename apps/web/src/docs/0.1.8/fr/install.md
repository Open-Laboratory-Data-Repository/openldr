# Installation

Installez OpenLDR sur l'hôte choisi. Ce parcours utilise la base analytique PostgreSQL fournie et une adresse locale. Les données d'exemple ne sont pas nécessaires.

<!-- install-platform -->

Choisissez ci-dessus la plateforme de **l'ordinateur qui héberge OpenLDR**. Elle peut différer de celle de l'appareil utilisé pour lire ce guide. Les commandes, chemins et illustrations changent ensemble.

Lisez d'abord les [Prérequis](/docs/requirements). Sur Windows Server, préparez l'environnement Linux décrit dans [Windows Server](/docs/windows-server), puis suivez les commandes Linux ici. Pour une installation existante, utilisez [Mises à niveau planifiées](/docs/upgrading).

Le dossier d'exemple est `~/Downloads/openldr_ce`. Choisissez un dossier accessible en écriture. Si vous choisissez un autre emplacement, adaptez la commande d'installation et les chemins suivants. Les images de terminal et de fichiers sont des illustrations. Sélectionnez une image pour l'agrandir.

Le texte bleu terminé par `$` ou `>` est l'**invite**. Le terminal l'affiche ; ne le saisissez pas. Saisissez la commande après l'invite et appuyez sur **Entrée**. Les lignes plus discrètes dessous sont la **sortie** du programme ; lisez-les sans les saisir. Par exemple, `docker --version` est une commande et `Docker version 29.5.2, build 79eb04c` est sa réponse. Les blocs à copier contiennent uniquement les commandes. Noms, chemins et versions peuvent différer. Certaines illustrations montrent les commandes sans leur sortie ; attendez la fin de chacune avant la suivante.

## Préparer l'hôte

Vous allez ouvrir un terminal, vérifier Docker et télécharger l'installateur. Exécutez les commandes sur l'ordinateur qui hébergera OpenLDR.

### 1. Ouvrir un terminal

<!-- install:unix -->
Sur Linux, ouvrez **Terminal** depuis le menu des applications. Sur macOS, ouvrez Spotlight, saisissez **Terminal** et ouvrez-le.
<!-- /install -->
<!-- install:windows -->
Ouvrez Démarrer, saisissez **PowerShell** et ouvrez **Windows PowerShell**. Gardez cette fenêtre ouverte pour les étapes suivantes.
<!-- /install -->

![Illustration d'un terminal prêt à recevoir une commande.](guide:install-terminal)

### 2. Vérifier Docker

Saisissez chaque commande et appuyez sur **Entrée** après chacune.

```
{{install:check}}
```

Les deux premières affichent les versions. `docker info` doit présenter une section **Server** sans erreur de connexion. Les versions et détails différeront de l'illustration. Si Docker est absent ou ne se connecte pas, corrigez ce problème avant de continuer.

![Illustration des vérifications Docker. Les versions et détails du serveur varieront.](guide:install-check)

### 3. Télécharger l'installateur

Copiez ces commandes dans le même terminal et appuyez sur **Entrée**.

```
{{install:download}}
```

<!-- install:unix -->
Ces commandes créent votre dossier Downloads si nécessaire, puis enregistrent `~/Downloads/openldr-install.sh`. Un téléchargement réussi avec ces options n'affiche normalement rien.
<!-- /install -->
<!-- install:windows -->
La commande conserve le script dans la variable `$installer`. Incluez `$installer` exactement comme indiqué. Cela fait partie de la commande PowerShell, pas de l'invite du terminal. Gardez cette fenêtre ouverte ; l'étape suivante utilise la même variable.
<!-- /install -->

![Illustration du téléchargement. Utilisez la commande copiable correspondante ci-dessus.](guide:install-download)

**Résultat attendu :** Le téléchargement se termine sans erreur. Rien n'est encore installé.

## Installer et retrouver les fichiers

La commande suivante crée le dossier d'installation, génère les mots de passe, télécharge les images des conteneurs et démarre les services. Le premier téléchargement peut prendre du temps.

### 1. Lancer l'installateur

Saisissez cette commande et appuyez sur **Entrée**.

```
{{install:run}}
```

L'option sans exemples est volontaire. Pour inclure le tableau de bord et les données d'exemple sur une nouvelle installation, retirez `--seedless` sur Linux/macOS ou `-Seedless` sur Windows. Vos propres données fonctionnent dans les deux cas.

![Illustration de la commande avec le dossier d'exemple et l'option sans données initiales.](guide:install-run)

### 2. Attendre les services et conserver le code de configuration

Attendez **OpenLDR is ready**. Conservez l'adresse et le code **Setup code**. Dans Studio, la page **Créer l'administrateur** demande ce code pour créer le premier administrateur. Le code est valable 30 minutes. Sous Linux et macOS, `./openldr auth setup-code` en affiche un nouveau. Sous Windows, utilisez `.\openldr.ps1 auth setup-code`. Une installation faite avec `--auth keycloak` affiche à la place un mot de passe administrateur Keycloak et les identifiants **App sign-in**.

Si le message indique **OpenLDR is starting**, suivez **Vérifier une installation encore en cours de démarrage** ci-dessous. Un code de sortie nul ne prouve pas que tous les services sont prêts.

![Illustration de la sortie finale. Le code de configuration est un espace réservé ; utilisez celui affiché sur votre hôte.](guide:install-ready)

### 3. Retrouver le dossier d'installation

Ouvrez `~/Downloads/openldr_ce` dans votre gestionnaire de fichiers. Il contient `config`, `data`, `docker-compose.yml` et le lanceur OpenLDR.

<!-- install:unix -->
Le lanceur est `openldr`.
<!-- /install -->
<!-- install:windows -->
Le lanceur est `openldr.ps1`.
<!-- /install -->

Le fichier caché `.env` contient des paramètres et mots de passe générés. Conservez-le avec l'installation et gardez-le privé.

![Illustration du gestionnaire de fichiers avec le dossier d'exemple et les fichiers générés.](guide:install-folder)

**Résultat attendu :** Les services sont prêts, vous avez le code de configuration et vous retrouvez les fichiers d'installation.

## Créer le premier administrateur

Les nouvelles installations utilisent l'authentification OpenLDR. Effectuez cette tâche une fois avec le **Setup code** affiché par l'installateur. Vous choisissez le nom et le mot de passe de l'administrateur. Ce parcours n'a pas de mot de passe `labadmin` par défaut. Les données de démonstration sont facultatives.

Avec `--auth keycloak` ou `-Auth keycloak`, suivez plutôt **Se connecter avec Keycloak** ci-dessous. Une mise à niveau conserve le mode d'authentification existant. Les captures montrent les libellés anglais.

### 1. Ouvrir Studio

Ouvrez l'adresse affichée après **OpenLDR is ready**, suivie de `/studio/`. Si le site public apparaît, sélectionnez **Studio**. Depuis un autre appareil, utilisez le nom d'hôte configuré. `localhost` désigne l'appareil qui ouvre le navigateur.

La configuration locale utilise un certificat auto-signé. Vérifiez l'adresse de votre installation avant de passer un avertissement de certificat. La capture montre Studio après cette vérification.

![Une installation neuve ouvre Create the administrator.](/docs-images/operator/local-setup-open.png)

### 2. Saisir votre code de configuration

Collez le code de l'installateur dans **Setup code**. Il dure 30 minutes. Un nouveau code remplace le précédent. S'il a expiré ou n'était pas encore disponible, utilisez la commande serveur décrite dans [Créer le premier administrateur avec un code](/docs/auth-providers), puis revenez ici. Utilisez votre propre code.

![Collez le code de votre installation dans Setup code.](/docs-images/operator/local-setup-code.png)

### 3. Choisir le nom de l'administrateur

Saisissez le nom souhaité dans **Username**. Utilisez 3 à 64 lettres, chiffres, points, tirets ou traits de soulignement. L'exemple utilise `guide.admin` ; choisissez votre propre nom.

![Choisissez le nom du premier administrateur.](/docs-images/operator/local-setup-username.png)

### 4. Choisir et répéter un mot de passe

Saisissez un mot de passe privé dans **Password**, puis répétez-le dans **Repeat password**. Utilisez 10 à 128 caractères. Il ne peut pas être le nom d'utilisateur. L'exemple masqué n'est pas à recopier.

![Saisissez le même mot de passe dans Password et Repeat password.](/docs-images/operator/local-setup-password.png)

### 5. Créer l'administrateur

Sélectionnez **Create the administrator**. En cas d'erreur, corrigez la valeur indiquée et recommencez. Après réussite, Studio vous connecte comme premier administrateur. Cette page de configuration ne revient plus.

![Create the administrator enregistre ce premier compte.](/docs-images/operator/local-setup-submit.png)

### 6. Ouvrir les guides intégrés

Sélectionnez **Docs** dans le menu principal à gauche. Sur un téléphone, ouvrez d'abord ce menu. **Start here** apparaît dans la documentation.

![Sélectionnez Docs après avoir créé votre compte.](/docs-images/operator/local-open-docs.png)

**Résultat attendu :** Le premier administrateur existe, Studio est ouvert et les guides sont accessibles. Sans démonstration, certaines pages de données peuvent être vides. La documentation reste accessible.

## Utiliser un compte existant ou temporaire

Suivez cette tâche après la création du premier administrateur. Utilisez votre propre compte. Si un administrateur vous a donné un mot de passe temporaire, les étapes 4 à 6 le remplacent. Sinon, Studio s'ouvre après l'étape 3 et vous pouvez ignorer la suite.

### 1. Ouvrir l'adresse Studio

Ouvrez l'adresse `/studio/` de votre installation. La page affiche maintenant **Sign in to OpenLDR**.

![La page de connexion apparaît après la création du premier administrateur.](/docs-images/operator/local-login-open.png)

### 2. Saisir vos identifiants

Saisissez votre nom ou adresse e-mail dans **Username or email**, puis votre mot de passe dans **Password**. Pour un compte nouveau ou réinitialisé, utilisez le mot de passe temporaire reçu. `guide.user` désigne ici un compte de test isolé.

![Saisissez votre nom et votre mot de passe dans le formulaire local.](/docs-images/operator/local-login-credentials.png)

### 3. Sélectionner Sign in

Sélectionnez **Sign in** sous les champs. Un compte normal ouvre Studio. Un mot de passe temporaire ouvre **Choose a new password**.

![Sign in se trouve sous les champs des identifiants.](/docs-images/operator/local-login-submit.png)

### 4. Répéter le mot de passe temporaire

Sur **Choose a new password**, saisissez le mot de passe utilisé à la connexion dans **Current password**. Cette étape s'applique seulement si Studio exige un changement.

![Current password est le mot de passe temporaire utilisé à la connexion.](/docs-images/operator/local-change-current.png)

### 5. Choisir et répéter un nouveau mot de passe

Saisissez votre nouveau mot de passe dans **New password**, puis dans **Repeat password**. Il doit comporter 10 à 128 caractères. Il ne peut être ni votre nom ni le mot de passe temporaire.

![Répétez le nouveau mot de passe dans les deux champs.](/docs-images/operator/local-change-new.png)

### 6. Enregistrer le nouveau mot de passe

Sélectionnez **Change password**. Studio s'ouvre après réussite. Utilisez le nouveau mot de passe aux prochaines connexions. Si Studio revient au formulaire de connexion, connectez-vous avec ce nouveau mot de passe.

![Change password enregistre le nouveau mot de passe et ouvre Studio.](/docs-images/operator/local-change-submit.png)

**Résultat attendu :** Studio s'ouvre avec votre compte. Sélectionnez **Docs** pour lire les guides intégrés. Les données de démonstration restent facultatives.

## Se connecter avec Keycloak

Utilisez les identifiants **App sign-in** affichés par votre installateur. Cette tâche remplace le mot de passe temporaire du nouveau compte Keycloak `labadmin`, puis ouvre les guides intégrés. Les données de démonstration sont facultatives. Si vous avez déjà changé ce mot de passe, utilisez votre mot de passe actuel et ignorez les étapes de changement.

### 1. Ouvrir Studio à l'adresse de votre installation

Ouvrez l'adresse affichée après **OpenLDR is ready**. Sur un autre ordinateur ou téléphone, utilisez le nom d'hôte configuré à l'installation. `localhost` désigne toujours l'appareil qui ouvre le navigateur. Si le site public apparaît, sélectionnez **Studio**.

La configuration locale utilise un certificat auto-signé. Vérifiez l'adresse de votre propre installation avant de passer un avertissement de certificat. Les boutons varient selon le navigateur ; l'image ci-dessous montre la page de connexion après cette vérification.

![La page de connexion OpenLDR après ouverture de Studio.](/docs-images/operator/install-login-open.png)

### 2. Saisir les identifiants de l'application

Saisissez `labadmin` dans **Username or email**. Dans **Password**, saisissez le mot de passe généré sur la ligne **App sign-in** de l'installateur. Le mot de passe administrateur Keycloak sert à gérer l'authentification. La capture utilise un compte jetable ; utilisez votre propre mot de passe généré.

![Saisissez labadmin et votre mot de passe App sign-in dans ces deux champs.](/docs-images/operator/install-login-credentials.png)

### 3. Sélectionner Sign In

Sélectionnez **Sign In** sous le champ du mot de passe. Un nouveau compte Keycloak `labadmin` ouvre **Update password**, car son premier mot de passe est temporaire.

![Sign In se trouve sous le champ du mot de passe.](/docs-images/operator/install-login-submit.png)

### 4. Choisir et confirmer un nouveau mot de passe

Saisissez un nouveau mot de passe privé dans **New Password**. Répétez-le dans **Confirm password**. Respectez les exigences affichées par votre installation. La capture contient un exemple masqué, pas un mot de passe à réutiliser.

![Saisissez le même nouveau mot de passe dans les deux champs.](/docs-images/operator/install-password-fields.png)

### 5. Valider le changement de mot de passe

Sélectionnez **Submit** sous les champs. Si une erreur apparaît, corrigez les champs et recommencez. Après un changement réussi, la connexion revient à Studio. Utilisez votre nouveau mot de passe aux connexions suivantes.

![Submit enregistre le nouveau mot de passe et poursuit la connexion.](/docs-images/operator/install-password-submit.png)

### 6. Ouvrir la documentation dans Studio

Une fois Studio ouvert, sélectionnez **Docs** dans le menu principal à gauche. Sur un téléphone, ouvrez d'abord le menu principal. Lisez **Start here**, puis le guide de votre prochaine tâche. Ces captures montrent les libellés anglais.

![Docs se trouve dans le menu principal. Start here apparaît dans la documentation.](/docs-images/operator/install-open-docs.png)

**Résultat attendu :** Le mot de passe temporaire est remplacé, Studio est ouvert et les guides intégrés sont accessibles. Sans données de démonstration, certaines pages peuvent être vides. Cela n'empêche pas d'ouvrir la documentation.

## Vérifier une installation encore en cours de démarrage

Utilisez cette tâche si l'installateur indique un service encore en démarrage. Exécutez les commandes sur l'hôte OpenLDR. Ne supprimez pas la base pour diagnostiquer un problème de démarrage.

### 1. Lire l'état des conteneurs

```
{{install:status}}
```

La colonne STATUS indique les services actifs, sains ou en redémarrage. Consultez votre résultat réel, pas un exemple de réussite.

![Terminal illustré: Lire l'état des conteneurs.](guide:install-status)

### 2. Lire les journaux récents et résoudre l'erreur

```
{{install:logs}}
```

Lisez l'erreur avant de réessayer. Corrigez sa cause, puis répétez la vérification d'état. Un code de sortie réussi ne prouve pas la disponibilité.

| Erreur | Action suivante |
| --- | --- |
| Docker absent | Installez-le selon [Prérequis](/docs/requirements), puis répétez les vérifications Docker. |
| Service Docker inaccessible | Démarrez Docker Desktop sous Windows/macOS ou le service Docker sous Linux, puis répétez `docker info`. |
| Module Compose absent | Installez le module ou mettez Docker Desktop à jour, puis répétez `docker compose version`. |
| Port 80 ou 443 occupé | Identifiez le service. Pour une nouvelle installation, choisissez des ports libres avec `--http-port 8080 --https-port 8443` ou `-HttpPort 8080 -HttpsPort 8443`. Ajoutez `:8443` à l'URL. |
| Téléchargement échoué | Vérifiez le réseau et répétez le téléchargement. N'exécutez pas un script vide ou incomplet. |

![Terminal illustré: Lire les journaux récents et résoudre l'erreur.](guide:install-logs)

## Choisir une adresse pour les autres ordinateurs

Choisissez cette adresse avant la première installation. Elle doit atteindre l'hôte depuis les postes ou téléphones prévus. Elle peut être privée ou Tailscale. Remplacez `openldr.example.org` aux deux étapes. Configurez DNS, routage et pare-feu pour votre réseau.

### 1. Installer avec le nom choisi

```
{{install:remote}}
```

L'installateur utilise ce nom pour la passerelle et les redirections de connexion. L'exemple utilise un certificat auto-signé et exclut les données de démonstration. Utilisez cette commande à la place de la commande locale précédente.

![Terminal illustré: Installer avec le nom choisi.](guide:install-remote)

### 2. Vérifier depuis un autre ordinateur

```
{{install:remote-check}}
```

Exécutez depuis un autre poste du réseau prévu. Sous Linux/macOS, la commande vérifie l'API distante et utilise `-k` uniquement pour le certificat auto-signé. Sous Windows, `TcpTestSucceeded: True` prouve l'accès TCP au port 443. Aucun de ces tests ne prouve la connexion Studio. Ouvrez aussi l'adresse HTTPS dans un navigateur. Adaptez le test et l'URL si vous avez choisi un autre port.

![Terminal illustré: Vérifier depuis un autre ordinateur.](guide:install-remote-check)

**Résultat attendu :** Un autre poste atteint la passerelle à l'adresse choisie. Si l'installation utilisait déjà un autre nom, lisez l'avertissement de changement d'hôte. Les clients Keycloak existants conservent leurs anciennes redirections. Modifier l'URL du navigateur ne modifie pas ces paramètres.

## Utiliser un domaine public avec un certificat reconnu

Cette tâche facultative concerne un **hôte Linux**. Pointez d'abord votre domaine vers l'hôte et ouvrez les ports TCP 80 et 443. Remplacez `openldr.example.org` et `you@example.org` par vos valeurs. Utilisez l'installateur téléchargé plus haut.

### 1. Lancer avec le domaine et l'adresse e-mail

```
{{install:tls}}
```


![Illustration de la commande Linux pour un domaine public. Remplacez le domaine et l'e-mail.](guide:install-tls)

### 2. Vérifier le certificat

Recherchez **Trusted cert installed**. En cas d'échec, le certificat auto-signé reste en place. Corrigez le DNS ou les ports et relancez avec le même dossier, domaine et e-mail.

![Illustration du message de réussite pour le domaine public d'exemple.](guide:install-tls-ready)

### 3. Vérifier le renouvellement

Avec root, l'installateur crée `/etc/cron.d/openldr-cert`. Sans root, il affiche une entrée cron complète à ajouter avec `crontab -e`. Copiez celle de votre hôte ; elle contient le chemin réel d'installation. Enregistrez et quittez l'éditeur à l'aide de ses commandes affichées.

![Illustration de l'ouverture du planning cron. Utilisez l'entrée de renouvellement affichée par votre installateur.](guide:install-renewal)

**Résultat attendu :** L'adresse publique sert le certificat reconnu et le renouvellement est configuré. Ne supposez pas qu'il est automatique si l'installateur vous demande d'ajouter l'entrée.

Windows et macOS peuvent utiliser leur propre certificat ou un proxy inverse existant. Voir la tâche suivante.

## Utiliser votre propre certificat

Utilisez cette tâche si vous avez déjà un certificat et sa clé privée. Remplacez le domaine d'exemple par l'adresse de votre hôte. Les fichiers doivent s'appeler `fullchain.pem` et `privkey.pem` dans le dossier généré.

### 1. Créer la configuration sans démarrer

```
{{install:scaffold}}
```

![Illustration de la création des fichiers sans démarrer les services.](guide:install-scaffold)

### 2. Copier le certificat et la clé

Remplacez les chemins sources par ceux de vos fichiers.

```
{{install:certificates}}
```

![Illustration des commandes de copie des certificats. Adaptez les chemins sources.](guide:install-certificates)

### 3. Démarrer les services et vérifier leur état

```
{{install:start}}
```

![Illustration des commandes de démarrage et de vérification des services.](guide:install-start)

### 4. Redémarrer la passerelle lors du remplacement sur une installation existante

```
{{install:restart-gateway}}
```

Ignorez cette étape pour une nouvelle installation démarrée ci-dessus. Sur une installation existante, remplacez certificat et clé, puis redémarrez sa passerelle depuis ce même dossier.

![Terminal illustré: Redémarrer la passerelle lors du remplacement sur une installation existante.](guide:install-restart-gateway)

### 5. Vérifier le certificat depuis le poste client

```
{{install:certificate-check}}
```

Remplacez le nom d'exemple par celui du certificat. Le poste doit faire confiance à son émetteur. Résolvez toute erreur de confiance ou de nom sans la masquer avec `-k`. Ce test vérifie HTTPS, pas la connexion Studio.

![Terminal illustré: Vérifier le certificat depuis le poste client.](guide:install-certificate-check)

**Résultat attendu :** L'adresse configurée répond en HTTPS avec votre certificat. Continuez avec le parcours de connexion correspondant ci-dessus.

## Choisir une base analytique

Choisissez une base analytique avant la première installation. Le parcours normal utilise PostgreSQL fourni. Les variantes ci-dessous remplacent ce choix ; ne les lancez pas l'une après l'autre. Un `.env` existant conserve sa configuration. Relancer l'installateur avec d'autres options n'est pas une migration. Les exemples gardent les données de démonstration facultatives avec `--seedless` ou `-Seedless`.

## Essayer SQL Server pour évaluation

OpenLDR conserve les données opérationnelles dans PostgreSQL interne et écrit les données analytiques dans la base choisie. Cette tâche ajoute un conteneur SQL Server 2022 Developer pour évaluation uniquement. La licence Developer ne permet pas la production. Voir les [éditions Microsoft](https://www.microsoft.com/en-us/sql-server/sql-server-downloads).

### 1. Installer la variante SQL Server d'évaluation

```
{{install:mssql-demo}}
```

Utilisez l'installateur déjà téléchargé. Il génère le mot de passe et crée la base cible de démonstration.

![Terminal illustré: Installer la variante SQL Server d'évaluation.](guide:install-mssql-demo)

### 2. Vérifier les conteneurs et l'adaptateur choisi

```
{{install:mssql-status}}
```

Attendez un service `mssql` supplémentaire et la valeur d'adaptateur `mssql`. Consultez l'état réel. Pour les journaux, gardez les deux fichiers `-f` et remplacez `ps` par `logs --tail 100`.

![Terminal illustré: Vérifier les conteneurs et l'adaptateur choisi.](guide:install-mssql-status)

### 3. Conserver l'identifiant de base généré

Lisez la ligne du mot de passe MSSQL de démonstration dans votre sortie réelle. L'image utilise un texte de remplacement. Ce mot de passe SA est distinct de la connexion Studio. Gardez-le privé.

![Terminal illustré: Conserver l'identifiant de base généré.](guide:install-mssql-ready)

## Connecter votre base analytique SQL Server

Utilisez SQL Server 2017, 2019 ou 2022 auto-hébergé. Les versions antérieures et les bases cloud gérées comme Azure SQL ou AWS RDS ne sont pas prises en charge. Base cible et compte doivent déjà exister et être accessibles depuis Docker. Cette tâche ne crée pas votre base externe.

### 1. Installer avec vos paramètres de connexion

```
{{install:mssql-existing}}
```

Remplacez `sql.internal`, `openldr_target`, `openldr` et `REPLACE_WITH_DATABASE_PASSWORD` par votre hôte, base, compte et mot de passe. L'installateur écrit ces paramètres dans `.env`. Évitez `#`, espaces et guillemets dans ce mot de passe. Les options sont listées plus bas. Ne partagez pas de capture contenant un vrai mot de passe.

![Terminal illustré: Installer avec vos paramètres de connexion.](guide:install-mssql-existing)

### 2. Vérifier l'adaptateur et les services

```
{{install:target-status}}
```

Attendez la valeur `mssql`. Consultez les journaux si l'API n'est pas prête. Une valeur d'adaptateur confirme la configuration, pas un import réussi. Ces paramètres correspondent à `TARGET_STORE_ADAPTER=mssql` et `MSSQL_*` dans les [variables d'environnement](/docs/environment).

![Terminal illustré: Vérifier l'adaptateur et les services.](guide:install-target-status)

## Essayer MySQL pour évaluation

Cette tâche facultative ajoute un conteneur MySQL 8.4. PostgreSQL interne reste nécessaire. Le conteneur MySQL fourni sert à l'évaluation, pas à la production.

### 1. Installer la variante MySQL d'évaluation

```
{{install:mysql-demo}}
```

Utilisez l'installateur déjà téléchargé. Il génère le mot de passe et crée la base cible de démonstration.

![Terminal illustré: Installer la variante MySQL d'évaluation.](guide:install-mysql-demo)

### 2. Vérifier les conteneurs et l'adaptateur choisi

```
{{install:mysql-status}}
```

Attendez un service `mysql` supplémentaire et l'adaptateur `mysql`. Consultez l'état réel. Pour les journaux, gardez les deux fichiers `-f` et remplacez `ps` par `logs --tail 100`.

![Terminal illustré: Vérifier les conteneurs et l'adaptateur choisi.](guide:install-mysql-status)

### 3. Conserver l'identifiant de base généré

Lisez le mot de passe root MySQL de démonstration dans votre sortie réelle. L'image utilise un texte de remplacement. Ce mot de passe est distinct de la connexion Studio. Gardez-le privé.

![Terminal illustré: Conserver l'identifiant de base généré.](guide:install-mysql-ready)

## Connecter votre base analytique MySQL ou MariaDB

Utilisez MySQL 8.4 LTS ou MariaDB 11.4 LTS auto-hébergé. Azure Database for MySQL et AWS RDS ne sont pas pris en charge. La base cible et son compte doivent déjà exister et être accessibles depuis Docker. PostgreSQL interne reste nécessaire.

### 1. Installer avec vos paramètres de connexion

```
{{install:mysql-existing}}
```

Remplacez `mysql.internal`, `openldr_target`, `openldr` et `REPLACE_WITH_DATABASE_PASSWORD`. Évitez `#`, espaces et guillemets dans le mot de passe écrit dans `.env`. Voir les options ci-dessous. Ne partagez pas de vrai mot de passe dans une capture.

![Terminal illustré: Installer avec vos paramètres de connexion.](guide:install-mysql-existing)

### 2. Vérifier l'adaptateur et les services

```
{{install:target-status}}
```

Attendez `mysql`, même pour MariaDB. Consultez l'état réel et les journaux. Cela confirme la configuration, pas un import réussi. Ces paramètres correspondent à `TARGET_STORE_ADAPTER=mysql` et `MYSQL_*` dans les [variables d'environnement](/docs/environment).

![Terminal illustré: Vérifier l'adaptateur et les services.](guide:install-target-status)

## Options de l'installateur

| Linux / macOS | Windows | Par défaut | Rôle |
| --- | --- | --- | --- |
| `--http-port <n>` / `--https-port <n>` | `-HttpPort / -HttpsPort` | `80` / `443` | Ports de la passerelle. Windows : `-HttpPort` / `-HttpsPort`. |
| `--ready-timeout <seconds>` | `-ReadyTimeout` | `180` | Attente des services. Windows : `-ReadyTimeout`. Zéro désactive cette attente. |
| `--require-ready` | Indisponible | désactivé | Linux/macOS uniquement. Échec si les services ne sont pas prêts à temps. Incompatible avec `--no-start` ou un délai nul. |
| `--dir <path>` | `-Dir` | `./openldr` | Dossier où créer la pile. |
| `--version <tag>` | `-Version` | `latest` | Étiquette d'image à télécharger et exécuter. |
| `--server-name <host>` | `-ServerName` | `localhost` | Nom d'hôte ou domaine public de ce déploiement. |
| `--letsencrypt <email>` | Non automatisé | aucune | Émet un certificat Let's Encrypt de confiance pour `--server-name`. |
| `--staging` | Indisponible | désactivé | Utilise l'autorité de certification de test de Let's Encrypt (pour les essais, évite les limites de débit). |
| `--no-start` | `-NoStart` | désactivé | Prépare et configure seulement, sans démarrer la pile. |
| `--no-pull` | `-NoPull` | désactivé | Ne télécharge pas les images (utilise celles déjà présentes). |
| `--seedless` | `-Seedless` | désactivé (avec données d'exemple) | Premier démarrage vide : sans le tableau de bord d'exemple ni les données de démonstration (installés par défaut). Windows : `-Seedless`. Nouvelle installation uniquement. |
| `--auth <mode>` | `-Auth` | demande, sinon `local` | Connexion d'une nouvelle installation : `local` ou `keycloak`. `local` garde les comptes propres à OpenLDR et ne lance pas Keycloak. Sans l'option, l'installateur pose la question s'il a un terminal, et prend `local` sinon. Une nouvelle exécution garde le mode choisi à l'installation. Windows : `-Auth`. |
| `--target-db <db>` | `-TargetDb` | `postgres` | Base analytique externe : `postgres`, `mssql` ou `mysql`. |
| `--mssql-demo` | `-MssqlDemo` | désactivé | Ajoute un conteneur SQL Server 2022 (évaluation uniquement). Implique `--target-db mssql`. |
| `--mssql-host <host>` | `-MssqlHost` | aucune | Hôte de votre SQL Server (obligatoire pour `--target-db mssql` sans `--mssql-demo`). |
| `--mssql-port <n>` | `-MssqlPort` | `1433` | Port de votre SQL Server. |
| `--mssql-database <name>` | `-MssqlDatabase` | `openldr_target` | Nom de la base cible (doit déjà exister sur votre propre serveur). |
| `--mssql-user <user>` | `-MssqlUser` | aucune | Identifiant de connexion de votre SQL Server. |
| `--mssql-password <pw>` | `-MssqlPassword` | aucune | Mot de passe de votre SQL Server (évitez `#`, les espaces et les guillemets). |
| `--mssql-encrypt <bool>` | `-MssqlEncrypt` | `false` | Chiffre la connexion SQL Server. |
| `--mssql-trust-cert <bool>` | `-MssqlTrustCert` | `true` | Fait confiance au certificat TLS du serveur (auto-signé, sur site). |
| `--mysql-demo` | `-MysqlDemo` | désactivé | Ajoute un conteneur MySQL 8.4 (évaluation uniquement). Implique `--target-db mysql`. |
| `--mysql-host <host>` | `-MysqlHost` | aucune | Hôte de votre MySQL/MariaDB (obligatoire pour `--target-db mysql` sans `--mysql-demo`). |
| `--mysql-port <n>` | `-MysqlPort` | `3306` | Port de votre MySQL/MariaDB. |
| `--mysql-database <name>` | `-MysqlDatabase` | `openldr_target` | Nom de la base cible (doit déjà exister sur votre propre serveur). |
| `--mysql-user <user>` | `-MysqlUser` | aucune | Identifiant de connexion de votre MySQL/MariaDB. |
| `--mysql-password <pw>` | `-MysqlPassword` | aucune | Mot de passe de votre MySQL/MariaDB (évitez `#`, les espaces et les guillemets). |
| `--mysql-ssl <bool>` | `-MysqlSsl` | `false` | Active SSL/TLS pour la connexion MySQL/MariaDB. |

## Guides associés

- [Prérequis](/docs/requirements)
- [Référence CLI](/docs/cli)
- [Variables d'environnement](/docs/environment)
- [Développement depuis le code source](/docs/development)
- [Mises à niveau planifiées](/docs/upgrading)
