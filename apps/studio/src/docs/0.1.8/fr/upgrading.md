# Mises à niveau planifiées

Prévoyez une interruption pour mettre l'application à niveau. Les changements de schéma peuvent rendre dangereuse l'utilisation simultanée d'anciens et de nouveaux services d'écriture. Cette procédure conserve les versions des moteurs de base et de stockage. Leur mise à niveau exige une procédure testée distincte.

Utilisez le vrai répertoire du projet Compose installé. Gardez les mêmes nom de projet, fichier d'environnement et surcharges pour chaque commande. Un opérateur doit pouvoir restaurer tout le déploiement.

Les images de terminal sont des illustrations indiquées comme telles. Remplacez les paramètres fictifs par ceux du déploiement. Elles ne prétendent pas montrer une mise à niveau en production. La sauvegarde et la restauration ont été répétées séparément sur des destinations Postgres et S3 temporaires.

Conservez ces instructions hors de Studio avant l'interruption. Convenez de la mise en attente et des nouvelles tentatives des émetteurs pendant l'arrêt.

## Noter la version actuelle et préparer la cible

Lisez les notes de version et les exigences de migration de la cible avant d'arrêter l'application.

### 1. Ouvrir General

Ouvrez **Settings**, puis **General**.

![Ouvrez Settings, puis General pour lire la version en cours.](upgrading-guide-general.png)

### 2. Noter la version en cours

Lisez About. Notez la version actuelle de l'application et l'environnement de déploiement.

![Notez la version en cours avant de choisir la cible.](upgrading-guide-version.png)

### 3. Conserver l'inventaire du déploiement actuel

Dans le répertoire du déploiement, enregistrez `docker compose images`. Conservez les étiquettes et identifiants des images précédentes, les fichiers Compose, les surcharges et le fichier .env privé. Gardez les anciennes images disponibles.

![Illustration. Notez précisément les images et la configuration actuelles.](upgrading-guide-inventory.png)

### 4. Fixer la version choisie de l'application

Définissez OPENLDR_VERSION avec l'étiquette approuvée dans .env. Téléchargez uniquement les images applicatives requises avant l'interruption. Conservez les versions de PostgreSQL, de l'identité et du stockage objet.

