# Configuration du laboratoire

La configuration du laboratoire couvre ce qu'OpenLDR garde pour le laboratoire lui-même. Vous fixez des seuils critiques sur les intervalles de référence d'un examen. Un administrateur peut aussi reconstruire l'index des numéros de demande. Ce guide s'adresse aux responsables de laboratoire et aux administrateurs.

Le formulaire **Lab order** commande des examens et saisit leurs résultats. Il peut aussi enregistrer un **Order rejection**. Lisez [Formulaires](/docs/forms).

Un plugin de laboratoire est prévu pour la réception et la vérification des résultats. Il ne fait pas partie de cette version.

Les seuils critiques font partie des intervalles de référence d'un examen. Ils exigent donc **Gérer la terminologie**, comme le reste de la définition de l'examen. Ouvrir **Catalogue des examens** exige **Parcourir la terminologie**. Reconstruire l'index exige **Zone de danger**.

## Ajouter des seuils critiques à un intervalle de référence

Un seuil critique est une valeur si loin de l'intervalle qu'il faut agir tout de suite. Utilisez les seuils approuvés par votre laboratoire. Ne copiez pas les nombres d'un exemple.

1. Ouvrez **Catalogue des examens** et ouvrez l'examen avec **Modifier**.
2. Trouvez le champ de résultat et son intervalle de référence.
3. Saisissez le seuil inférieur dans **Seuil critique bas**.
4. Saisissez le seuil supérieur dans **Seuil critique haut**.
5. Ouvrez le menu à points du panneau et sélectionnez **Enregistrer**.

**Résultat attendu :** un message indique que l'examen est enregistré. Les seuils sont gardés avec l'intervalle.

Vous pouvez remplir un seuil, les deux ou aucun. OpenLDR vérifie trois règles à l'enregistrement :

- **Seuil critique bas** doit être inférieur ou égal à **Borne basse**.
- **Seuil critique haut** doit être supérieur ou égal à **Borne haute**.
- **Seuil critique bas** doit être inférieur à **Seuil critique haut**.

Une règle n'est vérifiée que si l'intervalle a ses deux valeurs. Un refus nomme le champ de résultat et l'intervalle. Le message vient du serveur, en anglais, par exemple `HGB range 1: the critical low limit must be at or below the low limit.`

OpenLDR enregistre les seuils. Rien dans cette version ne signale encore un résultat par rapport à eux.

## Reconstruire l'index des numéros de demande

OpenLDR garde un index qui trouve une demande par son numéro de demande. Il le tient à jour tout seul à l'arrivée des demandes. Reconstruisez-le seulement si une erreur a laissé une demande hors de l'index, ou après la suppression de demandes du stockage.

Lancez la commande à travers le serveur OpenLDR en marche, en tant que personne qui détient **Zone de danger**. Sous Linux et macOS, connectez-vous d'abord avec `./openldr login`, ou définissez une clé d'accès dans `OPENLDR_KEY`. Sous Windows, définissez d'abord une clé d'accès dans `OPENLDR_KEY`. Le CLI s'y connecte uniquement avec une clé d'accès. Lisez [Utilisateurs](/docs/users) pour créer une clé d'accès. Lisez [Commencer ici](/docs/start-here) pour la CLI installée et celle de développement.

Exemple dans une copie de développement :

```shell
pnpm openldr lab requisitions rebuild --force
```

Pour une copie installée sous Linux ou macOS, utilisez `./openldr` au lieu de `pnpm openldr`. Sous Windows, utilisez `.\openldr.ps1` depuis votre dossier d'installation, avec `OPENLDR_KEY` défini. Cette commande n'a pas été lancée sous Windows.

**Résultat attendu :** la commande affiche, par exemple, `Indexed 120 orders by requisition number.`

Elle refuse sans `--force`, car elle réécrit tout l'index. Chaque reconstruction est inscrite dans le journal d'audit sous votre compte.

## Limites

- La réception et la vérification des résultats ne font pas partie de cette version. Un plugin de laboratoire est prévu pour elles.
- Les seuils critiques sont enregistrés, mais aucun écran ne signale encore un résultat par rapport à eux.
- La reconstruction de l'index est seulement une commande. Elle n'a pas de bouton dans le studio.

## Résolution des problèmes

- **L'enregistrement refuse un seuil critique.** Lisez le message. Il nomme l'intervalle et la règle non respectée.
- **La reconstruction dit que le compte n'a pas la capacité.** Le compte ne détient pas **Zone de danger**. Utilisez un compte dont le rôle l'a.

## Guides associés

- [Catalogue des examens](/docs/test-catalog)
- [Formulaires](/docs/forms)
- [Rôles](/docs/roles)
- [Utilisateurs](/docs/users)
