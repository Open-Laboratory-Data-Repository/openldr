# Workflows

Créez un workflow lorsque vous devez recevoir, vérifier, transformer, stocker ou livrer des données dans OpenLDR. Un nœud est une étape. Les lignes relient la sortie d'un nœud à l'entrée d'un autre.

Utilisez vos propres enregistrements et requêtes de rapport. Aucun jeu de données de documentation n'est nécessaire. Les images utilisent une installation de test distincte. Des fichiers fictifs facultatifs sont proposés à la fin.

**View workflows** ouvre les définitions et exécutions. **Edit workflows** les crée et les modifie. **Run workflows** lance les exécutions manuelles. **Manage workflow secrets** modifie les identifiants webhook.

Le workflow fourni **Ingest** traite aussi les soumissions Forms. Gardez-le activé. Le modifier affecte chaque émetteur utilisant son webhook. Remplacez un secret seulement lorsque vous êtes prêt à mettre ces émetteurs à jour.

## Trouver un workflow

Ouvrez une définition existante avant de l'inspecter ou de la modifier.

### 1. Ouvrir Workflows

Sélectionnez **Workflows** dans le menu principal.

![Ouvrez Workflows depuis le menu principal.](workflows-guide-open-page.png)

### 2. Trouver le workflow

Utilisez **Search workflows** pour filtrer les noms. Effacez la recherche pour retrouver toute la liste.

![La recherche filtre les noms des workflows.](workflows-guide-search.png)

### 3. Ouvrir sa ligne

Sélectionnez le nom du workflow. Cet exemple ouvre le workflow fourni **Ingest**.

![Ouvrez le workflow fourni Ingest.](workflows-guide-ingest-row.png)

### 4. Ajuster le canevas

Sélectionnez **Fit View** en bas à gauche. Utilisez plus et moins pour zoomer. Pan déplace le canevas. Select trace une zone de sélection.

![Fit View affiche les nœuds dans le canevas.](workflows-guide-fit.png)

## Définir le secret webhook d'Ingest

Effectuez cette tâche lorsqu'un émetteur autorisé a besoin d'un identifiant à copier. Un secret enregistré ne peut pas être révélé. Coordonnez d'abord son remplacement avec les émetteurs.

### 1. Sélectionner Ingest received

Sélectionnez le premier nœud, **Ingest received**.

![Sélectionnez le déclencheur webhook Ingest received.](workflows-guide-trigger.png)

### 2. Ouvrir ses paramètres

Sélectionnez l'engrenage **Configure** au-dessus du nœud sélectionné.

![Configure ouvre les paramètres du nœud sélectionné.](workflows-guide-configure.png)

### 3. Générer un nouveau secret

Sous **Secret**, sélectionnez **Replace secret**. Une valeur non enregistrée propose plutôt **Regenerate**.

