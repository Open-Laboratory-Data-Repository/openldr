# Rapports

Utilisez Reports pour exécuter une entrée de bibliothèque avec des filtres, lire Document ou Spreadsheet, exporter les résultats et consulter l'historique. Une planification enregistre un fichier pour une période. Elle ne l'envoie pas par courriel.

Commencez avec un rapport adapté à vos données reçues. Aucun exemple de données n'est requis. Les images utilisent Request summary report créé dans Report Designer. Son entrepôt de test contient zéro demande. La requête renvoie donc une ligne contenant zéro.

Vous avez besoin de **View reports** pour ouvrir la bibliothèque, **Run reports** pour exécuter ses entrées et **Export reports** pour télécharger les résultats. **Edit report templates** permet de gérer les planifications, Edit template et les actions de gestion des rapports.

Pour ajouter un rapport à la bibliothèque, enregistrez un modèle et utilisez Create report from this design dans [Créateur de rapports](/docs/report-designer). Publish revision seul ne crée pas d'entrée.

## Trouver et ouvrir un rapport

Utilisez le nom et la catégorie pour choisir la bonne entrée avant de définir les filtres.

### 1. Ouvrir Reports

Sélectionnez Reports dans le menu principal.

![Ouvrez Reports dans le menu principal.](reports-guide-open-page.png)

### 2. Rechercher dans la bibliothèque

Saisissez une partie du nom dans Search reports. Effacez la recherche pour rétablir toute la bibliothèque.

![Recherchez dans la bibliothèque par nom de rapport.](reports-guide-search.png)

### 3. Sélectionner le rapport

Sélectionnez son nom sous sa catégorie. L'exemple est Request summary report dans Operational.

![Sélectionnez le rapport sous sa catégorie.](reports-guide-select-report.png)

### 4. Ouvrir ses actions

Sélectionnez Actions près du titre du rapport choisi.

![Le rapport choisi a son propre menu Actions.](reports-guide-report-actions.png)

## Choisir les filtres et exécuter le rapport

Choisissez les dates et autres filtres adaptés à votre question. La requête de l'exemple inclut les deux dates calendaires sélectionnées.

### 1. Ouvrir Parameters

Choisissez Parameters dans le menu Actions du rapport.

![Parameters ouvre les filtres du rapport.](reports-guide-first-parameters.png)

### 2. Ouvrir la période

Sélectionnez la commande Period. D'autres rapports peuvent l'appeler Date range ou utiliser d'autres filtres.

![Ouvrez la commande de dates pour la période du rapport.](reports-guide-first-period.png)

### 3. Choisir les dates du rapport

Choisissez un préréglage, par exemple This year, ou utilisez les sélecteurs de mois, d'année et le calendrier. Complétez les autres filtres obligatoires.

![Choisissez un préréglage ou vos propres dates.](reports-guide-first-preset.png)

### 4. Exécuter le rapport

Sélectionnez Run dans le panneau des paramètres. Attendez le résultat terminé.

![Run exécute le rapport avec les filtres choisis.](reports-guide-first-run.png)

**Résultat attendu :** Document affiche le rapport avec les valeurs choisies. Le zéro de cet exemple est un résultat valide.

