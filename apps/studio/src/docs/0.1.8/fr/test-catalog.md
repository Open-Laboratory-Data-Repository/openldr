# Catalogue de tests

Maintenez une liste partagée de tests, choisissez ceux proposés par ce laboratoire et reliez les codes reçus des sources. Un test du catalogue et un champ de résultat sont distincts. Un test peut produire plusieurs champs de résultat.

**Cette configuration est facultative.** OpenLDR peut recevoir et traiter les données de laboratoire avant cette configuration. Nous recommandons vivement de la réaliser pendant l'utilisation. Le formulaire Lab order propose les tests activés dans ce laboratoire.

Utilisez vos codes de tests, noms, prélèvements et fichiers. Les captures utilisent des exemples fictifs. Aucun jeu de données de documentation n'est nécessaire. Les [fichiers d'exercice facultatifs](#exercice-facultatif-avec-des-donnees-fictives) se trouvent à la fin.

La lecture exige **Browse terminology**. Les modifications exigent **Manage terminology**. Si le catalogue vient du central, ce laboratoire peut changer la disponibilité, les prélèvements et les noms locaux. Il ne peut pas modifier les définitions partagées.

Les captures utilisent une installation propriétaire de son catalogue. Les exemples de champs utilisent aussi un petit dictionnaire fictif de résultats. Les nombres des intervalles de référence servent uniquement à la documentation. Utilisez les intervalles et significations de codes approuvés pour vos vrais tests.

## Ajouter un test au catalogue

Ajoutez ainsi un test lorsque cette installation possède son catalogue. Recherchez un test existant avant d'ajouter un autre code.

### 1. Ouvrir Test catalog

Sélectionnez **Test catalog** dans le menu principal à gauche.

![Test catalog se trouve dans le menu principal à gauche.](test-catalog-guide-open-page.png)

### 2. Ouvrir les actions de Tests

Sélectionnez **Tests**, puis ouvrez les points à côté de la recherche et des commandes du tableau.

![Tests contient le catalogue disponible pour cette installation.](test-catalog-guide-tests-tab.png)

![Ouvrez le menu à points de la page Tests.](test-catalog-guide-page-actions-step-2.png)

### 3. Choisir Add test

Sélectionnez **Add test**. Le panneau du test s'ouvre.

![Choisissez Add test pour saisir un test manuellement.](test-catalog-guide-add-menu.png)

### 4. Saisir le code

Saisissez le code stable de votre catalogue. L'exemple fictif utilise `EXAMPLE-ALPHA`. Laissez vide uniquement si le code LOINC doit devenir le code. Un code enregistré ne peut plus être changé.

![Utilisez le code stable de votre catalogue. L'exemple utilise EXAMPLE-ALPHA.](test-catalog-guide-test-code.png)

### 5. Saisir le nom

Saisissez le nom à afficher. Un nom court est facultatif. L'exemple utilise `Example panel Alpha` et `Example Alpha`.

![Saisissez le nom de test à afficher.](test-catalog-guide-test-name.png)

![Le nom court est facultatif.](test-catalog-guide-test-short-name.png)

### 6. Choisir la catégorie

Sélectionnez la catégorie adaptée dans la liste configurée. Les catégories viennent de Terminology.

![Choisissez une catégorie dans la liste configurée.](test-catalog-guide-category-option.png)

### 7. Choisir les prélèvements acceptés

Cochez les types de prélèvement acceptés par ce test. Utilisez les choix configurés de votre vrai test.

![Cochez les types de prélèvement acceptés par ce test.](test-catalog-guide-specimen.png)

## Terminer et enregistrer le test

Continuez dans le panneau ouvert. Vous pourrez configurer ce laboratoire et les champs de résultat après l'enregistrement de la définition partagée.

### 1. Vérifier le champ LOINC

Saisissez un code LOINC confirmé si vous en avez un, sinon laissez vide. Lorsque LOINC est chargé, recherchez et sélectionnez un terme. Ici il n'est pas chargé, donc seul le format des codes saisis est vérifié.

![LOINC est facultatif. Sans dictionnaire, l'installation vérifie uniquement le format des codes saisis.](test-catalog-guide-loinc.png)

### 2. Ouvrir les actions du panneau

Sélectionnez les points du panneau de test sous son titre.

![Le panneau de test a son propre menu à points.](test-catalog-guide-sheet-actions.png)

### 3. Choisir Save

Sélectionnez **Save**. Les nouveaux tests utilisent aussi Save.

![Save crée le test. Ce laboratoire peut être configuré ensuite.](test-catalog-guide-save-menu.png)

**Résultat attendu :** le panneau se ferme et le nouveau test apparaît dans Tests. Il commence Off dans ce laboratoire sauf si vous l'avez activé dans le panneau.

![Le test apparaît dans Tests. Il commence Off dans ce laboratoire.](test-catalog-guide-created.png)

## Rendre un test disponible dans ce laboratoire

Activez les tests réellement effectués ici. Cela change la disponibilité locale utilisée par le formulaire Lab order.

### 1. Ouvrir les actions de la ligne du test

Sélectionnez les points à droite de la ligne du test.

![Utilisez les points de la ligne du test pour la disponibilité locale.](test-catalog-guide-row-actions.png)

### 2. Choisir Switch on at this lab

Sélectionnez **Switch on at this lab**. L'action devient Switch off at this lab pour un test activé.

![Switch on at this lab rend le test disponible ici.](test-catalog-guide-enable-menu.png)

**Résultat attendu :** On at this lab affiche On. Les tests importés ne sont pas activés automatiquement.

![La colonne de disponibilité locale affiche maintenant On.](test-catalog-guide-enabled.png)

## Définir le nom et les prélèvements de ce laboratoire

Utilisez les réglages locaux si ce laboratoire affiche un autre nom ou accepte moins de prélèvements. Un laboratoire recevant le catalogue du central peut aussi les modifier.

### 1. Choisir Edit

Ouvrez les points de la ligne et sélectionnez **Edit**. Le code enregistré apparaît sans champ modifiable.

![Edit ouvre le catalogue et les réglages locaux.](test-catalog-guide-edit-menu.png)

![Un test existant garde son code. Corrigez son nom et les autres champs modifiables.](test-catalog-guide-fixed-code.png)

### 2. Vérifier la disponibilité locale

Sous **This lab**, utilisez **On at this lab** pour indiquer si ce laboratoire propose le test.

![Les réglages This lab contrôlent si cette installation propose le test.](test-catalog-guide-local-enabled.png)

### 3. Vérifier les prélèvements locaux

Gardez les types acceptés par ce laboratoire. Les choix locaux peuvent restreindre la liste du catalogue. Garder tous les prélèvements suit la liste du catalogue.

![Ce laboratoire peut restreindre les choix de prélèvements du catalogue.](test-catalog-guide-local-specimen.png)

### 4. Saisir un nom local si nécessaire

Saisissez le nom local dans le champ correspondant, ou laissez vide pour utiliser celui du catalogue. L'exemple utilise `Alpha at this lab`.

![Un nom local change la présentation du test dans ce laboratoire.](test-catalog-guide-local-name.png)

### 5. Enregistrer les réglages locaux

Ouvrez les points du panneau et sélectionnez **Save**.

![Save conserve les réglages locaux avec le test existant.](test-catalog-guide-local-save.png)

**Résultat attendu :** les réglages du laboratoire sont enregistrés sans changer le code du test.

## Trouver et exporter des tests

Recherchez avant de créer un autre test. Vous pouvez aussi exporter les tests actifs du catalogue pour examen ou importation ultérieure.

### 1. Rechercher par code ou nom

Utilisez **Search code or name**. La recherche couvre aussi les noms courts et locaux. L'exemple trouve le test par son nom local.

![La recherche peut trouver un test par son nom de catalogue ou local.](test-catalog-guide-search.png)

### 2. Lire la ligne correspondante

Vérifiez le code et le nom de catalogue avant modification. Le test garde son nom de catalogue même si le nom local correspond à la recherche.

![Le test correspondant reste visible sous son nom de catalogue.](test-catalog-guide-search-result.png)

### 3. Choisir Export CSV pour obtenir un fichier

Effacez la recherche si elle est inutile. Ouvrez les points de Tests et sélectionnez **Export CSV** pour télécharger les tests actifs. Un laboratoire géré par le central peut aussi exporter.

![Export CSV télécharge les tests actifs dans un format importable.](test-catalog-guide-export.png)

**Résultat attendu :** le navigateur télécharge un CSV avec les colonnes comprises par l'assistant d'importation. L'export contient les tests actifs du catalogue, pas seulement une ligne visible.

## Choisir le fichier de tests et associer ses colonnes

Importez une liste CSV ou Excel .xlsx. Les tests correspondent par code. L'importation ne retire pas les tests absents du fichier et ne change pas les réglages locaux.

### 1. Choisir Import

Dans Tests, ouvrez les points de la page et sélectionnez **Import**.

![Ouvrez le menu à points de la page Tests.](test-catalog-guide-page-actions-step-1.png)

![Import ouvre l'assistant d'examen du fichier.](test-catalog-guide-import-menu.png)

### 2. Choisir votre fichier

Sélectionnez la zone de fichier et votre propre CSV ou XLSX. L'assistant le lit et ouvre **Step 2 of 4: Columns**.

![Choisissez votre CSV ou XLSX. Rien n'est écrit avant Apply.](test-catalog-guide-import-file.png)

### 3. Vérifier la colonne Name

Vérifiez chaque colonne suggérée. Name est obligatoire. Corrigez un champ avec le sélecteur à côté du libellé.

![Vérifiez les associations de colonnes suggérées. Name est obligatoire.](test-catalog-guide-import-columns.png)

### 4. Vérifier les colonnes absentes et vides

**Not in the file** laisse un champ existant inchangé. Une cellule vide dans une colonne sélectionnée efface ce champ. N'associez une colonne vide que si cela est voulu.

![Not in the file conserve le champ existant. Une cellule vide dans une colonne associée l'efface.](test-catalog-guide-import-missing-column.png)

### 5. Continuer vers Values

Ouvrez les points du panneau d'importation et sélectionnez **Next**.

![Next se trouve dans les points du panneau d'importation.](test-catalog-guide-import-next-actions.png)

![Next vérifie les catégories et les prélèvements.](test-catalog-guide-import-next.png)

## Résoudre les valeurs et examiner l'importation

Values liste les textes de catégorie ou prélèvement sans choix configuré correspondant. Définissez chaque sens avant d'appliquer le fichier.

### 1. Trouver les valeurs inconnues

Lisez le texte et le nombre de lignes concernées. Une valeur laissée **Not chosen** entraîne le refus de sa ligne. Cet exemple contient une catégorie inconnue.

![Une catégorie inconnue exige une décision avant l'importation de sa ligne.](test-catalog-guide-import-unknown.png)

### 2. Choisir la bonne catégorie

Sélectionnez une catégorie existante de même sens. Choisissez **Add as a new category** seulement si une nouvelle catégorie est voulue.

![Choisissez une catégorie existante, ou Add as a new category si le sens est nouveau.](test-catalog-guide-import-new-category.png)

### 3. Vérifier le code d'une nouvelle catégorie

Lors d'un ajout, vérifiez ou changez le code généré. Cet exemple ajoute une catégorie fictive. Résolvez aussi les prélèvements inconnus avec leurs choix.

![Vérifiez le code suggéré avant d'ajouter la catégorie.](test-catalog-guide-import-category-code.png)

### 4. Continuer vers Review

Ouvrez les points du panneau et sélectionnez **Next**.

![Next calcule les nombres à examiner avec vos décisions de valeurs.](test-catalog-guide-import-values-next.png)

### 5. Lire les nombres et avertissements

Vérifiez New, Changed, Unchanged et Refused, les raisons de refus et Categories to add. Utilisez Back dans les points pour corriger les décisions du fichier.

![Lisez les nombres de lignes nouvelles, modifiées, inchangées et refusées, puis les catégories à ajouter.](test-catalog-guide-import-review.png)

### 6. Choisir Apply

Si l'examen correspond à votre intention, ouvrez les points du panneau et sélectionnez **Apply**. Rien n'est écrit avant cette action.

![Apply écrit seulement après votre examen de l'importation.](test-catalog-guide-import-apply.png)

**Résultat attendu :** le panneau se ferme et les tests importés apparaissent. Ils commencent Off dans ce laboratoire. Réimporter le même fichier indique des lignes inchangées, sans doublons.

![Les tests importés apparaissent dans Tests et commencent Off dans ce laboratoire.](test-catalog-guide-import-result.png)

![Le fichier identique est reconnu comme inchangé sans créer de doublons.](test-catalog-guide-repeat-review.png)

## Choisir les champs de résultat d'un test

Effectuez cette tâche pour la saisie de résultats avec ce test. Les choix viennent du dictionnaire installé. S'ils manquent, importez d'abord celui de votre système. [Terminologie](/docs/terminology) décrit les listes de codes et [Commencer ici](/docs/start-here) la CLI. L'exercice facultatif inclut un dictionnaire fictif.

### 1. Ouvrir le test et choisir ses champs de résultat

Choisissez Edit dans le menu de ligne. Cochez les champs produits par ce test sous ses paramètres de résultat.

![Edit ouvre le catalogue et les réglages locaux.](test-catalog-guide-edit-menu.png)

![Cochez les champs produits par le test. Les choix viennent de votre dictionnaire de résultats.](test-catalog-guide-parameter-choice.png)

### 2. Choisir chaque type de résultat

Choisissez **Numeric**, **Coded** ou **Text** pour chaque champ sélectionné. Un champ codé exige aussi son jeu de valeurs configuré. L'exemple utilise Numeric.

![Choisissez Numeric, Coded ou Text pour le champ de résultat.](test-catalog-guide-parameter-type.png)

### 3. Ouvrir les actions du champ numérique

Pour un champ numérique nécessitant un intervalle de référence, sélectionnez les points à côté du type de résultat.

![Les champs numériques ont leurs propres actions d'intervalle.](test-catalog-guide-parameter-actions.png)

### 4. Choisir Add range

Sélectionnez **Add range**. Un formulaire d'intervalle de référence apparaît sous le champ.

![Add range crée un intervalle de référence pour ce champ de résultat.](test-catalog-guide-add-range.png)

## Définir l'intervalle de référence et enregistrer

Utilisez les bornes approuvées pour votre test, méthode et population. L'intervalle et les nombres fictifs de l'exemple ne doivent pas servir d'intervalles cliniques.

### 1. Nommer l'intervalle

Saisissez un nom identifiant cet intervalle. L'exemple utilise `Example band only`.

![Nommez l'intervalle de référence. Cet intervalle fictif sert uniquement à la documentation.](test-catalog-guide-range-name.png)

### 2. Saisir les bornes approuvées

Saisissez les bornes inférieure et supérieure de votre vrai test. Une borne vide reste ouverte. Les nombres 1 et 10 de la capture servent uniquement à la documentation.

![Utilisez les bornes approuvées pour votre méthode réelle. Ces nombres sont fictifs.](test-catalog-guide-range-bounds.png)

### 3. Saisir l'unité

Définissez l'unité de l'intervalle. Utilisez le même sens et la même échelle que le résultat réel.

![Définissez l'unité de cet intervalle de référence.](test-catalog-guide-range-unit.png)

### 4. Vérifier les restrictions de sexe et d'âge

Définissez les limites de sexe ou d'âge applicables. Un intervalle sans restriction ne doit pas en avoir.

![Les limites de sexe et d'âge restreignent l'application de cet intervalle. Laissez-les ouvertes seulement pour un intervalle sans restriction.](test-catalog-guide-range-context.png)

### 5. Enregistrer le test

Ouvrez les points du panneau de test et sélectionnez **Save**.

![Save enregistre les champs de résultat et les intervalles sélectionnés.](test-catalog-guide-parameter-save.png)

**Résultat attendu :** les champs, types de résultat et intervalles de référence sélectionnés sont enregistrés avec le test.

## Relier un code de test reçu au catalogue

Effectuez cette tâche après l'arrivée de vos données habituelles. Si Observed est vide, créez le catalogue et revenez plus tard. Activer un test localement et associer un code reçu sont des actions distinctes.

### 1. Ouvrir Observed

Sélectionnez **Observed** en haut. Tests liste les codes reçus avec les commandes.

![Observed liste les codes de tests et résultats reçus de vos sources.](test-catalog-guide-observed-tab.png)

![Chaque code source montre son association actuelle au catalogue.](test-catalog-guide-observed-test-row.png)

### 2. Choisir Map to catalog test

Ouvrez les points de la ligne du code reçu et sélectionnez **Map to catalog test**.

![Ouvrez les points de la ligne du code source.](test-catalog-guide-observed-row-actions.png)

![Map to catalog test ouvre le sélecteur de destination.](test-catalog-guide-map-test-menu.png)

### 3. Ouvrir le sélecteur de destination

Sélectionnez **Choose a catalog test**.

![Choose a catalog test est le sélecteur de destination.](test-catalog-guide-map-picker.png)

### 4. Rechercher dans le catalogue

Dans **Search catalog tests**, recherchez le test réellement représenté par ce code source.

![Recherchez le test du catalogue correspondant au sens réel du code source.](test-catalog-guide-map-search.png)

### 5. Sélectionner le bon test

Choisissez le test correspondant. Vérifiez son code et son nom.

![Sélectionnez le test du catalogue correspondant.](test-catalog-guide-map-target.png)

### 6. Enregistrer l'association

Ouvrez les points du panneau d'association et sélectionnez **Save**.

![Le panneau d'association a son propre menu à points.](test-catalog-guide-map-actions.png)

![Save enregistre l'association utilisée par les rapports.](test-catalog-guide-map-save.png)

**Résultat attendu :** le code reçu affiche son Catalog test. Les rapports peuvent compter le code source sous cette identité du catalogue.

![Le code source montre maintenant son test du catalogue.](test-catalog-guide-mapped-test.png)

## Faire correspondre les codes de résultats reçus au dictionnaire

Les codes de résultat identifient les résultats individuels. Ils diffèrent des codes de test. La correspondance exacte sert lorsque la source et le dictionnaire utilisent les mêmes codes. Les associations existantes et les codes ambigus restent inchangés.

### 1. Choisir Results dans Observed

Sélectionnez **Results** pour voir les codes de résultat reçus.

![Results fait passer Observed des codes de test aux codes de résultat.](test-catalog-guide-results-toggle.png)

![Les codes de résultat sont distincts des codes de test.](test-catalog-guide-result-code-row.png)

### 2. Choisir Map matching codes

Ouvrez les points de Observed et sélectionnez **Map matching codes**.

![Ouvrez les points de Observed pour associer les codes de résultat.](test-catalog-guide-observed-actions.png)

![Map matching codes vérifie les correspondances exactes avec votre dictionnaire.](test-catalog-guide-match-menu.png)

### 3. Choisir le système de laboratoire

Choisissez le système source dont les codes sont à comparer. S'il n'en existe qu'un, il est sélectionné automatiquement.

![Choisissez le système de laboratoire dont les codes de résultat sont à comparer.](test-catalog-guide-match-system.png)

### 4. Lire les correspondances proposées

Vérifiez chaque code, nom de destination et nombre de résultats. Des noms correspondants ne remplacent pas la vérification du sens réel des codes.

![Lisez les correspondances exactes proposées avant de les appliquer.](test-catalog-guide-match-preview.png)

### 5. Ouvrir Matching actions

Sélectionnez les points du panneau de correspondance.

![Ouvrez Matching actions après vérification de la liste.](test-catalog-guide-match-actions.png)

### 6. Appliquer les correspondances

Sélectionnez **Map these codes**. Pour des codes différents, utilisez plutôt Map to result field sur la ligne du code reçu.

![Map these codes applique les correspondances proposées.](test-catalog-guide-match-apply.png)

**Résultat attendu :** le code associé indique son Result field. Si la page signale une copie d'entrepôt périmée, ses points proposent Rebuild warehouse copy.

![Le code de résultat reçu indique maintenant son champ de résultat.](test-catalog-guide-matched-result.png)

![Rebuild warehouse copy retente la publication des associations lorsque la copie est signalée périmée.](test-catalog-guide-rebuild-menu.png)

## Relier un champ de résultat à LOINC

Utilisez un code confirmé pour le sens de votre vrai champ. L'exemple fictif montre uniquement l'éditeur. Son entrée LOINC illustrative n'est pas une recommandation pour votre champ. Un laboratoire recevant le dictionnaire du central ne peut pas modifier ces liens.

### 1. Ouvrir Result fields

Sélectionnez **Result fields**. Trouvez le code du dictionnaire et vérifiez son rôle et ses unités.

![Result fields liste les champs du dictionnaire de résultats installé.](test-catalog-guide-result-fields-tab.png)

![Result fields montre le code, le rôle, les unités et le lien LOINC du dictionnaire.](test-catalog-guide-result-field-row.png)

### 2. Choisir Link LOINC

Ouvrez les points de la ligne du champ et sélectionnez **Link LOINC**.

![Ouvrez les points de la ligne du champ de résultat.](test-catalog-guide-result-field-actions.png)

![Link LOINC ouvre l'éditeur de lien du champ.](test-catalog-guide-loinc-link-menu.png)

### 3. Saisir ou sélectionner le LOINC confirmé

Si LOINC est chargé, recherchez et sélectionnez-le. Sinon, saisissez votre code confirmé. Cette installation vérifie seulement le format du code saisi. Elle ne prouve pas le sens clinique.

![Saisissez le LOINC confirmé pour votre vrai champ. Sans dictionnaire LOINC chargé, seul le format du code saisi est vérifié.](test-catalog-guide-loinc-input.png)

### 4. Enregistrer le lien

Ouvrez les points du lien LOINC et sélectionnez **Save**.

![Utilisez les points du lien LOINC pour enregistrer.](test-catalog-guide-loinc-actions.png)

![Save enregistre le lien. Vérifiez son sens avec votre terminologie avant utilisation.](test-catalog-guide-loinc-save.png)

**Résultat attendu :** la ligne du champ montre son code LOINC. Export CSV dans le menu Result fields télécharge les liens.

![La ligne du champ montre maintenant le code LOINC enregistré.](test-catalog-guide-loinc-result.png)

![Export CSV télécharge les liens du dictionnaire pour examen ou modification.](test-catalog-guide-result-export.png)

## Utiliser Test catalog sur un téléphone

Les mêmes onglets et actions restent disponibles sur un téléphone. Les tableaux larges peuvent défiler horizontalement.

### 1. Choisir l'onglet

Utilisez Tests, Result fields ou Observed en haut de la page.

![Tests, Result fields et Observed restent en haut sur un téléphone.](test-catalog-guide-phone-tests.png)

### 2. Ouvrir les actions pertinentes

Dans Tests, les points de la page sont à côté de la recherche et des commandes du tableau. Chaque ligne garde son menu.

![Les points de Tests restent à côté de la recherche et des commandes du tableau.](test-catalog-guide-phone-actions.png)

### 3. Choisir les codes de résultat reçus

Dans Observed, choisissez Results pour les codes de résultat reçus plutôt que les codes de test.

![Utilisez Results pour traiter les codes de résultat reçus sur un téléphone.](test-catalog-guide-phone-results.png)

## Exercice facultatif avec des données fictives

Chaque tâche précédente peut utiliser vos données. Utilisez ces fichiers uniquement sur une installation de test. Un test peut être retiré, mais pas supprimé. N'importez aucun test fictif dans un catalogue réel.

- [Télécharger un CSV de deux tests](https://openldr.online/docs-samples/user-guide/test-catalog/example-tests.csv) pour l'importation.
- [Télécharger un dictionnaire de résultats à un champ](https://openldr.online/docs-samples/user-guide/test-catalog/example-result-fields.json) pour les tâches de champs de résultat.
- [Télécharger quatre ressources de laboratoire fictives](https://openldr.online/docs-samples/user-guide/test-catalog/example-lab-data.json) pour remplir Observed.

Pour suivre exactement les images, ajoutez d'abord EXAMPLE-ALPHA manuellement. Le CSV seul crée Beta et Gamma. Utilisez vos propres noms correspondants si vous ignorez les fichiers d'exercice.

Pour le dictionnaire et le lot facultatifs, suivez d'abord [Commencer ici](/docs/start-here). Placez les fichiers téléchargés dans le dossier `data` de l'installation. Exemple depuis une copie de développement :

```shell
cd ~/Downloads/openldr_ce
pnpm openldr terminology import parameters data/example-result-fields.json
pnpm openldr ingest data/example-lab-data.json
```

Pour une installation Linux ou macOS, utilisez `./openldr` plutôt que `pnpm openldr`. Sous Windows, utilisez `.\openldr.ps1` depuis le dossier d'installation, comme `C:\openldr_ce`. Remplacez l'exemple par votre vrai dossier. Commencer ici détaille chaque plateforme.

## Avant de modifier les données partagées du catalogue

Un catalogue reçu du central a des définitions partagées en lecture seule. La disponibilité, les choix de prélèvements et les noms locaux restent les réglages de ce laboratoire.

L'importation accepte au maximum 5 000 lignes et 5 Mo. Excel lit la première feuille. Les tests correspondent par code. Un fichier ne retire pas les tests absents et ne change pas les réglages locaux.

Retirer un test le masque de la liste active par défaut. Il peut être restauré. Les tests du catalogue ne peuvent pas être supprimés. Utilisez le filtre Status pour trouver les tests retirés.

## Résolution des problèmes

**Add test ou Import manque.** Vérifiez si le catalogue vient du central et si votre compte peut gérer la terminologie. Lisez le message de propriété au-dessus du tableau.

**Un nouveau test manque dans Lab order.** Vérifiez On at this lab. Créer ou importer un test ne l'active pas automatiquement.

**L'importation refuse des lignes.** Lisez chaque raison dans Review. Revenez à Values pour les catégories ou prélèvements sans choix. Vérifiez Name et le code ou LOINC fournissant l'identité.

**Aucun paramètre de résultat n'apparaît.** Cette installation n'a aucun champ utilisable dans son dictionnaire. Chargez d'abord celui de votre système. Le dictionnaire d'exercice n'est qu'un exemple.

**Un code reste sans association.** Vérifiez si vous avez choisi Tests ou Results. Associer un niveau n'associe pas l'autre.

**La page signale une copie d'entrepôt périmée.** Ouvrez les actions de Observed et choisissez Rebuild warehouse copy. La page signale un échec si la reconstruction est impossible.

## Guides associés

[Terminologie](/docs/terminology) décrit les listes de codes configurées. [Établissements](/docs/facilities) décrit les codes d'établissement. [Commencer ici](/docs/start-here) décrit la CLI installée et de développement.
