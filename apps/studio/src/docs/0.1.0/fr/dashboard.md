# Tableau de bord

## Créer un autre tableau de bord

Ouvrez le menu à trois points à côté du sélecteur, puis choisissez **Nouveau tableau de bord**.
Cette action est disponible en consultation et en modification. Attendez la fin de l'enregistrement des modifications.
L'action reste désactivée pendant la création pour éviter les doublons.

Le tableau de bord vide s'ouvre en mode modification. Une confirmation indique son nom.
Ouvrez le menu à trois points et choisissez **Add widget** pour ajouter du contenu.
Si la création échoue, le tableau de bord actuel reste sélectionné. Lisez l'erreur, puis réessayez dans le menu.

![Vue du tableau de bord](dashboard-overview.png)
![Éditeur de widget](dashboard-edit-widget.png)

## Guides associés

- [Rapports](/docs/reports)
- [Workflows](/docs/workflows)

Les modifications faites pendant la création restent ouvertes. Enregistrez-les, puis sélectionnez le nouveau tableau de bord.

La modification des widgets et des filtres est désactivée pendant la création.

## Actualisation automatique

Chaque widget se charge immédiatement. Si l'actualisation automatique est activée, son délai commence après la fin de la requête. Une requête lente retarde la prochaine actualisation. Le widget ne lance pas de requêtes simultanées. Un délai de zéro désactive l'actualisation automatique.

Modifier la requête ou les filtres annule la requête obsolète dans le navigateur. Quitter le tableau de bord annule les requêtes en attente. Les résultats et erreurs tardifs ne remplacent pas les résultats récents. Une actualisation réussie efface l'erreur précédente.

Annuler une requête dans le navigateur ne garantit pas son arrêt dans la base de données.

## Limites des requêtes Builder

Les widgets Builder utilisent le délai maximal SQL et la limite de lignes du tableau de bord. Les valeurs par défaut sont de 5 000 millisecondes et 10 000 groupes. Les administrateurs peuvent modifier ces paramètres existants.

La limite compte les groupes de la base avant le regroupement par période, les totaux par série et la sélection des premiers résultats. En cas de dépassement, le widget affiche une erreur au lieu de totaux partiels. Précisez les filtres ou réduisez le regroupement. Demander moins de premiers résultats ne contourne pas cette limite.

PostgreSQL annule les instructions au délai configuré. MySQL et MariaDB utilisent leurs délais par instruction. Sur SQL Server, ce paramètre limite uniquement l'attente des verrous. Il ne limite pas la durée d'exécution.
