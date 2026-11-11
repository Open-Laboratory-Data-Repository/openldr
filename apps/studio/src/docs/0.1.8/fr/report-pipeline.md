# Rapports planifiés avec les workflows

Ce guide construit un rapport planifié classique avec les seuls workflows : interroger une base, remplir un modèle Excel à vos couleurs et l'envoyer par e-mail. Personne n'écrit ni ne lance de programme à part.

Le schéma utilise **deux workflows reliés par un jeu de données** (dataset) :

1. **Materialize** : la partie lourde. Selon un horaire, il lit la base source, remet les données en forme et enregistre un **dataset** nommé, une table de résultats stockée. Lancez-le aussi souvent que les données doivent être rafraîchies.
2. **Rapport et e-mail** : la partie livraison. Il **charge** ce dataset, remplit un modèle Excel et envoie le fichier. Lancez-le quand le rapport est dû.

Séparer le travail rend la livraison rapide, car elle lit le dataset stocké et non les tables vivantes. Les deux parties peuvent aussi suivre des horaires différents.

Les noms de nœuds et de champs des workflows sont en anglais à l'écran, ce guide les garde en anglais. Comptez 20 minutes. Sélectionnez une image ou un clip pour l'agrandir.

## Qui peut faire quoi

Il faut **Edit workflows** pour construire les workflows, et **Manage connectors** pour créer les connecteurs de base de données et de messagerie qu'ils utilisent. Voir [Workflows](/docs/workflows) et [Connecteurs](/docs/connectors).

## Avant de commencer

