# Concepteur de rapports

Le **Concepteur de rapports** (Report Designer) est un outil de mise en page par glisser-déposer pour les rapports imprimables. Vous placez un en-tête, des titres, des tableaux, des graphiques et des panneaux sur une page A4 ou Letter, vous liez chaque tableau à une [requête personnalisée](/docs/query) enregistrée, et vous publiez le résultat comme rapport dans la bibliothèque des [Rapports](/docs/reports).

Une installation neuve contient dix modèles, un par rapport intégré. Ce guide lit la construction de l'un d'eux, puis construit un nouveau modèle et le publie comme rapport. Comptez 15 minutes. Sélectionnez une image ou un clip pour l'agrandir.

Les menus et panneaux du concepteur sont en anglais à l'écran, ce guide garde donc leurs libellés anglais.

![Test Volume Over Time ouvert dans le concepteur, son tableau sélectionné et l'onglet Data montrant la requête liée.](report-designer-tour.png)

## Qui peut faire quoi

| Capacité | Ce qu'elle permet |
| --- | --- |
| **View reports** | Voir la bibliothèque des Rapports |
| **Run reports** | Exécuter et prévisualiser un rapport |
| **Edit report templates** | Ouvrir le concepteur, créer et modifier des modèles, les publier, et créer des rapports dans la bibliothèque |

## Avant de commencer

L'Exemple 2 a besoin des données d'exemple de la documentation. Voir [Tableaux de bord, Charger les données d'exemple](/docs/dashboard#charger-les-donnees-d-exemple).

## Exemple 1 : lire la construction d'un rapport intégré

![Ouvrir Test Volume Over Time, sélectionner son tableau et l'onglet Data.](report-designer-explore.mp4)

1. Ouvrez **Concepteur de rapports**. La liste **Templates** à gauche montre les dix modèles, avec le format et l'orientation.
2. Sélectionnez **Test Volume Over Time**. L'en-tête affiche **Saved** et **PUBLISHED**.
3. Sur la page, sélectionnez le tableau, nommé **Data**, avec les colonnes Month, Test et Count.
4. Ouvrez l'onglet **Data** à droite.

**Résultat attendu :** **Bind query** affiche **Test volume by month**, une requête personnalisée enregistrée. La liste **Columns** a trois colonnes cochées. Sous **Parameters**, `dateRange` porte le libellé **Date range** : c'est le filtre que le rapport demande à l'exécution.

Un rapport a donc trois parties : un modèle (cette page), la requête qui remplit ses tableaux, et les filtres qui passent des valeurs à la requête.

## Exemple 2 : construire un modèle et le publier comme rapport

Construisez un rapport d'un seul tableau : les patients par tranche d'âge.

### Construire le modèle

![New template, le nommer, insérer un tableau, le lier à Patient demographics by age band, cocher les colonnes et afficher les données.](report-designer-build.mp4)

1. Ouvrez le menu **⋯** en haut du canevas et sélectionnez **New template**.
2. Cliquez dans la case du nom, **Untitled template**, et tapez `Patients by age band (sample)`.
3. Ouvrez **⋯**, sélectionnez **Insert**, puis **Table**. Un tableau se pose sur la page.
4. Tableau sélectionné, ouvrez l'onglet **Data**. Réglez **Bind query** sur **Patient demographics by age band**.
5. Sélectionnez **Load columns**. Cinq colonnes apparaissent : band, total, male, female, other. Cochez les cinq.
6. Sélectionnez **Load pages** au-dessus du canevas, puis **Show data** dans l'en-tête.

**Résultat attendu :** le tableau se remplit de vraies lignes : 5-14 avec 3 patients, 15-24 avec 4, 25-49 avec 14, 50+ avec 4. Cela fait 25 patients : les 24 des données d'exemple, et **Sample Seed**, que chaque installation crée.

![Le tableau lié et rempli avec les patients de l'exemple.](report-designer-bound.png)

**Show data** ne montre que les lignes que tient la première page, pour que le canevas ne promette jamais plus que ce qu'imprime le PDF.

### Enregistrer, publier et ajouter aux Rapports

![Enregistrer le modèle et publier une révision.](report-designer-publish.mp4)

1. Ouvrez **⋯** et sélectionnez **Save**. L'en-tête affiche **Saved**.
2. Ouvrez **⋯** et sélectionnez **Publish revision**. L'en-tête affiche **PUBLISHED**. Rien n'est ajouté aux Rapports.
3. Ouvrez **⋯** et sélectionnez **Create report from this design**. Le panneau **New report** s'ouvre.

![Nommer le rapport, choisir Operational et le créer.](report-designer-create-report.mp4)

4. Dans **Name**, tapez `Patients by age band (sample)`.
5. Ouvrez **Category** et sélectionnez **Operational**. **Template** et **Primary query** sont déjà remplis, à partir du modèle et de son tableau.
6. Ouvrez le menu **Actions** du panneau et sélectionnez **Create report**.

### L'exécuter

![Exécuter le nouveau rapport depuis la bibliothèque des Rapports.](report-designer-run.mp4)

1. Ouvrez **Rapports**. **Patients by age band (sample)** est listé sous **Operational**.
2. Sélectionnez-le, ouvrez le menu à trois points, sélectionnez **Paramètres**, puis **Exécuter**. Il n'a pas de filtre, rien à remplir.

**Résultat attendu :** le document montre les cinq colonnes et les quatre lignes de l'étape 6.

![Le document du rapport.](report-designer-report.png)

Pour retirer l'exemple, supprimez le rapport depuis son menu dans Rapports, puis le modèle avec **⋯ → Delete** dans le concepteur.

## Deux actions distinctes

| Action du menu ⋯ | Résultat |
| --- | --- |
| **Publish revision** | Publie une version du modèle enregistré. Ne crée pas de rapport dans la bibliothèque. |
| **Create report from this design** | Ouvre le panneau de création d'un rapport lié au modèle et à une requête principale. Ne publie pas de révision du modèle. |

Les deux demandent un modèle déjà enregistré. Le nom du rapport peut différer de celui du modèle. Publier une révision ultérieure du même modèle ne demande pas de créer un autre rapport : utilisez l'action de création seulement pour ajouter une entrée à la bibliothèque.

Une révision publiée appartient au modèle. La requête principale fournit les lignes du tableur, le modèle définit la mise en page du document.

## Les éléments

**⋯ → Insert** propose : Text, Table, Key/value panel, Image, Barcode, QR code, Line, Rectangle, Date/time, Cell grid, Chart et Letterhead. Faites glisser un élément pour le déplacer et utilisez les poignées pour le redimensionner. Un élément sélectionné affiche son nom dans une étiquette au-dessus.

- **Table.** Dans l'onglet **Data** : **Bind query**, **Load columns**, puis cochez, réordonnez et renommez les colonnes. **Sort by column** trie les lignes avant le dessin. **First data row is the header** sert quand la requête renvoie ses libellés en première ligne (il faut aussi Sort by). **Transpose**, dans Properties, retourne un tableau large.
- **Cell grid.** Liez la requête dans **Data**, puis réglez la colonne de libellé, les colonnes de cellules, les paliers de couleur et les colonnes de fin dans **Properties**.
- **Chart.** Liez la requête dans **Data**, puis choisissez le type (bar, line ou donut), la colonne de libellé et les colonnes de valeurs dans **Properties**. Les graphiques s'impriment en formes vectorielles nettes, et un graphique lié exporte aussi ses lignes vers Excel.
- **Paramètres.** Dans **Data**, **Add parameter** définit les filtres du rapport (Text, Select ou Date range). La **Key** d'un paramètre doit correspondre au **Variable ID** du paramètre de la requête, pour que la valeur passe dans la requête.
- **Letterhead.** La bande d'identité partagée (logo, nom, adresse, contact, filet). Sa mise en page est définie une fois, donc tous les modèles qui l'utilisent changent ensemble. Les valeurs viennent de Paramètres, Laboratoire. Voir [Laboratoire](/docs/laboratory).

## Autres possibilités

- **Preview** rend le modèle en PDF avec des données réelles. **Export → PDF** ou **Excel** télécharge directement la sortie.
- La case d'état à côté du nom affiche Saved, Saving ou Unsaved changes. Le concepteur enregistre aussi automatiquement.
- La bande au-dessus du canevas indique combien de pages le modèle imprime. **Load pages** exécute les requêtes liées pour un vrai compte. Ce compte est un instantané, et la bande dit quand le modèle a changé depuis. Un tableau qui déborde reçoit une ligne pointillée là où finit sa première page.
- La section **Flow** de Properties règle le comportement des blocs quand un tableau ou une grille continue sur d'autres pages : **Place below**, **Gap after**, **First page only**, **Show with** et **Fill to bottom of box**.
- Un tableau lié peut avoir une **ligne de totaux** (un libellé, et les colonnes à additionner), et un texte peut afficher `{{sum(elementName.columnKey)}}`. Une **règle** par colonne (« When ≥ 10 → Critical ») met des valeurs en évidence sans toucher au SQL. Une colonne de statut venant de la requête l'emporte toujours sur une règle.
- **Trend** sur une colonne liée dessine la valeur en petite ligne dans la cellule. La requête fournit les nombres en une chaîne délimitée, par exemple `12,14,11,18`. Ce qui n'est pas au moins deux nombres propres s'imprime en texte, et Excel exporte toujours la chaîne brute.
- **⋯ → Versions** liste chaque version publiée avec son auteur et sa date. **Restore** recharge une version dans la copie de travail comme une modification ordinaire : une seule étape d'annulation, enregistrée automatiquement, sans publication.
- Le choix **Print language** en haut de Properties bascule le texte entre le texte du modèle et la traduction d'une langue. Une case vide veut dire « s'imprime comme écrit ». Un rapport imprimé depuis [Rapports](/docs/reports) utilise la langue du studio, et `openldr report run <id> --format pdf --lang fr` fait de même sans interface. Seul le texte saisi est traduit : jamais les résultats des requêtes, les informations du laboratoire ni les codes-barres.
- Les **rapports intégrés sont déjà livrés en français et en portugais**. Les dates suivent la langue d'impression (`2 sept. 2026`, `2 set. 2026`), le jour toujours avant le mois. Les codes de sensibilité (R, I, S) ne sont jamais traduits.
- Un panneau clé/valeur **non** lié à une requête liste ses paires sous **Pair translations** quand une langue est choisie. Une valeur contenant `{{param.from}}` ou `{{date}}` peut aussi être traduite, jetons compris.
- Un modèle en **brouillon** imprime un tampon DRAFT en diagonale sur chaque page. La publication le retire.
- **Page numbers**, dans les réglages de page, ajoute un pied de page numéroté. Un modèle peut avoir plusieurs pages.
- Dans l'onglet **Layers**, l'œil masque un élément (il quitte le canevas et le PDF, et le bloc dessous remonte), le cadenas le bloque, et les lignes se réordonnent par glisser-déposer.
- Sélectionnez plusieurs éléments et choisissez **⋯ → Group selection** pour les nommer comme un groupe. **Alt** atteint un élément seul dans le groupe. **Ungroup** retire le groupe.
- **Ctrl+D** duplique, **Ctrl+C** et **Ctrl+V** copient et collent. **⋯ → Duplicate** crée un modèle à partir d'un autre, **⋯ → Delete** en supprime un.
- Depuis [Rapports](/docs/reports), les responsables reviennent au modèle d'un rapport publié avec **Modifier le modèle**.

## Sur un téléphone

Le concepteur est fait pour un grand écran. Sur un téléphone, servez-vous-en pour lire un modèle, pas pour en construire un. Les rapports issus d'un modèle s'exécutent et s'impriment sur un téléphone comme les autres.

## Dépannage

- **Aucune colonne à choisir.** Choisissez une requête dans **Bind query**, puis sélectionnez **Load columns**.
- **Le tableau du canevas reste vide avec Show data.** Cochez au moins une colonne, puis relancez **Load pages**. Une requête avec un filtre obligatoire a besoin d'une valeur par défaut dans son paramètre.
- **Le modèle est publié mais absent des Rapports.** Publier une révision ne crée pas d'entrée. Utilisez **Create report from this design**.
- **Create report est grisé.** Remplissez Name, Category, Template et Primary query.
- **Un publish demande d'enregistrer d'abord.** Enregistrez et attendez **Saved**.
- **L'aperçu ne s'affiche pas.** Vérifiez que la requête liée et ses paramètres sont valides.
- **Rien à exporter.** Le modèle n'a encore aucun tableau.
- **Les lignes d'un tableau passent sur d'autres pages.** C'est normal : les tableaux se répartissent sur plusieurs pages quand les données ne tiennent pas sur une.

## Guides associés

- [Rapports](/docs/reports)
- [Requêtes personnalisées](/docs/query)
- [Laboratoire](/docs/laboratory)
- [Connecteurs](/docs/connectors)