![Replace secret génère une valeur à copier avant l'enregistrement.](workflows-guide-replace-secret.png)

### 4. Copier la nouvelle valeur

Copiez le nouveau secret et gardez-le avec les identifiants de l'émetteur. URL et Header indiquent où et comment l'envoyer.

![Copiez le nouveau secret avant l'enregistrement. La valeur enregistrée ne peut pas être révélée.](workflows-guide-copy-secret.png)

### 5. Enregistrer le workflow

Sélectionnez **Save** dans la barre d'outils.

![Save enregistre le workflow et son nouveau secret.](workflows-guide-save.png)

### 6. Confirmer la modification système

Lisez l'avertissement du workflow système, puis sélectionnez **Save anyway** si vous souhaitez cette modification.

![Les workflows système exigent une confirmation explicite Save anyway.](workflows-guide-confirm-save.png)

**Résultat attendu :** le message Workflow saved confirme l'écriture. Les émetteurs doivent utiliser le nouveau secret enregistré.

![Le message Workflow saved confirme cette écriture.](workflows-guide-saved.png)

## Lire une exécution et son reçu webhook

Effectuez cette tâche après un envoi de données. Vous pouvez aussi consulter les exécutions existantes sans nouvel envoi. L'exemple est une vraie exécution webhook contenant un patient fictif.

### 1. Ouvrir History

Dans le canevas, sélectionnez **History**.

![History liste les exécutions réelles et les reçus webhook acceptés.](workflows-guide-history.png)

### 2. Choisir l'exécution

Dans **Runs**, sélectionnez la ligne correspondant à la source et à l'heure recherchées.

![Sélectionnez l'exécution webhook terminée.](workflows-guide-run-row.png)

### 3. Lire le résultat

Vérifiez Completed ou Failed, puis le statut de chaque nœud. Dans cet exemple Bundle, Form Validate est ignoré, car la branche FHIR a traité l'entrée.

![L'exécution terminée montre la branche ayant traité ce Bundle.](workflows-guide-run-result.png)

### 4. Choisir un nœud

Sélectionnez une ligne de nœud pour voir ses données reçues et produites. L'exemple sélectionne **Persist store**.

![Sélectionnez l'exécution d'un nœud pour consulter ses données.](workflows-guide-run-node.png)

### 5. Inspecter sa sortie

Sélectionnez **Output**. Utilisez **Result** ou **Logs** pour les autres détails enregistrés. La réussite d'un nœud de stockage ne prouve pas qu'un destinataire en aval a lu les données.

![Output contient les données transmises par le nœud sélectionné.](workflows-guide-run-output.png)

### 6. Inspecter la requête acceptée

Sélectionnez **Webhook receipts**. Rapprochez l'identifiant de requête et le statut de la réponse à l'émetteur. Un reçu en attente ou en cours n'est pas une exécution terminée.

![Webhook receipts montre la requête acceptée et son statut final.](workflows-guide-receipts.png)

**Résultat attendu :** vous distinguez la requête webhook acceptée de l'exécution du workflow et des résultats de ses nœuds.

## Construire un workflow de comptage de l'entrepôt

Utilisez ce petit workflow en lecture seule pour apprendre le canevas. Il compte les demandes déjà dans l'entrepôt. Zéro est un résultat valide. Aucun jeu de données ni connecteur de base n'est nécessaire.

### 1. Ouvrir Workflow actions

Revenez à la liste Workflows et ouvrez les points **Workflow actions**.

![Ouvrez Workflow actions pour créer ou importer.](workflows-guide-list-actions.png)

### 2. Choisir New

Sélectionnez **New**.

![New ouvre un canevas vide.](workflows-guide-new.png)

### 3. Nommer le workflow

Définissez un nom utile dans **Workflow name**. L'exemple utilise `Warehouse row count`.

![Nommez le workflow avant de l'enregistrer.](workflows-guide-name.png)

### 4. Trouver Manual Trigger

Dans Node library, recherchez `Manual Trigger`.

![Recherchez Manual Trigger dans Node library.](workflows-guide-find-manual.png)

### 5. Ajouter le déclencheur

Glissez **Manual Trigger** sur une zone vide du canevas.

![Glissez Manual Trigger sur le canevas.](workflows-guide-manual-card.png)

### 6. Ajouter SQL Query

Recherchez `SQL Query` et glissez-le à côté du déclencheur. Effacez ensuite la recherche de la bibliothèque.

![Glissez SQL Query à droite du déclencheur.](workflows-guide-sql-card.png)

### 7. Relier les nœuds

Glissez le point à droite de Manual Trigger vers celui à gauche de SQL Query. Vérifiez qu'une ligne les relie.

![Reliez la sortie droite du déclencheur à l'entrée gauche de SQL Query.](workflows-guide-connect.png)

## Configurer et exécuter le comptage

Continuez avec les deux nœuds reliés. Cette requête en lecture seule compte les demandes déjà présentes dans l'entrepôt. Votre nombre peut différer de l'exemple.

### 1. Saisir la requête

Sélectionnez SQL Query, puis son engrenage Configure. Dans **SQL (SELECT only)**, saisissez `SELECT COUNT(*) AS requests FROM lab_requests`. Cette requête lit le schéma de rapport.

![Utilisez une requête en lecture seule sur le schéma de rapport.](workflows-guide-sql.png)

### 2. Enregistrer la définition

Sélectionnez **Save**.

![Save crée le workflow nommé.](workflows-guide-save-new.png)

### 3. Préparer l'exécution

Sélectionnez **Run**. Le déclencheur manuel attend votre prochaine action.

![Run prépare le déclencheur manuel.](workflows-guide-run.png)

### 4. Lancer le déclencheur

Sélectionnez le bouton de lecture **Click to run** sur Manual Trigger.

![Sélectionnez le bouton de lecture du déclencheur manuel pour lancer l'exécution.](workflows-guide-fire-trigger.png)

### 5. Lire le nombre

Après Completed, ouvrez SQL Query et sélectionnez **Output**. Lisez la valeur `requests`. Votre nombre peut différer de l'image.

![La sortie contient le nombre actuel de demandes, qui peut être nul.](workflows-guide-sql-output.png)

**Résultat attendu :** l'exécution termine en deux étapes et produit un élément contenant le nombre actuel de demandes.

![Une exécution réussie se termine par Completed.](workflows-guide-completed.png)

## Exporter une définition de workflow

Conservez ainsi une copie portable d'une définition. Les définitions exportées peuvent contenir de la configuration. Examinez-les avant de les partager.

### 1. Ouvrir les actions de la ligne

Revenez à la liste et ouvrez les points de la ligne du workflow.

![Chaque ligne de workflow a son propre menu d'actions.](workflows-guide-row-actions.png)

### 2. Choisir Export

Sélectionnez **Export**. Le navigateur télécharge un fichier `.workflow.json`. Le menu d'actions de la liste propose Import pour ce format.

![Export télécharge la définition du workflow en JSON.](workflows-guide-export.png)

**Résultat attendu :** vous avez une copie JSON de la définition. Export n'exécute pas le workflow.

## Créer une copie distincte

Utilisez Duplicate avant d'expérimenter avec un workflow personnalisé enregistré. La copie a sa propre définition.

### 1. Ouvrir les actions de la ligne

Ouvrez les points à côté du workflow à copier.

![Chaque ligne de workflow a son propre menu d'actions.](workflows-guide-row-actions.png)

### 2. Choisir Duplicate

Sélectionnez **Duplicate**. Une nouvelle ligne se termine par **(copy)**. Ouvrez-la avant de modifier.

![Duplicate crée une copie distincte du workflow.](workflows-guide-duplicate.png)

**Résultat attendu :** l'original et la copie apparaissent séparément.

![La copie distincte a sa propre ligne.](workflows-guide-duplicate-result.png)

## Retirer un workflow personnalisé

Effectuez cette tâche seulement si la définition est devenue inutile. Delete retire définitivement le workflow personnalisé sélectionné. L'exemple retire la copie temporaire.

### 1. Choisir Delete

Ouvrez les points de la ligne du workflow personnalisé et sélectionnez **Delete**.

![Delete est disponible pour les workflows personnalisés.](workflows-guide-delete.png)

### 2. Confirmer le workflow nommé

Lisez le nom dans la confirmation. Sélectionnez **Delete** uniquement pour la définition à retirer.

![Confirmez uniquement la copie de workflow personnalisé à retirer.](workflows-guide-delete-confirm.png)

**Résultat attendu :** la copie disparaît et l'original reste présent.

![Le workflow original reste présent après la suppression de sa copie.](workflows-guide-delete-result.png)

## Importer une définition exportée

Ajoutez ainsi un workflow depuis un fichier JSON exporté. Vérifiez la configuration avant d'exécuter une définition importée.

### 1. Ouvrir Workflow actions

Ouvrez les points au-dessus de la liste des workflows.

![Ouvrez Workflow actions pour créer ou importer.](workflows-guide-list-actions.png)

### 2. Choisir Import et un fichier

Sélectionnez **Import**, puis le fichier `.workflow.json` exporté dans le sélecteur de fichiers.

![Import lit une définition précédemment exportée.](workflows-guide-import.png)

**Résultat attendu :** le workflow personnalisé importé apparaît dans la liste. Import ne l'exécute pas.

![Import ajoute une autre définition personnalisée sans l'exécuter.](workflows-guide-import-result.png)

## Trouver les workflows sur un téléphone

Utilisez la liste des workflows sur un téléphone. Construisez et configurez les workflows du canevas sur un écran plus grand.

### 1. Rechercher dans la liste

Utilisez **Search workflows** pour trouver la définition enregistrée.

![Recherchez les workflows sur un téléphone.](workflows-guide-phone-search.png)

### 2. Ouvrir le workflow

Sélectionnez son nom. Utilisez History pour ses exécutions. Un grand écran convient mieux à l'édition du canevas.

![Ouvrez un workflow existant depuis sa ligne.](workflows-guide-phone-open.png)

## Envoyer votre propre contenu webhook

Utilisez l'URL des paramètres webhook. Utilisez HTTPS hors d'une installation de test locale. Envoyez le secret enregistré uniquement dans `X-Webhook-Token`. Utilisez une entrée acceptée par le workflow, comme un Bundle FHIR pour Ingest.

Depuis le dossier d'installation, placez le contenu approuvé dans `data/your-payload.json`. Remplacez l'hôte et le secret ci-dessous. Lisez [Commencer ici](/docs/start-here) pour les emplacements des commandes installées et de développement.

```shell
curl -X POST https://your-host/api/workflows/hooks/ingest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Token: YOUR_SECRET" \
  -H "Idempotency-Key: sender-request-123" \
  -d @data/your-payload.json
```

Une réponse terminée contient `ok`, `runId` et `correlationId`. Une réponse 202 signifie accepté, avec un identifiant de requête et une URL de suivi. Consultez cette URL avec le jeton actuel. Respectez Retry-After. Réutilisez la même clé d'idempotence et une entrée identique pour une nouvelle tentative. Une entrée différente avec la même clé retourne 409.

## Fichiers fictifs facultatifs d'exercice

Utilisez-les uniquement sur une installation de test. [Téléchargez un Bundle avec un patient fictif](https://openldr.online/docs-samples/user-guide/workflows/example-patient.json) pour pratiquer le webhook. Enregistrez-le dans `data/your-payload.json` du dossier d'installation, par exemple `~/Downloads/openldr_ce` ou `C:\openldr_ce`. Utilisez la commande précédente avec votre hôte et jeton de test.

[Téléchargez le workflow de comptage à deux nœuds](https://openldr.online/docs-samples/user-guide/workflows/warehouse-row-count.workflow.json). Importez-le par Workflow actions si vous voulez une référence après votre propre construction. Aucun fichier n'est nécessaire au fonctionnement normal.

## Choisir d'autres nœuds

Node library regroupe déclencheurs, bases de données, communication, fichiers et transformations. Recherchez par nom du nœud. Une entrée grise Coming soon ne peut pas s'exécuter.

Utilisez Postgres, MySQL ou Microsoft SQL avec un connecteur correspondant activé. SQL Query lit directement le schéma de rapport. Load Dataset lit les lignes enregistrées d'un workflow. Materialize Dataset remplace les lignes sous un nom de jeu de données.

Utilisez Edit Fields, Filter, Switch, Pivot ou Merge pour transformer les éléments. La plupart des réglages textuels lisent l'élément entrant avec `{{ $json.fieldName }}`. Adaptez les noms des champs à l'entrée réellement inspectée.

Les étapes de fichier et de livraison nécessitent leur propre configuration. [Rapports planifiés](/docs/report-pipeline) décrit les jeux de données et modèles Excel. Configurez un connecteur de messagerie approuvé avant d'ajouter une livraison.

## Traiter les requêtes webhook interrompues

History montre les reçus séparément des exécutions. Le travail en attente peut reprendre après redémarrage. Désactiver, supprimer ou modifier un workflow peut annuler ce travail. Interrupted signifie que le résultat est inconnu.

OpenLDR ne rejoue pas automatiquement le travail commencé. Vérifiez l'arrêt du premier traitement et rapprochez les effets externes avant d'utiliser une nouvelle clé de requête. Une connexion en échec ne prouve pas qu'aucun traitement n'a eu lieu. Les reçus restent après suppression du workflow.

Utilisez `./openldr` dans votre dossier installé sous Linux ou macOS, `.\openldr.ps1` sous Windows, ou `pnpm openldr` dans une copie de développement. Lancez la commande depuis votre dossier `openldr_ce`. [Start here](/docs/start-here) explique le lanceur et les chemins.

```shell
./openldr workflows receipts list WORKFLOW_ID --limit 25 --offset 0 --json
./openldr workflows receipts show REQUEST_ID --json
```

## Restaurer un workflow fourni

Les workflows système proposent **Reset to default** plutôt que Delete. La réinitialisation abandonne le graphe personnalisé et exige une confirmation. Exportez d'abord la définition actuelle si vous devez la conserver.

La réinitialisation conserve normalement le secret webhook existant. Si l'avertissement dit qu'il n'a pas pu être conservé, définissez un nouveau secret et mettez tous les émetteurs à jour. Ce guide n'a réinitialisé aucun workflow opérationnel.

## Résolution des problèmes

**Run attend sans démarrer.** Sélectionnez le bouton de lecture du déclencheur après Run.

**Un secret est rejeté.** Vérifiez la valeur enregistrée et le chemin actuel. Remplacer un secret exige Save et, pour Ingest, Save anyway. Un secret enregistré ne peut pas être révélé.

**Un nœud échoue.** Inspectez son entrée, sa configuration et ses journaux dans History. Vérifiez le connecteur requis et les noms des champs entrants.

**La saisie de formulaire indique un pipeline indisponible.** Vérifiez que le workflow fourni Ingest est activé. N'effacez ni ne supprimez ses nœuds pour diagnostiquer un émetteur.

**Une livraison annonce une réussite.** Vérifiez séparément le système destinataire. L'achèvement d'un nœud ne prouve pas qu'une personne a reçu ou lu le résultat.

## Guides associés

[Activité](/docs/activity) suit le parcours du contenu. [Rapports planifiés](/docs/report-pipeline) construit les données enregistrées et les classeurs de sortie. [Connecteurs](/docs/connectors) configure les systèmes externes.
