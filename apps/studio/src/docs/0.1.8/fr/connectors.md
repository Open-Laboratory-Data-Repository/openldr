# Connecteurs

Enregistrez une connexion une fois, puis choisissez-la dans les workflows, Custom Queries et les rapports. Un connecteur conserve les paramètres et les identifiants chiffrés.

Vous avez besoin de **Manage connectors**. Utilisez votre base ou votre compte de service. Les captures utilisent un compte fictif de rapports en lecture seule sur une base Postgres isolée.

Une nouvelle installation crée un connecteur d'entrepôt pour le moteur configuré. Les captures utilisent **Target Warehouse (Postgres)**. Les requêtes et rapports intégrés utilisent ce connecteur. Vérifiez leurs dépendances avant de le modifier.

L'hôte et le port doivent être accessibles depuis le serveur OpenLDR. Dans Docker, `localhost` désigne le conteneur lui-même. Utilisez le nom du service de base et son port interne si les deux services partagent un réseau Docker.

Créer un connecteur n'importe aucune fiche et n'exécute aucun workflow. La [pratique facultative](#pratique-facultative) se trouve à la fin.

## Choisir le type de connexion

Utilisez les paramètres et le compte préparés pour le service à joindre. Choisissez le type avant de remplir ses champs.

### 1. Ouvrir le menu utilisateur

Sélectionnez votre menu de compte en bas de la barre principale.

![Ouvrir le menu utilisateur en bas à gauche.](connectors-guide-open-user-menu.png)

### 2. Ouvrir Settings

Choisissez **Settings** dans le menu du compte.

![Choisir Settings dans le menu utilisateur.](connectors-guide-settings-menu.png)

### 3. Ouvrir Connectors

Sélectionnez **Connectors** dans Settings.

![Ouvrir Settings puis Connectors.](connectors-guide-open.png)

### 4. Ouvrir les actions de la page

Sélectionnez les points au-dessus du tableau.

![Le menu à points de la page contient Add connector.](connectors-guide-actions.png)

### 5. Choisir Add connector

Sélectionnez **Add connector**.

![Choisir Add connector.](connectors-guide-add.png)

### 6. Nommer la connexion

Saisissez un nom reconnaissable dans le sélecteur. L'exemple utilise `Example reporting database`. Ne mettez aucun mot de passe dans le nom.

![Utiliser un nom qui identifie la base et son usage.](connectors-guide-name.png)

### 7. Choisir Host

Définissez **Category** sur **Host** pour une connexion intégrée de base, de messagerie ou de fichiers.

![Choisir Host pour les connexions intégrées de base, de messagerie ou de fichiers.](connectors-guide-host-option.png)

### 8. Choisir le type de service

Définissez **Database type** sur le service réel. L'exemple utilise **Postgres**. La liste contient aussi les services de messagerie et de fichiers.

![Choisir le vrai type de service. L'exemple utilise Postgres.](connectors-guide-type.png)

## Saisir les détails et enregistrer

Continuez dans le panneau ouvert. Les champs dépendent du type choisi. Cet exemple utilise Postgres.

### 1. Saisir l'adresse de la base

Remplissez **Host**, **Port** et **Database**. L'adresse montrée appartient à cette installation de test. Utilisez l'adresse de votre serveur.

![Saisir l'hôte, le port et la base accessibles depuis le serveur OpenLDR.](connectors-guide-address.png)

### 2. Saisir le compte

Remplissez **User** et **Password** avec le compte de base. Un test de connexion n'établit pas quelles tables ce compte peut lire.

![Utiliser un compte autorisé à lire les données nécessaires.](connectors-guide-account.png)

### 3. Vérifier le chiffrement du transport

Réglez **Use SSL** selon les exigences de la base. L'exemple local le désactive. Les autres types ont leurs propres paramètres de transport.

![Régler Use SSL selon la base. L'exemple isolé n'utilise pas SSL.](connectors-guide-ssl.png)

### 4. Ouvrir les actions du panneau

Sélectionnez les points dans l'en-tête du panneau.

![Ouvrir le menu à points du panneau du connecteur.](connectors-guide-sheet-actions.png)

### 5. Enregistrer le connecteur

Sélectionnez **Save**.

![Save conserve le connecteur et les identifiants chiffrés.](connectors-guide-save.png)

**Résultat attendu :** le connecteur apparaît dans la liste, activé. Allowed plugin host limite le réseau des plugins. Cette colonne n'indique pas l'adresse enregistrée de la base.

![La ligne montre le nom, le type, l'hôte autorisé aux plugins et l'état activé.](connectors-guide-created.png)

## Tester la connexion enregistrée

Effectuez un test après la création ou un changement d'identifiants.

### 1. Choisir Test

Ouvrez les points de la ligne et choisissez **Test**.

![Test connection vérifie les identifiants enregistrés.](connectors-guide-test.png)

### 2. Lire le résultat

Attendez **Connection OK** ou un échec sous le menu de ligne. Une connexion réussie ne prouve pas la réussite d'une requête ou d'un envoi de courriel.

![Connection OK confirme que ce serveur peut se connecter avec le compte enregistré.](connectors-guide-test-result.png)

**Résultat attendu :** le serveur OpenLDR teste les identifiants enregistrés. Les résultats apparaissent dans Audit.

## Modifier les paramètres ou les identifiants

Modifiez directement les paramètres ordinaires. Les mots de passe restent vides après l'enregistrement. Laissez un mot de passe vide pour le conserver.

### 1. Ouvrir Edit

Sur la bonne ligne, ouvrez les points et choisissez **Edit**.

![Edit ouvre les paramètres ordinaires enregistrés.](connectors-guide-edit.png)

### 2. Vérifier les champs enregistrés

Vérifiez l'hôte, le port, la base et l'utilisateur. Un mot de passe défini montre une indication dans le champ. Saisissez-en un seulement pour le remplacer.

![Les champs ordinaires sont visibles. Le mot de passe enregistré reste vide.](connectors-guide-stored.png)

### 3. Enregistrer les changements

Ouvrez les points du panneau et choisissez **Save**. L'exemple garde le mot de passe vide pour le conserver. Testez ensuite le connecteur.

![Enregistrer avec le mot de passe vide conserve celui déjà stocké.](connectors-guide-save-kept.png)

**Résultat attendu :** le même connecteur reste accessible à ses utilisateurs existants. Leur prochaine exécution utilise les nouveaux paramètres.

## Rechercher et désactiver temporairement une connexion

Désactivez un connecteur pour suspendre son utilisation sans supprimer les paramètres enregistrés.

### 1. Rechercher dans la liste

Recherchez par nom, type ou hôte autorisé aux plugins.

![La recherche trouve le nom, le type et l'hôte du connecteur.](connectors-guide-search.png)

### 2. Désactiver Enabled

Désactivez **Enabled** sur la bonne ligne. Les requêtes et workflows qui en dépendent peuvent échouer pendant sa désactivation.

![Enabled peut empêcher temporairement l'utilisation du connecteur.](connectors-guide-toggle.png)

### 3. Vérifier l'interrupteur

Un interrupteur éteint indique la désactivation. Réactivez-le quand le connecteur peut être utilisé.

![Un interrupteur éteint indique un connecteur désactivé.](connectors-guide-disabled.png)

**Résultat attendu :** la désactivation conserve le connecteur et ses identifiants. Elle ne retire pas les dépendances.

## Supprimer une connexion inutile

Vérifiez les workflows, requêtes et rapports dépendants avant toute suppression. Ne retirez pas le connecteur d'entrepôt pour simplement vider la liste.

### 1. Choisir Remove

Ouvrez les points de la ligne et choisissez **Remove**.

![Remove supprime le connecteur et ses identifiants enregistrés.](connectors-guide-remove.png)

### 2. Vérifier la confirmation

Vérifiez le nom. Choisissez **Remove** pour supprimer ou **Cancel** pour conserver. La capture conserve l'exemple pour les tâches suivantes.

![Vérifier le nom du connecteur avant de confirmer la suppression.](connectors-guide-remove-confirm.png)

**Résultat attendu :** confirmer Remove supprime le connecteur et ses identifiants. Toute référence restante échoue jusqu'à sa reconfiguration.

## Utiliser Connectors sur téléphone

La colonne Host est masquée sur téléphone. Ouvrez Edit pour lire l'adresse de connexion.

### 1. Trouver la ligne

Utilisez la recherche, puis les points de la ligne ou Enabled.

![Sur téléphone, le nom, le type, l'interrupteur et les points tiennent dans la largeur.](connectors-guide-phone-list.png)

### 2. Lire ou modifier les paramètres

Choisissez **Edit** dans les points de la ligne. Le panneau remplit l'écran. Faites-le défiler pour les formulaires longs.

![Le panneau d'édition remplit l'écran du téléphone.](connectors-guide-phone-edit.png)

## Choisir le bon type

**Bases SQL.** Postgres, MySQL / MariaDB et Microsoft SQL ont des paramètres distincts. Le connecteur choisi détermine le dialecte des requêtes. Pour les instances SQL Server et les comptes de domaine Windows, consultez [Diagnostiquer les connexions](/docs/connector-diagnose).

**Autres services hôtes.** MongoDB, Redis, SMTP Email, IMAP Email, Gmail, Microsoft Outlook et SFTP affichent leurs champs spécifiques. Utilisez les identifiants fournis par votre opérateur. Gmail et Outlook exigent une application déjà enregistrée et un jeton de renouvellement. SMTP utilise le compte d'envoi et les paramètres du relais.

**Destinations de plugin.** Choisissez **Plugin** dans Category, un plugin de sortie installé, puis remplissez ensemble Base URL, Username et Password. En modification, laissez les trois vides pour les conserver ou remplacez les trois. Installez un plugin de sortie dans [Marché](/docs/marketplace) si la liste est vide.

Un nœud propose les connecteurs actifs du type requis. Un connecteur absent peut être désactivé ou d'un autre type. Ne mettez pas les mots de passe dans les noms de workflow ou le texte SQL.

## Utiliser la ligne de commande

Consultez [Commencer ici](/docs/start-here) pour configurer la CLI. Depuis `openldr_ce`, utilisez les commandes suivantes. Prenez l'identifiant dans la liste. Les commandes d'ajout, de consultation, de modification, de test et de suppression prennent en charge les connecteurs Host. Les destinations de plugin passent par Studio.

Un fichier d'ajout contient `name`, `type` et `config`. Un fichier de modification contient seulement les champs à changer. Les champs omis restent conservés. Les secrets vides gardent les valeurs existantes. Protégez les fichiers d'identifiants et supprimez-les après usage.

```shell
pnpm openldr connectors list
pnpm openldr connectors inspect <id>
pnpm openldr connectors add --file new-connector.json
pnpm openldr connectors update <id> --file connector-patch.json
pnpm openldr connectors test <id>
pnpm openldr connectors remove <id> --force
```

## Pratique facultative

Ces tâches utilisent votre compte de service. Pour une installation de test, demandez à l'opérateur de créer une petite table et un rôle en lecture seule. Les captures utilisent deux lignes fictives dans `guide_orders` et `guide_reader`.

Ne copiez pas l'adresse ni le mot de passe des captures dans une vraie connexion. Accordez au compte de rapports SELECT seulement sur les tables approuvées. Vérifiez les requêtes autorisées et refusées dans votre base. Le test illustré vérifie la connexion Postgres locale. Il ne teste ni l'envoi de courriel, ni l'autorisation cloud, ni le transfert de fichiers.

## Résolution de problèmes

**Connexion refusée ou délai dépassé.** Vérifiez l'adresse depuis le serveur OpenLDR et le pare-feu de la base. Ouvrez les points de la ligne, puis Diagnose pour les connexions Host.

**Échec d'authentification.** Vérifiez le compte et la base. Remplacez le mot de passe dans Edit et testez à nouveau.

**Erreur SSL ou de certificat.** Demandez à l'opérateur les paramètres de transport requis. SQL Server affiche Encrypt et Trust server certificate.

**Le test réussit mais une requête échoue.** Lisez l'erreur ou l'exécution du workflow. Le compte peut manquer d'accès, le SQL utiliser un autre dialecte ou la requête dépasser son délai. Les requêtes des connecteurs SQL ont une limite de 30 secondes.

**D'anciens résultats restent visibles.** Vérifiez l'erreur près du sélecteur de connecteur. Un ancien tableau ne prouve pas que la dernière exécution a réussi.

## Guides associés

[Diagnostiquer les connexions](/docs/connector-diagnose) explique les vérifications. [Commencer ici](/docs/start-here) explique la CLI. Workflows et Custom Queries utilisent les connecteurs enregistrés.