![Illustration. Fixez la version approuvée avant l'interruption.](upgrading-guide-pin.png)

**Résultat attendu :** l'image applicative cible et l'inventaire complet de la version précédente sont disponibles. Ne téléchargez pas aveuglément toutes les images d'infrastructure.

## Arrêter les écritures et vérifier leur achèvement

Suspendez les émetteurs webhook, les pairs de synchronisation, les écritures planifiées et les modifications des opérateurs. Bloquez le trafic entrant. Incluez les répliques API et tâches CLI hors de ce projet Compose.

### 1. Arrêter tous les services applicatifs d'écriture

Arrêtez toutes les répliques API avec un délai suffisant pour leurs travaux les plus longs. L'illustration prévoit 300 secondes. Vérifiez les journaux d'arrêt et l'état des conteneurs. Un arrêt forcé, un délai expiré ou un code 137 ne prouve pas la fin des travaux.

![Illustration. Suspendez les écritures externes, arrêtez toutes les répliques API et vérifiez l'arrêt.](upgrading-guide-drain.png)

### 2. Arrêter les écritures d'identité et de stockage

Après l'API, arrêtez Keycloak et le stockage objet. Arrêtez tous les autres services écrivant dans ces stockages. Gardez PostgreSQL disponible pour les sauvegardes logiques. Maintenez les écritures arrêtées pendant les vérifications de sauvegarde et la migration.

![Illustration. Arrêtez l'identité et le stockage objet après l'API.](upgrading-guide-stores.png)

**Résultat attendu :** la sauvegarde peut capturer un état commun sans écritures. Notez les reçus webhook en attente et examinez les travaux interrompus avant toute reprise ultérieure.

## Sauvegarder et prouver la restauration

Stockez les sauvegardes en privé, hors des volumes du déploiement. Un fichier de sauvegarde ou une API saine ne prouve pas à lui seul la capacité de restauration.

### 1. Sauvegarder chaque base

Identifiez les noms et comptes réels des bases. Utilisez pg_dump -Fc avec un fichier de sortie dans le conteneur Postgres, puis Compose cp vers un répertoire privé déjà créé. Répétez pour les bases interne, cible et d'identité. Utilisez les outils natifs pour les stockages SQL Server ou MySQL externes.

![Illustration. Sauvegardez chaque base pendant la même période sans écritures.](upgrading-guide-database-backup.png)

### 2. Conserver les rôles, objets et configurations

Conservez séparément les rôles PostgreSQL. Sauvegardez chaque compartiment d'objets ou volume de stockage arrêté. Préservez .env, fichiers Compose, configuration montée, clés de chiffrement et de signature, certificats, fichiers locaux et inventaire des images de la même période sans écritures.

![Illustration. Conservez les rôles et toute la configuration en privé.](upgrading-guide-roles.png)

### 3. Restaurer vers des destinations isolées

Restaurez les rôles et bases en traitant les erreurs comme des échecs. Restaurez les objets et comparez leurs sommes de contrôle. Comparez les enregistrements sauvegardés et des comptages représentatifs. Utilisez les clés conservées pour déchiffrer un secret enregistré sans l'afficher. Vérifiez que les enregistrements restaurés lisent les objets restaurés.

![Illustration. Restaurez vers des destinations distinctes et isolées.](upgrading-guide-restore.png)

**Résultat attendu :** poursuivez seulement si les bases, objets, configuration, clés et images correspondants peuvent être restaurés. Les restaurations isolées ne doivent contacter aucun émetteur ou destinataire réel.

## Migrer avant de démarrer la nouvelle API

Gardez les anciens services d'écriture arrêtés. Vérifiez que la commande ponctuelle utilise la nouvelle image applicative fixée.

### 1. Exécuter la migration de la nouvelle image

Utilisez `docker compose run --rm --no-deps api node /app/cli/dist/index.js db migrate`. Exigez un code 0 et la réussite des migrations interne et cible. Cette commande remplace celle de l'API et ne sert aucune requête.

![Illustration. Exécutez la CLI de la nouvelle image fixée avant son API.](upgrading-guide-migrate.png)

**Résultat attendu :** arrêtez-vous si la migration échoue. Certaines modifications peuvent déjà être enregistrées. Diagnostiquez ou restaurez l'instantané correspondant. Ne démarrez pas les anciens exécutables sur un schéma partiellement migré.

## Installations qui utilisent Keycloak

Faites-le avant de démarrer le nouveau fichier compose. Si le service `keycloak` du `docker-compose.yml` vers lequel vous passez a une ligne `profiles`, ajoutez cette ligne au fichier `.env` de l'installation :

```sh
COMPOSE_PROFILES=keycloak
```

Sans elle, Keycloak ne démarre pas et personne ne peut se connecter. Si `.env` a déjà une ligne `COMPOSE_PROFILES`, ajoutez-y `keycloak` après une virgule. Relancer l'installateur en une ligne ajoute la ligne pour vous. Une installation en connexion locale n'a rien à faire ici.

## Vérifier la nouvelle version avant la reprise du trafic

Démarrez les services dans l'ordre des dépendances. Gardez le trafic entrant et les émetteurs suspendus jusqu'à la réussite des vérifications.

### 1. Démarrer les services applicatifs fixés

Démarrez d'abord le stockage et l'identité existants, puis les nouveaux services applicatifs fixés. Conservez les versions des moteurs d'infrastructure.

![Illustration. Démarrez le stockage et l'identité, puis les services applicatifs fixés.](upgrading-guide-start.png)

### 2. Vérifier l'état et les travaux enregistrés

Vérifiez l'état des conteneurs, la santé de l'application et les journaux. Lisez des données représentatives et des fichiers importés. Contrôlez les reçus de workflow et les exécutions liées avant de rouvrir le trafic. Reprenez les envois seulement après ces contrôles.

![Illustration. Vérifiez la nouvelle application avant de reprendre le trafic.](upgrading-guide-verify.png)

### 3. Remplacer le script openldr

Lancez ceci dans le dossier d'installation une fois les images passées à la nouvelle version. Cela réécrit seulement le script `openldr`, et `openldr.ps1` là où l'installateur en écrit un. Rien d'autre ne change. Sans cela, l'ancien script n'envoie aucune connexion, et chaque commande qui passe par l'application répond `Sign in first: openldr login, or set OPENLDR_KEY.`

```sh
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash -s -- --wrapper-only --dir .
```

Sous Windows, dans PowerShell :

```powershell
$installer = Invoke-RestMethod https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1
& ([scriptblock]::Create($installer)) -WrapperOnly -Dir C:\openldr_ce
```

Connectez-vous ensuite avec `./openldr login`, ou définissez `OPENLDR_KEY`. Sous Windows, `.\openldr.ps1` se connecte uniquement avec une clé, donc définissez `OPENLDR_KEY`. Aucune des deux commandes n'a été lancée sur une vraie installation. La forme PowerShell n'a pas été lancée sous Windows.

**Résultat attendu :** la version est contrôlée avant l'arrivée de nouveaux travaux. Gardez les sauvegardes vérifiées et les anciennes images selon la politique de conservation du site.

## Résoudre les problèmes de requêtes interrompues

Un HTTP 202 signifie qu'un webhook a été accepté. Il ne prouve pas son achèvement. Interrogez les reçus en attente et inspectez les exécutions liées. Examinez les effets externes partiels avant de remplacer le travail.

Pour retenter la même requête logique, conservez son Idempotency-Key et son entrée d'origine. Ne rejouez pas toutes les requêtes interrompues avec de nouvelles clés. Si le trafic a repris avant une restauration, rapprochez les livraisons et effets externes du point restauré.

## Délai d'arrêt et installations existantes

Les nouveaux fichiers Compose de l'installateur définissent `stop_grace_period: ${OPENLDR_STOP_GRACE_PERIOD:-5m}` sous services.api. Ajoutez cette propriété à un ancien fichier Compose local si elle manque. Prévoyez le temps des travaux les plus longs. Un délai d'arrêt explicite prévaut.

OpenLDR attend les requêtes et traitements actifs pendant l'arrêt. Un traitement qui ne revient jamais peut dépasser le délai. Les journaux et l'état des processus doivent établir si les travaux se sont achevés. N'exécutez jamais `docker compose down -v` pendant une mise à niveau.

Si un ancien entrepôt ne contient pas les statuts de résultat, les notes de version peuvent exiger `openldr db reproject --force` après la mise à niveau. Cela reconstruit les projections depuis les ressources canoniques. La commande passe par l'application en marche, donc connectez-vous d'abord avec un compte qui a la permission `settings.danger_zone`. Faites-le uniquement si la version cible l'exige.

## Anciens déploiements MinIO passant à Garage

Une installation antérieure à 0.1.11 exige la migration de stockage correspondante avant le démarrage de la nouvelle configuration Compose. Une nouvelle installation n'en a pas besoin. Conservez en privé l'ancienne image MinIO, le volume, l'adresse et les identifiants avant toute modification.

Gardez l'ancien service MinIO disponible avec Garage pendant la copie. Son environnement doit garder les anciennes valeurs littérales des identifiants. Les nouvelles variables S3 appartiennent à Garage. Générez la clé d'accès, le secret, le secret RPC et le jeton administrateur Garage selon les instructions de version. Ne les affichez pas dans les captures.

Utilisez la commande CLI de copie du stockage avec l'ancienne adresse, la clé, le secret et le compartiment. Elle copie vers la cible actuellement configurée. Lisez les nombres d'objets et d'octets et exigez son contrôle d'achèvement. Elle ignore un objet existant de même taille, sans prouver l'égalité du contenu. Comparez aussi des sommes de contrôle représentatives et ouvrez des fichiers importés.

Gardez l'ancien volume jusqu'à la vérification des fichiers copiés et de l'application. Retirer un ancien volume est une décision destructive distincte. Les options de copie peuvent exposer les identifiants source dans l'historique shell et les arguments des processus. Utilisez une session d'administration privée.

Suivez les instructions de migration du stockage pour les versions source et cible exactes. La répétition n'a pas migré une installation MinIO historique. Son exercice S3 distinct a comparé les sommes de contrôle complètes entre deux compartiments temporaires.

## Ce que la répétition isolée a établi

La répétition a arrêté uniquement l'API de l'installation de test isolée. Elle a sauvegardé et restauré les deux bases Postgres temporaires vers des destinations distinctes. Le nombre canonique restauré correspondait à 27 enregistrements, et le nombre de demandes cible à 1. Huit objets ont été restaurés dans un compartiment distinct avec des sommes SHA-256 identiques.

Un secret de connecteur enregistré a été déchiffré avec la même valeur grâce à la clé conservée. Aucun secret n'a été affiché. Une commande de migration du schéma actuel a terminé avec le code 0 sur les bases restaurées.

Ces contrôles établissent une petite répétition de sauvegarde à version identique. Ils ne prouvent ni une mise à niveau historique, ni la restauration de l'identité ou de bases externes, ni une migration du moteur de stockage, ni l'achèvement des tâches longues, ni la capacité en production. Les commandes Compose illustrées n'ont pas été exécutées sur une installation de production.

## Guides associés

[Variables d'environnement](/docs/environment), [Paramètres](/docs/settings), [Workflows](/docs/workflows) et [Documentation de déploiement et de développement](/docs/advanced-docs).
