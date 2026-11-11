# Requêtes personnalisées

**Requête** est l'endroit où vous regardez directement les données du laboratoire et où vous écrivez du SQL. Vous parcourez des tables, vous écrivez un `SELECT`, vous ajoutez des paramètres, et vous l'enregistrez comme **requête personnalisée**. Les requêtes enregistrées sont celles que les tableaux du [Concepteur de rapports](/docs/report-designer) utilisent, et celles que les [rapports](/docs/reports) publiés exécutent.

Ce guide prend environ 25 minutes. Il utilise les données d'exemple de la documentation, chargez-les d'abord. Sélectionnez une image ou un clip pour l'agrandir.

![Requête avec une table ouverte. 1 Connecteurs. 2 Jeux de données. 3 Requêtes personnalisées. 4 Nouvel onglet de requête. 5 Exécuter.](query-tour.png)

1. **Connecteurs.** Chaque connecteur de base de données, ses schémas et ses tables.
2. **Jeux de données.** Les tables que des flux de travail ont construites pour être réutilisées.
3. **Requêtes personnalisées.** Les requêtes enregistrées, rangées en groupes si vous en avez créé.
4. **Nouvelle requête.** Le **+** de la barre d'onglets ouvre un onglet de requête vide.
5. **Exécuter.** Exécute l'onglet ouvert.

## Qui peut faire quoi

Une seule autorisation couvre cette page : **Use query workbench**. Les rôles Lab Admin, Lab Manager et Data Analyst l'ont par défaut.

Les requêtes ne font que lire. Une requête qui modifie des données ou des tables est refusée.

## Avant de commencer

