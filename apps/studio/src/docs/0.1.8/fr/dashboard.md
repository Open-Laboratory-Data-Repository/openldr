# Tableaux de bord

Un tableau de bord est une page de graphiques, de chiffres et de tableaux. Chaque tuile est un **widget**. Un widget exécute une requête sur l'entrepôt du laboratoire et dessine la réponse. Les filtres en haut de la page changent ce que les widgets comptent.

Ce guide prend environ 45 minutes. Vous chargez un petit jeu de données de laboratoire fictives, vous explorez le tableau de bord d'exemple, puis vous construisez votre propre tableau de bord avec quatre widgets. Chaque étape a une image ou un court clip. Sélectionnez une image ou un clip pour l'agrandir.

Certaines parties de l'interface sont encore en anglais. Ce guide écrit chaque libellé tel qu'il apparaît à l'écran.

![Le tableau de bord d'exemple. 1 Sélecteur. 2 Actualiser. 3 Menu du tableau de bord. 4 Filtres. 5 Un widget.](dashboard-tour.png)

1. **Sélecteur.** Passe d'un tableau de bord à l'autre.
2. **Actualiser.** Relance tous les widgets tout de suite.
3. **Menu du tableau de bord.** Le menu à trois points. Il contient toutes les actions : créer, modifier, ajouter un widget, filtres, exporter, importer, supprimer.
4. **Filtres.** Réduisent le tableau de bord à une période, un examen ou une priorité.
5. **Un widget.** Une requête et une image de sa réponse.

## Qui peut faire quoi

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

## Charger les données d'exemple

Une nouvelle installation contient le tableau de bord d'exemple, **Lab Overview (Sample)**, mais presque aucune donnée de laboratoire. Chaque chiffre affiche 0 et chaque graphique affiche **No data**. Les exemples de ce guide ont besoin de données. Chargez d'abord le fichier d'exemple.

Le fichier est un Bundle FHIR de type transaction, rempli d'activité fictive. Il contient 24 patients et 60 demandes d'examen sur cinq examens, venant de trois établissements, avec leurs échantillons, résultats et comptes rendus. Toutes les dates tombent en septembre et octobre 2026. Le même fichier donne toujours les mêmes chiffres, donc votre écran doit correspondre à ce guide.

> **Utilisez une installation de test.** Les lignes d'exemple deviennent de vraies lignes dans votre entrepôt. Aucune commande ne retire seulement celles-ci. Pour repartir de zéro, lancez `./openldr db reset`, qui supprime et recrée toute la base. Ne chargez jamais l'exemple sur l'installation d'un laboratoire en service.

**Sur une installation faite avec l'installateur en une ligne**, lancez ces commandes depuis le dossier d'installation. La commande `openldr` tourne dans le conteneur `api`, qui ne voit que le dossier `data`. Le fichier doit donc s'y trouver.

```bash
curl -L -o data/openldr-sample-lab-data.json https://openldr.online/docs-samples/openldr-sample-lab-data.json
./openldr ingest data/openldr-sample-lab-data.json
```

Sous Windows, téléchargez le même fichier dans `data`, puis lancez `.\openldr.ps1 ingest data/openldr-sample-lab-data.json`.

**Depuis une copie du code source**, le fichier est déjà dans le dépôt :

```bash
pnpm openldr ingest apps/web/public/docs-samples/openldr-sample-lab-data.json
```

Un chargement réussi se termine par `batch <id>: done (226 resources)`. Ouvrez **Tableau de bord**. En quelques secondes, vous devez voir :

| Widget | Valeur avec l'exemple chargé |
| --- | --- |
| Total Orders | 60 |
| Distinct Patients | 21 |
| Results Recorded | 51 |
| Orders by Test | Full blood count 18, Malaria rapid test 16, HIV viral load 11, Blood glucose 9, Creatinine 6 |

Si les chiffres sont plus élevés, l'entrepôt contenait déjà d'autres données. Les exemples fonctionnent toujours, mais vos chiffres seront différents.

## Ce que montre le tableau de bord d'exemple

**Lab Overview (Sample)** est livré avec chaque installation. Ses widgets portent des noms anglais. Chacun est écrit en SQL. Ils s'exécutent même lorsque **SQL brut pour les tableaux de bord** est désactivé, car le serveur connaît ces requêtes. Tous les widgets n'écoutent pas tous les filtres.

| Widget | Montre | Suit les filtres |
| --- | --- | --- |
| Total Orders | Nombre de demandes d'examen | Period, Test, Priority |
| Distinct Patients | Patients ayant au moins une demande | Period, Test, Priority |
| Results Recorded | Résultats non annulés | Period, Test |
| Result Finalisation % | Part des comptes rendus définitifs ou modifiés | Aucun |
| Orders by Test | Demandes par examen, les 15 premiers | Period, Priority |
| Orders Trend | Demandes par jour | Period, Test, Priority |
| Orders by Status | Demandes par statut | Period, Test, Priority |
| Orders by Priority | Demandes par priorité | Period, Test |
| Order → Report Pipeline | Demandé, échantillon reçu, résultat saisi, compte rendu émis | Aucun |
| Abnormal Results | Résultats marqués haut, bas ou anormal | Period |
| Results Trend | Résultats par jour | Period, Test |
| Analyte Volume vs Avg Value | Nombre de résultats face à la valeur moyenne, par analyte | Aucun |
| Recent Orders | Les 50 demandes les plus récentes | Period, Test, Priority |

**Test** liste des noms de demandes, comme Full blood count. **Results Recorded** et **Results Trend** comptent les résultats des demandes de cet examen. Une demande Full blood count a deux résultats, Haemoglobin et White cell count, donc les deux sont comptés.

## Exemple 1 : filtrer le tableau de bord d'exemple

Trouvez combien de demandes urgentes de HIV viral load sont arrivées en octobre 2026.

![Filtrer le tableau de bord d'exemple sur octobre 2026, HIV viral load, urgent.](dashboard-filters.mp4)

1. Ouvrez **Tableau de bord**. Le sélecteur affiche **Lab Overview (Sample)**.
2. Sélectionnez **Period**. Revenez à octobre 2026. Sélectionnez le 1er octobre, puis le 31 octobre.
3. Ouvrez **Test** et choisissez **HIV viral load**.
4. Ouvrez **Priority** et choisissez **urgent**.

**Résultat attendu :** Total Orders affiche 1 et Distinct Patients affiche 1. Results Recorded affiche 4, car il ignore **Priority**. Orders by Test montre toujours tous les examens, car il ignore **Test**.

![Le tableau de bord après les trois filtres.](dashboard-filters-result.png)

Pour effacer un filtre, ouvrez-le et choisissez **All**. Pour effacer **Period**, ouvrez-le et sélectionnez **Clear**. Les filtres ne sont pas enregistrés. Recharger la page remet chaque filtre à sa valeur par défaut.

## Actualiser

Sélectionnez **Actualiser**, l'icône en forme de flèches, pour relancer tous les widgets tout de suite.

Un widget peut aussi s'actualiser seul. Les widgets d'exemple s'actualisent toutes les 5 minutes. Pour en régler un, ouvrez le widget dans l'éditeur et tapez un nombre de secondes dans **Refresh every (seconds)**, au-dessus des options du graphique. Le champ s'affiche avant que la requête ait tourné. Sur un téléphone, il est dans l'onglet **Style**.

Comment l'actualisation se comporte :

- L'intervalle démarre quand une requête se termine. Une requête lente retarde la suivante. Elle ne lance jamais une deuxième requête par-dessus la première.
- Un intervalle de 0 désactive l'actualisation automatique.
- Changer un filtre, ou quitter la page, annule la requête dans le navigateur. Une réponse tardive ne remplace jamais une réponse plus récente.
- Annuler dans le navigateur n'arrête pas toujours la requête dans la base.

## Exemple 2 : créer un tableau de bord et un graphique en barres

Construisez un graphique en barres des demandes par examen avec le **Builder**. Aucun SQL n'est nécessaire.

![Créer un tableau de bord et un graphique en barres avec le Builder.](dashboard-new-widget.mp4)

1. Ouvrez le menu à trois points et sélectionnez **Nouveau tableau de bord**. Un tableau de bord vide nommé **Nouveau tableau de bord** s'ouvre en mode modification. Le mode modification affiche une grille de points.
2. Ouvrez de nouveau le menu et sélectionnez **Add widget**. L'éditeur de widget s'ouvre.
3. Sélectionnez le titre en haut à gauche et tapez `Orders by test`.
4. **Data** indique déjà **Test Orders**, et **Summarize** indique déjà **Count**. Laissez les deux.
5. Sélectionnez le bouton **Group by**, la deuxième icône de la rangée sous **Summarize**. Dans la nouvelle zone **Group by**, choisissez **Test**.
6. L'aperçu à droite montre maintenant cinq chiffres. Ouvrez le menu à trois points de l'éditeur, l'**Editor menu**, et sélectionnez **Charts**. Choisissez **Bar**.
7. Ouvrez de nouveau l'**Editor menu** et sélectionnez **Save**.

**Résultat attendu :** le graphique en barres apparaît sur la grille. Full blood count est la barre la plus haute, à 18.

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

**Breakdown** ajoute une colonne `series`, par exemple une par priorité. Aujourd'hui, seul **Table** l'affiche. Les graphiques en ligne, en barres et en aires dessinent une seule série et l'ignorent.

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

> **Les filtres n'atteignent que les widgets SQL.** Un filtre du tableau de bord ne change un widget que si le SQL de ce widget utilise les jetons du filtre. Les widgets du Builder gardent leurs propres conditions et ignorent la barre de filtres. L'exemple suivant montre comment relier un filtre.

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

**Résultat attendu :** Orders by requesting site passe à 12, 11 et 9. Les widgets du Builder ne changent pas.

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

- **Chaque chiffre vaut 0 et chaque graphique affiche No data.** L'entrepôt est vide. [Chargez les données d'exemple](#charger-les-donnees-d-exemple), ou chargez les vôtres.
- **Aucun tableau de bord n'apparaît.** Il n'en existe encore aucun. La page vide propose **Nouveau tableau de bord** et **Importer**.
- **Edit n'apparaît pas dans le menu.** Votre rôle n'a pas **Edit dashboards**.
- **Le SQL n'est pas modifiable, ou l'enregistrement affiche `raw SQL widgets are disabled`.** Activez **SQL brut pour les tableaux de bord**. Voir [Activer les widgets SQL](#activer-les-widgets-sql).
- **Un widget ignore la barre de filtres.** Les widgets du Builder l'ignorent toujours. Un widget SQL ne suit un filtre que si son SQL utilise les jetons et si ses variables sont reliées dans **Filters**.
- **Breakdown ne change rien à mon graphique.** Seul **Table** affiche une répartition aujourd'hui.
- **Un widget affiche une erreur de délai ou de lignes.** Il a atteint le délai ou le plafond de lignes. Voir [Limites et paramètres](#limites-et-parametres).
- **Un nouveau widget n'est pas visible.** Les nouveaux widgets vont en bas de la grille. Faites défiler vers le bas.

## Guides associés

- [Rapports](/docs/reports)
- [Requêtes personnalisées](/docs/query)
- [Flux de travail](/docs/workflows), qui peuvent publier des jeux de données lus par les tableaux de bord
- [Exposition des données](/docs/data-exposure)
- [Paramètres](/docs/settings)