![Document affiche l'exécution choisie en PDF.](reports-guide-document.png)

## Télécharger le document et la feuille de calcul

Utilisez Document pour la mise en page imprimable et Spreadsheet pour les lignes exactes. Les libellés peuvent différer car le modèle peut renommer les colonnes imprimées.

### 1. Télécharger le PDF

Dans Document, utilisez Download pour enregistrer le PDF. Les flèches de page et le zoom changent l'affichage.

![Download enregistre le PDF de cette exécution.](reports-guide-pdf-download.png)

### 2. Ouvrir Spreadsheet

Sélectionnez Spreadsheet au-dessus du résultat.

![Spreadsheet affiche les lignes de requête dans une table.](reports-guide-spreadsheet-tab.png)

### 3. Vérifier les valeurs des lignes

Lisez les libellés et les cellules avant d'exporter. L'exemple montre requests égal à zéro.

![Lisez le nombre réel dans la ligne de la feuille de calcul.](reports-guide-spreadsheet-result.png)

### 4. Exporter en CSV pour obtenir le résultat de la requête

Sélectionnez Export CSV. La requête est relancée avec les paramètres du résultat affiché. Les filtres et le tri Spreadsheet ne s'appliquent pas au CSV. Les changements de source depuis l'exécution peuvent affecter le fichier.

![Export CSV exécute la requête avec les paramètres de l'exécution actuelle.](reports-guide-export-csv.png)

### 5. Exporter les lignes filtrées en XLSX

Sélectionnez Export XLSX. Il utilise le résultat chargé avec les filtres et le tri Spreadsheet sur toutes les pages. Il inclut toutes les colonnes, même celles masquées à l'écran.

![Export XLSX télécharge le filtrage et le tri actuels de la feuille de calcul.](reports-guide-export-xlsx.png)

**Résultat attendu :** le navigateur télécharge le format choisi. Choisissez l'export dont le traitement des lignes convient à votre tâche.

## Filtrer et organiser les lignes Spreadsheet

Ces commandes changent la vue Spreadsheet chargée. Elles ne modifient ni la définition du rapport ni la mise en page Document.

### 1. Ajouter un filtre

Sélectionnez Filter, puis Add filter.

![Add filter crée une règle de feuille de calcul.](reports-guide-filter-add.png)

### 2. Choisir la colonne

Sélectionnez la colonne à filtrer. L'exemple ne possède qu'une colonne requests.

![Choisissez la colonne de résultat à filtrer.](reports-guide-filter-column.png)

### 3. Définir la valeur de règle

Choisissez un opérateur et saisissez sa valeur. L'exemple utilise Equals et 0.

![Saisissez une valeur adaptée à la colonne de résultat.](reports-guide-filter-value.png)

### 4. Appliquer la règle

Sélectionnez Apply pour mettre à jour les lignes affichées.

![Apply change les lignes affichées dans Spreadsheet.](reports-guide-filter-apply.png)

### 5. Ajouter un tri

Sélectionnez Sort, puis Add sort et choisissez une colonne de résultat.

![Choisissez Add sort pour ordonner les lignes chargées.](reports-guide-sort-add.png)

### 6. Choisir le sens

Utilisez Asc ou Desc et sélectionnez Apply. L'exemple possède une ligne. Son ordre ne change donc pas visiblement.

![Asc trie des petites valeurs vers les grandes. Sélectionnez-le pour changer de sens.](reports-guide-sort-order.png)

### 7. Choisir les colonnes visibles

Ouvrez Columns et utilisez les cases. La dernière colonne visible ne peut pas être masquée. Fermez le menu après sélection.

![Columns change les champs visibles dans la page.](reports-guide-columns.png)

![Cochez les champs nécessaires. La dernière colonne visible ne peut pas être masquée.](reports-guide-column-options.png)

### 8. Réinitialiser ou utiliser les pages

Reset efface les règles et les modifications de colonnes. Utilisez Rows per page et les flèches si le résultat dépasse une page.

![Reset efface les filtres, le tri et les modifications de colonnes.](reports-guide-reset-table.png)

![Utilisez la taille de page et les flèches pour davantage de lignes.](reports-guide-pagination.png)

## Actualiser un résultat affiché

Utilisez cette tâche après une modification des données pour relancer la même question.

### 1. Choisir Refresh

Ouvrez le menu Actions du rapport et choisissez Refresh. Il utilise les valeurs du résultat affiché, même si une modification des paramètres est inachevée.

![Refresh relance avec les valeurs du résultat affiché.](reports-guide-refresh.png)

**Résultat attendu :** la requête s'exécute à nouveau. Le nouveau nombre peut être identique au précédent.

## Consulter l'historique des exécutions interactives

Utilisez l'historique pour savoir quand un rapport a été exécuté ou téléchargé et avec quels paramètres.

### 1. Ouvrir Run History

Ouvrez Actions et choisissez Run History.

![Run History liste les exécutions interactives et les tentatives planifiées enregistrées.](reports-guide-history.png)

### 2. Lire Activity

Vérifiez le format, le nombre de lignes, l'utilisateur et l'heure. Preview est une exécution interactive. pdf, csv et xlsx identifient les téléchargements.

![Lisez le format, le nombre de lignes, l'utilisateur et l'heure de chaque exécution interactive.](reports-guide-history-rows.png)

### 3. Rétablir un ancien choix de paramètres

Sélectionnez une ligne Activity pour remettre ses paramètres dans les commandes. Ouvrez Parameters et Run pour un nouveau résultat. Sélectionner l'historique ne rejoue pas sa sortie enregistrée.

![Sélectionner une ligne d'activité rétablit ses paramètres sans rejouer l'ancienne sortie.](reports-guide-history-apply.png)

## Créer une planification de rapport

Une planification enregistre un résultat pour une période. Elle n'a aucun champ de destinataire. Vérifiez le fichier généré avant de compter sur les exécutions automatiques.

### 1. Ouvrir Schedules

Ouvrez Actions et choisissez Schedules.

![Schedules gère les résultats automatiques de ce rapport.](reports-guide-schedules.png)

### 2. Choisir New Schedule

Sélectionnez New Schedule dans le panneau des planifications.

![New Schedule ouvre les paramètres de planification.](reports-guide-new-schedule.png)

### 3. Choisir la fréquence

Définissez Frequency. L'exemple choisit Weekly.

![Choisissez la fréquence de planification.](reports-guide-weekly.png)

### 4. Choisir son jour

Pour Weekly, choisissez Day of week. L'exemple utilise Mon. Monthly propose plutôt les jours 1 à 28.

![Choisissez le jour de la semaine pour la planification hebdomadaire.](reports-guide-weekday.png)

### 5. Choisir le format de sortie

Définissez Output format sur CSV, XLSX ou PDF. L'exemple utilise PDF.

![Choisissez le format du fichier enregistré.](reports-guide-schedule-format.png)

### 6. Enregistrer la planification

Ouvrez les points Actions de l'éditeur et choisissez Save. La période est calculée à l'exécution et n'est pas enregistrée sous forme de dates fixes.

![L'éditeur de planification possède son propre menu Actions.](reports-guide-schedule-actions.png)

![Save enregistre la planification.](reports-guide-schedule-save-step-6.png)

**Résultat attendu :** la liste montre fréquence, format, interrupteur d'activation et prochaine échéance.

![La planification enregistrée affiche sa fréquence, son format et sa prochaine échéance.](reports-guide-schedule-saved.png)

## Exécuter maintenant et télécharger le résultat enregistré

Run now permet de vérifier une nouvelle planification. Un message de mise en file ne prouve pas la réussite. Consultez Scheduled Runs pour connaître l'issue.

### 1. Mettre l'exécution en file

Gardez la planification activée et sélectionnez Run now. Désactivée, elle ne s'exécute pas même si un message indique sa mise en file.

![Run now met un cycle immédiat en file. Vérifiez son résultat dans Scheduled Runs.](reports-guide-schedule-run.png)

### 2. Ouvrir Scheduled Runs

Fermez Schedules. Ouvrez Actions, Run History, puis l'onglet Scheduled Runs. Rouvrez le panneau si le résultat n'est pas encore arrivé.

![Scheduled Runs sépare les sorties planifiées enregistrées de l'activité interactive.](reports-guide-scheduled-tab.png)

### 3. Lire l'état et la période

Vérifiez OK ou Failed et la période enregistrée. Une tentative échouée n'a aucun fichier de sortie.

![Vérifiez OK et la période enregistrée avant téléchargement.](reports-guide-scheduled-result.png)

### 4. Télécharger la sortie réussie

Sélectionnez Download sur une exécution enregistrée réussie.

![Download récupère la sortie enregistrée réussie.](reports-guide-scheduled-download.png)

**Résultat attendu :** le PDF téléchargé est la sortie planifiée enregistrée. Il ne remplace pas le résultat affiché sur la page du rapport.

## Désactiver, modifier ou supprimer une planification

Utilisez les commandes de la bonne ligne. La vérification désactive et supprime sa planification jetable après avoir contrôlé le fichier enregistré.

### 1. Désactiver les exécutions automatiques

Ouvrez Schedules et désactivez l'interrupteur de la ligne. Une date Next affichée ne l'emporte pas sur la désactivation.

![Désactivez l'interrupteur pour arrêter les futures exécutions automatiques.](reports-guide-schedule-toggle.png)

### 2. Modifier la planification enregistrée

Sélectionnez Edit sur la ligne.

![Edit modifie la fréquence, les filtres ou le format enregistrés.](reports-guide-schedule-edit.png)

### 3. Enregistrer les modifications voulues

Changez les paramètres nécessaires, puis utilisez Actions et Save dans cet éditeur. L'exemple change le format de sa planification désactivée en XLSX.

![Cet exemple désactivé change le format futur en XLSX.](reports-guide-schedule-edit-format.png)

![Save enregistre la planification.](reports-guide-schedule-save-step-3.png)

### 4. Supprimer une planification inutile

Sélectionnez Delete sur la bonne ligne.

![Delete supprime uniquement la planification sélectionnée.](reports-guide-schedule-delete.png)

### 5. Confirmer sa suppression

Lisez la confirmation et sélectionnez Delete si vous voulez supprimer cette planification.

![Confirmez la suppression lorsque la planification est inutile.](reports-guide-schedule-delete-confirm.png)

**Résultat attendu :** la planification choisie disparaît. La vérification ne laisse aucune planification activée ou enregistrée pour son rapport.

## Garder un rapport facile à trouver

Les favoris organisent la bibliothèque dans ce navigateur. Ils ne changent pas les données des rapports.

### 1. Épingler le rapport

Pointez la ligne du rapport et sélectionnez son étoile. Il apparaît aussi dans Pinned.

![Épinglez le rapport pour le garder près du haut de la bibliothèque de ce navigateur.](reports-guide-pin.png)

### 2. Retirer le favori

Sélectionnez à nouveau l'étoile remplie pour ne plus l'épingler.

![Sélectionnez à nouveau l'étoile remplie pour retirer le favori.](reports-guide-unpin.png)

## Ouvrir le modèle lié

Utilisez cette tâche lorsqu'un responsable autorisé doit modifier la mise en page ou les filtres du modèle.

### 1. Choisir Edit template

Ouvrez Actions et sélectionnez Edit template.

![Edit template ouvre la mise en page liée dans Report Designer.](reports-guide-edit-template.png)

### 2. Vérifier le nom du modèle

Confirmez que Report Designer a ouvert le bon modèle lié avant modification.

![Le modèle lié s'ouvre pour un responsable autorisé.](reports-guide-edit-template-result.png)

## Dépublier un rapport de la bibliothèque

Utilisez Unpublish pour masquer une entrée de bibliothèque en conservant son modèle. Le rapport passe à Draft.

### 1. Choisir Unpublish

Ouvrez le menu **Actions** du rapport voulu et sélectionnez **Unpublish**.

![Choisissez Unpublish pour le rapport à masquer.](reports-guide-unpublish.png)

### 2. Confirmer le retrait de la bibliothèque

Vérifiez le message **Report unpublished** et la liste de la bibliothèque. Le rapport ne doit plus apparaître.

![Report unpublished confirme la réussite de l'action.](reports-guide-unpublish-success.png)

**Résultat attendu :** le rapport est Draft et ne figure plus dans la bibliothèque. Son modèle reste disponible dans Report Designer.

## Supprimer un rapport inutile de la bibliothèque

Delete supprime définitivement la définition sélectionnée. Vérifiez que l'équipe n'en a plus besoin. L'exemple supprime une entrée jetable et garde le rapport principal et son modèle.

### 1. Choisir Delete report

Ouvrez Actions du rapport inutile et sélectionnez Delete report.

![Delete report supprime définitivement l'entrée sélectionnée.](reports-guide-delete-report.png)

### 2. Confirmer l'action nommée

Lisez la confirmation, puis choisissez Delete report uniquement pour la suppression voulue.

![Confirmez uniquement l'entrée à supprimer.](reports-guide-delete-report-confirm.png)

**Résultat attendu :** l'entrée disparaît de la bibliothèque. Son modèle lié reste disponible dans Report Designer.

## Exécuter un rapport existant sur téléphone

La bibliothèque commence repliée en barre étroite. Utilisez-la pour choisir le rapport, puis donnez plus de place au résultat.

### 1. Développer la bibliothèque

Sélectionnez Expand library sur la barre étroite.

![Développez la barre de bibliothèque sur téléphone.](reports-guide-phone-library.png)

### 2. Trouver et choisir le rapport

Recherchez son nom et sélectionnez-le. Repliez ensuite la bibliothèque.

![Recherchez et ouvrez le rapport.](reports-guide-phone-select.png)

### 3. Choisir les dates

Ouvrez Actions et Parameters. Ouvrez la période et choisissez un préréglage ou des dates. Sur téléphone, les préréglages passent à la ligne au-dessus d'un seul mois.

![Les préréglages passent à la ligne au-dessus du calendrier mensuel sur téléphone.](reports-guide-phone-dates.png)

### 4. Exécuter avec les valeurs sélectionnées

Sélectionnez Run dans le panneau des paramètres.

![Run reste disponible dans le panneau des paramètres du rapport.](reports-guide-phone-run.png)

### 5. Lire Spreadsheet

Après exécution, sélectionnez Spreadsheet et inspectez les valeurs. Les tables larges défilent horizontalement.

![Spreadsheet affiche le même résultat terminé sur téléphone.](reports-guide-phone-result.png)

## Comprendre l'heure et les périodes des planifications

Les planifications s'exécutent à 06:00 UTC. Cet éditeur n'a aucun réglage séparé d'heure ou de fuseau. Next et Last utilisent le fuseau du navigateur. Le filtre de fuseau d'un rapport contrôle les regroupements de données, pas l'horloge de planification.

Une nouvelle planification Daily commence demain. Weekly prend le prochain jour choisi, jamais aujourd'hui. Monthly utilise le jour choisi du mois prochain. Quarterly utilise le premier jour du prochain trimestre civil.

| Fréquence | Période à l'exécution |
| --- | --- |
| Daily | Le jour UTC précédent. |
| Weekly | Les sept jours UTC précédents, jusqu'à hier. |
| Monthly | Le mois civil précédent en UTC. |
| Quarterly | Le trimestre civil précédent en UTC. |

Run now utilise cette même période calculée. Il ne reprend pas les dates choisies sur la page du rapport. La requête doit inclure toute la journée de fin. L'exécution hebdomadaire vérifiée couvrait le 5 au 11 novembre 2026.

## Comprendre les filtres et les données des rapports

Les filtres viennent des paramètres du modèle. Modifiez-les dans Report Designer. La requête principale fournit les lignes Spreadsheet. Les liaisons des éléments du modèle fournissent Document. Un rapport peut donc avoir plusieurs tables liées alors que Spreadsheet montre sa requête principale.

Reports transmet les dates choisies aux paramètres de requête Date range, dont `period`. Les requêtes existantes avec des paramètres Text nommés `from` et `to` restent compatibles. Présentez les dates avec un paramètre de modèle Date range dans Report Designer.

Les rapports nécessitent des données reçues différentes. Un rapport de prélèvements, d'organismes ou de sensibilités ne peut pas les inventer à partir d'un comptage de demandes. Un résultat vide peut être correct selon les filtres ou les données disponibles.

Dans les rapports intégrés, Facility désigne généralement le laboratoire qui analyse. Lisez l'aide du filtre et la requête avant de supposer un regroupement par clinique ayant envoyé la demande.

## Exécuter un rapport avec la CLI

Utilisez `./openldr` dans votre dossier installé sous Linux ou macOS, `.\openldr.ps1` sous Windows, ou `pnpm openldr` dans une copie de développement. Lancez la commande depuis votre dossier `openldr_ce`. [Start here](/docs/start-here) explique le lanceur et les chemins.

```shell
./openldr report list
./openldr report run REPORT_ID --param from=2026-01-01 --param to=2026-11-12 --json
./openldr report run REPORT_ID --param from=2026-01-01 --param to=2026-11-12 --format pdf --out data/report.pdf
```

Remplacez REPORT_ID par l'entrée listée avec la première commande. Remplacez les dates et chemins de sortie par vos valeurs. L'exécution JSON vérifiée avec la CLI a renvoyé une ligne avec requests égal à zéro.

## Résultats facultatifs de vérification

L'usage normal nécessite vos rapports et vos données reçues. Aucun lot documentaire n'est requis. Pour construire le même petit rapport, utilisez la requête facultative dans [Créateur de rapports](/docs/report-designer#reference-facultative-d-exercice).

Les téléchargements réels sont [le PDF interactif](https://openldr.online/docs-samples/user-guide/reports/request-summary.pdf), [le CSV](https://openldr.online/docs-samples/user-guide/reports/request-summary.csv), [le XLSX](https://openldr.online/docs-samples/user-guide/reports/request-summary.xlsx) et [le PDF planifié enregistré](https://openldr.online/docs-samples/user-guide/reports/scheduled-request-summary.pdf). Ils contiennent seulement un nombre de demandes égal à zéro.

## Dépannage

**La bibliothèque est vide.** Effacez la recherche et vérifiez View reports. Publier un modèle seul ne crée aucune entrée.

**Run est indisponible.** Complétez les filtres obligatoires et vérifiez Run reports. Une requête peut encore exiger des valeurs que le modèle n'a pas marquées obligatoires.

**Un rapport ne renvoie aucune ligne.** Vérifiez la période, l'établissement et les données source nécessaires. Un fichier d'exemple n'est pas requis pour les rapports réels.

**Un rapport personnalisé indique required parameter: period.** Définissez les deux dates dans Parameters et relancez le rapport. Vérifiez que le modèle expose un filtre Date range et que la requête déclare ses paramètres obligatoires.

**Une exécution planifiée manque.** Vérifiez l'interrupteur d'activation, puis fermez et rouvrez Scheduled Runs. Un message de mise en file seul ne prouve aucune exécution.

**Une exécution planifiée indique Failed.** Sur ordinateur, pointez son état pour lire l'erreur enregistrée. Corrigez les paramètres concernés et réessayez Run now.

## Guides associés

[Créateur de rapports](/docs/report-designer) définit la mise en page et crée les entrées. [Requêtes](/docs/query) définit les données. [Rapports planifiés avec des workflows](/docs/report-pipeline) couvre les workflows de classeurs personnalisés et de courriel.