- **Les données d'exemple de la documentation**, pour l'exemple. Voir [Tableaux de bord, Charger les données d'exemple](/docs/dashboard#charger-les-donnees-d-exemple).
- **Un connecteur de base de données** vers votre source. Une installation neuve a **Target Warehouse (Postgres)**, que l'exemple utilise.
- **Un connecteur de messagerie** pour la partie B. SMTP est le plus simple, y compris Gmail avec un mot de passe d'application. Voir [Connecteurs, Connecteurs de messagerie](/docs/connectors#connecteurs-de-messagerie).
- **Votre modèle `.xlsx`** pour la partie B, avec une ligne d'en-tête et les données qui commencent juste en dessous.

## Exemple 1 : matérialiser un dataset depuis l'exemple

Construisez la partie Materialize sur les données d'exemple : comptez les demandes par examen pour septembre et octobre 2026, et enregistrez le résultat dans le dataset `orders_by_test_sample`.

![Nommer le workflow, poser Manual Trigger, Postgres et Materialize Dataset, les relier et écrire le SQL.](report-pipeline-build.mp4)

1. Ouvrez **Workflows**. Ouvrez **Workflow actions** et sélectionnez **New**.
2. Dans **Workflow name**, tapez `Materialize orders by test (sample)`.
3. Depuis la bibliothèque de nœuds, faites glisser **Manual Trigger** (sous **Core**), **Postgres** (sous **Databases**) et **Materialize Dataset** (sous **Core**) sur le canevas.
4. Reliez-les : Manual Trigger vers Postgres, puis Postgres vers Materialize Dataset. Tirez du point droit d'un nœud vers le point gauche du suivant.
5. Sélectionnez **Postgres**, puis son engrenage. Choisissez le connecteur **Target Warehouse (Postgres)** et tapez :

```sql
SELECT panel_desc AS test, COUNT(*) AS orders
FROM lab_requests
WHERE authored_at >= '2026-09-01' AND authored_at < '2026-11-01'
GROUP BY panel_desc
ORDER BY orders DESC
```

6. Sélectionnez **Materialize Dataset**, puis son engrenage. Dans **Dataset name**, tapez `orders_by_test_sample`. Un dataset est remplacé par nom : la dernière exécution remplace les lignes d'avant.

![Les réglages du nœud Materialize Dataset.](report-pipeline-materialize-config.png)

![Enregistrer, lancer, et l'exécution qui se termine.](report-pipeline-run.mp4)

7. Sélectionnez **Save**, puis **Run**. Sélectionnez le badge lecture sur Manual Trigger.

**Résultat attendu :** **Completed, 3 steps**. L'onglet **Output** de Materialize Dataset liste cinq éléments : Full blood count 18, Malaria rapid test 16, HIV viral load 11, Blood glucose 9, Creatinine 6.

![La sortie de l'exécution : cinq lignes.](report-pipeline-output.png)

La fenêtre de dates limite l'exemple aux deux mois de l'échantillon. Dans un vrai rapport, la fenêtre vient d'un nœud **Edit Fields**, comme dans la partie A plus bas.

### Voir le dataset

1. Dans l'éditeur de workflow, sélectionnez **Datasets** dans la barre d'outils. **orders_by_test_sample** est listé avec **5** lignes, sa date de mise à jour et un téléchargement **CSV**.

![La liste Datasets de l'éditeur de workflow.](report-pipeline-datasets.png)

2. Ouvrez **Requête**. Dans l'explorateur, dépliez **Datasets** et sélectionnez **orders_by_test_sample**. Les cinq lignes s'ouvrent dans un onglet.

![Le dataset ouvert dans Requête.](report-pipeline-query.mp4)

![Les cinq lignes du dataset dans Requête.](report-pipeline-query-result.png)

Un dataset vit dans la base interne. Pour que les nœuds SQL et les tableaux de bord l'interrogent comme une vraie table de l'entrepôt Postgres, activez **Publier les jeux de données de workflow** dans les [Paramètres](/docs/settings).

## Partie A : le workflow Materialize complet

Construisez ce graphe (déclencheur → champs → deux extractions SQL → remise en forme → matérialisation) :

![Le workflow Materialize : horaire, bornes de dates, deux extractions, un pivot, une jointure et la matérialisation](report-materialize-builder.png)

1. **Schedule trigger** : réglez le cron selon la fréquence de reconstruction des données.
2. **Edit Fields** : calculez la période, par exemple `periodStart` = premier jour du mois dernier, `periodEnd` = premier jour de ce mois. Ces valeurs alimentent les requêtes.
3. **Nœud(s) de base de données** : un ou plusieurs nœuds **Postgres / Microsoft SQL**, chacun avec le **connecteur** de la source et un `SELECT` simple. Injectez la période avec des modèles :

   ```sql
   select ...
   from requests r
   where r.registered >= '{{ $json.periodStart }}'
     and r.registered <  '{{ $json.periodEnd }}'
   ```

   Gardez chaque requête en `SELECT` portable. Faites la remise en forme dans les nœuds suivants, pas en SQL propre à une base.
4. **Pivot** (si besoin) : transformez des lignes longues en colonnes larges (par exemple une colonne par antibiotique). Réglez les clés de regroupement, la colonne pivot, la colonne de valeur et la liste fixe des colonnes de sortie.
5. **Merge → Combine by key** (si vous avez deux extractions) : joignez-les sur des clés communes (par exemple `requestid`, `organism`). Branchez d'abord la branche « gauche » sur le nœud.
6. **Materialize Dataset** : donnez-lui un nom stable, par exemple `amr_ndola_monthly`.

**Enregistrez et lancez-le.** Vérifiez que l'exécution est verte et que le dataset a des lignes. Un dataset vide veut dire que la source ou la période n'a rien renvoyé.

## Partie B : le workflow Rapport et e-mail

Construisez ce graphe (déclencheur → chargement → modèle → e-mail) :

1. **Schedule trigger** : réglez-le pour qu'il parte après le rafraîchissement du dataset par la partie A.
2. **Load Dataset** : le même nom que celui matérialisé (`amr_ndola_monthly`).

![La configuration du nœud Excel Template, avec le bouton Upload template](report-excel-template.png)

3. **Excel Template** :
   - Cliquez **Upload template** et choisissez votre `.xlsx`. La *Template artifact key* se remplit seule. Le workflow doit d'abord être enregistré, car le fichier est stocké avec lui.
   - **Start cell** : où commencent les données, par exemple `A2`.
   - **Columns (ordered)** : les champs des éléments dans l'ordre des colonnes du modèle. Les valeurs s'écrivent de gauche à droite depuis la cellule de départ.
   - **Auto-filter header cell** : par exemple `A1`, pour ajouter un filtre sur la ligne d'en-tête (facultatif).
   - **Password** : pour protéger le fichier, désignez un connecteur ou un secret qui contient le mot de passe. Laissez vide pour un fichier non protégé.
4. **Send Email** :
   - **Connector** : votre connecteur SMTP ou de messagerie.
   - **To** (et **Cc**) : les destinataires.
   - **Subject**, **Body**, **Body format**.
   - **Attachment field** : réglez sur `file` pour joindre la sortie d'Excel Template.

**Lancez-le** et vérifiez la boîte du destinataire, et ses indésirables au premier envoi.

## Un exemple plus grand : le rapport AMR mensuel

Le rapport de sensibilité aux antimicrobiens pousse le schéma au maximum :

- **Materialize :** deux `SELECT` portables, l'un pour les isolats de culture, l'autre pour les résultats d'antibiogramme en format long. Puis un **Pivot** répartit environ 50 antibiotiques en colonnes, un **Merge → Combine by key** joint les isolats à leurs résultats pivotés sur `requestid` + `organism`, et **Materialize Dataset** écrit `amr_ndola_monthly`.
- **Rapport :** **Load Dataset** → **Excel Template** remplit le modèle `AMR_temp.xlsx` (départ `A2`, filtre `A1`, mot de passe facultatif) → **Send Email** joint le fichier pour les destinataires.

Tout ce qui est propre aux antimicrobiens ou aux dates vit dans les nœuds, donc les deux mêmes workflows tournent sur Postgres ou SQL Server en choisissant simplement le bon connecteur.

## Ordre des opérations

Lancez toujours **Materialize avant Rapport** : le Rapport lit ce que Materialize a écrit. Sur un horaire, réglez le Rapport pour partir un peu après l'exécution de Materialize.

## Dépannage

- **La pièce jointe est vide ou n'a que les en-têtes :** le dataset était vide. Lancez d'abord Materialize et vérifiez la période et la requête source.
- **« Save the workflow first » à l'envoi d'un modèle :** enregistrez le workflow, puis envoyez le fichier.
- **L'e-mail part sans pièce jointe :** réglez **Attachment field** de Send Email sur `file`.
- **Gmail refuse la connexion :** utilisez un mot de passe d'application, pas votre mot de passe normal. Voir [Connecteurs, Envoyer depuis Gmail](/docs/connectors#envoyer-depuis-gmail-avec-un-mot-de-passe-d-application).
- **Un nœud de base de données n'a rien sur quoi s'exécuter :** créez et attachez un connecteur. Voir [Connecteurs](/docs/connectors).
- **La jointure ne donne aucune ligne :** vérifiez que les deux branches utilisent les **mêmes noms de clés**, et que la branche gauche est branchée en premier sur Merge.

## Sur un téléphone

Les workflows se lisent sur un téléphone, mais en construire un demande un grand écran. Un rapport planifié tourne sur le serveur, il n'a besoin de l'écran de personne.

## Guides associés

- [Workflows](/docs/workflows)
- [Connecteurs](/docs/connectors)
- [Requêtes personnalisées](/docs/query)
- [Rapports](/docs/reports)
- [Paramètres](/docs/settings)
