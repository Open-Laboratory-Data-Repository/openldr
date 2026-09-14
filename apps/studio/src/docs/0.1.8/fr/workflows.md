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

Arrêtez toutes les anciennes instances API et tous les anciens processus qui modifient les flux. Appliquez ensuite la migration 096 avec `openldr db migrate`, puis démarrez les instances mises à jour. Les anciens processus ne maintiennent pas le nouvel index des chemins. Ce déploiement exige une interruption ; ne mélangez pas les versions pendant les écritures. Les instances doivent partager la base et la clé de chiffrement.

## Requêtes webhook durables

OpenLDR enregistre un reçu et un événement dans une seule transaction avant d'accepter le webhook. Si la base est indisponible avant l'acceptation, la requête échoue sans reçu accepté. Une erreur ou connexion perdue ne prouve pas l'absence d'exécution. Réessayez avec la même clé d'idempotence et les mêmes données.

L'en-tête facultatif `Idempotency-Key` identifie une requête logique. Dans un même flux, la même clé et les mêmes données réutilisent le reçu initial. Des données différentes avec la même clé renvoient 409. Les données comprennent corps, paramètres, en-têtes transmis et contenu binaire. Les en-têtes d'authentification et de transport sont exclus. Sans clé, chaque POST crée une requête et peut répéter des effets.

OpenLDR attend au maximum 10 secondes après l'acceptation. Une exécution terminée conserve les champs de réponse 200 existants. Une requête répétée déjà terminée renvoie 200 même avec `Prefer: respond-async`. Un échec enregistré renvoie 500 avec `requestId`, sans erreur brute. Les reçus interrompus ou annulés renvoient 409. Une requête en attente ou en cours renvoie 202 avec `accepted: true`, `requestId`, `status` et `statusUrl`. `Location` et `Retry-After` donnent l'adresse et le délai de consultation. 202 signifie acceptée, pas terminée. `Prefer: respond-async` supprime l'attente. Une déconnexion n'annule pas le travail accepté.

### Exemple d'envoi

Une réponse 200 terminée peut être `{"ok":true,"runId":"run-id","correlationId":"correlation-id"}`. Les clés doivent contenir 1 à 200 caractères ASCII imprimables sans espaces.

Envoyez `POST /api/workflows/hooks/example` avec `x-webhook-token: CURRENT_SECRET`, `Idempotency-Key: sender-request-123` et `Prefer: respond-async`. Réutilisez la même clé et les mêmes données pour réessayer cette requête.

Exemple de corps de réponse 202 :

```json
{"accepted":true,"requestId":"request-id","status":"queued","statusUrl":"/api/workflows/hooks/example?requestId=request-id"}
```

Consultez l'adresse renvoyée avec `GET /api/workflows/hooks/example?requestId=request-id` et le secret actuel dans `x-webhook-token`. Respectez `Retry-After`. La consultation renvoie seulement `requestId`, `status` et `runId`, sans données ni erreurs brutes. L'identifiant seul n'autorise rien. Après rotation, l'ancien secret ne donne plus accès. Renommer ou supprimer le chemin peut empêcher cette consultation. Les opérateurs peuvent toujours consulter le reçu par identifiant de flux et de requête.

### Consultation et reprise

L'onglet Reçus webhook dans l'historique affiche `queued`, `running`, `completed`, `failed`, `interrupted` et `cancelled`. Les routes opérateur sont `GET /api/workflows/:id/receipts?limit=25&offset=0` et `GET /api/workflows/:id/receipts/:requestId`.

```sh
openldr workflows receipts list WORKFLOW_ID --limit 25 --offset 0 --json
openldr workflows receipts show REQUEST_ID --json
```

La limite va de 1 à 100 et le décalage commence à zéro. Ces commandes utilisent le même service que l'API. Aucune relance n'est proposée.

Les requêtes en attente peuvent reprendre après redémarrage. Un flux désactivé, supprimé ou modifié avant l'exécution annule le travail en attente. `interrupted` indique un résultat incertain. OpenLDR ne relance jamais automatiquement une exécution commencée. Vérifiez l'arrêt du processus initial et rapprochez les effets externes avant d'envoyer une nouvelle identité. Aucun retour arrière automatique des effets externes n'existe. Les reçus et clés survivent à la suppression du flux. Aucune expiration ni purge automatique ne limite leur stockage.

La migration 097 ajoute le stockage des reçus. Le déploiement suit toujours P14. Arrêtez les anciennes instances API et les processus qui modifient les flux. Exécutez `openldr db migrate`, puis démarrez les instances mises à jour. Ne mélangez pas les versions pendant les écritures. La compatibilité réelle du client CDR reste non prouvée, car son code source n'a pas été vérifié.
