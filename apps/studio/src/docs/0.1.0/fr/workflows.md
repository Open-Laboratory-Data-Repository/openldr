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


## Webhooks sur plusieurs instances API

Enregistrez le nouveau chemin ou secret avant d'envoyer des requêtes avec cette valeur. Chaque instance API mise à jour lit le chemin et le secret actuels dans la base partagée. Aucun redémarrage n'est nécessaire après l'enregistrement. Les requêtes déjà authentifiées peuvent se terminer.

Envoyez le secret uniquement dans l'en-tête `x-webhook-token`. L'ancien chemin renvoie 404 après un changement. Un secret ancien ou illisible renvoie 401. Un flux désactivé ou supprimé renvoie 404. Chaque déclencheur actif doit avoir un chemin unique, même dans un seul flux. Un conflit de chemins renvoie 503 sans exécuter le flux. Une erreur de lecture de la base renvoie aussi 503. Aucune instance ne réutilise des identifiants en cache.

Arrêtez toutes les anciennes instances API et tous les anciens processus qui modifient les flux. Appliquez ensuite la migration 096 avec `openldr db migrate`, puis démarrez les instances mises à jour. Les anciens processus ne maintiennent pas le nouvel index des chemins. Ce déploiement exige une interruption ; ne mélangez pas les versions pendant les écritures. Les instances doivent partager la base et la clé de chiffrement. Cette modification ne rend pas l'exécution durable. Les émetteurs doivent toujours gérer les requêtes interrompues et les effets potentiellement répétés.
