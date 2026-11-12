# Rôles

Un rôle regroupe des capacités, les permissions pour des actions précises. Attribuez les rôles dans Users. Le panneau Users attribue un seul rôle par personne.

Utilisez vos propres noms de rôles et besoins d'accès. Les images montrent un rôle temporaire Documentation reader dans une installation de test isolée. Aucune donnée d'entraînement n'est requise.

View roles permet de consulter les rôles. Manage roles permet de les créer, modifier, supprimer ou attribuer. Ouvrir Users exige aussi View users. Créer ou modifier les identités exige Manage users. Administrator est verrouillé. Les autres rôles système sont modifiables mais ne peuvent pas être supprimés.

Pour l'installation et la CLI, lisez [Commencer ici](/docs/start-here). Ce guide couvre la page Roles.

## Inspecter un rôle avant de modifier les accès

Vérifiez ainsi les actions autorisées par un rôle existant.

### 1. Ouvrir Settings et Roles

Ouvrez votre menu utilisateur en bas à gauche, choisissez **Settings**, puis **Roles**.

![Ouvrez votre menu utilisateur en bas à gauche.](roles-guide-open-user-menu.png)

![Choisissez Settings dans votre menu utilisateur.](roles-guide-settings-menu.png)

![Sélectionnez Roles dans la liste des sections de Settings.](roles-guide-roles-page.png)

### 2. Ouvrir le rôle

Sélectionnez la ligne d'un rôle. Lisez son nom, sa description et les capacités sélectionnées. Faites défiler le panneau pour lire chaque permission.

![Lisez le nom, la description et les capacités sélectionnées du rôle.](roles-guide-inspect-role.png)

### 3. Vérifier le verrouillage

Le rôle intégré Administrator affiche un avertissement et des champs en lecture seule. Sélectionnez **Close** en haut à droite après consultation.

![Administrator est verrouillé. Ses capacités ne peuvent pas être modifiées.](roles-guide-locked-role.png)

**Résultat attendu :** lire un rôle ne modifie pas ses permissions.

## Créer un rôle avec des permissions précises

Utilisez cette tâche si les rôles existants ne correspondent pas aux besoins du personnel. Définissez les actions nécessaires avant de sélectionner les capacités.

### 1. Ouvrir les actions de la page

Sélectionnez les points au-dessus de la table Roles.

![Ouvrez le menu de points de Roles.](roles-guide-create-actions.png)

### 2. Choisir Create role

Sélectionnez **Create role**.

![Choisissez Create role.](roles-guide-create-menu.png)

### 3. Saisir le nom

Utilisez un nom reconnu par votre équipe. L'exemple utilise `Documentation reader`.

![Saisissez un nom décrivant ce rôle.](roles-guide-name.png)

### 4. Vérifier le slug

**Slug** est l'identifiant du rôle. Le nom le remplit automatiquement jusqu'à votre première modification. Choisissez-le avec soin car il ne peut plus changer après création.

