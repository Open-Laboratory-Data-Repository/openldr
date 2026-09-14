# Activité

Activité regroupe les exécutions de workflows par identifiant de données reçues. [Audit](/docs/audit) concerne les changements d'utilisateurs et de configuration.

## Examiner un traitement

1. Ouvrez **Activité**. Votre compte doit disposer de la permission de consulter cette page.
2. Recherchez un identifiant, une source, un statut ou une étape. Les filtres réduisent les lignes chargées.
3. Sélectionnez une ligne pour lire les étapes, heures et détails enregistrés. Conservez l'identifiant pour une investigation.
4. Fermez les détails, actualisez depuis le menu **⋯**, puis rouvrez la ligne pour obtenir les nouveaux détails.
5. En cas d'échec ou de traitement incomplet, consultez l'historique du workflow dans [Workflows](/docs/workflows).

## Étapes et statuts

Les étapes représentent la réception, une validation réussie, un événement de persistance et une étape de sortie réussie. Toutes les étapes ne sont pas nécessaires à chaque workflow. L'indicateur de la ligne résume le parcours ; il ne prouve pas chaque étape précédente. Une sortie réussie ne prouve pas une vérification humaine à destination.

Le statut complet signifie qu'un événement de persistance existe sans exécution associée en échec. Il n'exige pas d'étape de sortie. Un statut d'échec indique une exécution échouée. Le statut bloqué signifie que les données enregistrées n'établissent ni l'un ni l'autre ; consultez l'historique avant de conclure que le traitement s'est arrêté.

## Résultats vides et limites

La page charge les 200 groupes les plus récents. Recherche, filtres, tri et pagination portent uniquement sur ces groupes, pas sur tout l'historique.

Une liste vide ne prouve pas l'absence de données reçues. Effacez recherche et filtres, actualisez, puis consultez les exécutions des workflows. Des données sans historique de workflow associé peuvent manquer dans la liste.

Si les détails restent en chargement, fermez-les, actualisez et rouvrez la ligne. La page peut afficher le chargement après un échec de requête. Activité ne propose pas de relance du traitement ; suivez la procédure de récupération du workflow.

## Attente des événements en file

Chaque instance du bus d'événements exécute un seul gestionnaire à la fois. Un gestionnaire lent peut retarder les événements suivants. Les notifications répétées ne lancent pas d'autres gestionnaires pendant le lot en cours. Les événements en attente restent en file pour un lot ultérieur. Des processus serveur distincts peuvent toujours traiter des événements simultanément.

## Guides associés

- [Workflows](/docs/workflows)
- [Audit](/docs/audit)

## Propriété des événements en file

Le worker renouvelle les baux des événements en cours et de ceux qui attendent dans son lot. Un worker de remplacement reçoit un nouveau jeton. Un ancien worker ne peut plus modifier cet événement pour le terminer, le déclarer en échec ou le relancer. Après un arrêt brutal, un bail expiré compte toujours comme une tentative échouée et permet une reprise. Les traitements doivent accepter les livraisons répétées. Une panne de base ou un processus suspendu peut permettre une autre exécution. Arrêtez les anciens workers avant la mise à niveau. Les workers sans contrôle du jeton ne garantissent pas cette protection.
