# Audit

Audit indique qui a réalisé une action, quand et sur quel élément. Les administrateurs et les contrôleurs l'utilisent pour examiner les changements et les accès.

Vous avez besoin de View audit log. Utilisez les événements enregistrés par votre installation. Les captures montrent des modifications de comptes et de mises en page fictifs dans une installation de test. Aucune donnée d'exemple n'est nécessaire.

Audit est en lecture seule. Lire un événement ne le modifie pas. Before, After et Metadata apparaissent seulement si l'action a enregistré ces valeurs.

## Rechercher les événements d'une action

Utilisez cette tâche quand vous connaissez le type d'action à examiner. Vous pouvez aussi filtrer par auteur, élément ou date.

### 1. Ouvrir Audit

Sélectionnez **Audit** dans le menu principal.

![Choisir Audit dans le menu principal.](audit-guide-open-audit.png)

### 2. Lire les colonnes

Lisez **When**, **Actor**, **Action**, **Entity type** et **Entity ID**. Une action comme user.update décrit l'opération enregistrée.

![Lire When, Actor, Action et les détails de l'élément avant d'ouvrir un événement.](audit-guide-read-event-row.png)

### 3. Ouvrir Filter

Sélectionnez **Filter** au-dessus du tableau.

![Utiliser Filter pour rechercher une action ou un auteur.](audit-guide-filter-open.png)

### 4. Ajouter une règle

Sélectionnez **Add filter**.

![Choisir Add filter.](audit-guide-filter-add.png)

### 5. Choisir Action

Ouvrez le sélecteur de colonne et choisissez **Action**. Gardez **Equals** pour un nom d'action exact.

![Choisir Action comme colonne de filtre.](audit-guide-filter-action.png)

### 6. Saisir l'action

Saisissez l'action à examiner. L'exemple utilise `user.update` pour les changements de profil. Utilisez une action présente dans votre installation.

![Saisir le nom de l'action. L'exemple utilise user.update.](audit-guide-filter-value.png)

### 7. Appliquer le filtre

Sélectionnez **Apply**.

![Choisir Apply pour demander les événements correspondants.](audit-guide-filter-apply.png)

**Résultat attendu :** la liste montre les événements correspondants. Une liste vide indique qu'aucun événement ne correspond aux règles actuelles.

![La liste contient les événements user.update correspondants.](audit-guide-filter-result.png)

## Lire un événement et ses valeurs enregistrées

Identifiez ainsi la fiche concernée et comparez les changements. Les détails enregistrés varient selon les actions.

### 1. Ouvrir l'événement

Sélectionnez la ligne correspondante. Dans le panneau, lisez l'identifiant de l'événement, l'horodatage, l'auteur, l'action et l'élément concerné.

![Vérifier Event ID, Timestamp, Actor et l'élément concerné.](audit-guide-event-identifiers.png)

### 2. Lire Before

Descendez jusqu'à **Before**. Cette section contient les anciennes valeurs si l'action les a fournies. **None recorded.** indique qu'aucun instantané n'a été enregistré.

![Before contient les anciennes valeurs si l'action les a fournies.](audit-guide-event-before.png)

### 3. Lire After

Descendez jusqu'à **After**. Comparez les valeurs enregistrées à Before. Ces copies enregistrées ne sont pas un éditeur.

![After contient les valeurs enregistrées si l'action les a fournies.](audit-guide-event-after.png)

### 4. Lire Metadata

Descendez jusqu'à **Metadata** pour consulter le contexte supplémentaire enregistré.

![Metadata contient le contexte supplémentaire enregistré par l'action.](audit-guide-event-metadata.png)

### 5. Copier une référence si nécessaire

Utilisez **Copy Event ID** près de l'identifiant pour conserver une référence dans votre enquête. Les autres valeurs renseignées disposent aussi de commandes de copie.

![Utiliser la commande de copie près d'une valeur pour conserver une référence.](audit-guide-event-copy.png)

### 6. Fermer le panneau

Sélectionnez **Close** en haut à droite.

![Close ramène à la liste filtrée.](audit-guide-event-close.png)

**Résultat attendu :** vous retrouvez la même liste filtrée. L'événement d'audit reste inchangé.

## Parcourir d'autres événements et actualiser la liste

Utilisez cette tâche pour consulter une autre page ou les changements enregistrés depuis l'ouverture d'Audit.

### 1. Effacer le filtre si nécessaire

Ouvrez Filter et choisissez **Clear** pour retrouver tous les événements.

![Clear retire les règles de filtre actives.](audit-guide-filter-clear.png)

### 2. Choisir la taille de page

Ouvrez **Rows per page** en bas et choisissez une taille. L'exemple choisit **10**.

![Utiliser Rows per page pour changer le nombre d'événements affichés.](audit-guide-page-size.png)

![Choisir la taille de page. L'exemple choisit 10.](audit-guide-ten-rows.png)

### 3. Lire la page suivante

Sélectionnez **Next page** lorsque cette commande est disponible.

![Next page lit le groupe d'événements suivant.](audit-guide-next-page.png)

### 4. Revenir à la page précédente

Sélectionnez **Previous page**.

![Previous page revient au groupe précédent.](audit-guide-previous-page.png)

### 5. Actualiser la liste

Ouvrez le menu à points de la page et choisissez **Refresh**. Les filtres actuels restent appliqués.

![Ouvrir le menu à points d'Audit.](audit-guide-refresh-actions.png)

![Choisir Refresh pour demander à nouveau la liste filtrée actuelle.](audit-guide-refresh-menu.png)

**Résultat attendu :** le tableau lit la page demandée ou les événements actualisés depuis le serveur.

## Lire les événements sur un téléphone

Utilisez la même page Audit sur téléphone. Le tableau peut défiler horizontalement.

### 1. Utiliser les filtres

Utilisez **Filter** au-dessus du tableau pour réduire les résultats avant de lire les lignes larges.

![Filter reste disponible au-dessus du tableau sur téléphone.](audit-guide-phone-filter.png)

### 2. Ouvrir le panneau d'événement

Sélectionnez une ligne. Faites défiler le panneau pour lire les identifiants et les copies enregistrées.

![Le panneau utilise la largeur du téléphone et permet de parcourir les valeurs enregistrées.](audit-guide-phone-event.png)

## Pratique facultative

Dans une installation de test, effectuez un changement approuvé de profil ou de mise en page, puis recherchez son événement. Comparez Before et After lorsqu'ils sont présents. Aucun import de données d'audit n'est nécessaire.

## Limites

Cette page ne modifie, ne supprime et n'exporte pas les événements. Une copie absente ne prouve pas que l'action n'a rien changé. L'action n'a enregistré aucune copie.

## Résolution de problèmes

**Aucun événement ne correspond.** Vérifiez les filtres actifs ou choisissez Filter, puis Clear.

**Un événement récent manque.** Choisissez Refresh et vérifiez les filtres et la page actuels.

**Before ou After indique None recorded.** Utilisez l'auteur, l'action, l'élément et les métadonnées disponibles. Cette page ne peut pas récupérer la copie absente.

## Guides associés

Consultez [Utilisateurs](/docs/users) pour les actions sur les comptes et [Rôles](/docs/roles) pour les permissions. Consultez [Commencer ici](/docs/start-here) pour configurer la ligne de commande.
