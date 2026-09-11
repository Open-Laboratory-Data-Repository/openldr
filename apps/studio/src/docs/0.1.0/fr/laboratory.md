# Laboratoire

Dans **Paramètres → Laboratoire**, configurez l'identité imprimée sur les en-têtes des rapports et le registre proposé pour les nouveaux établissements.

## Configuration

1. Renseignez le nom du laboratoire, l'adresse et le contact.
2. Choisissez un fichier image pour le logo. L'aperçu précède l'enregistrement. Effacer le logo nécessite aussi un enregistrement.
3. Sélectionnez le registre des établissements. Ce choix fournit le système initial lors de la création d'un établissement ; il n'importe aucune donnée et ne modifie pas les identifiants existants.
4. Renseignez un fuseau horaire IANA, par exemple `Africa/Dar_es_Salaam`. Les décalages fixes sont refusés. Avec un entrepôt SQL Server, laissez ce champ vide et saisissez le nom Windows dans le filtre de fuseau horaire du rapport.
5. Dans le menu **⋯** de la page, enregistrez. Vérifiez la notification, puis rouvrez la page pour contrôler les valeurs.
6. Prévisualisez un rapport utilisant l'en-tête partagé pour vérifier l'identité et le logo.

## Registre et limites

La liste propose les sources actives enregistrées dans [Établissements](/docs/facilities). Si la source manque, lancez l'importation dans cette page et enregistrez la source. Revenez au Laboratoire et rechargez la page. Une liste vide peut aussi indiquer un échec de chargement.

Choisissez le registre auquel appartiennent vos codes d'établissement. Son URI distingue ces codes de ceux d'un autre registre. Ce choix ne migre pas les établissements existants.

Le fuseau horaire peut préremplir un filtre de rapport ; il ne règle pas l'heure de toutes les planifications. Consultez [Rapports](/docs/reports).

Les modifications ne sont pas enregistrées automatiquement. En cas d'erreur, corrigez la valeur et réessayez. Le logo doit être un fichier image accepté par la page, pas une adresse web.

## Guides associés

- [Paramètres](/docs/settings)
- [Établissements](/docs/facilities)
- [Rapports](/docs/reports)
