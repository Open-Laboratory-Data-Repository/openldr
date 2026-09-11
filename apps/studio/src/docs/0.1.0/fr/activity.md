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

## Guides associés

- [Workflows](/docs/workflows)
- [Audit](/docs/audit)
