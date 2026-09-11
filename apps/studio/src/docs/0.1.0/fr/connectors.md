# Connecteurs

Un connecteur conserve la configuration d'une connexion externe. Les nœuds de workflow le sélectionnent par son nom. Les secrets sont chiffrés et ne sont plus affichés après l'enregistrement.

## Créer un connecteur

![Liste des connecteurs](connectors-list.png)

1. Ouvrez **Paramètres → Connecteurs**.
2. Ouvrez le menu **⋯** de la page et choisissez **Ajouter un connecteur**.
3. Saisissez un **Nom** reconnaissable dans les nœuds de workflow.
4. Choisissez la **Catégorie**. La valeur initiale, **Extension**, nécessite une extension de sortie installée. Pour une base de données, un serveur de messagerie ou un serveur de fichiers, choisissez **Hôte**.
5. Pour Hôte, sélectionnez le service sous **Type de base de données**. Ce sélecteur comprend aussi les services de messagerie et de fichiers. Pour Extension, sélectionnez l'extension de sortie installée.
6. Renseignez les champs de connexion du service, puis choisissez **Enregistrer**.
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

## Délai des requêtes de base de données

Les requêtes des connecteurs PostgreSQL et MySQL ont une limite d'exécution de 30 secondes. Une requête lente échoue au lieu de bloquer indéfiniment le workflow ou le rapport. PostgreSQL annule la requête sur le serveur. MySQL utilise une seconde connexion avec les mêmes identifiants pour terminer la connexion de la requête. Cette annulation peut prendre une seconde supplémentaire. La connexion initiale a une limite distincte de 30 secondes.

Si une requête dépasse cette limite, réduisez la période ou affinez les filtres, puis vérifiez son plan d'exécution. Réessayez après correction. Le formulaire du connecteur ne propose aucun champ de délai.

Si l'erreur indique `server cancellation failed`, OpenLDR a fermé sa connexion locale sans pouvoir confirmer l'annulation sur le serveur. Demandez à l'administrateur de vérifier les requêtes actives. Le compte MySQL doit pouvoir ouvrir une autre connexion et terminer ses propres sessions.
