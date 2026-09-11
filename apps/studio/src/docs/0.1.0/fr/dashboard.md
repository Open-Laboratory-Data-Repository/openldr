# Tableau de bord

Ouvrez Dashboard pour consulter les widgets partagés. Les droits de modification permettent de modifier les widgets et leur disposition depuis le menu du tableau de bord. Dans l'éditeur, choisissez Builder pour une requête guidée ou SQL si votre administrateur l'autorise.

![Tableau de bord](dashboard-overview.png)

## Limites des requêtes Builder

Les widgets Builder utilisent le délai maximal SQL et la limite de lignes du tableau de bord. Les valeurs par défaut sont de 5 000 millisecondes et 10 000 groupes. Les administrateurs peuvent modifier ces paramètres existants.

La limite compte les groupes de la base avant le regroupement par période, les totaux par série et la sélection des premiers résultats. En cas de dépassement, le widget affiche une erreur au lieu de totaux partiels. Précisez les filtres ou réduisez le regroupement. Demander moins de premiers résultats ne contourne pas cette limite.

PostgreSQL annule les instructions au délai configuré. MySQL et MariaDB utilisent leurs délais par instruction. Sur SQL Server, ce paramètre limite uniquement l'attente des verrous. Il ne limite pas la durée d'exécution.

## Guides associés

- [Rapports](/docs/reports)
- [Workflows](/docs/workflows)
