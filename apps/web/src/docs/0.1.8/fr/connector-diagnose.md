# Diagnostiquer les connexions

<!-- operator-platform -->

Effectuez la maintenance sur l'hôte OpenLDR, dans le dossier Compose installé. Les exemples utilisent `~/Downloads/openldr_ce` sous Linux/macOS et `C:\openldr_ce` dans PowerShell. Remplacez ces chemins. Le terminal affiche déjà l'invite bleue ; saisissez seulement la commande. Les illustrations de fichiers montrent le texte à modifier dans le fichier indiqué. Ces images ne prouvent pas une opération réussie. Les données de démonstration sont facultatives.

Utilisez Diagnose lorsqu'un connecteur hôte enregistré ne se connecte pas. Il vérifie les paramètres, le nom du serveur, le port, l'authentification et la version du serveur, dans cet ordre.

Vous devez avoir **Manage connectors**. Le diagnostic part du serveur OpenLDR avec les identifiants enregistrés. Il ouvre une connexion de test sans importer de données.

Utilisez votre propre connexion enregistrée. Les images montrent une vraie connexion Postgres isolée et une instance SQL Server volontairement absente. Un exemple d'échec ne prouve pas qu'une authentification SQL Server fonctionne.

## Diagnostiquer une connexion enregistrée

Commencez par une connexion que vous utilisez déjà, ou par le connecteur de l'entrepôt sur une nouvelle installation.

### 1. Ouvrir Connectors

Ouvrez **Settings**, puis **Connectors**.

![Ouvrez Settings, puis Connectors.](/docs-images/operator/connector-diagnose-guide-open.png)

### 2. Choisir Diagnose

Ouvrez les points de la ligne du connecteur hôte et sélectionnez **Diagnose**. Les contrôles commencent à l'ouverture du panneau.