Les exemples ont besoin des données d'exemple de la documentation. Si **Total Orders** affiche 0 sur le tableau de bord d'exemple, chargez-les d'abord. Voir [Charger les données d'exemple](/docs/dashboard#charger-les-donnees-d-exemple).

Une nouvelle installation a déjà un connecteur, **Target Warehouse (Postgres)**, qui pointe vers l'entrepôt du laboratoire. Elle fournit aussi les requêtes derrière les rapports fournis, sous **Requêtes personnalisées**. Vous pouvez les ouvrir et les lire. Modifiez-les avec prudence, car des rapports les utilisent.

## Exemple 1 : parcourir une table

Regardez les demandes d'examen brutes.

![Ouvrir Connecteurs, Target Warehouse, public et lab_requests.](query-browse.mp4)

1. Ouvrez **Requête**.
2. Dans l'**Explorateur**, dépliez **Connecteurs**, puis **Target Warehouse (Postgres)**, puis **public**.
3. Sélectionnez **lab_requests**. Un onglet s'ouvre avec ses lignes.

**Résultat attendu :** le bas de page affiche **1–50 of 60**. Chaque ligne est une demande, avec des colonnes comme `request_id`, `patient_id`, `panel_desc`, `status`, `priority` et `authored_at`.

Les tables les plus utiles :

| Table | Une ligne par |
| --- | --- |
| `lab_requests` | Demande d'examen |
| `lab_results` | Résultat, par exemple une valeur d'hémoglobine |
| `specimens` | Échantillon |
| `diagnostic_reports` | Compte rendu émis |
| `patients` | Patient |
| `facility_registry` | Établissement du registre. Voir [Établissements](/docs/facilities). |

Le simple parcours d'une table n'a pas d'ordre fixe. Pour voir le SQL derrière, sélectionnez le bouton de code en haut à droite de l'onglet.

## Exemple 2 : écrire une requête

Comptez les demandes pour chaque examen.

![Ouvrir un nouvel onglet, choisir le connecteur, écrire le SQL et l'exécuter.](query-write.mp4)

1. Sélectionnez **+** dans la barre d'onglets. Un onglet nommé **Query #1** s'ouvre.
2. Ouvrez la liste des connecteurs et choisissez **Target Warehouse (Postgres)**.
3. Tapez ceci dans l'éditeur :

```sql
SELECT panel_desc AS test, COUNT(*) AS orders
FROM lab_requests
GROUP BY panel_desc
ORDER BY orders DESC
```

4. Sélectionnez **Exécuter**, le bouton lecture.

**Résultat attendu :** cinq lignes. Full blood count 18, Malaria rapid test 16, HIV viral load 11, Blood glucose 9, Creatinine 6.

**Exécuter** reste grisé tant que l'onglet n'a pas de connecteur et de SQL.

## Exemple 3 : ajouter un paramètre

Transformez la requête pour qu'elle demande quel examen compter, et qu'elle répartisse les demandes par priorité.

![Changer le SQL, ajouter un paramètre select avec un SQL des options, et l'enregistrer.](query-params.mp4)

1. Remplacez le SQL par :

```sql
SELECT priority, COUNT(*) AS orders
FROM lab_requests
WHERE panel_desc = {{ param.test }}
GROUP BY priority
ORDER BY orders DESC
```

2. Sélectionnez le bouton **Paramètres**, l'icône de curseurs à droite de la barre de l'onglet. La fenêtre **Paramètres** s'ouvre.
3. Sélectionnez **Ajouter**.
4. Dans **ID de variable**, saisissez `test`. Il doit correspondre au nom dans `{{ param.test }}`.
5. Dans **Libellé**, tapez `Test`. C'est ce que voient les personnes qui l'exécutent.
6. Réglez **Type** sur **select**. Une zone **SQL des options** apparaît. Tapez `SELECT DISTINCT panel_desc FROM lab_requests ORDER BY 1`. Sa première colonne remplit la liste.
7. Cochez **Requis**.
8. Sélectionnez **Enregistrer**.

![La fenêtre Paramètres avec un paramètre select.](query-params-sheet.png)

Types de paramètres :

| Type | Demande | SQL |
| --- | --- | --- |
| text | Un texte libre | `{{ param.<id> }}` |
| select | Une valeur dans une liste. **SQL des options** remplit la liste. | `{{ param.<id> }}` |
| daterange | Un premier et un dernier jour | `{{ param.from }}` et `{{ param.to }}` |

Les flèches d'un paramètre changent son ordre. La corbeille le retire.

### L'exécuter avec une valeur

![Exécuter la requête, choisir HIV viral load et exécuter avec cette valeur.](query-run-values.mp4)

1. Sélectionnez **Exécuter**. Comme la requête a des paramètres, un panneau latéral, **Paramètres d'exécution**, demande d'abord les valeurs.
2. Réglez **Test** sur **HIV viral load**.
3. Ouvrez **Actions d'exécution**, le menu à trois points du panneau, et sélectionnez **Exécuter avec ces valeurs**.

**Résultat attendu :** trois lignes. routine 7, urgent 2, stat 2. Ce sont les 11 demandes de HIV viral load.

Un paramètre facultatif laissé vide s'exécute comme un texte vide. Cela veut dire aucun filtre quand le SQL teste `''`.

## Exemple 4 : enregistrer la requête

![Enregistrer la requête sous un nom. Elle apparaît dans Requêtes personnalisées.](query-save.mp4)

1. Ouvrez **Actions de la requête**, les trois points à côté du bouton des paramètres, et sélectionnez **Enregistrer**.
2. Le premier enregistrement demande un nom dans **Enregistrer la requête**. Tapez `Orders by priority for one test`.
3. Ouvrez le menu à trois points du panneau et sélectionnez **Enregistrer**.

**Résultat attendu :** le message **Requête personnalisée « Orders by priority for one test » enregistrée**, l'onglet prend le nouveau nom, et la requête apparaît dans **Requêtes personnalisées** dans l'Explorateur. Les enregistrements suivants mettent à jour la même requête.

Un nom doit être unique. Un nom déjà pris laisse le panneau ouvert avec votre brouillon. Choisissez un autre nom.

Pour utiliser cette requête dans un rapport, voir le [Concepteur de rapports](/docs/report-designer). Les filtres d'un rapport viennent des paramètres de son modèle, pas de la requête. Donnez au paramètre de la requête le même **ID de variable** que la clé du paramètre du modèle, et la valeur du filtre passe quand le rapport s'exécute.

Pour terminer ce guide, supprimez la requête : ouvrez son menu dans l'Explorateur et sélectionnez **Supprimer la requête**.

## Renommer, grouper et supprimer

Chaque requête enregistrée dans l'Explorateur a son propre menu.

![Le menu d'une requête enregistrée.](query-row-actions.png)

- **Renommer.** Change seulement le nom. La requête garde son identifiant, donc les rapports la retrouvent. Pas besoin de l'ouvrir dans un onglet. Ne supprimez pas une requête pour la renommer.
- **Déplacer vers le groupe.** La range dans un groupe, ou l'en sort avec **Aucun groupe**.
- **Supprimer la requête.** La supprime, après confirmation.

**Renommer**, dans **Actions de la requête** d'un onglet, fait la même chose pour la requête ouverte. Il ne change que le nom enregistré. Les changements non enregistrés du SQL, du connecteur et des paramètres restent dans l'onglet jusqu'à **Enregistrer**.

### Groupes

Un paquet de contenu peut ajouter beaucoup de requêtes d'un coup. Les groupes gardent la liste lisible.

- Pour créer un groupe, ouvrez le menu de **Requêtes personnalisées** et choisissez **Nouveau groupe**. Saisissez un nom et choisissez **Enregistrer** dans le menu du panneau.
- Pour ranger une requête dans un groupe, faites-la glisser sur le groupe. Sur un téléphone, appuyez longuement sur la requête, ou utilisez **Déplacer vers le groupe**.
- Pour sortir une requête de son groupe, faites-la glisser sur **Requêtes personnalisées**, ou choisissez **Déplacer vers le groupe**, puis **Aucun groupe**.
- Chaque groupe a un menu avec **Renommer le groupe** et **Supprimer le groupe**. Supprimer un groupe garde ses requêtes. Elles sortent du groupe.

Les groupes ne font que ranger la liste. Déplacer une requête ne change ni son nom, ni son SQL, ni son identifiant, donc les rapports continuent de marcher. Les groupes appartiennent à cette installation. La synchronisation central-laboratoire ne les envoie pas et ne les change pas.

## Exporter et importer des requêtes

L'en-tête de l'Explorateur a son propre menu, **Actions de transfert**.

![Le menu de l'Explorateur : Actualiser, Exporter les requêtes, Importer des requêtes.](query-transfer-menu.png)

- **Actualiser** recharge l'Explorateur quand des requêtes ont changé ailleurs, par exemple depuis la ligne de commande ou un paquet de contenu.
- **Exporter les requêtes** télécharge un fichier avec le nom, le SQL, les paramètres et le nom de groupe de chaque requête. Il ne contient ni l'identifiant ni le connecteur.
- **Importer des requêtes** lit un tel fichier.

L'import suit ces règles :

- Un nouveau nom est créé.
- Un nom qui existe déjà est ignoré, sauf si vous choisissez de le remplacer.
- Remplacer garde l'identifiant et le connecteur de la requête, donc les rapports qui l'utilisent continuent de marcher.
- Remplacer une requête fournie avec CE est annulé la prochaine fois que CE recharge ses requêtes fournies.
- Si une requête remplacée change l'identifiant d'un paramètre, les rapports qui réglaient l'ancien paramètre le perdent.
- Une seule requête invalide arrête tout le fichier. Rien n'est écrit.
- Les nouvelles requêtes utilisent **Target Warehouse (Postgres)**, sauf si vous choisissez un autre connecteur.
- Une requête avec un nom de groupe va dans ce groupe, créé au besoin. Une nouvelle requête rejoint toujours son groupe. Une requête remplacée ne rejoint son groupe que si elle n'en a pas encore, donc une requête que vous avez déplacée reste où vous l'avez mise.

En ligne de commande :

```bash
openldr query export --out queries.json [--name <name>...]
openldr query import queries.json [--connector <name>] [--force]
```

`--out` écrase un fichier existant. `--force` remplace les requêtes qui existent déjà.

Le contenu écrit pour un système de laboratoire se partage avec ces fichiers. Ils vivent dans le dossier `packs/` de l'opérateur, pas dans CE lui-même.

## Jeux de données

Dépliez **Jeux de données** pour interroger les tables qu'un flux de travail a construites. Servez-vous-en pour des données lentes ou complexes, afin qu'un rapport lise une table prête au lieu de la source en direct. Voir [Flux de travail](/docs/workflows).

## Pagination et SQL Server

Le parcours des tables et les résultats des requêtes fonctionnent avec les connecteurs PostgreSQL, MySQL ou MariaDB, et SQL Server.

- PostgreSQL et MySQL ou MariaDB affichent un total compté, comme **1–50 of 60**.
- SQL Server affiche une plage de lignes et « total inconnu ». L'atelier n'a pas compté tout le résultat. **Suivant** n'est possible que si le serveur a trouvé une ligne de plus après cette page. Une dernière page exactement pleine désactive quand même **Suivant**. **Précédent** revient d'une page.
- Changer le nombre de lignes par page revient à la première page.
- SQL Server lit jusqu'au décalage demandé, donc les pages suivantes peuvent être plus lentes. La pagination ne prend pas d'instantané de la base.

Pour une pagination stable, ajoutez un `ORDER BY` qui finit par une clé unique. Par exemple, si `id` est unique, `ORDER BY created_at, id` départage les heures égales. L'atelier ne peut pas deviner une clé unique pour votre SQL. Sans elle, des lignes peuvent se répéter ou manquer d'une page à l'autre, de même que des lignes qui changent pendant que vous paginez.

## Sur un téléphone

Sur un téléphone, l'Explorateur commence replié en une fine bande à gauche. Sélectionnez le bouton de panneau en haut de la bande, **Développer l'explorateur**, pour l'ouvrir. Repliez-le de nouveau pour donner tout l'écran à la requête.

![L'Explorateur ouvert sur un téléphone, avec Requêtes personnalisées dépliées.](query-phone.png)

## Dépannage

- **Exécuter est grisé.** Choisissez d'abord un connecteur et écrivez du SQL.
- **« unbound parameter ».** Chaque `{{ param.x }}` du SQL demande un paramètre avec cet **ID de variable**.
- **« required parameter » à l'exécution.** Remplissez chaque paramètre marqué **Requis**.
- **La requête est refusée.** Seules les instructions `SELECT` s'exécutent. Tout ce qui modifie des données ou des tables est refusé.
- **Aucun connecteur dans l'Explorateur.** Créez ou activez un connecteur de base de données. Voir [Connecteurs](/docs/connectors).
- **La liste d'un paramètre select est vide.** Son **SQL des options** n'a renvoyé aucune ligne. Exécutez ce SQL dans un onglet à part pour le vérifier.
- **Des pages répètent ou sautent des lignes.** Ajoutez un `ORDER BY` qui finit par une clé unique. Voir [Pagination et SQL Server](#pagination-et-sql-server).
- **Vous avez besoin du registre des établissements.** Lisez la table `facility_registry` de l'entrepôt. Voir [Établissements](/docs/facilities).

## Guides associés

- [Rapports](/docs/reports)
- [Concepteur de rapports](/docs/report-designer)
- [Connecteurs](/docs/connectors)
- [Tableaux de bord](/docs/dashboard)
