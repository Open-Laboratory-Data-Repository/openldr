# Rapports planifiés avec des workflows

Utilisez deux workflows lorsqu'un rapport exige des données préparées et un modèle de classeur. Le premier lit la source et enregistre un jeu de données nommé. Le second charge ces lignes et remplit le classeur.

Commencez avec votre requête de rapport et votre classeur. Aucune donnée d'exemple n'est requise. Le petit comptage ci-dessous fonctionne aussi avec un entrepôt vide. Le classeur de pratique facultatif se trouve à la fin.

Vous avez besoin de **Edit workflows** et **Run workflows**. Configurer des connecteurs de base ou de messagerie exige aussi **Manage connectors**. Consultez [Workflows](/docs/workflows) pour les commandes du canevas.

Créez et vérifiez le classeur avant d'ajouter un nœud d'envoi. Les captures utilisent une installation de test distincte. Les paramètres de courriel servent seulement d'explication. Aucun courriel n'a été envoyé pendant cette vérification.

## Créer la requête récapitulative

Utilisez une requête en lecture seule qui renvoie les colonnes nécessaires au classeur. Ce comptage introductif renvoie une ligne même sans demandes.

### 1. Créer un workflow

Ouvrez Workflows, puis Workflow actions et choisissez **New**.

![New ouvre un workflow vide.](report-pipeline-guide-build-new.png)

### 2. Le nommer

Saisissez un nom utile dans Workflow name. L'exemple utilise `Build request summary`.

![Nommer le workflow selon sa tâche.](report-pipeline-guide-build-name.png)

### 3. Ajouter Manual Trigger

Recherchez Manual Trigger dans Node library et faites-le glisser sur le canevas.

![Faire glisser Manual Trigger depuis Node library sur le canevas.](report-pipeline-guide-build-manual.png)

### 4. Ajouter SQL Query

Recherchez SQL Query et faites-le glisser près du déclencheur. Ce nœud lit directement le schéma de rapports. Pour une autre source, utilisez un nœud de base et un connecteur.

![Faire glisser SQL Query depuis Node library sur le canevas.](report-pipeline-guide-build-sql-node.png)

### 5. Relier les nœuds

Faites glisser le point de sortie à droite du déclencheur vers le point d'entrée à gauche de SQL Query.

