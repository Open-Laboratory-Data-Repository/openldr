# Tableaux de bord

Un tableau de bord réunit des graphiques, des tableaux et des totaux. Chaque élément est un widget.
Créez un tableau de bord pour les données de votre laboratoire. Vous pouvez configurer les widgets avant l'arrivée des dossiers.
Les exercices avec les données d'exemple ci-dessous sont facultatifs.

## Créer un tableau de bord

Créez un tableau de bord vide pour les informations à suivre. Ajoutez ensuite les widgets.
Vous devez avoir les autorisations de création et de modification des tableaux de bord.

### 1. Ouvrir Tableau de bord

Sélectionnez **Tableau de bord** en haut du menu principal à gauche.

![Tableau de bord en haut du menu principal.](dashboard-create-open.png)

### 2. Ouvrir le menu du tableau de bord

Sélectionnez le **menu à trois points** à droite de la barre d'outils, à côté du bouton d'actualisation.

![Le menu à trois points à côté du bouton d'actualisation.](dashboard-create-menu.png)

### 3. Choisir Nouveau tableau de bord

Sélectionnez **Nouveau tableau de bord**, le premier élément du menu ouvert.

![Nouveau tableau de bord est le premier élément du menu ouvert.](dashboard-create-new.png)

**Résultat attendu :** un tableau de bord vide s'ouvre en mode modification. Son nom commence par **Nouveau tableau de bord**.
Si ce nom existe déjà, OpenLDR ajoute un numéro. Vous pouvez maintenant ajouter des widgets.

![Le nouveau tableau de bord est sélectionné et sa grille est vide.](dashboard-create-result.png)

Sélectionnez une image pour agrandir la même zone mise en évidence. Ces captures montrent l'interface en anglais.


## Ajouter un widget

Ajoutez un widget pour afficher un graphique, un tableau ou un total. Choisissez les dossiers du laboratoire, puis le calcul et le type de graphique.


### 1. Ouvrir l'éditeur de widget

Un nouveau tableau de bord est déjà en mode modification. Pour un tableau existant, ouvrez son menu à trois points et sélectionnez **Edit**.

![Edit dans le menu du tableau de bord.](dashboard-guide-bar-step-1-new-dashboard.png)
Ouvrez le menu à trois points du tableau et sélectionnez **Add widget**.

![Add widget dans le menu de modification.](dashboard-guide-bar-step-2-add-widget.png)




### 2. Donner un titre au widget

Saisissez un titre qui décrit le résultat. Par exemple, utilisez `Orders by test` pour comparer le nombre de demandes par examen.

![Le titre en haut de l'éditeur de widget.](dashboard-guide-bar-step-3-title.png)


### 3. Choisir les données et le calcul

Dans **Data**, choisissez les dossiers à utiliser. Dans **Summarize**, choisissez le calcul. **Count** compte les dossiers. Les autres calculs dépendent des données choisies.

![Cet exemple utilise Test Orders et Count. Choisissez les données et le calcul adaptés à votre question.](dashboard-guide-bar-step-4-defaults.png)


### 4. Choisir un regroupement si nécessaire

Pour comparer des catégories, sélectionnez **Group by**, puis un champ. Pour un total unique, ne choisissez aucun regroupement.

![Group by se trouve entre Filter et Breakdown.](dashboard-guide-bar-step-5-group-button.png)



![Les champs dépendent de Data. Test forme un groupe par nom d'examen.](dashboard-guide-bar-step-5-group-menu.png)
Pour une date, utilisez **Grain** pour choisir un intervalle disponible.

![Un regroupement par Authored avec Grain réglé sur week.](dashboard-guide-widget-date-grain.png)




### 5. Choisir l'affichage

Ouvrez le menu à trois points de l'éditeur et sélectionnez **Charts**.

![Charts ouvre le choix de visualisation.](dashboard-guide-bar-step-6-chart-menu.png)
Choisissez **Number** pour un total, **Bar** pour comparer des catégories ou **Line** pour une évolution dans le temps.

![Le choix Visualization Type.](dashboard-guide-bar-step-6-bar-picker.png)




### 6. Enregistrer le widget

Ouvrez le menu à trois points de l'éditeur et sélectionnez **Save**.

![L'éditeur se ferme après l'enregistrement.](dashboard-guide-bar-step-7-save.png)


### 7. Vérifier le résultat

Retrouvez le widget par son titre. Les nouveaux widgets apparaissent en bas du tableau. Vérifiez que les libellés et les valeurs décrivent les données choisies.

![Les dossiers choisis déterminent les libellés et les valeurs.](dashboard-guide-bar-result.png)


### 8. Terminer la modification

Ouvrez le menu à trois points du tableau de bord et sélectionnez **Done**.

![Done enregistre le tableau et quitte le mode modification.](dashboard-guide-dashboard-done.png)

**Résultat attendu :** le widget affiche le titre et la présentation choisis. Les valeurs viennent des données sélectionnées. Répétez la tâche pour ajouter des widgets.


## Facultatif : pratiquer avec les données d'exemple

Ces exercices facultatifs utilisent des dossiers fictifs et des résultats connus. Ignorez-les si vous utilisez vos propres données.


### Charger les données d'exemple

Le fichier contient **60 demandes fictives** de septembre et octobre 2026. Utilisez une installation de test vide. Importer le fichier écrit des dossiers dans cette installation.

Pour ouvrir un terminal et exécuter les commandes, consultez [Commencer ici](/docs/start-here#utiliser-la-ligne-de-commande) ou ses [instructions de développement](/docs/start-here#exemple-1-utiliser-la-cli-dans-un-environnement-de-developpement). Remplacez le dossier d'exemple par le vôtre.


#### 1. Télécharger le fichier d'exemple

Linux / macOS:

```sh
cd ~/Downloads/openldr_ce
curl -fL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/apps/web/public/docs-samples/openldr-sample-lab-data.json -o data/openldr-sample-lab-data.json
```

Windows PowerShell:

```powershell
cd C:\openldr_ce
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/apps/web/public/docs-samples/openldr-sample-lab-data.json" -OutFile data/openldr-sample-lab-data.json
```


#### 2. Importer les dossiers

Linux / macOS:

```sh
cd ~/Downloads/openldr_ce
./openldr ingest data/openldr-sample-lab-data.json
```

Windows PowerShell:

```powershell
cd C:\openldr_ce
.\openldr.ps1 ingest data/openldr-sample-lab-data.json
```

**Résultat attendu :** `batch <id>: done (226 resources)`. Patientez quelques secondes avant de lire les données.


#### Depuis une copie du code source

Le fichier d'exemple est déjà inclus. Depuis votre copie de test dans `~/Downloads/openldr_ce` ou `C:\openldr_ce`, exécutez la commande ci-dessous. Elle utilise les bases configurées dans `.env`.

```sh
pnpm openldr ingest apps/web/public/docs-samples/openldr-sample-lab-data.json
```


### Exemple 1 : créer un widget de demandes par examen

Après l'import, utilisez un tableau en mode modification. Vous allez compter les demandes par examen avec les mêmes commandes que ci-dessus.


### 1. Ajouter un widget

Ouvrez le menu à trois points du tableau et sélectionnez **Add widget**.

![Ajouter un widget](dashboard-guide-bar-step-2-add-widget.png)


### 2. Nommer le widget

Saisissez `Orders by test` dans le titre en haut à gauche.

![Nommer le widget](dashboard-guide-bar-step-3-title.png)


### 3. Compter les demandes

Conservez **Test Orders** dans **Data** et **Count** dans **Summarize**.

![Compter les demandes](dashboard-guide-bar-step-4-defaults.png)


### 4. Regrouper par examen

Sélectionnez **Group by**, puis **Test** dans la liste.

![Regrouper par examen](dashboard-guide-bar-step-5-group-button.png)



![Regrouper par examen](dashboard-guide-bar-step-5-group-menu.png)


### 5. Choisir des barres

Ouvrez le menu de l'éditeur et sélectionnez **Charts**. Dans **Visualization Type**, choisissez **Bar**.

![Choisir des barres](dashboard-guide-bar-step-6-chart-menu.png)



![Choisir des barres](dashboard-guide-bar-step-6-bar-picker.png)


### 6. Enregistrer le widget

Ouvrez le menu de l'éditeur et sélectionnez **Save**.

![Enregistrer le widget](dashboard-guide-bar-step-7-save.png)


### 7. Vérifier le graphique

Retrouvez **Orders by test** en bas du tableau.

![Vérifier le graphique](dashboard-guide-bar-result.png)

**Résultat attendu avec les données d'exemple :** cinq barres. **Full blood count** est la plus haute, avec **18 demandes**.

![Orders by test](dashboard-new-widget.mp4)


### Exemple 2 : filtrer le tableau de bord d'exemple

Utilisez **Lab Overview (Sample)** pour compter les demandes urgentes de charge virale VIH reçues en octobre 2026.

![Lab Overview (Sample)](dashboard-filters.mp4)


### 1. Ouvrir le tableau

Sélectionnez **Tableau de bord** dans le menu principal.

![Ouvrir le tableau](dashboard-guide-filter-step-1-dashboard.png)


### 2. Choisir le tableau d'exemple

Sélectionnez **Lab Overview (Sample)** au-dessus des graphiques.

![Choisir le tableau d'exemple](dashboard-guide-filter-step-2-selector.png)


### 3. Choisir les dates d'octobre

Ouvrez **Period** et allez en octobre 2026. Sélectionnez **1**, puis **31**, et cliquez hors du calendrier.

![Choisir les dates d'octobre](dashboard-guide-filter-step-3-calendar.png)



![Choisir les dates d'octobre](dashboard-guide-filter-step-3-selected.png)


### 4. Choisir l'examen

Ouvrez **Test** et sélectionnez **HIV viral load**.

![Choisir l'examen](dashboard-guide-filter-step-4-test.png)


### 5. Choisir les demandes urgentes

Ouvrez **Priority** et sélectionnez **urgent**.

![Choisir les demandes urgentes](dashboard-guide-filter-step-5-priority.png)


### 6. Lire le résultat

Lisez **Total Orders** et **Distinct Patients** sous les filtres.

![Lire le résultat](dashboard-guide-filter-result.png)

**Résultat attendu avec les données d'exemple :** **Total Orders** et **Distinct Patients** affichent **1**. **Results Recorded** affiche **4**, car il ignore Priority. **Orders by Test** conserve tous les examens, car il ignore Test.


## Autres tâches des tableaux de bord

La référence suivante décrit les autres commandes de l'éditeur, la disposition, les filtres, SQL et l'export.
### Qui peut faire quoi

Ce que vous voyez dépend des autorisations de votre rôle. Un administrateur les règle dans **Rôles**. Les noms des autorisations s'affichent en anglais.

| Autorisation | Ce qu'elle permet |
| --- | --- |
| View dashboards | Ouvrir **Tableau de bord**, lire les widgets, utiliser les filtres, actualiser, exporter. |
| Create dashboards | Utiliser **Nouveau tableau de bord** et **Importer**. |
| Edit dashboards | Utiliser **Edit**, ajouter et modifier des widgets et des filtres, déplacer et redimensionner. |
| Delete dashboards | Utiliser **Supprimer** en mode modification. |

Sans **View dashboards**, Studio affiche une page d'accès refusé et ne charge aucune donnée. La navigation, la documentation et la déconnexion restent accessibles.

Deux paramètres comptent aussi. Ils sont réservés aux administrateurs et décrits dans [Limites et paramètres](#limites-et-parametres) :

- **SQL brut pour les tableaux de bord** décide si quelqu'un peut écrire des widgets SQL. Il est désactivé sur une nouvelle installation.
- **Exposition des données** décide quelles colonnes supplémentaires le Builder peut proposer.

### Actualiser

Sélectionnez **Actualiser**, l'icône en forme de flèches, pour relancer tous les widgets tout de suite.

Un widget peut aussi s'actualiser seul. Les widgets d'exemple s'actualisent toutes les 5 minutes. Pour en régler un, ouvrez le widget dans l'éditeur et tapez un nombre de secondes dans **Refresh every (seconds)**, au-dessus des options du graphique. Le champ s'affiche avant que la requête ait tourné. Sur un téléphone, il est dans l'onglet **Style**.

Comment l'actualisation se comporte :

- L'intervalle démarre quand une requête se termine. Une requête lente retarde la suivante. Elle ne lance jamais une deuxième requête par-dessus la première.
- Un intervalle de 0 désactive l'actualisation automatique.
- Changer un filtre, ou quitter la page, annule la requête dans le navigateur. Une réponse tardive ne remplace jamais une réponse plus récente.
- Annuler dans le navigateur n'arrête pas toujours la requête dans la base.

### Renommer un tableau de bord

Chaque nouveau tableau de bord s'appelle **Nouveau tableau de bord**, puis **Nouveau tableau de bord (2)**, et ainsi de suite. Pour lui donner un nom, ouvrez le **Dashboard menu**, choisissez **Renommer**, tapez le nom, puis choisissez **Enregistrer** dans le menu **⋯** du volet. **Renommer** attend tant que des modifications ne sont pas enregistrées. Le tableau de bord d'exemple garde son nom : OpenLDR le rétablit au redémarrage du serveur.

### L'éditeur de widget

![L'éditeur de widget. 1 Titre. 2 Data. 3 Summarize. 4 Group by. 5 Builder ou SQL. 6 Editor menu.](dashboard-builder.png)

1. **Titre.** Affiché sur la carte du widget.
2. **Data.** Ce qu'il faut compter : **Test Orders**, **Results**, **Reports**, **Specimens**, **Patients** ou **Facilities**.
3. **Summarize.** La mesure. **Count** par défaut. **Add measure** en ajoute une autre, comme **Distinct Patients** ou **Avg Value**. **Formula** divise une mesure par une autre, par exemple pour montrer un pourcentage.
4. **Group by.** Répartit la mesure selon un champ. Un champ de date demande aussi un **Grain** : jour, semaine, mois, trimestre ou année.
5. **Builder** ou **SQL.** Passer à SQL montre la requête écrite par le Builder. Vous ne pouvez la modifier que si **SQL brut pour les tableaux de bord** est activé.
6. **Editor menu.** **Tables** liste les champs. **Charts** choisit l'image. **Filters** règle les variables SQL. **Save** enregistre. **Delete** supprime un widget enregistré.

La rangée de boutons sous **Summarize** ajoute d'autres parties : **Filter**, **Group by**, **Breakdown**, **Sort**, **Join data** et **Custom column**, dans cet ordre. Chaque partie a un **×** pour la retirer.

En bas à gauche, on voit les lignes brutes. En bas à droite se trouve le style : quelle colonne sert de catégorie, laquelle sert de valeur, et la couleur. Sur un téléphone, ces zones deviennent quatre onglets : **Build**, **Preview**, **Data** et **Style**.

Pour modifier un widget enregistré, passez en mode modification, ouvrez le menu à trois points du widget et sélectionnez **Edit**.

### Types de graphiques

![Le choix du graphique, ouvert depuis Editor menu, Charts.](dashboard-chart-types.png)

| Type | Usage | Options de style |
| --- | --- | --- |
| Number | Un total | Colonne de valeur, suffixe comme `%` |
| Line | Une évolution dans le temps | Catégorie, valeur, couleur |
| Bar | Comparer des groupes | Catégorie, valeur, couleur |
| Area | Un volume dans le temps | Catégorie, valeur, couleur |
| Row | Des barres couchées, pour les noms longs | Catégorie, valeur, couleur |
| Pie | Les parts d'un tout | Catégorie, valeur, rayon intérieur. 0 dessine un camembert, plus dessine un anneau |
| Scatter | Deux mesures l'une contre l'autre | Colonne X, colonne Y, couleur |
| Funnel | Des étapes qui rétrécissent | Catégorie, valeur |
| Progress | Avancement vers un objectif | Colonne de valeur, objectif, couleur, suffixe |
| Gauge | Une valeur sur un cadran | Colonne de valeur, min, max, vert à partir de, orange à partir de, suffixe |
| Table | Les lignes elles-mêmes | Aucune |
| Traffic Light | Bon, à surveiller ou mauvais | Colonne de valeur, vert à partir de, orange à partir de, suffixe |

**Breakdown** ajoute une colonne `series`, par exemple une par priorité. Les graphiques en barres, en lignes horizontales, en ligne et en aires dessinent une série par valeur, chacune de sa couleur, avec une légende. Un camembert ou un entonnoir additionne les valeurs et montre un total par libellé. **Table** affiche la colonne `series` telle quelle.

## Exemple 3 : demandes par semaine

Montrez combien de demandes arrivent chaque semaine.

![Un graphique en ligne des demandes par semaine.](dashboard-trend.mp4)

1. Restez en mode modification. Ouvrez le menu à trois points et sélectionnez **Add widget**.
2. Tapez le titre `Orders per week`.
3. Sélectionnez **Group by** et choisissez **Authored**. Authored est la date de la demande.
4. Dans **Grain**, choisissez **week**.
5. Ouvrez l'**Editor menu**, sélectionnez **Charts**, puis choisissez **Line**.
6. Ouvrez l'**Editor menu** et sélectionnez **Save**.

**Résultat attendu :** une ligne avec un point par semaine, de la semaine du 30 août à celle du 25 octobre 2026. La semaine la plus chargée est celle du 4 octobre.

L'éditeur place chaque nouveau widget en bas de la grille. Faites défiler vers le bas pour le trouver.

## Exemple 4 : un chiffre avec une condition

Comptez les résultats marqués hauts.

![Un widget chiffre qui compte les résultats hauts.](dashboard-number.mp4)

1. Ouvrez le menu à trois points et sélectionnez **Add widget**.
2. Tapez le titre `High results`.
3. Ouvrez **Data** et choisissez **Results**.
4. Sélectionnez **Filter**, puis **Add condition**.
5. Réglez le champ sur **Interpretation**. Laissez l'opérateur sur **eq**, qui veut dire égal. Tapez `H` comme valeur.
6. **Number** est déjà le type de graphique. Ouvrez l'**Editor menu** et sélectionnez **Save**.

**Résultat attendu :** le widget affiche 22.

L'exemple utilise les indicateurs habituels : `H` haut, `L` bas, `N` normal, `A` anormal. Pour compter ensemble les hauts et les bas, réglez l'opérateur sur **in** et la valeur sur `H, L`. Cela donne 27.

Opérateurs de filtre : **eq** égal, **in** l'un d'une liste, **contains** contient un texte, **gte** supérieur ou égal, **lte** inférieur ou égal, **between** entre deux valeurs. **Add group** imbrique des conditions. **Match type** choisit si toutes les conditions ou l'une d'elles doivent être vraies.

## Déplacer et redimensionner les widgets

![Déplacer un widget et en élargir un autre.](dashboard-layout.mp4)

En mode modification, chaque carte montre une poignée à côté de son titre.

- **Déplacer.** Faites glisser une carte par son titre. Les autres se décalent pour faire de la place.
- **Redimensionner.** Faites glisser le coin en bas à droite d'une carte.

Les changements s'enregistrent seuls environ une seconde et demie après votre dernier geste. **Done**, dans le menu à trois points, enregistre aussi et quitte le mode modification.

![Le menu du tableau de bord en mode modification.](dashboard-menu-edit.png)

Sur un téléphone, les cartes s'affichent sur une seule colonne et ne peuvent pas être déplacées ni redimensionnées. Utilisez un ordinateur pour organiser un tableau de bord.

## Filtres du tableau de bord

Le tableau de bord d'exemple a trois filtres. Votre nouveau tableau de bord n'en a aucun. Ajoutez un filtre de période.

![Ajouter un filtre Period.](dashboard-filter-add.mp4)

1. En mode modification, ouvrez le menu à trois points et sélectionnez **Edit filters**. Le panneau **Filtres du tableau de bord** s'ouvre.
2. Ouvrez **Actions du filtre**, les trois points en haut du panneau, et sélectionnez **Ajouter un filtre**.
3. Dans **Identifiant de variable**, tapez `period`.
4. Dans **Libellé**, tapez `Period`.
5. Dans **Type**, choisissez **Plage de dates**.
6. Ouvrez **Actions du filtre** et sélectionnez **Enregistrer**. Puis sélectionnez **Done** dans le menu à trois points.

![Le panneau des filtres. Les jetons à utiliser en SQL s'affichent à côté de chaque filtre.](dashboard-filter-editor.png)

Types de filtres :

| Type | Choisit | Jetons SQL |
| --- | --- | --- |
| Texte | Un mot dans une liste, ou tapé | `{{id}}` |
| Nombre | Un nombre | `{{id}}` |
| Date | Un jour | `{{id}}` |
| Plage de dates | Un premier et un dernier jour | `{{id_from}}` et `{{id_to}}` |

Un filtre texte peut remplir sa liste avec **SQL des options**. Le filtre **Test** de l'exemple utilise `SELECT DISTINCT panel_desc FROM lab_requests WHERE panel_desc IS NOT NULL ORDER BY panel_desc`. Tout filtre peut avoir une **Valeur par défaut**.

> **Un filtre ne change que les widgets qui lui sont reliés.** Un widget SQL est relié quand son SQL utilise les jetons du filtre et que ses variables sont réglées dans **Filters**. Un widget du Builder se relie dans le bloc **Dashboard filters** du Builder : choisissez le champ que chaque filtre restreint, par exemple **Authored** pour **Period**. Un filtre relié remplace la condition du widget sur ce même champ. L'exemple suivant montre comment relier un filtre au SQL.

## Exemple 5 : un widget écrit en SQL

Montrez les demandes par établissement demandeur. Le Builder ne peut pas le faire, car **Test Orders** n'a pas de champ établissement. Écrivez donc du SQL.

### Activer les widgets SQL

Un administrateur le fait une seule fois.

![Paramètres, Général, avec l'interrupteur SQL brut pour les tableaux de bord.](dashboard-raw-sql-setting.png)

1. Ouvrez **Paramètres**, puis **Général**.
2. Activez **SQL brut pour les tableaux de bord**.

En ligne de commande, lancez `./openldr settings flags set dashboard.raw_sql true`. Les widgets SQL ne font que lire les données. Ils interrogent l'entrepôt de cette installation : PostgreSQL, MySQL ou SQL Server.

### Écrire le widget

![Écrire le widget SQL, l'exécuter et choisir un graphique Row.](dashboard-sql.mp4)

1. Choisissez **Nouveau tableau de bord** dans le sélecteur. Ouvrez le menu à trois points et sélectionnez **Edit**, puis **Add widget**.
2. Tapez le titre `Orders by requesting site`.
3. Sélectionnez **SQL**. Remplacez le texte de l'éditeur par :

```sql
SELECT requester_display AS label, COUNT(*) AS value
FROM lab_requests
WHERE 1=1
[[AND substring(authored_at,1,10) >= {{period_from}}]]
[[AND substring(authored_at,1,10) <= {{period_to}}]]
GROUP BY requester_display
ORDER BY value DESC
```

4. Sélectionnez **Run query**, le bouton lecture. Les lignes affichent 23, 22 et 15.
5. Ouvrez l'**Editor menu**, sélectionnez **Charts**, puis choisissez **Row**.

Nommez la colonne de catégorie `label` et la colonne de nombre `value`. Les graphiques cherchent ces noms en premier. Le panneau de style peut les diriger vers d'autres colonnes.

`{{period_from}}` est une variable. `[[ ... ]]` rend une ligne facultative. Si la variable n'a pas de valeur, toute la ligne disparaît. Sans les crochets, une variable vide devient `NULL` et la requête ne renvoie rien.

### Relier les variables au filtre Period

![Ouvrir Filters, régler le type sur Date Range et le relier à Period.](dashboard-sql-variables.mp4)

1. Ouvrez l'**Editor menu** et sélectionnez **Filters**. Le panneau **Variables** liste `{{period_from}}` et `{{period_to}}`.
2. Réglez **Type** sur **Date Range**. Les deux variables n'en font plus qu'une, nommée `period`.
3. Réglez **Dashboard Filter** sur **Period (period)**.
4. Fermez le panneau. Ouvrez l'**Editor menu** et sélectionnez **Save**. Puis sélectionnez **Done** dans le menu à trois points.

Seuls les filtres du même type apparaissent dans **Dashboard Filter**. **Test Value** permet d'essayer une valeur dans l'éditeur sans toucher au tableau de bord.

### Utiliser le filtre

![Choisir octobre 2026 dans Period. Seul le widget SQL change.](dashboard-filter-apply.mp4)

Sélectionnez **Period** et choisissez du 1er au 31 octobre 2026.

**Résultat attendu :** Orders by requesting site passe à 12, 11 et 9. Les widgets du Builder ne changent pas, car aucun n'est relié à **Period**.

Une pastille de variable rouge au-dessus du SQL veut dire que la variable ne peut pas être résolue. Soit son type ne correspond plus au filtre relié, soit une plage de dates est écrite `{{period}}` au lieu de `{{period_from}}` et `{{period_to}}`. Ouvrez **Filters** dans l'**Editor menu** pour lire le message.

## Exporter, importer et copier

Le menu à trois points propose **Exporter** et **Importer**, en consultation comme en modification.

- **Exporter** télécharge le tableau de bord en fichier JSON nommé d'après lui, par exemple `Nouveau_tableau_de_bord.json`.
- **Importer** lit un tel fichier et l'ajoute comme nouveau tableau de bord. Il n'en remplace jamais un. Si le nom est déjà pris, il ajoute un numéro.

Servez-vous-en pour :

- **Copier un tableau de bord** vers une autre installation, ou en garder une sauvegarde.

Importer un tableau de bord qui contient des widgets SQL échoue tant que **SQL brut pour les tableaux de bord** est désactivé, avec le message `raw SQL widgets are disabled`. Cela vaut aussi pour une copie du tableau de bord d'exemple. Activez d'abord le paramètre.

## Supprimer un tableau de bord

1. Sélectionnez le tableau de bord et passez en mode modification.
2. Ouvrez le menu à trois points et sélectionnez **Supprimer**.
3. Confirmez avec **Supprimer le tableau de bord**.

![La demande de confirmation.](dashboard-delete-confirm.png)

La suppression est définitive. Exportez d'abord si vous pourriez en avoir besoin. Pour terminer ce guide, supprimez **Nouveau tableau de bord**.

## Sur un téléphone

Des personnes utilisent Studio sur leur téléphone. Les tableaux de bord y fonctionnent sur une seule colonne.

![Le tableau de bord d'exemple sur un téléphone.](dashboard-phone.png)

Sur un téléphone, vous pouvez lire les widgets, utiliser les filtres, actualiser et exporter. Déplacer et redimensionner demandent un ordinateur. L'éditeur de widget fonctionne sur un téléphone, avec ses quatre onglets.

## Limites et paramètres

Ces réglages sont réservés aux administrateurs. Ils se trouvent dans **Paramètres**, **Général**.

| Paramètre | Par défaut | Effet |
| --- | --- | --- |
| SQL brut pour les tableaux de bord | Désactivé | Permet d'écrire et d'exécuter des widgets SQL. Le SQL de l'exemple s'exécute même désactivé. |
| Délai SQL des tableaux de bord (ms) | 5000 | Arrête toute requête de widget, Builder ou SQL, qui dure plus longtemps. |
| Plafond de lignes SQL des tableaux de bord | 10000 | Les widgets SQL renvoient au plus ce nombre de lignes. Les widgets du Builder échouent si la requête produit plus de groupes. |

Le plafond compte les groupes de la base avant que le tableau de bord regroupe les dates, additionne les séries ou garde les N premiers. Demander moins de premiers résultats ne contourne pas le plafond. Si un widget atteint le plafond, il affiche une erreur, jamais un total partiel. Restreignez les filtres ou regroupez moins.

PostgreSQL, MySQL, MariaDB et SQL Server arrêtent tous le travail de la base au délai. SQL Server réinitialise aussi chaque connexion partagée après une requête, pour que les limites de lignes et de verrous ne touchent jamais la suivante.

**Exposition des données**, aussi dans Paramètres, décide quelles colonnes supplémentaires de l'entrepôt le Builder peut proposer, par exemple dans **Join data**. Voir [Exposition des données](/docs/data-exposure).

## Dépannage

**Le widget affiche No data ou un total nul.** Vérifiez que des dossiers sont arrivés pour les données choisies. Vous pouvez enregistrer le widget avant leur arrivée.

**Mon nouveau widget est introuvable.** Les nouveaux widgets apparaissent en bas du tableau. Faites défiler la page.

**La commande de modification est absente.** Vérifiez que votre rôle permet de modifier les tableaux de bord.

**Mes totaux sont différents.** Les résultats supposent que seules les données d'exemple sont chargées. Les autres données changent les totaux.

- **Chaque chiffre vaut 0 et chaque graphique affiche No data.** L'entrepôt est vide. [Chargez les données d'exemple](#charger-les-donnees-d-exemple), ou chargez les vôtres.
- **Aucun tableau de bord n'apparaît.** Il n'en existe encore aucun. La page vide propose **Nouveau tableau de bord** et **Importer**.
- **Edit n'apparaît pas dans le menu.** Votre rôle n'a pas **Edit dashboards**.
- **Le SQL n'est pas modifiable, ou l'enregistrement affiche `raw SQL widgets are disabled`.** Activez **SQL brut pour les tableaux de bord**. Voir [Activer les widgets SQL](#activer-les-widgets-sql).
- **Un widget ignore la barre de filtres.** Il n'est pas relié à ce filtre. Pour un widget du Builder, choisissez un champ dans son bloc **Dashboard filters**. Un widget SQL ne suit un filtre que si son SQL utilise les jetons et si ses variables sont reliées dans **Filters**.
- **Breakdown ne change rien à mon camembert.** Un camembert ou un entonnoir additionne les valeurs de Breakdown. Utilisez un graphique en barres pour les voir côte à côte.
- **Un widget affiche une erreur de délai ou de lignes.** Il a atteint le délai ou le plafond de lignes. Voir [Limites et paramètres](#limites-et-parametres).
- **Un nouveau widget n'est pas visible.** Les nouveaux widgets vont en bas de la grille. Faites défiler vers le bas.

## Guides associés

- [Rapports](/docs/reports)
- [Requêtes personnalisées](/docs/query)
- [Flux de travail](/docs/workflows), qui peuvent publier des jeux de données lus par les tableaux de bord
- [Exposition des données](/docs/data-exposure)
- [Paramètres](/docs/settings)