![Choisissez Diagnose dans la ligne d'un connecteur hôte.](/docs-images/operator/connector-diagnose-guide-diagnose.png)

### 3. Lire le résultat des paramètres

Lisez le statut et le message de chaque étape. Un avertissement donne un conseil sans arrêter les contrôles suivants.

![Lisez le statut réel de chaque étape du diagnostic.](/docs-images/operator/connector-diagnose-guide-passed.png)

### 4. Lire les résultats de connexion

Vérifiez **Port**, **Login** et **Server version**. L'exemple Postgres local réussit tous les contrôles.

![Port, Login et Server version confirment la connexion testée.](/docs-images/operator/connector-diagnose-guide-login.png)

### 5. Répéter si nécessaire

Ouvrez les points du panneau de diagnostic et sélectionnez **Run again**. Les paramètres actuellement enregistrés sont utilisés.

![Run again répète les contrôles avec les paramètres enregistrés.](/docs-images/operator/connector-diagnose-guide-again.png)

**Résultat attendu :** un diagnostic réussi se termine par All checks passed. Il prouve la connexion testée. Il ne prouve ni une requête de rapport, ni le schéma source, ni les droits particuliers du compte.

## Saisir les paramètres SQL Server

Demandez à l'opérateur de la base s'il faut une instance nommée, un port TCP fixe, un compte SQL ou un compte de domaine Windows. Ne créez la connexion fictive que pour un exemple d'échec isolé.

### 1. Ajouter un connecteur hôte

Fermez le diagnostic. Ouvrez les points de Connectors et choisissez **Add connector**. Saisissez un nom utile et réglez Category sur **Host**.

![Choisissez Add connector pour une connexion SQL Server.](/docs-images/operator/connector-diagnose-guide-add.png)

### 2. Choisir Microsoft SQL

Réglez **Database type** sur **Microsoft SQL**.

![Choisissez Microsoft SQL.](/docs-images/operator/connector-diagnose-guide-sql-type.png)

### 3. Saisir le serveur et l'instance

Saisissez **Host**. Une valeur collée `SERVER\INSTANCE` se sépare en Host et Instance name à la sortie du champ. Utilisez un Port fixe uniquement si Instance name est vide.

![Le serveur et l'instance collés sont répartis dans des champs distincts.](/docs-images/operator/connector-diagnose-guide-split.png)

### 4. Saisir la base et le compte

Remplissez **Database**, **User** et **Password**. Pour un compte Windows, renseignez Windows domain et saisissez le nom d'utilisateur sans domaine. Laissez le domaine vide pour un compte SQL.

![Saisissez la base et les identifiants. Windows domain concerne seulement les comptes Windows.](/docs-images/operator/connector-diagnose-guide-login-fields.png)

### 5. Vérifier le chiffrement

**Encrypt** est activé au départ. Suivez les exigences de chiffrement et de certificat de l'opérateur du serveur. Trust server certificate accepte un certificat sans la validation habituelle.

![Encrypt est activé au départ. Adaptez le chiffrement et les certificats au serveur.](/docs-images/operator/connector-diagnose-guide-encryption.png)

### 6. Enregistrer le connecteur

Ouvrez les points du panneau et choisissez **Save**.

![Save enregistre les paramètres avant le diagnostic.](/docs-images/operator/connector-diagnose-guide-save.png)

**Résultat attendu :** le connecteur enregistré peut être diagnostiqué. L'exemple nomme volontairement une instance inexistante.

## Lire et corriger un diagnostic en échec

Le diagnostic s'arrête au premier contrôle en échec. Les étapes suivantes sont ignorées et n'ont donc aucun résultat.

### 1. Diagnostiquer la ligne enregistrée

Ouvrez les points de la ligne et choisissez **Diagnose**.

![Choisissez Diagnose sur l'instance nommée enregistrée.](/docs-images/operator/connector-diagnose-guide-bad-diagnose.png)

### 2. Lire le premier échec

Lisez l'étape en échec et le message de correction. Cet exemple ne reçoit aucune réponse SQL Server Browser pour son instance absente.

![Cette instance volontairement absente échoue à SQL Server Browser.](/docs-images/operator/connector-diagnose-guide-browser-failure.png)

### 3. Vérifier les étapes ignorées

Ici, Port, Login et Server version n'ont pas été tentés. Une authentification ignorée ne signifie pas que le mot de passe est accepté.

![Les étapes suivantes sont ignorées après le premier échec.](/docs-images/operator/connector-diagnose-guide-skipped.png)

### 4. Corriger les paramètres enregistrés

Fermez le diagnostic, ouvrez les points de la ligne et choisissez **Edit**. Vérifiez Host et Instance name. Si l'opérateur fournit un port TCP fixe, effacez Instance name et saisissez ce port. Enregistrez toute modification, puis relancez le diagnostic.

![Vérifiez le serveur et l'instance. Vous pouvez aussi effacer Instance name et saisir le vrai port TCP fixe.](/docs-images/operator/connector-diagnose-guide-correction.png)

**Résultat attendu :** suivez l'étape réellement en échec. La correction peut nécessiter une modification de service, de pare-feu ou de résolution de noms hors d'OpenLDR. L'instance absente n'a pas été réparée.

## Lire le diagnostic sur un téléphone

Le même menu de ligne ouvre le diagnostic à la largeur du téléphone.

### 1. Lire les messages des contrôles

Ouvrez Diagnose, puis faites défiler le panneau pour lire chaque résultat. Les messages passent à la ligne sous le nom de l'étape.

![Le panneau du téléphone renvoie chaque message à la ligne.](/docs-images/operator/connector-diagnose-guide-phone.png)

## Comprendre les contrôles

**Settings.** Un hôte est renseigné et le port est valide. L'avertissement localhost rappelle que chaque conteneur Docker a sa propre adresse de bouclage.

**Server name.** Le serveur OpenLDR résout le nom en adresse. Une résolution réussie ne prouve pas que le port de la base répond.

**SQL Server Browser.** Pour une instance SQL Server nommée, UDP 1434 indique son port TCP. Demandez à l'opérateur de démarrer Browser et d'autoriser UDP. Sinon, utilisez le vrai port TCP fixe sans nom d'instance.

**Port.** Une connexion TCP s'ouvre. Un autre service peut aussi répondre sur ce port.

**Login.** Le compte enregistré ouvre la base. En cas d'échec, vérifiez l'utilisateur, le mot de passe, le domaine et les accès à la base.

**Server version.** Le serveur répond à une petite requête. Cela ne prouve toujours pas que les tables et colonnes nécessaires à l'importateur existent.

## Diagnostiquer avec le CLI

Remplacez CONNECTOR_ID par le connecteur hôte enregistré. Ces contrôles testent la connexion sans importer de données.

### 1. Trouver l’identifiant du connecteur

```sh
{{operator:diagnose-list}}
```

![Trouver l’identifiant du connecteur.](guide:operator-diagnose-list)

### 2. Lancer le diagnostic depuis l’hôte

```sh
{{operator:diagnose-cli}}
```

![Lancer le diagnostic depuis l’hôte.](guide:operator-diagnose-cli)

### 3. Examiner les paramètres sans révéler les secrets

```sh
{{operator:diagnose-inspect}}
```

![Examiner les paramètres sans révéler les secrets.](guide:operator-diagnose-inspect)

## Exercice facultatif et limites

Aucun jeu de données n'est nécessaire. Testez d'abord votre connecteur d'entrepôt existant. Un connecteur Microsoft SQL temporaire avec une instance inexistante peut illustrer l'échec de Browser. Retirez ensuite cet exemple par les points de la ligne et la confirmation.

Les contrôles documentés ont obtenu une réussite Postgres réelle et un délai UDP expiré pour une instance nommée absente. Ils n'ont testé ni l'authentification Windows, ni une instance SQL Server nommée fonctionnelle, ni le remplacement de certificat, ni un ancien serveur TLS.

## Résolution des problèmes

**Le premier contrôle échoue.** Lisez-le avant les résultats ignorés. Corrigez les paramètres enregistrés dans Edit, puis relancez Diagnose.

**Browser expire pour une instance SQL Server nommée.** Vérifiez les noms du serveur et de l'instance, ainsi que l'accès à SQL Server Browser. Les contrôles suivants restent ignorés jusqu'à la réussite de la découverte.

**Tous les contrôles réussissent, mais l'importateur échoue.** Le diagnostic vérifie la connexion et la réponse du serveur. Il ne prouve pas que le compte peut lire chaque table source nécessaire.

## Guides associés

[Connecteurs](/docs/connectors) décrit la création, les tests et les changements de secrets. [Importer depuis OpenLDR v1](/docs/v1-import) utilise un connecteur de base de données.
