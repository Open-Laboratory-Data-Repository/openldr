# Mises à niveau planifiées

<!-- operator-platform -->

Effectuez la maintenance sur l'hôte OpenLDR, dans le dossier Compose installé. Les exemples utilisent `~/Downloads/openldr_ce` sous Linux/macOS et `C:\openldr_ce` dans PowerShell. Remplacez ces chemins. Le terminal affiche déjà l'invite bleue ; saisissez seulement la commande. Les extraits de configuration indiquent le fichier à modifier ; ce ne sont pas des commandes. Ces images ne prouvent pas une opération réussie. Les données de démonstration sont facultatives.

## Préparer la version

Planifiez une interruption. Conservez projet, fichier environnement et surcharges Compose. Ne changez pas les versions des moteurs de base. Lisez les notes de version.

### 1. Relever images et services actuels

Conservez les identifiants et versions hors du déploiement. Les commandes suivantes utilisent ce dossier.

```sh
{{operator:upgrade-folder}}
```

![Relever images et services actuels.](guide:operator-upgrade-folder)

### 2. Sauvegarder configuration et clés

Remplacez BEFORE_UPGRADE. Limitez les accès. Incluez surcharges, clés de chiffrement et signature, certificats et fichiers locaux. Cela ne sauvegarde pas les volumes de base ou de fichiers. Gardez ce guide hors de Studio.

```sh
{{operator:upgrade-private-copy}}
```

![Sauvegarder configuration et clés.](guide:operator-upgrade-private-copy)

## Arrêter les écritures

Suspendez émetteurs, synchronisation et écritures planifiées. Bloquez le trafic. Arrêtez les travaux CLI et toutes les API, y compris sur les autres hôtes.

### 1. Laisser finir les travaux actifs

Ajoutez sous services.api aux anciennes installations. Prévoyez le travail le plus long. Le délai explicite suivant prend priorité.

```text
{{operator:upgrade-grace}}
```

![Laisser finir les travaux actifs.](guide:operator-upgrade-grace)

### 2. Arrêter et contrôler la fermeture API

300 secondes est un exemple. Un délai dépassé, arrêt forcé ou code 137 ne prouve pas la fin des travaux. Examinez les effets interrompus.

```sh
{{operator:upgrade-stop}}
```

![Arrêter et contrôler la fermeture API.](guide:operator-upgrade-stop)

### 3. Arrêter les écritures identité et fichiers

Utilisez les vrais noms. Une ancienne installation peut nommer le stockage minio. Gardez PostgreSQL actif pour les sauvegardes logiques. Arrêtez aussi les autres écrivains.

```sh
{{operator:upgrade-stores-stop}}
```

![Arrêter les écritures identité et fichiers.](guide:operator-upgrade-stores-stop)

## Sauvegarder et prouver la restauration

Sauvegardez bases, rôles et tous les fichiers ou volumes arrêtés durant le même arrêt des écritures. Ne lancez jamais docker compose down -v. Ne copiez pas un volume PostgreSQL actif comme sauvegarde logique.

### 1. Créer chaque sauvegarde PostgreSQL

Remplacez DB_NAME et DB_USER. Répétez pour bases interne, analytique et Keycloak. Pour SQL Server/MySQL, appliquez aussi leur procédure native testée.

```sh
{{operator:upgrade-dump}}
```

![Créer chaque sauvegarde PostgreSQL.](guide:operator-upgrade-dump)

### 2. Copier chaque sauvegarde hors des volumes

La destination privée doit exister. Contrôlez chaque code de sortie. La copie évite la redirection binaire PowerShell.

```sh
{{operator:upgrade-dump-copy}}
```

![Copier chaque sauvegarde hors des volumes.](guide:operator-upgrade-dump-copy)

### 3. Sauvegarder aussi les rôles

Remplacez DB_USER. Protégez globals.sql, qui peut contenir des identifiants. Sauvegardez chaque bucket ou volume arrêté avec la procédure testée.

```sh
{{operator:upgrade-roles}}
```

![Sauvegarder aussi les rôles.](guide:operator-upgrade-roles)

### 4. Restaurer dans une destination isolée

Utilisez une base vide isolée, jamais la production. Restaurez les rôles et résolvez les conflits initiaux. Copiez la sauvegarde sur cet hôte. Une liste seule ne prouve rien. Restaurez les fichiers, comparez sommes et données, déchiffrez des secrets avec les clés conservées et vérifiez les liens vers les fichiers avant migration.

```sh
{{operator:upgrade-restore}}
```

![Restaurer dans une destination isolée.](guide:operator-upgrade-restore)

## Préparer les anciennes installations MinIO

Ignorez si Garage est déjà utilisé. Avant migration, récupérez Compose et configuration de la version cible et réintégrez le service sauvegardé. Gardez image exacte, volume et anciens identifiants.

