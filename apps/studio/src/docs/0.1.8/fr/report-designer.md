# Concepteur de rapports

Utilisez Report Designer pour disposer les éléments imprimables, les lier à des Custom Queries enregistrées et créer des rapports pour la bibliothèque. Une conception contrôle la page. Une requête fournit les lignes. Les paramètres du modèle définissent les filtres saisis lors de l'exécution.

Commencez avec votre requête enregistrée et votre mise en page prévue. Aucun jeu de données de documentation n'est nécessaire. Les images utilisent une requête retournant zéro demande sur une installation de test distincte. L'exercice facultatif est à la fin.

Vous devez avoir **Edit report templates** pour créer, modifier et publier les conceptions. **View reports** ouvre la bibliothèque et **Run reports** exécute ses entrées.

Publier une révision et créer un rapport de bibliothèque sont deux actions distinctes. Enregistrez la nouvelle conception avant chacune.

## Examiner une conception existante

Comprenez ainsi le lien entre un tableau existant, sa requête et les filtres exposés par le rapport.

### 1. Ouvrir Report Designer

Sélectionnez Report Designer dans le menu principal.

![Ouvrez Report Designer pour examiner et créer les mises en page.](report-designer-guide-open-page.png)

### 2. Choisir un modèle

Sélectionnez une entrée existante dans Templates. L'exemple ouvre Test Volume Over Time.

![Sélectionnez une conception existante dans Templates.](report-designer-guide-existing-template.png)

### 3. Sélectionner son tableau

Sélectionnez l'élément tableau sur la page imprimable.