![Vérifiez l'identifiant. Il devient accessible en lecture seule après création.](roles-guide-slug.png)

### 5. Décrire le rôle

Indiquez son objectif dans **Description**. Les autres administrateurs sauront ainsi à qui l'attribuer.

![Décrivez qui doit utiliser ce rôle.](roles-guide-description.png)

### 6. Sélectionner les capacités

Activez chaque permission nécessaire. Lisez la description près de chaque interrupteur. L'exemple sélectionne **View dashboards**.

![Choisissez chaque permission nécessaire. L'exemple autorise la consultation des tableaux de bord.](roles-guide-capability.png)

### 7. Ouvrir les actions du panneau

Sélectionnez les points en haut du panneau Create role.

![Ouvrez le menu de points du panneau de rôle.](roles-guide-sheet-actions.png)

### 8. Créer le rôle

Sélectionnez **Create**.

![Choisissez Create pour enregistrer le rôle.](roles-guide-create-save.png)

**Résultat attendu :** le panneau se ferme et le rôle apparaît dans la liste. Le créer ne l'attribue à personne. Utilisez Users pour l'attribuer.

![Le rôle créé apparaît avec sa description et son nombre de membres.](roles-guide-created-result.png)

## Modifier la description ou les permissions d'un rôle

Utilisez cette tâche lorsque les responsabilités des titulaires changent. Vérifiez qui possède ce rôle avant de modifier les accès.

### 1. Trouver le rôle

Saisissez son nom dans **Search roles**. L'exemple recherche `Documentation`.

![Utilisez Search roles pour trouver un rôle par son nom.](roles-guide-search.png)

### 2. Ouvrir les actions de la ligne

Sélectionnez les points de la ligne correspondante.

![Ouvrez les points du rôle correspondant.](roles-guide-row-actions.png)

### 3. Choisir Edit

Sélectionnez **Edit**. Sélectionner la ligne ouvre le même panneau.

![Choisissez Edit pour modifier sa description ou ses permissions.](roles-guide-edit-menu.png)

### 4. Mettre à jour la description

Modifiez **Description** si l'objectif a changé. Vous pouvez aussi modifier Name. Slug reste en lecture seule.

![Mettez à jour la description. Le slug reste en lecture seule.](roles-guide-edit-description.png)

### 5. Ajuster les permissions

Activez ou désactivez les capacités. L'exemple ajoute **View reports**.

![Activez ou désactivez les capacités individuelles.](roles-guide-edit-capability.png)

### 6. Enregistrer le rôle

Ouvrez les points du panneau et sélectionnez **Save**.

![Choisissez Save pour conserver les modifications.](roles-guide-edit-save.png)

**Résultat attendu :** la liste affiche la description enregistrée. Les utilisateurs de ce rôle reçoivent ses permissions.

![La description mise à jour apparaît sur la ligne du rôle.](roles-guide-edited-result.png)

## Supprimer un rôle personnalisé

Utilisez cette tâche seulement pour retirer les permissions accordées par ce rôle. Les rôles système ne peuvent pas être supprimés.

### 1. Choisir Delete

Trouvez le rôle, ouvrez les points de sa ligne et sélectionnez **Delete**.

![Delete est disponible pour un rôle personnalisé.](roles-guide-delete-menu.png)

### 2. Confirmer le rôle et les effets

Lisez la confirmation. Les membres perdent les capacités accordées par ce rôle. Sélectionnez **Delete** pour confirmer ou **Cancel** pour le conserver.

![Vérifiez le nom du rôle et l'effet sur ses membres avant confirmation.](roles-guide-delete-confirm.png)

**Résultat attendu :** le rôle disparaît. La suppression est irréversible. Vérifiez les utilisateurs concernés après suppression.

![Le rôle supprimé n'apparaît plus dans la recherche.](roles-guide-deleted-result.png)

## Consulter les rôles sur téléphone

Utilisez la même page Roles sur téléphone. Les colonnes larges peuvent nécessiter un défilement horizontal.

### 1. Rechercher le rôle

Saisissez son nom dans **Search roles**.

![Recherchez les rôles sur téléphone. La table défile horizontalement.](roles-guide-phone-search.png)

### 2. Ouvrir ses paramètres

Sélectionnez la ligne du rôle. Faites défiler le panneau pour lire sa description et ses capacités. Sélectionnez **Close** en haut à droite pour revenir.

![Le panneau de rôle utilise la largeur du téléphone. Faites défiler pour consulter ses capacités.](roles-guide-phone-sheet.png)

## Exercice facultatif

Dans une installation de test, créez le rôle `Documentation reader`. Sélectionnez uniquement View dashboards. Ajoutez View reports avec la tâche de modification, puis supprimez le rôle d'exercice. Ne l'attribuez pas au personnel réel.

## Avant de modifier les accès

Administrator est verrouillé. Les autres rôles système sont modifiables mais ne peuvent pas être supprimés. Un slug enregistré ne peut pas changer.

Créer un rôle ne l'attribue à personne. Les attributions se gèrent dans Users. Vérifiez les personnes concernées avant de modifier ou supprimer un rôle attribué.

## Dépannage

**Le rôle est en lecture seule.** Vérifiez s'il s'agit du rôle Administrator verrouillé et si votre compte possède Manage roles.

**Un nouveau rôle ne change aucun accès.** Créer le rôle enregistre seulement ses permissions. Utilisez Users pour l'attribuer à la personne voulue.

## Guides associés

[Commencer ici](/docs/start-here) explique la CLI installée et de développement. Users explique l'attribution des rôles.
