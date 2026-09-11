# Utilisateurs et rôles

L'éditeur d'utilisateur de Studio attribue un seul rôle. Ce rôle regroupe les permissions nécessaires au travail de la personne.

![Liste des utilisateurs](users-list.png)

## Attribuer un rôle

1. Ouvrez **Utilisateurs** et recherchez le compte.
2. Ouvrez le menu **⋯** de sa ligne et choisissez **Modifier**.
3. Attendez le chargement des rôles, puis ouvrez **Rôle** et sélectionnez un rôle.
4. Le choix est unique. Sélectionner un autre rôle remplace la sélection ; cela n'ajoute pas un second rôle.
5. Enregistrez et vérifiez la notification de réussite.
6. Rouvrez le compte pour vérifier le rôle enregistré.

![Éditeur d'utilisateur et sélection du rôle](user-edit-roles.png)

La modification du compte nécessite la permission de gérer les utilisateurs. L'attribution du rôle nécessite aussi la permission de gérer les rôles. Si l'attribution échoue, l'éditeur reste ouvert et affiche une erreur. Corrigez cette erreur avant de considérer la modification comme terminée.

Si aucun rôle ne convient, créez ou ajustez un rôle dans **Paramètres → Rôles**. Modifier les permissions d'un rôle partagé affecte tous les utilisateurs auxquels il est attribué.

## Guides associés

- [Rôles](/docs/roles)
- [Audit](/docs/audit)
- [Paramètres](/docs/settings)

## Désactiver ou réactiver un compte

Ouvrez le menu **Actions** de la ligne du compte pour le désactiver ou le réactiver. La désactivation bloque d'abord l'accès local, puis met à jour le fournisseur d'identité. La prochaine requête API authentifiée reçoit `403 account disabled`, même avec un jeton déjà émis. Une page déjà chargée peut rester visible.

Le blocage couvre aussi les comptes qui ne se sont jamais connectés. La réactivation met d'abord à jour le fournisseur, puis lève le blocage local. Si une écriture échoue, l'action affiche une erreur. Le fournisseur peut alors autoriser le compte tandis qu'OpenLDR maintient le blocage. Rétablissez la connexion défaillante et répétez la même action. L'audit enregistre `user.status.failed` en cas d'échec et `user.status` en cas de réussite.

Dans la CLI, utilisez `openldr user deactivate <local-id>` ou `openldr user activate <local-id>`. Trouvez l'identifiant local avec `openldr users list`. Les comptes liés modifient les deux systèmes à partir de leur identifiant fournisseur. Les comptes uniquement locaux changent seulement dans OpenLDR. L'audit des changements CLI indique l'acteur `cli`.

Si une autre modification du statut de ce compte est en cours, l'API renvoie `409`. Attendez la fin de cette action, puis réessayez. Cela s'applique aussi aux modifications simultanées depuis Studio et la CLI.
