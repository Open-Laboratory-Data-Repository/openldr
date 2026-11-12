# Activité

Activity permet de vérifier l'arrivée d'un envoi récent et les événements enregistrés ensuite. Un envoi est un lot de données, comme une requête webhook ou un lot d'ingestion CLI.

Utilisez vos propres envois récents. Aucune donnée d'exemple n'est nécessaire. Les captures suivent le patient fictif envoyé dans l'installation de test de Workflows. Une installation vide peut n'avoir aucun envoi récent.

Vous avez besoin de **View activity**. Cette page lit les événements enregistrés. Elle ne modifie, ne relance et ne supprime pas les données. [Audit](/docs/audit) enregistre les changements utilisateur et administratifs.

## Suivre un envoi

Utilisez cette tâche quand un expéditeur demande si ses données sont arrivées. Gardez son identifiant de réponse ou l'heure d'envoi à portée de main.

### 1. Ouvrir Activity

Sélectionnez **Activity** dans le menu principal.

![Ouvrir Activity pour suivre les envois récents.](activity-guide-open-page.png)

### 2. Rechercher l'envoi

Saisissez son identifiant dans **Search payloads...**. La recherche trouve aussi la source, l'état ou l'étape dans la liste chargée.

![Rechercher l'identifiant de l'envoi pour trouver cette requête.](activity-guide-search.png)

### 3. Vérifier la ligne correspondante

Vérifiez la source et l'heure de début. Lisez l'étape et l'état actuels. L'exemple a atteint Persisted et Complete.

