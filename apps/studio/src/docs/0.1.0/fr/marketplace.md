# Marketplace

Le Marketplace permet aux administrateurs de consulter les paquets, leurs permissions et les registres.

## Avant de commencer

Vous devez disposer des droits d'administration. Vérifiez la source du paquet avant toute installation.

![Paquets disponibles dans le Marketplace](marketplace-browse.png)

## Consulter et installer un paquet

1. Ouvrez **Paramètres**, puis **Marketplace**.
2. Dans **Parcourir**, ouvrez les détails du paquet.
3. Choisissez la version souhaitée.
4. Consultez les permissions, la compatibilité et la documentation.
5. Ouvrez le menu des détails, puis choisissez **Installer**.
6. Vérifiez les permissions dans la demande d'approbation avant de confirmer.

![Version, permissions et documentation du paquet](marketplace-detail.png)

## Comprendre les permissions

**Chargement des permissions** signifie que les détails sont en cours de récupération. L'installation reste désactivée.

**Permissions indisponibles** signifie que les permissions n'ont pas pu être établies. Cela ne signifie pas que le paquet ne demande aucune permission. Quittez les détails, vérifiez la disponibilité du registre, puis rouvrez le paquet.

**Aucune permission particulière demandée** apparaît seulement lorsque les détails chargés confirment une liste vide. Pour un paquet déjà installé sans référence au registre, les permissions proviennent de son enregistrement local.

Un changement de version relance cette vérification. L'approbation d'installation utilise les permissions de la version sélectionnée. Elle n'accorde rien avant votre confirmation.

## Gérer les paquets et les registres

Dans **Installés**, utilisez le menu du paquet pour les actions disponibles, notamment l'activation, la désactivation et la suppression.

Dans **Registres**, ouvrez le menu et choisissez **Ajouter un registre**. Renseignez le nom, le type et l'emplacement. Enregistrez, puis vérifiez la ligne créée. Vous pouvez modifier le registre ou le désactiver depuis la liste.

![Liste et formulaire des registres](marketplace-registries.png)

## Dépannage

- Si l'installation échoue, vérifiez la compatibilité, les permissions et la disponibilité du registre.
- Si un paquet manque, vérifiez que son registre est activé et accessible.
- Si un paquet installé n'apparaît pas dans l'application, vérifiez son activation et sa compatibilité.

## Guides associés

- [Paramètres](/docs/settings)
- [Connecteurs](/docs/connectors)
- [Formulaires](/docs/forms)