![Relier la sortie de Manual Trigger à l'entrée de SQL Query.](report-pipeline-guide-build-connect.png)

### 6. Saisir le SELECT

Sélectionnez SQL Query, puis son engrenage Configure. Saisissez `SELECT COUNT(*) AS requests FROM lab_requests`. Fermez le panneau pour ajouter le nœud suivant.

![Compter les demandes actuelles de l'entrepôt. Le compte peut être zéro.](report-pipeline-guide-build-sql.png)

## Enregistrer le résultat comme jeu de données

Un jeu de données conserve les dernières lignes matérialisées sous un nom. Choisissez un nom stable avant qu'un autre workflow le lise.

### 1. Ajouter Materialize Dataset

Recherchez Materialize Dataset et faites-le glisser après SQL Query.

![Faire glisser Materialize Dataset depuis Node library sur le canevas.](report-pipeline-guide-build-materialize.png)

### 2. Le relier à SQL Query

Reliez la sortie de SQL Query à l'entrée de Materialize Dataset.

![Relier la sortie de SQL Query à l'entrée de Materialize Dataset.](report-pipeline-guide-build-materialize-connect.png)

### 3. Nommer le jeu de données

Ouvrez la configuration de Materialize Dataset. Saisissez le nom choisi dans **Dataset name**. L'exemple utilise `request_summary`.

![Choisir un nom stable. Une exécution ultérieure remplace les lignes enregistrées.](report-pipeline-guide-dataset-name.png)

### 4. Enregistrer la définition

Sélectionnez **Save**.

![Enregistrer la définition avant de l'exécuter.](report-pipeline-guide-build-save.png)

### 5. Armer le workflow

Sélectionnez **Run**.

![Run arme le déclencheur manuel.](report-pipeline-guide-build-run.png)

### 6. Lancer le déclencheur manuel

Sélectionnez le bouton de lecture de Manual Trigger. Attendez Completed.

![Sélectionner le bouton de lecture du déclencheur pour lancer l'exécution.](report-pipeline-guide-build-fire.png)

**Résultat attendu :** les trois étapes enregistrent les lignes actuelles de la requête sous le nom choisi.

![Completed confirme que le workflow a atteint sa fin.](report-pipeline-guide-build-completed.png)

## Vérifier et télécharger les lignes enregistrées

Vérifiez le jeu de données avant de créer le classeur. Une requête de comptage produit une ligne dont la valeur peut être zéro.

### 1. Ouvrir Datasets

Sélectionnez **Datasets** dans la barre du workflow.

![Datasets ouvre les jeux de données enregistrés des workflows.](report-pipeline-guide-datasets-button.png)

### 2. Vérifier le jeu enregistré

Lisez son nom, son nombre de lignes et son heure de mise à jour. Vérifiez que le nom correspond à Materialize Dataset.

![Lire le nom enregistré, le nombre de lignes et l'heure de mise à jour.](report-pipeline-guide-dataset-row.png)

### 3. Télécharger le CSV

Sélectionnez **CSV** sur cette ligne pour consulter les valeurs dans un autre outil.

![CSV télécharge les lignes enregistrées.](report-pipeline-guide-dataset-csv.png)

**Résultat attendu :** le CSV téléchargé contient les lignes que le second workflow chargera.

## Créer le workflow du classeur

Utilisez un second workflow pour lire les lignes préparées. Il peut s'exécuter après leur actualisation par le premier workflow.

### 1. Créer et nommer le workflow

Revenez à Workflows et choisissez New. Donnez un nom comme `Create summary workbook`.

![New ouvre un workflow vide.](report-pipeline-guide-deliver-new.png)

![Nommer le workflow selon sa tâche.](report-pipeline-guide-deliver-name.png)

### 2. Ajouter Manual Trigger

Faites glisser Manual Trigger depuis la bibliothèque sur le canevas.

![Faire glisser Manual Trigger depuis Node library sur le canevas.](report-pipeline-guide-deliver-manual.png)

### 3. Ajouter Load Dataset

Faites glisser Load Dataset à côté.

![Faire glisser Load Dataset depuis Node library sur le canevas.](report-pipeline-guide-deliver-load.png)

### 4. Relier le déclencheur

Reliez la sortie de Manual Trigger à l'entrée de Load Dataset.

![Relier la sortie de Manual Trigger à l'entrée de Load Dataset.](report-pipeline-guide-deliver-load-connect.png)

### 5. Choisir le jeu enregistré

Ouvrez la configuration de Load Dataset. Saisissez dans Dataset name le nom exact écrit par le premier workflow, comme `request_summary`. Fermez le panneau.

![Charger le nom exact produit par le premier workflow.](report-pipeline-guide-load-name.png)

### 6. Ajouter Excel Template

Faites glisser Excel Template sur le canevas après Load Dataset.

![Faire glisser Excel Template depuis Node library sur le canevas.](report-pipeline-guide-deliver-excel.png)

### 7. Relier Excel Template

Reliez la sortie de Load Dataset à l'entrée de Excel Template.

![Relier la sortie de Load Dataset à l'entrée de Excel Template.](report-pipeline-guide-deliver-excel-connect.png)

## Configurer le modèle de classeur

Utilisez votre classeur .xlsx. Placez les en-têtes au-dessus des cellules qui recevront les données. Faites correspondre les noms des champs reçus aux colonnes.

### 1. Enregistrer avant l'envoi

Sélectionnez Save. L'envoi du modèle exige un identifiant de workflow enregistré.

![Enregistrer d'abord pour que l'envoi dispose d'un identifiant de workflow.](report-pipeline-guide-template-save.png)

### 2. Envoyer le modèle

Ouvrez la configuration de Excel Template, sélectionnez **Upload template**, puis votre fichier .xlsx. La clé de l'artefact se remplit après l'envoi.

![Envoyer votre classeur .xlsx avec une ligne d'en-têtes.](report-pipeline-guide-template-upload.png)

![L'envoi renseigne la clé de l'artefact du modèle.](report-pipeline-guide-template-uploaded.png)

### 3. Définir la première cellule de données

Définissez **Start cell** sur la cellule de données en haut à gauche. Utilisez A2 si la première ligne contient les en-têtes.

![A2 écrit les données sous l'en-tête de la première ligne.](report-pipeline-guide-start-cell.png)

### 4. Associer les colonnes dans l'ordre

Dans **Columns (ordered)**, saisissez les noms des champs reçus séparés par des virgules. Le comptage utilise seulement `requests`.

![Lister les champs reçus dans l'ordre des colonnes du classeur.](report-pipeline-guide-template-columns.png)

### 5. Choisir un en-tête de filtre facultatif

Définissez **Auto-filter header cell** sur A1 pour un filtre en première ligne, ou laissez vide.

![A1 active un filtre sur la ligne d'en-têtes.](report-pipeline-guide-auto-filter.png)

### 6. Nommer le fichier produit

Renseignez **File name**, par exemple `request-summary.xlsx`.

![Définir le nom du fichier à télécharger.](report-pipeline-guide-file-name.png)

## Exécuter et vérifier le classeur

Vérifiez le fichier avant sa planification ou son envoi. Contrôlez les vraies valeurs, les en-têtes et la mise en forme dans votre tableur.

### 1. Enregistrer les paramètres du modèle

Sélectionnez Save.

![Enregistrer la définition avant de l'exécuter.](report-pipeline-guide-deliver-save.png)

### 2. Armer l'exécution

Sélectionnez Run.

![Run arme le déclencheur manuel.](report-pipeline-guide-deliver-run.png)

### 3. Lancer Manual Trigger

Sélectionnez son bouton de lecture et attendez Completed.

![Sélectionner le bouton de lecture du déclencheur pour lancer l'exécution.](report-pipeline-guide-deliver-fire.png)

### 4. Télécharger le fichier produit

Ouvrez Excel Template, sélectionnez Output, puis le téléchargement du classeur nommé.

![Télécharger le classeur produit depuis Output de Excel Template.](report-pipeline-guide-workbook-download.png)

**Résultat attendu :** le classeur contient les lignes enregistrées. L'exemple possède Requests en A1 et le nombre zéro en A2.

![Completed confirme que le workflow a atteint sa fin.](report-pipeline-guide-deliver-completed.png)

## Planifier la reconstruction

Ajoutez la planification après une exécution manuelle donnant les lignes voulues. Une expression cron à cinq parties définit minute, heure, jour du mois, mois et jour de semaine.

### 1. Ajouter Schedule

Ouvrez le premier workflow et faites glisser Schedule depuis Node library sur le canevas.

![Faire glisser Schedule depuis Node library sur le canevas.](report-pipeline-guide-schedule-node.png)

### 2. Définir l'expression cron

Ouvrez la configuration de Schedule. Définissez **Cron Expression** pour l'heure voulue. `0 6 * * *` signifie 06:00 chaque jour dans le fuseau choisi.

![Définir une expression cron à cinq parties pour l'heure de reconstruction.](report-pipeline-guide-schedule-cron.png)

### 3. Définir le fuseau horaire

Saisissez un fuseau IANA comme `Africa/Dar_es_Salaam`. Un champ Timezone vide utilise UTC.

![Utiliser le fuseau dans lequel la planification doit s'interpréter.](report-pipeline-guide-schedule-timezone.png)

### 4. Relier la planification

Fermez la configuration et reliez la sortie de Schedule à l'entrée de SQL Query. Gardez le déclencheur manuel pour les lancements volontaires.

![Relier la sortie de Schedule à l'entrée de SQL Query.](report-pipeline-guide-schedule-connect.png)

### 5. Enregistrer la définition planifiée

Sélectionnez Save lorsque vous voulez activer la planification reliée. Vérifiez History après sa première échéance.

![Save active la planification reliée.](report-pipeline-guide-schedule-save.png)

**Résultat attendu :** la planification enregistrée détermine les reconstructions. Cette vérification a enregistré les paramètres puis désactivé le workflow de test. Le déclenchement par l'horloge n'a pas été testé.

## Configurer l'envoi facultatif par courriel

Ajoutez l'envoi seulement après approbation du connecteur et des destinataires. La vérification montre un connecteur de boucle locale inutilisé et une adresse example.invalid. Ce nœud n'a été ni enregistré ni exécuté.

### 1. Ajouter et relier Send Email

Ouvrez le workflow du classeur, ajoutez Send Email (SMTP), puis reliez la sortie de Excel Template à son entrée.

![Faire glisser Send Email (SMTP) depuis Node library sur le canevas.](report-pipeline-guide-email-node.png)

![Relier la sortie de Excel Template à l'entrée de Send Email (SMTP).](report-pipeline-guide-email-connect.png)

### 2. Choisir le connecteur de messagerie

Ouvrez la configuration du nœud. Choisissez votre connecteur SMTP approuvé. Gmail et Outlook ont leurs propres types de nœuds et connecteurs correspondants.

![Choisir votre connecteur SMTP approuvé.](report-pipeline-guide-email-connector.png)

### 3. Définir les destinataires

Saisissez les destinataires approuvés dans To. Ajoutez Cc seulement si nécessaire. Remplacez l'adresse d'exemple par votre vraie destination autorisée.

![Saisir le destinataire approuvé. Cette adresse d'exemple ne peut pas recevoir de courrier.](report-pipeline-guide-email-to.png)

### 4. Définir l'objet

Saisissez un Subject clair.

![Donner un objet clair au message.](report-pipeline-guide-email-subject.png)

### 5. Écrire le corps

Saisissez le Body du message.

![Écrire le corps du message.](report-pipeline-guide-email-body.png)

### 6. Choisir le format correspondant

Choisissez Plain text ou HTML selon le texte écrit.

![Choisir Plain text ou HTML selon le corps du message.](report-pipeline-guide-email-format.png)

### 7. Joindre le champ du classeur

Définissez **Attachment field** sur `file`, le champ de sortie de Excel Template. Une valeur vide n'envoie aucune pièce jointe.

![Utiliser file pour joindre la sortie de Excel Template.](report-pipeline-guide-email-attachment.png)

**Résultat attendu :** les paramètres définissent le transport, les destinataires, le contenu et la pièce jointe. Enregistrer puis exécuter un nœud relié envoie un vrai courriel. Vérifiez la boîte destinataire seulement après autorisation de ce test par votre équipe.

## Consulter les workflows de rapports sur téléphone

Créez le canevas sur grand écran. Sur téléphone, utilisez la liste et History pour consulter une définition existante.

### 1. Trouver les workflows

Recherchez leurs noms dans Workflows.

![Trouver les workflows de rapports enregistrés sur téléphone.](report-pipeline-guide-phone-find.png)

### 2. Ouvrir le workflow du classeur

Sélectionnez son nom dans la liste.

![Ouvrir le workflow du classeur pour consulter son historique.](report-pipeline-guide-phone-open.png)

### 3. Lire History

Sélectionnez History et vérifiez l'état et l'heure d'exécution.

![Lire l'exécution manuelle terminée dans History.](report-pipeline-guide-phone-history.png)

## Classeur de pratique facultatif

[Télécharger le classeur de pratique à une colonne](https://openldr.online/docs-samples/user-guide/report-pipeline/example-summary-template.xlsx). Il contient l'en-tête Requests en A1. Il sert au comptage en lecture seule ci-dessus et ne contient aucune donnée patient. Votre classeur peut utiliser d'autres colonnes et formats.

[Télécharger le classeur produit pendant la vérification](https://openldr.online/docs-samples/user-guide/report-pipeline/generated-request-summary.xlsx) pour comparer le résultat attendu. Ce fichier provient de l'exécution réelle isolée, avec zéro demande dans son entrepôt.

## Adapter le résumé à votre rapport

Remplacez le comptage par votre SELECT approuvé et associez ses champs au classeur. Pour une autre base, utilisez un nœud de connecteur Postgres, MySQL ou Microsoft SQL correspondant.

Pour les périodes de rapport, définissez periodStart et periodEnd avant la requête, puis lisez-les avec `{{ $json.periodStart }}`. Gardez la requête, les types de paramètres et les bornes de dates cohérents avec la source.

Utilisez Pivot pour transformer une valeur reçue en plusieurs colonnes. Utilisez Merge avec Combine by key pour joindre deux branches. Configurez les vraies clés et règles de collision nécessaires. Ces transformations plus grandes n'ont pas été testées pendant cette vérification.

Vous pouvez aussi ouvrir les jeux sous Datasets dans [Requêtes](/docs/query). La publication des jeux de workflow en SQL d'entrepôt est un choix facultatif dans Settings. Gardez le même nom dans les deux workflows.

## Choisir l'heure d'envoi

Planifiez le classeur après l'heure prévue de fin d'actualisation. Prévoyez le temps de la requête source. Un simple décalage ne garantit pas qu'un premier workflow particulièrement lent est terminé. Vérifiez l'heure de mise à jour du jeu et History.

Run manuel utilise aussi le jeu actuellement enregistré. Il ne reconstruit pas automatiquement le premier workflow. Relancez celui-ci quand des données fraîches sont nécessaires.

## Résolution de problèmes

**Le jeu de données manque.** Exécutez le premier workflow et recherchez les erreurs dans Materialize Dataset. Vérifiez le nom exact dans Load Dataset.

**Le classeur est vide.** Vérifiez le CSV et les noms des champs reçus. Une requête filtrée peut légitimement ne renvoyer aucune ligne.

**L'envoi exige d'enregistrer d'abord.** Enregistrez le workflow puis réessayez. Le fichier envoyé appartient à ce workflow enregistré.

**Les valeurs arrivent dans les mauvaises colonnes.** Vérifiez Start cell et Columns (ordered). L'association écrit les champs de gauche à droite dans l'ordre indiqué.

**La planification n'a pas produit le fichier attendu.** Vérifiez l'activation du workflow, l'expression cron, le fuseau, puis History. Une planification enregistrée ne prouve pas son déclenchement.

**Un courriel n'a pas le classeur.** Vérifiez la sortie amont de Excel Template et Attachment field. Confirmez séparément le transport et le destinataire réels.

## Guides associés

[Workflows](/docs/workflows) explique le canevas et l'historique. [Requêtes](/docs/query) permet de parcourir les jeux enregistrés. [Connecteurs](/docs/connectors) configure les transports de source et d'envoi.
