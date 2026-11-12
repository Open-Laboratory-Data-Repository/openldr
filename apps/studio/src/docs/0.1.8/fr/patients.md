# Patients

Trouvez les patients reçus avec les données de laboratoire, lisez leurs identifiants et demandes, puis examinez les doublons possibles. La page Patients lit les fiches source. Elle ne permet ni modification ni fusion de patients.

**Les réglages des patients sont facultatifs.** OpenLDR reçoit les patients avec les données de laboratoire avant le libellé des systèmes d'identifiants. Nous recommandons vivement d'ajouter des libellés utiles et d'examiner les doublons possibles pendant l'utilisation.

Utilisez vos fiches reçues et vos systèmes d'identifiants. Aucun jeu de données de documentation n'est nécessaire. Les images montrent des patients fictifs sur une installation de test. Des [données d'exercice facultatives](#exercice-facultatif-avec-des-patients-fictifs) se trouvent à la fin.

**View patient index** permet une liste masquée et les recherches par identifiant exact. **View patient identifiers** permet les noms complets, identifiants, dates de naissance, coordonnées et recherches par nom. Ces consultations non masquées sont auditées. Les images utilisent ce droit.

**Manage patient index** permet les réglages des systèmes d'identifiants et les décisions sur les doublons. Un laboratoire recevant ses libellés du central ne peut pas les modifier ici.

## Trouver un patient et lire ses détails

Vérifiez ainsi la personne décrite par une fiche source et ses demandes de laboratoire. Si la liste est vide, revenez après la réception de patients par votre flux habituel.

### 1. Ouvrir Patients

Sélectionnez **Patients** dans le menu principal, puis l'onglet **Patients**.

![Patients se trouve dans le menu principal à gauche.](patients-guide-open-page.png)

![Patients liste les fiches reçues des systèmes source.](patients-guide-patients-tab.png)

### 2. Rechercher la personne

Dans **Search name or identifier**, saisissez un nom ou identifiant. Sans droit de consulter les identifiants, le champ affiche **Exact identifier** et exige la valeur complète.

![Avec le droit de consulter les identifiants, la recherche trouve une partie du nom.](patients-guide-search-name.png)

### 3. Vérifier la ligne correspondante

Lisez le nom, le sexe, l'âge, les identifiants affichés et le nombre de demandes. Vérifiez la personne avec vos fiches source. Les noms seuls ne prouvent pas l'identité.

![Lisez la ligne du patient correspondant avant de l'ouvrir.](patients-guide-search-result.png)

### 4. Ouvrir le patient

Sélectionnez la ligne. **Identity** dans le panneau Patient montre les détails source. Les points de la ligne proposent aussi **View**.

![Sélectionnez la ligne du patient pour ouvrir ses détails en lecture seule.](patients-guide-open-row.png)

![View dans le menu de ligne ouvre les mêmes détails.](patients-guide-row-view.png)

![Identity montre les détails source. La page Patients ne les modifie pas.](patients-guide-identity.png)

### 5. Lire les identifiants

Sous **Identifiers**, lisez chaque système et valeur. Un libellé change le nom affiché, pas la valeur source.

![Identifiers montre les systèmes et valeurs reçus pour ce patient.](patients-guide-identifiers.png)

### 6. Lire les demandes

Sous **Requests**, vérifiez les dates de commande, panels, établissements demandeurs, statuts et nombres de résultats. Utilisez la pagination s'il reste des lignes.

![Requests montre les commandes, statuts et nombres de résultats du patient.](patients-guide-requests.png)

### 7. Fermer le panneau

Sélectionnez **Close** en haut à droite pour revenir à la liste.

![Close revient à la liste des patients.](patients-guide-close-details-step-7.png)

**Résultat attendu :** vous consultez la fiche sans changer les détails du patient. Les corrections d'identité se font dans le système qui les maintient.

## Nommer un système d'identifiants et l'afficher dans la liste

Un système d'identifiants est l'URI indiquant le type d'une valeur d'identifiant. Configurez les systèmes reçus de vos sources. Utilisez un libellé reconnaissable.

### 1. Ouvrir Identifier systems

Sélectionnez **Identifier systems** en haut de Patients. Il liste les systèmes reçus et les nombres de patients.

![Identifier systems liste les types d'identifiants reçus.](patients-guide-identifier-tab.png)

### 2. Choisir Edit pour le système

Ouvrez les points de la bonne ligne et sélectionnez **Edit**. Vérifiez l'URI avant de modifier les réglages.

![Ouvrez les points du système à nommer.](patients-guide-identifier-row-actions.png)

![Edit ouvre les réglages d'affichage et de recherche du système.](patients-guide-identifier-edit.png)

### 3. Saisir le libellé

Dans **Label**, saisissez un nom lisible. L'exemple fictif utilise `Example ID`. Laissez vide pour utiliser le nom fourni par la source.

![Donnez au système un nom reconnaissable. L'exemple utilise Example ID.](patients-guide-identifier-label.png)

### 4. Choisir si ses valeurs sont affichées

Activez **Show in the list** pour inclure ce système dans la colonne Identifiers du tableau Patients.

![Show in the list inclut ce système d'identifiants dans le tableau des patients.](patients-guide-identifier-list.png)

### 5. Vérifier sa participation aux recherches

Gardez **Search matches it** activé pour les valeurs utiles à l'identification. Désactivez-le pour un système de valeurs génériques qui ne doit pas identifier une personne. Ce réglage affecte aussi les doublons par identifiant identique.

![Search matches it définit si les identifiants du système participent aux recherches.](patients-guide-identifier-searchable.png)

### 6. Ouvrir Identifier system actions

Sélectionnez les points de ce panneau de réglages.

![Les réglages du système ont leur propre menu à points.](patients-guide-identifier-actions.png)

### 7. Enregistrer les réglages

Sélectionnez **Save**.

![Save enregistre le libellé et les choix d'affichage et de recherche.](patients-guide-identifier-save.png)

**Résultat attendu :** la ligne montre le libellé enregistré et les réglages d'affichage et de recherche.

![Le système affiche maintenant le libellé enregistré.](patients-guide-identifier-saved.png)

## Trouver un patient par un identifiant affiché

Recherchez la valeur de l'identifiant, pas son libellé. Plusieurs fiches peuvent apparaître si la source contient un identifiant partagé ou dupliqué.

### 1. Revenir à Patients et rechercher

Sélectionnez **Patients** et saisissez la valeur de l'identifiant. L'exemple recherche `DOCS-001`.

![Patients liste les fiches reçues des systèmes source.](patients-guide-patients-tab.png)

![Recherchez la valeur, pas le libellé. Ces deux fiches fictives partagent volontairement DOCS-001.](patients-guide-search-identifier.png)

### 2. Vérifier la valeur libellée

Lisez la colonne Identifiers. L'exemple montre **Example ID: DOCS-001**. Les deux fiches fictives la partagent volontairement.

![L'identifiant apparaît avec son libellé configuré.](patients-guide-listed-identifier.png)

**Résultat attendu :** les patients correspondants apparaissent avec le libellé configuré. Une colonne Identifiers vide ne prouve pas l'absence d'identifiants source. Vérifiez le réglage d'affichage.

## Trouver les fiches marquées Merged

Effectuez cette tâche si la source a désactivé une fiche ou signalé son remplacement. La liste montre les fiches actives par défaut.

### 1. Ouvrir Filter

Sélectionnez **Filter** au-dessus de la liste.

![Utilisez Filter pour inclure les fiches marquées Merged par la source.](patients-guide-filter-open.png)

### 2. Ajouter un filtre

Sélectionnez **Add filter**.

![Add filter commence une règle Status.](patients-guide-filter-add.png)

### 3. Vérifier la règle Status

Utilisez la colonne **Status** et gardez **Equals**.

![Choisissez Status et gardez l'opérateur Equals.](patients-guide-filter-status.png)

### 4. Choisir Merged

Sélectionnez la valeur **Merged**.

![Choisissez Merged pour consulter les fiches inactives ou remplacées.](patients-guide-filter-merged.png)

### 5. Appliquer le filtre

Sélectionnez **Apply**.

![Apply actualise la liste avec cette règle Status.](patients-guide-filter-apply.png)

**Résultat attendu :** la liste montre les fiches Merged. Un badge apparaît à côté des noms. Effacez le filtre de statut pour revenir aux fiches actives.

![Les fiches Merged montrent un badge à côté du nom du patient.](patients-guide-merged-row-step-0.png)

## Suivre un remplacement signalé par la source

Une fiche remplacée peut pointer vers le patient destinataire de la fusion en amont. OpenLDR suit ce lien signalé. Cette action ne fusionne aucune fiche.

### 1. Ouvrir la fiche fusionnée

Sélectionnez la ligne du patient fusionné. Un remplacement signalé ajoute un menu d'actions dans Identity.

![Les fiches Merged montrent un badge à côté du nom du patient.](patients-guide-merged-row-step-1.png)

![Un remplacement signalé ajoute un menu à points au panneau Patient.](patients-guide-merged-actions-step-1.png)

### 2. Ouvrir les actions du panneau Patient

Sélectionnez les points à côté de **Identity**.

![Un remplacement signalé ajoute un menu à points au panneau Patient.](patients-guide-merged-actions-step-2.png)

### 3. Suivre le remplacement

Sélectionnez **Open the patient this record was merged into**.

![Open the patient this record was merged into suit le remplacement source.](patients-guide-merged-replacement.png)

**Résultat attendu :** le patient de remplacement s'ouvre dans le panneau Patient en lecture seule.

![Le patient de remplacement s'ouvre dans le même panneau en lecture seule.](patients-guide-replacement-result.png)

## Examiner un groupe de doublons possibles

Examinez les éléments avant de décider si les fiches décrivent la même personne. Un identifiant partagé peut venir d'une erreur de saisie ou d'une valeur générique. OpenLDR ne décide pas à votre place.

### 1. Ouvrir Duplicates

Sélectionnez **Duplicates** en haut de Patients.

![Duplicates liste les groupes pouvant représenter une même personne.](patients-guide-duplicates-tab.png)

### 2. Lire la règle et les éléments

Vérifiez pourquoi chaque groupe est proposé et son nombre de patients. L'exemple correspond à un identifiant partagé.

![Lisez la règle et les éléments avant de décider si le groupe est un doublon.](patients-guide-duplicate-group.png)

### 3. Ouvrir le groupe

Sélectionnez sa ligne pour ouvrir **Likely duplicates**.

![Sélectionnez la ligne du groupe pour examiner ses membres.](patients-guide-duplicate-open.png)

### 4. Comparer les membres

Lisez les éléments, identifiants et détails d'identité disponibles. La comparaison par nom identique exige aussi des détails de naissance correspondants et des sexes compatibles.

![Le panneau du groupe explique pourquoi ces patients ont été rapprochés.](patients-guide-duplicate-evidence.png)

### 5. Ouvrir un membre si nécessaire

Utilisez les points du membre et sélectionnez **Open patient** pour consulter sa fiche complète et ses demandes.

![Chaque membre a son menu à points pour ouvrir sa fiche complète.](patients-guide-member-actions.png)

![Open patient ouvre la fiche en lecture seule du membre choisi.](patients-guide-member-open.png)

**Résultat attendu :** le membre choisi s'ouvre dans un panneau Patient en lecture seule. Examiner le groupe ne fusionne aucun patient.

![Open patient affiche le membre choisi dans son panneau en lecture seule.](patients-guide-member-view-result.png)

## Indiquer qu'un groupe contient des personnes différentes

Faites-le uniquement après avoir vérifié qu'il s'agit de personnes différentes. Pour un vrai doublon, corrigez plutôt les fiches source. La décision de groupe est réversible.

### 1. Revenir au groupe

Si le panneau Patient d'un membre est ouvert, sélectionnez **Close** pour revenir à Likely duplicates.

![Close revient à la liste des patients.](patients-guide-close-details-step-1.png)

### 2. Saisir une raison si utile

Dans **Reason**, indiquez pourquoi les personnes sont différentes. L'exemple décrit explicitement sa démonstration fictive.

![Après confirmation de personnes différentes, saisissez la raison de la décision.](patients-guide-duplicate-reason.png)

### 3. Ouvrir les actions du groupe

Sélectionnez les points à côté du titre Evidence.

![Utilisez les points du groupe pour enregistrer votre décision.](patients-guide-duplicate-actions.png)

### 4. Marquer le groupe comme personnes différentes

Sélectionnez **Mark as not duplicates**.

![Mark as not duplicates masque ce groupe examiné dans Open. Il ne fusionne ni ne supprime de patients.](patients-guide-duplicate-mark.png)

**Résultat attendu :** le groupe disparaît de Open. Les fiches patient restent inchangées.

![Le groupe examiné est absent de la liste Open.](patients-guide-duplicate-dismissed.png)

## Réafficher un groupe examiné

Annulez ainsi une décision Not duplicates pour renvoyer le groupe à l'examen.

### 1. Choisir Not duplicates

Dans Duplicates, ouvrez **Status** et choisissez **Not duplicates**.

![Utilisez Status pour trouver les groupes marqués comme non doublons.](patients-guide-duplicate-status.png)

![Not duplicates liste les groupes examinés.](patients-guide-duplicate-status-option.png)

### 2. Ouvrir le groupe examiné

Sélectionnez sa ligne.

![Ouvrez le groupe examiné pour annuler la décision si nécessaire.](patients-guide-duplicate-reopen.png)

### 3. Choisir Show again

Ouvrez les points du groupe et sélectionnez **Show again**.

![Utilisez les points du groupe pour enregistrer votre décision.](patients-guide-duplicate-actions.png)

![Show again renvoie le groupe dans Open sans changer les fiches patient.](patients-guide-duplicate-restore.png)

### 4. Revenir à Open

Utilisez **Status** pour choisir **Open**.

![Choisissez Open pour revenir aux groupes non résolus.](patients-guide-duplicate-status-open.png)

**Résultat attendu :** le groupe revient dans la liste ouverte d'examen.

![Le groupe est de nouveau dans Open pour examen.](patients-guide-duplicate-restored.png)

## Exporter les groupes de doublons ouverts

Effectuez cette tâche lorsque l'équipe maintenant les fiches source a besoin des groupes ouverts. L'export exige View patient identifiers et fait l'objet d'un audit.

### 1. Ouvrir les actions de Duplicates

Sélectionnez les points au-dessus du tableau Duplicates.

![L'onglet Duplicates a un menu d'export distinct.](patients-guide-duplicate-export-actions.png)

### 2. Choisir Export CSV

Sélectionnez **Export CSV**. Le navigateur télécharge les groupes ouverts.

![Export CSV télécharge les groupes ouverts pour l'équipe maintenant les données source.](patients-guide-duplicate-export.png)

**Résultat attendu :** le CSV inclut les identifiants nécessaires à l'examen source. L'export ne marque ni ne fusionne aucun patient.

## Utiliser Patients sur un téléphone

Les onglets et le panneau Patient restent disponibles sur un téléphone. Une liste large peut défiler horizontalement.

### 1. Choisir l'onglet

Utilisez Patients, Identifier systems ou Duplicates en haut.

![Patients, Identifier systems et Duplicates restent en haut sur un téléphone.](patients-guide-phone-tabs.png)

### 2. Rechercher le patient

Utilisez le champ de recherche avec les mêmes droits d'identifiants que sur ordinateur.

![Utilisez la recherche de patients sur un téléphone.](patients-guide-phone-search.png)

### 3. Ouvrir les détails du patient

Sélectionnez la ligne correspondante et faites défiler le panneau Patient pour lire ses sections.

![Le panneau Patient utilise la largeur du téléphone et ses sections défilent.](patients-guide-phone-details.png)

## Exercice facultatif avec des patients fictifs

Toutes les tâches précédentes peuvent utiliser vos fiches reçues. Ce fichier facultatif est réservé à une installation de test. Il contient trois patients fictifs, une demande, un rapport et un résultat. Deux patients partagent un identifiant. Une ancienne fiche pointe vers son remplacement.

[Téléchargez le lot d'exercice de six ressources](https://openldr.online/docs-samples/user-guide/patients/example-patients.json). Lisez [Commencer ici](/docs/start-here) pour la CLI installée et de développement. Placez ensuite le fichier dans le dossier data de l'installation.

Exemple pour une copie de développement :

```shell
cd ~/Downloads/openldr_ce
pnpm openldr ingest data/example-patients.json
```

Pour une installation Linux ou macOS, utilisez `./openldr` plutôt que `pnpm openldr`. Sous Windows, utilisez `.\openldr.ps1` depuis le dossier d'installation, comme `C:\openldr_ce`. Remplacez les exemples par votre vrai dossier. Commencer ici décrit chaque plateforme.

Ce fichier n'exige pas les fichiers d'exercice facultatifs du catalogue de tests. Les nombres de demandes et patients de votre installation peuvent différer des images.

## Comprendre le masquage et les limites des doublons

Sans View patient identifiers, les noms sont masqués, les identifiants montrent seulement leurs quatre derniers caractères et les dates de naissance seulement l'année. Téléphone et adresse électronique sont cachés. La recherche exige un identifiant exact. Ces limites concernent aussi les groupes de doublons.

Les groupes par identifiant utilisent la même valeur dans le même système d'identifiants recherchable. Les identifiants sans système et les systèmes avec Search matches it désactivé sont exclus. La comparaison nom et naissance ignore casse, espaces et accents. Seules les fiches actives sont comparées.

Un groupe montre au maximum 50 membres. Un groupe plus grand ne peut pas être marqué ici. Vérifiez si un identifiant générique a servi pour plusieurs personnes. Corrigez les données source ou le réglage de recherche du système.

Les données patient appartiennent au processus source. Cette page lit les identités, nomme les systèmes d'identifiants et enregistre les décisions d'examen des doublons. Elle n'a aucune action de modification ou fusion de patients.

## Résolution des problèmes

**La liste des patients est vide.** Vérifiez la réception de données patient par le flux habituel. Aucun exemple ni libellé d'identifiant n'est nécessaire pour recevoir des patients.

**Une partie du nom ne trouve rien.** Sans View patient identifiers, cherchez la valeur complète de l'identifiant. Vérifiez Search matches it pour ce système.

**La colonne Identifiers est vide.** Activez Show in the list pour un système reçu. Ouvrez le panneau Patient pour vérifier les identifiants source eux-mêmes.

**Les réglages d'identifiants ne peuvent pas être modifiés.** Vérifiez Manage patient index et si les libellés viennent du central. Un laboratoire géré par le central les consulte ici.

**Le panneau indique une liste périmée.** Rechargez la page et rouvrez le patient. La référence de liste peut expirer après un redémarrage du serveur.

**Un groupe de doublons revient après une mise à jour source.** Comparez les membres actuels et les éléments. Corrigez les vrais doublons dans le système source plutôt que les marquer comme personnes différentes.

## Guides associés

[Établissements](/docs/facilities) décrit l'identité des établissements. [Catalogue de tests](/docs/test-catalog) décrit les codes de tests et résultats. [Commencer ici](/docs/start-here) décrit la CLI.