![Sélectionnez l'élément tableau sur la page.](report-designer-guide-existing-table.png)

### 4. Lire ses réglages Data

Sélectionnez Data dans l'inspecteur à droite. Vérifiez Bind query et les Parameters du modèle dessous.

![Data montre la liaison de requête et les paramètres du modèle.](report-designer-guide-existing-data-tab.png)

![La requête liée fournit les lignes du tableau. Les paramètres du modèle définissent les filtres d'exécution.](report-designer-guide-existing-binding.png)

## Créer une conception de tableau distincte

Utilisez une nouvelle conception pour votre rapport plutôt que de modifier une définition intégrée partagée.

### 1. Choisir New template

Ouvrez More actions au-dessus du canevas et sélectionnez New template. Le concepteur vide propose aussi New template.

![More actions contient les opérations sur les modèles.](report-designer-guide-actions.png)

![New template démarre une conception distincte.](report-designer-guide-new-template.png)

### 2. Nommer la conception

Saisissez un Report name clair, comme Request summary design.

![Définissez Report name selon les besoins du rapport.](report-designer-guide-design-name.png)

### 3. Insérer un tableau

Ouvrez More actions, pointez Insert et sélectionnez Table.

![Insert liste les types d'éléments imprimables.](report-designer-guide-insert.png)

![Table ajoute un tableau de données à cette conception.](report-designer-guide-insert-table.png)

### 4. Sélectionner le tableau

Le Table inséré est sélectionné. Glissez-le à l'emplacement prévu et utilisez ses poignées pour le redimensionner. L'exemple conserve sa position initiale.

![Le nouveau tableau est sélectionné pour la configuration.](report-designer-guide-new-table.png)

## Choisir la requête du tableau

Utilisez une requête enregistrée retournant les colonnes prévues. Si elle a des paramètres, définissez des valeurs de modèle correspondantes avant de charger les colonnes.

### 1. Ouvrir Data

Avec le tableau sélectionné, sélectionnez Data dans l'inspecteur.

![Ouvrez Data pour le tableau personnalisé sélectionné.](report-designer-guide-new-data-tab.png)

### 2. Lier la requête enregistrée

Ouvrez Bind query et choisissez votre Custom Query. L'exemple utilise Request count for reporting, avec deux paramètres de requête Text obligatoires nommés from et to.

![Choisissez votre Custom Query enregistrée.](report-designer-guide-bind-query.png)

## Définir le filtre de rapport et les valeurs d'aperçu

Dans Reports, le filtre de plage de dates actuel transmet les valeurs simples from et to. La requête d'exemple les déclare comme deux paramètres Text obligatoires. Le modèle fournit un seul contrôle Date range. Une requête de l'atelier déclarant un seul paramètre daterange échoue actuellement lorsqu'elle est liée directement à Reports.

### 1. Ajouter un paramètre de modèle

Sélectionnez Add parameter sous les réglages de liaison.

![Add parameter définit un filtre exposé par ce modèle.](report-designer-guide-add-parameter.png)

### 2. Faire correspondre la clé de requête

Définissez une Key unique, comme period. Ce contrôle de plage fournit les valeurs from et to utilisées par la requête de rapport.

![Définissez Key param1 selon les besoins du rapport.](report-designer-guide-parameter-key.png)

### 3. Choisir le libellé visible

Définissez Label avec le texte à afficher, comme Period.

![Définissez Label period selon les besoins du rapport.](report-designer-guide-parameter-label.png)

### 4. Faire correspondre le type du paramètre

Réglez Type sur Date range. La requête de rapport utilise elle-même deux paramètres Text nommés from et to.

![Choisissez Date range pour le paramètre de requête.](report-designer-guide-parameter-type.png)

### 5. Définir le début par défaut

Saisissez la première date incluse par défaut. L'exemple utilise 2026-01-01.

![Définissez From period selon les besoins du rapport.](report-designer-guide-parameter-from.png)

### 6. Définir la fin par défaut

Saisissez la dernière date incluse par défaut. L'exemple utilise 2027-01-01. La requête inclut toute la journée de fin, comme le calendrier et le planificateur du rapport. Ces valeurs servent à l'aperçu. Les utilisateurs peuvent en choisir d'autres.

![Définissez To period selon les besoins du rapport.](report-designer-guide-parameter-to.png)

## Choisir et prévisualiser la colonne imprimée

Load columns utilise les valeurs par défaut du modèle pour exécuter la requête liée. La requête de comptage retourne une colonne requests même si l'entrepôt ne contient aucune demande.

### 1. Charger les colonnes de requête

Sélectionnez Load columns. Lisez l'erreur si la requête ou les valeurs par défaut sont invalides.

![Load columns exécute la requête avec les valeurs par défaut du modèle.](report-designer-guide-load-columns.png)

### 2. Inclure la colonne

Cochez requests pour l'inclure dans le tableau. Choisissez les vraies colonnes de sortie nécessaires à votre rapport.

![Incluez la colonne requests dans le tableau imprimé.](report-designer-guide-include-column.png)

### 3. Définir son libellé imprimé

Saisissez un libellé lisible, comme Requests. Cela change le texte imprimé, pas le champ de requête.

![Définissez Label de la colonne requests selon les besoins du rapport.](report-designer-guide-column-label.png)

### 4. Charger les données des pages

Sélectionnez Load pages au-dessus du canevas. Il exécute les données liées et calcule le nombre de pages physiques.

![Load pages récupère les lignes et calcule le nombre de pages imprimées.](report-designer-guide-load-pages.png)

### 5. Afficher les données chargées

Sélectionnez Show data. Rechargez les pages après modification si le nombre est périmé.

![Show data remplit le canevas avec les lignes chargées.](report-designer-guide-show-data.png)

**Résultat attendu :** le tableau montre le nombre réel. Cette installation imprime une colonne Requests contenant zéro.

![La colonne imprimée contient le nombre actuel, y compris zéro.](report-designer-guide-bound-result.png)

## Enregistrer et examiner le PDF

Enregistrez explicitement une nouvelle conception. Vérifiez ensuite la page réellement produite avant publication.

### 1. Enregistrer la conception

Ouvrez More actions et sélectionnez Save. Attendez Saved. Après le premier enregistrement, les modifications suivantes sont aussi enregistrées automatiquement.

![Save conserve la nouvelle conception avant publication.](report-designer-guide-save.png)

### 2. Ouvrir Preview

Ouvrez More actions et sélectionnez Preview.

![Preview produit le PDF de la conception de travail actuelle.](report-designer-guide-preview.png)

### 3. Vérifier et télécharger la page produite

Lisez l'aperçu PDF et utilisez Download pour une copie locale. Fermez l'aperçu pour revenir à l'édition.

![L'aperçu montre la sortie réelle de la requête dans la conception imprimable.](report-designer-guide-preview-result.png)

![Download enregistre le PDF produit.](report-designer-guide-preview-download.png)

**Résultat attendu :** l'aperçu produit la conception actuelle avec les données de requête. Une conception brouillon porte un tampon DRAFT.

## Publier une révision enregistrée

Publiez après avoir vérifié la conception enregistrée. Une révision conserve l'état publié. Elle n'ajoute aucune entrée à la bibliothèque Reports.

### 1. Publier la révision

Ouvrez More actions et sélectionnez Publish revision. Enregistrez d'abord si le concepteur le demande.

![Publish revision capture la conception enregistrée sans créer de rapport de bibliothèque.](report-designer-guide-publish.png)

### 2. Vérifier le statut publié

Vérifiez Published à côté du nom de la conception.

![Published confirme la révision de la conception.](report-designer-guide-published.png)

**Résultat attendu :** la conception enregistrée possède une révision publiée.

## Examiner les versions publiées

Identifiez ainsi la révision enregistrée avant d'envisager une restauration.

### 1. Ouvrir Versions

Ouvrez More actions et sélectionnez Versions.

![Versions liste les états publiés.](report-designer-guide-versions.png)

### 2. Lire la ligne de révision

Vérifiez sa version, la date de publication et l'auteur. Restore charge cet état dans la copie de travail comme une modification. Il ne publie pas une nouvelle révision. Fermez le panneau si aucune restauration n'est nécessaire.

![Lisez la révision, la date et l'auteur avant restauration.](report-designer-guide-version-row.png)

## Créer l'entrée de bibliothèque du rapport

Effectuez cette tâche après la préparation de la conception et de la requête. Le rapport de bibliothèque peut porter un autre nom que sa conception.

### 1. Choisir Create report from this design

Ouvrez More actions et sélectionnez Create report from this design.

![Create report from this design crée une entrée de bibliothèque distincte.](report-designer-guide-create-report.png)

### 2. Nommer le rapport

Saisissez le Name de bibliothèque. L'exemple utilise Request summary report.

![Choisissez le nom du rapport de bibliothèque.](report-designer-guide-report-name.png)

### 3. Choisir sa catégorie

Ouvrez Category et choisissez la catégorie où le trouver, comme Operational.

![Choisissez la catégorie où les utilisateurs trouveront le rapport.](report-designer-guide-report-category.png)

### 4. Vérifier les définitions liées

Confirmez Template et Primary query. Le modèle contrôle la mise en page Document. La requête principale fournit les lignes Spreadsheet.

![Vérifiez le modèle sélectionné pour ce rapport.](report-designer-guide-report-template.png)

![Vérifiez la requête principale fournissant les lignes du tableur.](report-designer-guide-report-query.png)

### 5. Créer l'entrée de bibliothèque

Ouvrez les points Actions du panneau et sélectionnez Create report.

![Le panneau New report a ses propres points Actions.](report-designer-guide-report-actions.png)

![Create report ajoute l'entrée de bibliothèque nommée.](report-designer-guide-report-create.png)

**Résultat attendu :** l'entrée nommée est disponible sous sa catégorie dans Reports. Ouvrez ses Parameters et exécutez-la ici. [Rapports](/docs/reports) décrit ce parcours.

## Exporter directement depuis le concepteur

Utilisez ces exports pour produire une sortie de la conception actuelle sans ouvrir son rapport de bibliothèque.

### 1. Exporter le PDF

Ouvrez More actions, pointez Export et sélectionnez PDF.

![Export PDF télécharge la sortie de la conception actuelle.](report-designer-guide-export-pdf.png)

### 2. Exporter vers Excel

Ouvrez More actions, pointez Export et sélectionnez Excel. Les lignes liées du tableau deviennent des données de classeur.

![Export Excel télécharge les lignes liées du tableau.](report-designer-guide-export-excel.png)

**Résultat attendu :** le navigateur télécharge le PDF produit ou le classeur.

## Contrôler la visibilité et le verrouillage des éléments

Layers fournit des contrôles directs pour les éléments sélectionnés. Masquer affecte la sortie. Verrouiller empêche les déplacements.

### 1. Ouvrir Layers

Sélectionnez Layers dans l'inspecteur.

![Layers sélectionne les éléments et contrôle visibilité, verrouillage et ordre.](report-designer-guide-layers.png)

### 2. Masquer un élément si souhaité

Utilisez Hide Table, le contrôle œil, pour le tableau sélectionné. Les éléments masqués n'apparaissent ni dans le canevas ni dans le PDF.

![Utilisez l'œil pour masquer volontairement un élément.](report-designer-guide-hide-layer.png)

### 3. Le réafficher

Utilisez Show Table pour le rétablir.

![Utilisez Show Table pour rétablir l'élément masqué.](report-designer-guide-show-layer.png)

### 4. Verrouiller sa position

Utilisez Lock Table pour empêcher le déplacement tout en gardant la sélection possible.

![Lock garde l'élément sélectionnable en empêchant le déplacement.](report-designer-guide-lock-layer.png)

### 5. Le déverrouiller

Utilisez Unlock Table pour le déplacer. L'exemple laisse le tableau visible et déverrouillé.

![Unlock Table autorise à nouveau le déplacement.](report-designer-guide-unlock-layer.png)

## Examiner une conception existante sur un téléphone

Utilisez un grand écran pour créer des mises en page. Sur un téléphone, trouvez et examinez un modèle existant ou exécutez son rapport dans Reports.

### 1. Développer Explorer

Sélectionnez Expand explorer sur sa barre étroite.

![Utilisez la barre Explorer pour trouver un modèle existant sur un téléphone.](report-designer-guide-phone-explorer.png)

### 2. Choisir le modèle existant

Sélectionnez son nom, puis repliez Explorer si vous avez besoin de place pour le canevas.

![Choisissez la conception existante. Utilisez un écran plus grand pour la modifier.](report-designer-guide-phone-template.png)

### 3. Ouvrir ses actions

Utilisez More actions pour examiner les opérations disponibles. Modifiez la mise en page sur un écran plus grand.

![Utilisez More actions pour examiner une conception existante.](report-designer-guide-phone-actions.png)

## Choisir les éléments de page et les outils de mise en page

Insert propose aussi Text, Letterhead, Key/value panel, Image, Barcode, QR code, Line, Rectangle, Date, Cell grid et Chart. Sélectionnez un élément pour modifier ses Properties. La tâche à un tableau n'exige pas ces éléments supplémentaires.

Properties contrôle le format du papier, l'orientation et les numéros de page lorsqu'aucun élément n'est sélectionné. Il contrôle aussi position, dimensions et apparence des éléments. Undo et Redo parcourent les modifications. Le zoom ne change que votre vue.

Pour Chart ou Cell grid, liez une requête dans Data et choisissez les colonnes de libellé, valeur ou cellule correspondantes dans Properties. Vérifiez la sortie produite avec vos lignes.

Les réglages Flow placent un élément sous un autre ou contrôlent le contenu répété sur les pages suivantes. Utilisez Load pages après une modification de mise en page pour contrôler le nombre de pages physiques. Show data montre seulement les lignes tenant dans la page du canevas.

## Séparer le texte du rapport et les champs de requête

Un libellé de colonne imprimée peut différer du nom du champ de requête. Utilisez les champs de libellé de Data pour le texte visible. Gardez les clés de liaison alignées avec la sortie réelle de la requête.

Le sélecteur Print language de Properties modifie les textes du rapport pour une langue. Les traductions vides reprennent le texte d'origine. Changer la langue de conception ne traduit pas les données de la requête.

Un Letterhead utilise l'identité du laboratoire configurée dans Settings. Il peut donner à plusieurs conceptions les mêmes logo, nom et coordonnées.

## Gérer les conceptions avec soin

More actions inclut Duplicate et Delete. Duplicate démarre une conception distincte pour une variante. Delete supprime définitivement une conception après confirmation. Vérifiez d'abord les rapports liés.

Restore dans Versions modifie la copie de travail et peut être annulé. Prévisualisez la conception restaurée avant de la publier volontairement. Une autre révision ne nécessite pas un autre rapport de bibliothèque pour la même conception.

Create report from this design ajoute une entrée de bibliothèque distincte. Il ne remplace pas Publish revision. Une conception publiée absente de Reports exige encore la création de bibliothèque.

## Référence facultative d'exercice

[Téléchargez la requête facultative de comptage pour rapports](https://openldr.online/docs-samples/user-guide/report-designer/report-count-query.json). Importez-la par Query pour une référence. Elle utilise deux paramètres Text obligatoires nommés from et to, adaptés à l'entrée actuelle de plage de dates de Reports. Aucun exemple patient n'est requis. Utilisez votre requête approuvée pour les rapports habituels.

[Téléchargez le PDF d'exemple publié](https://openldr.online/docs-samples/user-guide/report-designer/published-summary.pdf) ou [son classeur exporté](https://openldr.online/docs-samples/user-guide/report-designer/summary-design.xlsx) pour comparer le résultat à une colonne. Ces fichiers contiennent uniquement un comptage nul.

## Résolution des problèmes

**Aucune colonne n'apparaît.** Choisissez Bind query, configurez les valeurs par défaut nécessaires et sélectionnez Load columns.

**Le canevas reste vide.** Incluez au moins une colonne liée, puis Load pages et Show data. Lisez les erreurs de requête avant de changer la mise en page.

**Le statut d'enregistrement affiche une erreur.** Corrigez-la avant de publier. Un nouveau modèle exige un premier Save explicite.

**Create report est indisponible.** Enregistrez la conception, puis remplissez Name, Category, Template et Primary query dans le panneau New report.

**L'aperçu et la sortie diffèrent des lignes attendues.** Alignez les clés du modèle sur les identifiants de paramètres de requête. Vérifiez les valeurs par défaut et les bornes de dates SQL. L'exemple inclut les deux jours limites du calendrier.

**Un tableau s'imprime sur plusieurs pages.** Les données peuvent dépasser la première page. Utilisez Load pages et consultez le PDF pour vérifier le nombre réel.

**Reports indique required parameter: period.** Une Custom Query déclarant un seul paramètre daterange fonctionne dans Query, mais ne reçoit actuellement aucune plage imbriquée de Reports. Utilisez deux paramètres Text nommés from et to, référencés dans le SQL. Un aperçu réussi ne prouve pas l'exécution depuis la bibliothèque.

## Guides associés

[Requête](/docs/query) crée les requêtes enregistrées. [Rapports](/docs/reports) exécute les entrées de bibliothèque et planifie les sorties. [Laboratoire](/docs/laboratory) configure l'identité partagée.