![Vérifier la source, l'heure de début, l'étape et l'état actuels.](activity-guide-matching-row.png)

### 4. Ouvrir le cycle de vie

Sélectionnez la ligne pour ouvrir **Payload lifecycle**.

![Sélectionner la ligne pour consulter son cycle de vie enregistré.](activity-guide-open-row.png)

### 5. Conserver l'identifiant

Copiez l'identifiant sous le titre du panneau pour signaler un problème.

![Conserver l'identifiant pour demander de l'aide à un administrateur.](activity-guide-payload-id.png)

### 6. Lire Received

Lisez l'heure d'arrivée, la source détaillée et l'identifiant d'exécution associé. Utilisez cet identifiant dans l'historique de Workflows.

![Received enregistre l'arrivée et l'identifiant d'exécution du workflow.](activity-guide-received.png)

### 7. Lire Persisted

Lisez l'événement de stockage et le nombre de ressources. L'exemple a stocké un Patient. D'autres workflows peuvent enregistrer d'autres étapes.

![Persisted enregistre le nombre de ressources stockées.](activity-guide-persisted.png)

### 8. Revenir à la liste

Sélectionnez **Close** en haut à droite.

![Fermer le panneau du cycle de vie pour revenir à la liste.](activity-guide-close.png)

**Résultat attendu :** vous identifiez l'envoi et les étapes réellement enregistrées pour lui.

## Charger le dernier état enregistré

Utilisez Refresh après l'arrivée de nouvelles données. Fermez puis rouvrez le panneau pour charger ses détails actuels.

### 1. Ouvrir Activity actions

Sélectionnez les points nommés **Activity actions**.

![Activity actions contient Refresh.](activity-guide-actions.png)

### 2. Choisir Refresh

Sélectionnez **Refresh**. Rouvrez la ligne pour consulter les détails actualisés du cycle de vie.

![Refresh recharge la liste récente.](activity-guide-refresh.png)

**Résultat attendu :** la liste des envois récents se recharge.

## Afficher les envois terminés

Utilisez un filtre Status pour examiner un résultat particulier. Les filtres s'appliquent aux envois récents chargés.

### 1. Ouvrir Filter

Sélectionnez **Filter**.

![Filter réduit la liste des envois récents chargés.](activity-guide-filter.png)

### 2. Ajouter une règle

Sélectionnez **Add filter**.

![Add filter crée une règle.](activity-guide-add-filter.png)

### 3. Choisir Status

Ouvrez le sélecteur de colonne et choisissez **Status**. Gardez **Equals**.

![Choisir Status comme colonne et garder Equals.](activity-guide-status-rule.png)

### 4. Choisir Complete

Ouvrez le sélecteur de valeur et choisissez **Complete**. Choisissez un autre état pour examiner ce résultat.

![Choisir Complete pour lire les envois stockés sans exécution de workflow en échec.](activity-guide-complete-value.png)

### 5. Appliquer la règle

Sélectionnez **Apply**. La règle apparaît au-dessus du tableau.

![Apply actualise les lignes visibles.](activity-guide-apply-filter.png)

**Résultat attendu :** les lignes visibles correspondent à la règle Status.

![Le filtre Status appliqué apparaît au-dessus des lignes correspondantes.](activity-guide-filtered.png)

## Afficher les débuts les plus récents en premier

Triez par heure quand l'ordre d'arrivée compte. Ce tri modifie seulement la liste chargée.

### 1. Ajouter un tri

Sélectionnez **Sort**, puis **Add sort**.

![Add sort crée une règle de tri.](activity-guide-add-sort.png)

### 2. Choisir Started

Sélectionnez **Started** parmi les colonnes proposées.

![Choisir Started pour trier par heure d'arrivée.](activity-guide-sort-started.png)

### 3. Choisir l'ordre décroissant

Sélectionnez **Asc** une fois pour passer à **Desc**.

![Passer de Asc à Desc pour afficher les débuts les plus récents en premier.](activity-guide-sort-direction.png)

### 4. Appliquer le tri

Sélectionnez **Apply**. Les débuts les plus récents apparaissent en premier.

![Apply conserve le tri choisi pour les lignes chargées.](activity-guide-apply-sort.png)

## Choisir les colonnes visibles

Utilisez cette tâche quand le tableau est plus large que les informations nécessaires.

### 1. Ouvrir Columns

Sélectionnez **Columns**.

![Columns contrôle les colonnes visibles du tableau.](activity-guide-columns.png)

### 2. Choisir les champs

Cochez ou décochez les colonnes à afficher. Gardez Payload visible pour identifier les lignes. Fermez ensuite le menu.

![Garder les champs nécessaires à la vérification.](activity-guide-column-options.png)

### 3. Parcourir les pages du tableau

Utilisez la taille de page et les flèches sous le tableau quand la liste chargée dépasse une page.

![Utiliser la taille de page et les flèches quand il y a plusieurs pages.](activity-guide-pagination.png)

## Lire un envoi sur téléphone

Recherchez d'abord pour réduire le tableau. Faites défiler horizontalement pour lire les colonnes plus à droite.

### 1. Rechercher les envois récents

Utilisez le champ de recherche en haut d'Activity.

![Rechercher les envois récents sur téléphone.](activity-guide-phone-search.png)

### 2. Ouvrir l'envoi

Sélectionnez son identifiant dans la ligne.

![Sélectionner l'identifiant pour ouvrir le cycle de vie.](activity-guide-phone-open.png)

### 3. Lire le cycle de vie

Faites défiler le panneau pour lire les étapes enregistrées et les nombres de ressources.

![Lire chaque étape enregistrée dans le panneau sur téléphone.](activity-guide-phone-detail.png)

## Lire les étapes et les états

La barre souligne les étapes jusqu'à la dernière enregistrée. Lisez le cycle de vie pour voir les événements réellement présents. L'absence de Validated ne prouve pas l'échec de toutes les vérifications précédentes.

Un envoi enregistré ne prouve pas que le destinataire a accepté ou lu les données. Stuck ne prouve pas un arrêt du traitement. Vérifiez History et les résultats des nœuds du workflow.

| Étape | Signification |
| --- | --- |
| Received | Un lot d'ingestion ou un workflow a enregistré l'arrivée. |
| Validated | Un workflow a enregistré une vérification réussie. |
| Persisted | Un événement de stockage a enregistré des ressources sauvegardées. |
| Pushed | Une étape a enregistré un envoi vers un autre système. |

| État | Signification |
| --- | --- |
| Complete | Les données ont atteint le stockage sans exécution de workflow en échec enregistrée. |
| Failed | Une exécution de workflow ou un lot d'ingestion associé a échoué. |
| Stuck | Les événements enregistrés n'établissent ni réussite ni échec. |
| Running | Un import ou un lot CLI est encore actif. |
| Stopped | Un import ou un lot CLI a été arrêté. |

## Comprendre la période d'historique

Activity charge jusqu'à 200 envois récents. Recherche, filtres, tri et pagination agissent sur ces lignes chargées. Ils ne recherchent pas dans toute la base.

L'historique des lots CLI a sa propre limite. Pour les lots plus anciens, utilisez `openldr pipeline status`. Consultez [Commencer ici](/docs/start-here) pour le lanceur installé ou la forme de développement `pnpm openldr pipeline status`. Utilisez votre vrai dossier, comme `~/Downloads/openldr_ce` ou `C:\openldr_ce`.

## Pratique facultative avec des données fictives

Vous pouvez suivre tout envoi reçu sans créer de données supplémentaires. Pour un test, utilisez le Bundle fictif facultatif de [Workflows](/docs/workflows#fichiers-fictifs-facultatifs-d-exercice). Suivez ses étapes webhook, puis recherchez ici l'identifiant de corrélation renvoyé. Aucun exemple n'est requis en usage habituel.

## Résolution de problèmes

**La liste est vide.** Effacez recherche et filtres, puis choisissez Refresh. Vérifiez les réponses à l'expéditeur et History dans Workflows avant de conclure à une absence d'arrivée. Les événements anciens peuvent être hors de la période récente.

**Une ligne indique Failed.** Ouvrez History du workflow et examinez le nœud en échec. Activity ne propose pas de relance. Vérifiez les effets avant de suivre la procédure de reprise du workflow.

**Le panneau reste sur Loading.** Fermez-le, choisissez Refresh puis rouvrez la ligne. Si cela persiste, demandez à un administrateur de vérifier la requête API et les journaux serveur. Le panneau ne distingue pas toutes les requêtes échouées des requêtes lentes.

**Refresh affiche une erreur.** Réessayez une fois. Signalez l'erreur exacte si elle persiste.

## Guides associés

[Workflows](/docs/workflows) explique les exécutions et les reçus webhook. [Audit](/docs/audit) explique les traces de changements administratifs.
