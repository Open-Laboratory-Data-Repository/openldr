# Connecteurs

Un connecteur conserve la configuration d'une connexion externe. Les nœuds de workflow le sélectionnent par son nom. Les secrets sont chiffrés et ne sont plus affichés après l'enregistrement.

## Créer un connecteur

![Liste des connecteurs](connectors-list.png)

1. Ouvrez **Paramètres → Connecteurs**.
2. Ouvrez le menu **⋯** de la page et choisissez **Ajouter un connecteur**.
3. Saisissez un **Nom** reconnaissable dans les nœuds de workflow.
4. Choisissez la **Catégorie**. La valeur initiale, **Extension**, nécessite une extension de sortie installée. Pour une base de données, un serveur de messagerie ou un serveur de fichiers, choisissez **Hôte**.
5. Pour Hôte, sélectionnez le service sous **Type de base de données**. Ce sélecteur comprend aussi les services de messagerie et de fichiers. Pour Extension, sélectionnez l'extension de sortie installée.
6. Renseignez les champs de connexion du service, puis choisissez **Enregistrer** dans le menu **⋯** du formulaire.
7. Vérifiez la notification contenant le nom et la nouvelle ligne. Le connecteur est initialement activé. Le formulaire de création ne propose pas de choix Activé.
8. Pour le désactiver, coupez **Activé** dans la liste. Vous pouvez aussi choisir **Modifier** dans le menu **⋯** de la ligne, couper Activé et enregistrer.
9. Dans le menu **⋯** de la ligne, choisissez **Tester** pour vérifier la connexion depuis le serveur OpenLDR.
10. Sélectionnez le connecteur activé dans un nœud de workflow compatible lorsque vous souhaitez l'utiliser.

![Formulaire de configuration du connecteur](connector-form.png)

## Choisir la bonne catégorie

Si Extension ne propose aucune extension de sortie, choisissez Hôte pour un service intégré. Pour une destination fournie par une extension, installez d'abord cette extension dans le [Marketplace](/docs/marketplace).

L'adresse et le port doivent être accessibles depuis le serveur OpenLDR. Dans Docker, utilisez l'adresse accessible depuis le conteneur, qui peut différer de celle de votre ordinateur.

Un enregistrement réussi confirme la sauvegarde de la configuration. Utilisez Tester pour vérifier la connexion. Si le connecteur manque dans un nœud, vérifiez son activation et sa compatibilité avec ce nœud.

## Guides associés

- [Workflows](/docs/workflows)
- [Rapports planifiés](/docs/report-pipeline)
- [Paramètres](/docs/settings)
- [Marketplace](/docs/marketplace)

## Modifier les paramètres enregistrés

Choisissez **Modifier** dans le menu **⋯** de la ligne. Les connecteurs Hôte affichent les champs ordinaires enregistrés : hôte, port, base de données et utilisateur selon le service. Un secret indiqué comme défini reste vide. Laissez-le vide pour conserver sa valeur, même en changeant l'hôte. Saisissez un secret uniquement pour le remplacer. Choisissez **Enregistrer** dans le menu **⋯** du formulaire, puis **Tester** dans le menu de la ligne.

Les URL, champs inconnus et configurations des extensions ne sont pas affichés. Pour une extension, saisissez toujours ensemble l'URL de base, l'utilisateur et le mot de passe.

En ligne de commande, utilisez `openldr connectors inspect <id>`. Le JSON contient les champs ordinaires dans `config` et la présence des secrets dans `secretsSet`. Pour modifier un connecteur Hôte : `openldr connectors update <id> --file patch.json`. Exemple : `{"config":{"host":"db.internal","port":"5432"}}`. Les champs omis et les secrets vides conservent leur valeur. Pour renommer : `{"name":"Base du laboratoire"}`. La sortie et l'audit ne contiennent pas les secrets. Protégez les fichiers contenant des secrets de remplacement.
