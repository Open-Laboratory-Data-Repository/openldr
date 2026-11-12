# Requêtes

Utilisez Query pour parcourir les connecteurs de bases activés, inspecter les jeux de données des workflows et enregistrer des instructions SELECT dans Custom Queries. Report Designer peut lier ses tables à ces requêtes.

Commencez avec votre connecteur et vos données reçues. Aucun exemple de données n'est requis. Le comptage ci-dessous donne aussi un résultat utile dans un entrepôt vide. Les images utilisent une installation de test distincte.

Vous avez besoin de **Use query workbench**. Les requêtes lisent les données. Les instructions modifiant les données ou les tables sont refusées. Une nouvelle installation crée un connecteur vers le moteur d'entrepôt configuré. Ces images utilisent **Target Warehouse (Postgres)**. Les autres sources nécessitent un connecteur de base correspondant et activé.

Les requêtes intégrées enregistrées peuvent alimenter des rapports. Consultez-les librement, mais comprenez ces dépendances avant de changer le SQL ou les identifiants de paramètres.

## Parcourir une table source

Inspectez le schéma d'un connecteur avant d'écrire du SQL. Un schéma est l'espace de noms qui contient les tables de la base.

### 1. Ouvrir Query

Sélectionnez Query dans le menu principal.

![Ouvrez Query depuis le menu principal.](query-guide-open-page.png)

### 2. Développer Connectors

Sélectionnez Connectors dans Explorer.

![Développez Connectors dans Explorer.](query-guide-connectors.png)

### 3. Développer votre connecteur

Sélectionnez le connecteur de base activé. L'exemple utilise Target Warehouse (Postgres).

![Développez votre connecteur de base activé.](query-guide-warehouse.png)

### 4. Développer son schéma

Sélectionnez le schéma, par exemple public pour l'entrepôt PostgreSQL.

![Développez le schéma contenant vos données.](query-guide-schema.png)

### 5. Ouvrir la table

Sélectionnez la table à inspecter. L'exemple utilise lab_requests. Une table vide peut ne renvoyer aucune ligne sans erreur.

![Sélectionnez une table pour parcourir ses lignes actuelles.](query-guide-table.png)

### 6. Inspecter le SQL de consultation

Sélectionnez le bouton SQL au-dessus des résultats pour afficher le SELECT généré. La consultation simple ne garantit aucun ordre des lignes.

![SQL affiche le SELECT utilisé pour cette consultation.](query-guide-browse-sql.png)

### 7. Utiliser les pages de résultats

Utilisez la taille de page et les flèches pour les grands résultats. Ajoutez un ORDER BY explicite finissant par une clé unique avant de compter sur des pages stables.

![Utilisez la taille de page et les flèches pour les grandes tables.](query-guide-browse-paging.png)

**Résultat attendu :** l'onglet lit les lignes actuelles du connecteur choisi. L'entrepôt de la capture n'a aucune demande.

![Un entrepôt vide peut ne renvoyer aucune ligne sans erreur.](query-guide-browse-result.png)

## Compter les demandes de l'entrepôt

Utilisez une petite requête en lecture seule pour vérifier le connecteur et le résultat. Votre nombre de demandes peut différer de l'image.

### 1. Ouvrir une nouvelle requête

Sélectionnez le plus nommé new query dans la barre d'onglets.

![Le plus ouvre un nouvel onglet de requête.](query-guide-new-query.png)

### 2. Choisir le connecteur

Ouvrez Connector et sélectionnez la base à interroger.

![Choisissez la base activée à interroger.](query-guide-choose-connector.png)

### 3. Saisir le SELECT

Saisissez `SELECT COUNT(*) AS requests FROM lab_requests` dans l'éditeur.

![Saisissez un SELECT en lecture seule. Ce comptage fonctionne aussi sans données.](query-guide-sql.png)

### 4. Exécuter la requête

Sélectionnez Run. Le résultat contient une colonne requests et une ligne, même si le nombre vaut zéro.

![Run exécute le SQL sur le connecteur choisi.](query-guide-run-step-4.png)

**Résultat attendu :** le résultat montre le nombre actuel de demandes de l'entrepôt.

![Une ligne de sortie contient le nombre réel de demandes.](query-guide-count-result.png)

## Ajouter un paramètre obligatoire de période

Utilisez les paramètres si la requête doit demander des valeurs à chaque exécution. Cet exemple compte les demandes entre une date de début incluse et une date de fin exclue.

### 1. Utiliser le SQL avec bornes de dates

