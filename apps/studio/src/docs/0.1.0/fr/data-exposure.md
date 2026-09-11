# Exposition des données

Paramètres → Exposition des données règle les colonnes supplémentaires accessibles dans les tables jointes du constructeur de tableaux de bord interne. L'accès exige la capacité `data_exposure.manage`.

## Comprendre la portée

La politique contrôle les colonnes supplémentaires choisies dans les tables jointes du constructeur. Les dimensions prédéfinies du modèle restent disponibles. Elle ne filtre pas tous les champs retournés.

Pour ces colonnes supplémentaires, la politique concerne la sélection, les requêtes et la conversion en SQL. Elle ne filtre pas les résultats des widgets SQL brut. Après conversion en SQL, les exécutions ne suivent pas les modifications ultérieures de cette politique.

Les requêtes personnalisées passent par les connecteurs de bases de données. Les rapports liés à ces requêtes, les données de requêtes du concepteur de rapports et les nœuds Base de données des workflows utilisent le SQL des connecteurs. Ils ne suivent pas cette politique, même si le connecteur pointe vers la base OpenLDR.

Limitez le compte de base de données de chaque connecteur aux tables, colonnes ou vues autorisées. Vérifiez ses droits et l'accès aux requêtes avant de partager un rapport. La validation SELECT et les limites de lignes ne masquent pas les colonnes sensibles. Limitez aussi le compte utilisé par les widgets SQL brut.

## Modifier la visibilité

1. Ouvrez Paramètres → Exposition des données et trouvez la table et la colonne.
2. Désactivez une colonne pour la marquer Masquée. Activez-la pour la marquer Visible.
3. Le badge DPI désigne les données personnelles. Rendre une telle colonne visible exige une confirmation. Confirmez uniquement si son utilisation dans le constructeur interne est prévue.
4. Les modifications restent locales jusqu'au choix Enregistrer dans le menu ⋯ de la page. Vérifiez la notification. En cas d'erreur, ne supposez pas que toutes les modifications ont été enregistrées.
5. Choisissez Annuler les modifications dans ce menu pour recharger les valeurs enregistrées.
6. Rouvrez la page et vérifiez les états. Rechargez ensuite le constructeur interne et contrôlez les colonnes proposées. Exécutez une requête de test sans données sensibles pour vérifier le résultat ou le refus attendu.

## Vérifier le chemin de la requête

Utilisez des données de test non sensibles. Un état Masquée enregistré prouve seulement le choix sauvegardé. Vérifiez séparément le constructeur interne, le SQL brut et les rapports utilisant des connecteurs. Pour un connecteur, testez le compte configuré sur les vues autorisées et les colonnes interdites. Contrôlez le rapport obtenu avant sa diffusion.

Cette politique ne supprime pas les données des enregistrements ni des fichiers déjà exportés.

## Guides associés

- [Paramètres](/docs/settings)
- [Tableau de bord](/docs/dashboard)
- [Requêtes personnalisées](/docs/query)
- [Connecteurs](/docs/connectors)
- [Rapports](/docs/reports)
