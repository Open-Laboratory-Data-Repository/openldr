# Flux de travail

Créez et exécutez des traitements de données dans l'éditeur de flux de travail.

## Résultat visé

Vous pouvez ouvrir un flux, parcourir ses nœuds et consulter ses exécutions.

![Liste des flux de travail](workflows-list.png)

## Avant de commencer

Le rôle Lab Admin ou Lab Manager est nécessaire. Préparez les
[connecteurs](/docs/connectors) utilisés par vos nœuds.

## Étapes

1. Ouvrez Workflows, puis un flux existant ou l'action de création.
2. Nommez le flux et ouvrez l'éditeur.
3. Ajoutez un déclencheur, puis les nœuds nécessaires.
4. Reliez les nœuds dans l'ordre d'exécution et configurez chacun dans le panneau latéral.
5. Enregistrez avec Save, puis lancez un essai avec Run.

![Éditeur de flux et commandes du canevas](workflow-builder.png)

6. Consultez l'historique pour vérifier les résultats de chaque nœud.

![Historique des exécutions](workflow-run-history.png)

## Naviguer dans le canevas

- En bas à gauche, **+** agrandit la vue et **−** la réduit.
- **Fit View**, sous les boutons de zoom, affiche tous les nœuds.
- En haut à gauche, choisissez la main pour le mode **Pan**.
  Faites glisser une zone vide du canevas pour déplacer la vue.
- En mode **Select**, l'icône de pointeur, un glissement avec le bouton gauche
  sélectionne les nœuds dans un rectangle. Utilisez le bouton central ou droit pour déplacer la vue.

La minicarte en bas à droite permet aussi de déplacer et de zoomer la vue.
Si les nœuds sortent du cadre, utilisez **Fit View** avant de déplacer un nœud.
Ces commandes ne changent pas les positions enregistrées des nœuds.

## Résultat attendu

Les nœuds sont visibles. Le flux est enregistré et l'historique indique le résultat de l'essai.

## Dépannage

Si un nœud échoue, vérifiez ses champs obligatoires et son connecteur.
Consultez ses résultats dans l'historique avant de modifier le flux.

## Utilisation web avancée

Consultez le guide des [rapports planifiés](/docs/report-pipeline) pour préparer des rapports récurrents.

## Guides associés

- [Rapports planifiés](/docs/report-pipeline)
- [Connecteurs](/docs/connectors)
- [Rapports](/docs/reports)
- [Audit](/docs/audit)