Remplacez le SQL par `SELECT COUNT(*) AS requests FROM lab_requests WHERE authored_at >= {{ param.from }} AND authored_at < {{ param.to }}`.

![Le SQL de période lit les valeurs liées from et to.](query-guide-parameter-sql.png)

### 2. Ouvrir Parameters

Sélectionnez Parameters au-dessus de l'éditeur SQL.

![Parameters définit les valeurs demandées par la requête.](query-guide-parameters.png)

### 3. Ajouter un paramètre

Ouvrez les points Parameter actions dans le panneau et choisissez Add.

![Le panneau Parameters a son propre menu d'actions.](query-guide-parameter-actions.png)

![Add crée une définition de paramètre.](query-guide-parameter-add.png)

### 4. Définir Variable ID

Saisissez `period` dans Variable ID. Les paramètres de période fournissent les valeurs spéciales from et to utilisées par le SQL.

![Utilisez un identifiant de variable stable.](query-guide-parameter-id.png)

### 5. Définir le libellé visible

Saisissez un Label clair, par exemple Period.

![Le libellé apparaît lors de l'exécution de la requête.](query-guide-parameter-label.png)

### 6. Choisir daterange

Définissez Type sur **daterange**.

![daterange demande deux dates et fournit from et to.](query-guide-parameter-type.png)

### 7. Exiger les bornes de dates

Activez Required car ce SQL nécessite les deux dates.

![Exigez une valeur lorsque le SQL nécessite les deux bornes.](query-guide-parameter-required.png)

### 8. Enregistrer la définition du paramètre

Ouvrez Parameter actions et sélectionnez Save. Cela met à jour l'onglet actuel. Enregistrez la requête elle-même pour la conserver.

![Save applique la définition du paramètre à cet onglet.](query-guide-parameter-save.png)

## Exécuter avec les dates choisies

Utilisez les dates adaptées à votre question. L'exemple inclut 2026-01-01 et exclut 2027-01-01. Il couvre toute l'année civile 2026.

### 1. Exécuter la requête paramétrée

Sélectionnez Run. Le panneau Run parameters demande les valeurs configurées.

![Run exécute le SQL sur le connecteur choisi.](query-guide-run-step-1.png)

### 2. Saisir les bornes de dates

Définissez la première date comme début inclus. Définissez la seconde comme fin exclue par ce SQL. Un autre SQL peut utiliser une règle différente.

![Saisissez la première date incluse.](query-guide-from-date.png)

![Saisissez la date de fin exclue utilisée par ce SQL d'exemple.](query-guide-to-date.png)

### 3. Ouvrir Run actions

Sélectionnez les points du panneau Run parameters.

![Ouvrez les actions des paramètres d'exécution après vérification des dates.](query-guide-run-values-actions.png)

### 4. Exécuter avec ces valeurs

Sélectionnez Run with these values.

![Run with these values exécute la requête paramétrée.](query-guide-run-values.png)

**Résultat attendu :** le résultat compte uniquement les demandes dans les bornes SQL. Zéro est un résultat valide.

![Le nombre filtré est un résultat réel, même s'il vaut zéro.](query-guide-parameter-result.png)

## Enregistrer la requête personnalisée

Enregistrez le SQL, le connecteur et les paramètres lorsque d'autres tâches doivent les réutiliser.

### 1. Choisir Save

Ouvrez Query actions au-dessus de l'éditeur et sélectionnez Save.

![Utilisez Query actions pour enregistrer ce SQL et ses paramètres.](query-guide-query-actions.png)

![Save demande un nom au premier enregistrement.](query-guide-save-query.png)

### 2. Nommer la requête

Saisissez un nom unique. L'exemple utilise Requests in a date range.

![Choisissez un nom unique pour la requête enregistrée.](query-guide-query-name.png)

### 3. Enregistrer la définition nommée

Ouvrez Name actions dans le panneau de nommage et choisissez Save.

![Save dans ce panneau conserve la requête.](query-guide-name-save.png)

**Résultat attendu :** la requête apparaît dans Custom Queries dans Explorer. Les enregistrements suivants mettent à jour la même définition.

![La requête enregistrée est disponible dans Explorer.](query-guide-saved-query.png)

## Renommer une requête enregistrée

Utilisez Rename pour conserver l'identifiant et les liens des rapports. Renommer n'enregistre pas les modifications non enregistrées de l'éditeur.

### 1. Ouvrir les actions de la ligne enregistrée

Développez Custom Queries et utilisez les points près de la requête.

![Les requêtes enregistrées ont leurs propres actions de ligne.](query-guide-saved-actions.png)

### 2. Choisir Rename

Sélectionnez Rename dans ce menu de ligne.

![Rename change le nom enregistré en conservant l'identifiant.](query-guide-rename.png)

### 3. Enregistrer le nouveau nom

Saisissez le nouveau nom unique, puis ouvrez Name actions et choisissez Save. L'exemple devient Request count by period.

![Saisissez le nouveau nom unique.](query-guide-rename-value.png)

![Save dans ce panneau conserve la requête.](query-guide-name-save.png)

**Résultat attendu :** Explorer affiche le nouveau nom et la requête garde son identifiant.

![Explorer affiche le nouveau nom de la requête.](query-guide-renamed.png)

## Organiser une requête dans un groupe

Les groupes organisent Explorer sur cette installation. Ils ne changent ni le SQL ni les liaisons des rapports.

### 1. Ouvrir Custom query actions

Sélectionnez les points près de Custom Queries.

![Custom query actions contient New group.](query-guide-custom-actions.png)

### 2. Créer un groupe

Sélectionnez New group.

![New group crée un dossier Explorer pour les requêtes enregistrées.](query-guide-new-group.png)

### 3. Nommer et enregistrer le groupe

Saisissez un nom utile, puis utilisez Name actions et Save. L'exemple utilise Documentation examples.

![Choisissez un nom de groupe utile.](query-guide-group-name.png)

![Save dans ce panneau conserve la requête.](query-guide-name-save.png)

### 4. Déplacer la requête

Ouvrez les points de la requête, pointez Move to group et choisissez le groupe cible. Développez ce groupe pour voir la requête.

![Move to group change l'organisation sans modifier le SQL.](query-guide-move-group.png)

![Choisissez le groupe cible.](query-guide-group-option.png)

**Résultat attendu :** la requête enregistrée apparaît dans son groupe.

![La requête est listée dans le groupe choisi.](query-guide-grouped.png)

## Exporter les requêtes sélectionnées

Un export transfère noms, SQL, paramètres et noms de groupes entre installations. Vérifiez le fichier avant de partager du contenu propre à une source.

### 1. Ouvrir Export queries

Ouvrez Transfer actions dans l'en-tête Explorer et sélectionnez Export queries.

![Explorer possède des actions de transfert distinctes.](query-guide-transfer-actions.png)

![Export queries ouvre un panneau de sélection.](query-guide-export-open.png)

### 2. Sélectionner les définitions

Cochez uniquement les requêtes à exporter.

![Sélectionnez uniquement les requêtes à exporter.](query-guide-export-select.png)

### 3. Télécharger le fichier

Ouvrez les points du panneau d'export et choisissez Download. Fermez le panneau après téléchargement.

![Download exporte noms, SQL, paramètres et noms de groupes.](query-guide-export-download.png)

**Résultat attendu :** le JSON contient les définitions choisies. Il exclut les identifiants de requêtes et les liaisons de connecteurs.

## Vérifier et importer un fichier de requêtes

Utilisez un export de requêtes ou un paquet de contenu approuvé. Vérifiez le traitement des noms identiques avant application.

### 1. Ouvrir Import queries

Ouvrez Transfer actions et sélectionnez Import queries.

![Import queries ouvre la vérification du fichier.](query-guide-import-open.png)

### 2. Choisir le fichier JSON

Ouvrez les points du panneau d'import, choisissez Choose file et sélectionnez l'export.

![Choose file ouvre le sélecteur de fichiers.](query-guide-import-choose.png)

### 3. Lire l'aperçu

Vérifiez si chaque nom sera créé, ignoré ou remplacé. L'exemple existe déjà et sera ignoré avec le remplacement désactivé.

![Vérifiez si chaque nom sera créé, ignoré ou remplacé.](query-guide-import-preview.png)

### 4. Vérifier le connecteur et le remplacement

Choisissez le connecteur pour les nouveaux noms importés. Gardez Replace existing queries désactivé pour préserver les définitions existantes. Activez-le seulement pour un remplacement voulu.

![Choisissez le connecteur pour les nouveaux noms importés.](query-guide-import-connector.png)

![Gardez Replace existing queries désactivé pour préserver les définitions de même nom.](query-guide-import-replace.png)

### 5. Appliquer l'import vérifié

Ouvrez les points du panneau et sélectionnez Import. Une seule définition invalide empêche l'import du fichier.

![Import applique le plan vérifié. Cet exemple de même nom est ignoré.](query-guide-import-apply.png)

**Résultat attendu :** l'opération crée, ignore ou remplace les noms comme indiqué. Le remplacement conserve l'identifiant et le connecteur existants.

## Ouvrir un jeu de données de workflow

Utilisez cette tâche si un workflow a déjà préparé les lignes nécessaires. Les autres tâches de ce guide ne nécessitent aucun jeu de données de workflow.

### 1. Développer Datasets

Sélectionnez Datasets dans Explorer.

![Datasets liste les données enregistrées par les workflows.](query-guide-datasets.png)

### 2. Ouvrir un jeu de données enregistré

Sélectionnez son nom. L'exemple ouvre request_summary, créé dans Rapports planifiés avec des workflows. Il contient une valeur requests égale à zéro.

![Le résumé de workflow enregistré s'ouvre sans nouvelle requête source.](query-guide-dataset-result.png)

**Résultat attendu :** l'onglet affiche les lignes enregistrées par le workflow.

## Exécuter une requête enregistrée sur téléphone

Explorer est replié au départ pour laisser plus de place au travail. Un grand écran facilite l'écriture SQL.

### 1. Développer Explorer

Sélectionnez Expand explorer en haut de sa barre étroite.

![Explorer est replié au départ sur téléphone.](query-guide-phone-expand.png)

### 2. Ouvrir la requête enregistrée

Développez Custom Queries et son groupe, puis sélectionnez le nom de la requête.

![Ouvrez une requête enregistrée dans son groupe.](query-guide-phone-query.png)

### 3. Replier Explorer

Sélectionnez Collapse explorer pour élargir l'éditeur.

![Repliez Explorer pour donner plus de place à l'éditeur.](query-guide-phone-collapse.png)

### 4. Saisir les valeurs d'exécution

Sélectionnez Run et remplissez le panneau des paramètres. Utilisez Run actions et Run with these values comme sur ordinateur.

![Run ouvre la saisie des paramètres de la requête enregistrée.](query-guide-phone-run.png)

![Saisissez les bornes de dates dans le panneau sur téléphone.](query-guide-phone-values.png)

## Supprimer un groupe en conservant ses requêtes

Utilisez cette tâche lorsque le dossier est inutile. Supprimer un groupe conserve toutes ses requêtes.

### 1. Ouvrir les actions du groupe

Utilisez les points près du nom du groupe.

![Ouvrez les actions du groupe sans modifier la requête.](query-guide-group-actions.png)

### 2. Choisir Delete group

Sélectionnez Delete group.

![Delete group supprime le dossier et garde ses requêtes.](query-guide-group-delete.png)

### 3. Confirmer la suppression du dossier

Lisez la confirmation indiquant que les requêtes restent, puis sélectionnez Delete group.

![La confirmation conserve explicitement les requêtes.](query-guide-group-delete-confirm.png)

**Résultat attendu :** le dossier disparaît et ses requêtes apparaissent en dehors.

![La requête reste en dehors du groupe supprimé.](query-guide-ungrouped.png)

## Supprimer une requête enregistrée inutile

Vérifiez les rapports dépendants avant suppression. Cet exemple supprime une définition jetable et conserve la requête vérifiée.

### 1. Ouvrir les actions de la requête

Utilisez les points près de la requête inutile.

![Ouvrez les actions d'une requête personnalisée inutile.](query-guide-delete-query-actions.png)

### 2. Choisir Delete query

Sélectionnez Delete query. Cela supprime la définition enregistrée, pas les lignes de l'entrepôt.

![Delete query supprime définitivement cette définition enregistrée.](query-guide-delete-query.png)

### 3. Confirmer la suppression

Lisez la confirmation, puis choisissez Delete query uniquement pour la définition à supprimer.

![Confirmez uniquement la requête enregistrée à supprimer.](query-guide-delete-query-confirm.png)

**Résultat attendu :** la définition enregistrée disparaît d'Explorer.

## Choisir les types de paramètres

Text accepte une valeur lue avec `{{ param.variableId }}`. Select demande une valeur issue d'Options SQL. Sa première colonne fournit les choix. Date range fournit `{{ param.from }}` et `{{ param.to }}`.

Choisissez un Variable ID unique et non vide par paramètre. Les points de sa ligne permettent de le monter, descendre ou supprimer. Supprimer un paramètre encore référencé dans le SQL provoque une erreur de paramètre non lié.

Une valeur facultative vide devient une chaîne vide. Le SQL doit la traiter explicitement si elle signifie aucun filtre. Required ne crée pas de valeur par défaut. Un rapport utilise les paramètres du modèle. Faites correspondre leur clé à la définition de requête.

La page Reports actuelle transmet les filtres de dates sous forme de valeurs plates from et to. Une Custom Query déclarant un paramètre daterange fonctionne ici mais échoue actuellement en liaison directe avec Reports. Pour les rapports, utilisez deux paramètres Text nommés from et to, référencés par {{ param.from }} et {{ param.to }}. Report Designer peut les présenter avec une seule commande Date range.

## Supprimer ou regrouper les définitions

Une ligne de requête propose Rename, Move to group et Delete query. No group remet la requête à la racine. Supprimer une requête exige confirmation et peut casser les rapports qui la référencent.

Chaque groupe possède Rename group et Delete group. Supprimer un groupe conserve ses requêtes et les déplace à l'extérieur. Vous pouvez aussi glisser une requête sur un groupe. Sur téléphone, utilisez Move to group pour une action directe.

Refresh dans Transfer actions recharge les entrées Explorer modifiées ailleurs, y compris par la CLI ou l'import de paquets. L'organisation des groupes appartient à cette installation et n'est pas envoyée par la synchronisation central-laboratoire.

## Garder des pages de résultats cohérentes

PostgreSQL et MySQL affichent un total compté. SQL Server peut indiquer total unknown et n'active Next que si une ligne supplémentaire est trouvée. Changer Rows per page revient à la première page.

Pour des pages stables, terminez ORDER BY par une clé unique. Par exemple, `ORDER BY authored_at, id` départage les heures égales si id est unique. Les lignes peuvent encore changer pendant la navigation car aucun instantané de la base n'est conservé.

Un connecteur SQL Server sans Database peut afficher les bases accessibles avant les schémas. Utilisez les noms complets de base, schéma et table pour du SQL entre bases du même serveur. Chaque connecteur PostgreSQL lit une seule base.

## Exporter ou importer avec la CLI

Utilisez `./openldr` dans votre dossier installé sous Linux ou macOS, `.\openldr.ps1` sous Windows, ou `pnpm openldr` dans une copie de développement. Lancez la commande depuis votre dossier `openldr_ce`. [Start here](/docs/start-here) explique le lanceur et les chemins.

```shell
./openldr query export --out data/queries.json --name "Request count by period"
./openldr query import data/queries.json
```

L'export écrase un fichier de sortie existant. L'import ignore les noms existants par défaut. Ajoutez `--force` seulement pour les remplacer volontairement. Le contenu propre à un système de laboratoire doit rester dans des paquets gérés par l'opérateur.

## Fichier de requête facultatif pour s'exercer

[Télécharger l'export de la requête vérifiée](https://openldr.online/docs-samples/user-guide/query/request-count-queries.json). Il demande les dates et compte les demandes de l'entrepôt. Il ne contient aucun patient et ne nécessite aucun lot d'exemples. Importez-le seulement pour garder une référence après avoir écrit votre requête.

Pour un jeu de données d'exercice, suivez le workflow facultatif de comptage dans [Rapports planifiés avec des workflows](/docs/report-pipeline). Une nouvelle installation peut ne posséder aucun jeu de données.

## Dépannage

**Aucune source disponible.** Demandez à un responsable de configurer un connecteur de base activé ou de créer le jeu de données nécessaire.

**Une requête échoue.** Lisez l'erreur à la place du résultat. Corrigez le SQL ou les valeurs et relancez. Les anciens résultats ne prouvent pas une nouvelle réponse réussie.

**Un paramètre non lié est signalé.** Faites correspondre chaque paramètre SQL à une définition configurée. Les périodes utilisent from et to.

**Une liste Select est vide.** Exécutez son Options SQL dans un onglet séparé. Il peut légitimement ne renvoyer aucune ligne.

**Un nom existe déjà.** Choisissez un autre nom. Le panneau conserve le brouillon après le refus d'un doublon.

**Une modification importée disparaît après redémarrage.** Les définitions intégrées peuvent être réinitialisées. Créez un nom personnalisé distinct pour conserver une variante durable.

## Guides associés

[Créateur de rapports](/docs/report-designer) lie les résultats de requêtes à une page. [Rapports](/docs/reports) exécute les entrées de la bibliothèque. [Connecteurs](/docs/connectors) configure les sources.
