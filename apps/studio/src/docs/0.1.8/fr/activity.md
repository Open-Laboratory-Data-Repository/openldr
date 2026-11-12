# Activité

**Activité** suit chaque envoi de données, appelé charge, pendant son passage dans OpenLDR : reçue, vérifiée, enregistrée, transmise. Une charge est un lot de données, par exemple un envoi HTTP vers un webhook. Servez-vous-en pour répondre à « ces données sont-elles arrivées, et ont-elles été enregistrées ? ».

Ce n'est pas l'[Audit](/docs/audit). L'Audit enregistre ce que les personnes ont modifié. Activité enregistre ce qui est arrivé aux données.

Ce guide prend environ 10 minutes. Sélectionnez une image ou un clip pour l'agrandir.

![Activité après trois envois vers le webhook Ingest. Chacun a atteint Persistée et est Terminée.](activity-list.png)

## Qui peut faire quoi

Une seule autorisation couvre cette page : **View activity**. Elle ne fait que lire. Rien ici ne modifie ni ne relance des données.

## Avant de commencer

Une nouvelle installation affiche **Aucune charge récente.** Activité liste les charges passées par un flux de travail, les imports, et les lots chargés avec `openldr ingest`. Les données d'exemple, une fois chargées avec `openldr ingest`, apparaissent ici comme un lot. Sa **Source** vaut `cli`. Son **Statut** affiche **Terminée** une fois enregistré, ou **Échouée** avec l'erreur.

Pour voir une charge, envoyez-en une par le webhook Ingest. Voir [Flux de travail, exemples 1 et 2](/docs/workflows#exemple-1-preparer-le-webhook-ingest). Cela prend environ cinq minutes et ne change aucun compte.

## Exemple 1 : suivre une charge

![Sélectionner une charge pour ouvrir son cycle de vie.](activity-detail.mp4)

1. Ouvrez **Activité**. Les charges les plus récentes sont en haut.
2. Trouvez votre charge. **Source** vaut **webhook**. **Étape** affiche **Persistée**. **Statut** affiche **Terminée**.
3. Sélectionnez la ligne. **Cycle de vie de la charge** s'ouvre à droite.

**Résultat attendu :** deux étapes. **Reçue**, depuis le webhook, avec l'identifiant de l'exécution. Puis **Persistée**, avec **1 × Patient** : la ressource enregistrée.

Gardez l'identifiant de la charge, le long identifiant en haut, si vous demandez à un administrateur de regarder.

Pour voir les dernières charges, ouvrez le menu à trois points en haut à droite et sélectionnez **Actualiser**. Rouvrez une ligne pour obtenir ses derniers détails.

## Lire les étapes et le statut

| Étape | Ce qu'elle veut dire |
| --- | --- |
| Reçue | Un lot ou une exécution de flux a noté l'arrivée des données. |
| Validée | Une étape du flux a vérifié les données, et elles sont passées. |
| Persistée | Les données ont été enregistrées. Le détail dit combien de chaque ressource. |
| Envoyée | Une étape du flux a transmis les données, par exemple à un autre système. |

Le détail liste les étapes enregistrées. Tous les flux n'enregistrent pas les quatre. La barre d'étapes de la liste est un résumé, pas la preuve de chaque étape précédente. Un envoi enregistré ne prouve pas que quelqu'un a vérifié les données à l'arrivée.

| Statut | Ce qu'il veut dire |
| --- | --- |
| Terminée | Les données ont été enregistrées, et aucune exécution de flux pour elles n'a échoué. Pas besoin d'étape Envoyée. |
| Échouée | Une exécution de flux pour elles a échoué. Ouvrez l'**History** du flux. |
| Bloquée | Aucun des deux cas ne peut être montré. Vérifiez l'**History** du flux avant de conclure que le traitement s'est arrêté. |

## Trouver une charge

- **Rechercher des charges utiles…** trouve l'identifiant de la charge, la source, le statut ou l'étape.
- **Filtrer**, **Trier** et **Colonnes** marchent comme sur n'importe quel tableau.
- La page charge les 200 charges les plus récentes. Recherche, filtres, tri et pagination ne portent que sur ces 200. Ils ne cherchent pas dans l'historique plus ancien.

## Dépannage

- **La liste est vide.** Cela ne prouve pas que rien n'est arrivé. Effacez la recherche et les filtres, sélectionnez **Actualiser**, et vérifiez l'**History** du flux. Activité montre les 100 derniers lots chargés avec `openldr ingest`. Pour les plus anciens, lancez `openldr pipeline status`.
- **Une erreur de chargement s'affiche.** Sélectionnez de nouveau **Actualiser**. Si elle reste, signalez l'erreur à un administrateur.
- **Le panneau du cycle de vie reste en chargement.** Fermez-le, sélectionnez **Actualiser**, et rouvrez la ligne. La page ne distingue pas toujours une requête échouée d'une requête lente.
- **Une charge est Échouée.** Ouvrez le flux par lequel elle est passée, puis **History**, et lisez l'erreur du nœud en échec. Cette page n'a pas de bouton pour relancer. Suivez la procédure de reprise du flux.

## Gestion des événements en file

Ces notes sont pour les administrateurs.

- Chaque instance du bus d'événements traite un gestionnaire à la fois. Un gestionnaire lent retarde les événements suivants. D'autres notifications de file ne lancent pas d'autres gestionnaires pendant un lot. Les événements en attente patientent jusqu'à un lot suivant. Des processus serveur séparés peuvent quand même traiter des événements en même temps.
- Le processus renouvelle ses baux pour les événements en cours et pour ceux qui attendent dans son lot réservé. Un processus de remplacement reçoit un nouveau jeton de réservation. Un ancien processus ne peut alors plus marquer cette réservation comme finie, échouée ou à réessayer.
- Après un plantage, une réservation expirée compte comme une tentative échouée et peut être réessayée. Les gestionnaires doivent supporter d'être lancés deux fois : une panne de base ou un processus en pause peut laisser un autre processus traiter le même événement.
- Arrêtez les anciens processus avant une mise à jour. Les processus sans vérification du jeton de réservation ne peuvent pas offrir cette protection.

## Guides associés

- [Flux de travail](/docs/workflows)
- [Audit](/docs/audit)