### 1. Conserver le service source ancien

Remplacez tous les marqueurs par la configuration sauvegardée. Reprenez le vrai volume si différent de miniodata. Les anciens identifiants explicites restent valides après changement S3. Ne tirez pas une image latest supposée.

```text
{{operator:upgrade-minio-config}}
```

![Conserver le service source ancien.](guide:operator-upgrade-minio-config)

### 2. Générer les nouvelles valeurs Garage

Préfixez les 24 caractères hexadécimaux par GK. Générez séparément 64 caractères pour secret S3, secret RPC et jeton admin. Gardez-les privés.

```sh
{{operator:upgrade-garage-key}}
```

![Générer les nouvelles valeurs Garage.](guide:operator-upgrade-garage-key)

### 3. Écrire les nouveaux paramètres de stockage

Remplacez tous les marqueurs. Incluez config/garage.toml et les fichiers Compose cibles. Compose refuse les secrets Garage absents. Ne démarrez pas encore l’API.

```text
{{operator:upgrade-garage-config}}
```

![Écrire les nouveaux paramètres de stockage.](guide:operator-upgrade-garage-config)

## Migrer avec l’image API choisie

Gardez les bases disponibles et tous les anciens écrivains arrêtés. Préservez les versions des moteurs et du stockage.

### 1. Fixer la version applicative choisie

Utilisez la version concrète choisie dans les notes, pas le marqueur. Ne changez ni émetteur ni clé de chiffrement.

```text
{{operator:upgrade-version}}
```

![Fixer la version applicative choisie.](guide:operator-upgrade-version)

### 2. Télécharger seulement les images applicatives

Utilisez toutes les surcharges existantes. Conservez les anciennes images pour récupération. Cela ne met pas à niveau PostgreSQL ou Garage.

```sh
{{operator:upgrade-pull}}
```

![Télécharger seulement les images applicatives.](guide:operator-upgrade-pull)

### 3. Exécuter les migrations une fois

Exigez code 0 et migrations interne et cible réussies. Cela ne lance ni dépendances ni serveur API. En cas d’échec, arrêtez. Des changements peuvent déjà être validés. Ne lancez pas d’anciens binaires sur un schéma modifié. Restaurez ensemble bases, fichiers, clés et images si nécessaire.

```sh
{{operator:upgrade-migrate}}
```

![Exécuter les migrations une fois.](guide:operator-upgrade-migrate)

## Copier les anciens fichiers avant les écritures

Seulement pour MinIO vers Garage. Gardez l’API arrêtée. Les bases doivent rester disponibles pour le CLI de maintenance.

### 1. Démarrer les stockages source et cible

Utilisez les vrais noms de la configuration fusionnée. N’ajoutez pas api à cette commande.

```sh
{{operator:upgrade-stores}}
```

![Démarrer les stockages source et cible.](guide:operator-upgrade-stores)

### 2. Copier et vérifier les objets

Remplacez OLD_KEY, OLD_SECRET et SOURCE_BUCKET. Ces secrets apparaissent dans arguments et historique. MinIO reste inchangé. Répétez après échec. Les objets de même taille sont ignorés ; taille égale ne prouve pas contenu égal. Exigez vérification réussie, comparez des sommes et ouvrez des fichiers. Conservez l’ancien volume. Sa suppression ultérieure est facultative.

```sh
{{operator:upgrade-storage-copy}}
```

![Copier et vérifier les objets.](guide:operator-upgrade-storage-copy)

## Vérifier avant de reprendre le trafic

Démarrez la nouvelle API seulement après migration et copie réussies. Si le trafic avait repris, réconciliez livraisons et effets externes avant une restauration ancienne.

### 1. Démarrer les services choisis et contrôler l’état

Gardez versions et surcharges. Consultez journaux et données représentatives avant de rouvrir le trafic.

```sh
{{operator:upgrade-start}}
```

![Démarrer les services choisis et contrôler l’état.](guide:operator-upgrade-start)

### 2. Vérifier santé et travaux en attente

HTTP 202 signifie accepté, pas terminé. Examinez reçus webhook et exécutions liées. Réessayez une demande interrompue avec sa clé Idempotency-Key et entrée d’origine. La santé seule ne prouve ni restauration ni effets externes.

```sh
{{operator:upgrade-health}}
```

![Vérifier santé et travaux en attente.](guide:operator-upgrade-health)

### 3. Reconstruire les anciennes projections seulement si nécessaire

Pour versions antérieures au statut de résultat, index patient ou doublons, cela remplit les nouveaux champs. Cette reconstruction exige --force. Ignorez si inutile. Gardez sauvegarde vérifiée et anciennes images selon votre politique.

```sh
{{operator:upgrade-reproject}}
```

![Reconstruire les anciennes projections seulement si nécessaire.](guide:operator-upgrade-reproject)
