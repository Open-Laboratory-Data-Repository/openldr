# Exposition des données

Data Exposure contrôle les colonnes supplémentaires proposées par le créateur de tableaux de bord. Les administrateurs y masquent les colonnes ou approuvent leur disponibilité. Vous avez besoin de Manage data exposure.

Cette politique couvre les colonnes supplémentaires du créateur. Elle exclut les dimensions intégrées, le SQL brut et les rapports de connecteurs. Masquer une colonne ici ne supprime pas ses données ni l'accès à la base.

Le badge PII signifie information permettant d'identifier une personne. Afficher une telle colonne exige une confirmation supplémentaire, puis Save.

Utilisez votre politique de colonnes approuvée. Les images proviennent d'une installation de test isolée et les colonnes sont rétablies après démonstration. Aucun exemple d'enregistrement n'est requis.

## Masquer une colonne supplémentaire du tableau de bord

Utilisez cette tâche lorsqu'une colonne supplémentaire ne doit plus être proposée dans le créateur de tableaux de bord.

### 1. Ouvrir Settings et Data Exposure

Ouvrez votre menu utilisateur en bas à gauche, choisissez **Settings**, puis **Data Exposure**.

![Ouvrez votre menu utilisateur en bas à gauche.](data-exposure-guide-user-menu.png)

![Choisissez Settings.](data-exposure-guide-settings-menu.png)

![Sélectionnez Data Exposure dans Settings.](data-exposure-guide-exposure-page.png)

### 2. Trouver le groupe de table

Trouvez la table contenant la colonne. L'exemple utilise **Patient**. Vérifiez le nom de la table et celui de la colonne.

![Trouvez le bon groupe avant de modifier une colonne.](data-exposure-guide-table-group.png)

### 3. Vérifier l'état actuel

Lisez **Shown** ou **Hidden** près de l'interrupteur. L'exemple commence avec `managing_organization` à Shown.

![Shown indique que la colonne supplémentaire est proposée dans le créateur de tableaux de bord.](data-exposure-guide-shown-column.png)

### 4. Désactiver la colonne

Désactivez son interrupteur. Le brouillon indique maintenant **Hidden**.

![Désactivez l'interrupteur pour marquer la colonne supplémentaire Hidden.](data-exposure-guide-hide-column.png)

### 5. Vérifier l'indicateur de modifications

**Unsaved changes** signifie que le brouillon n'a pas encore modifié la politique enregistrée.

![Unsaved changes indique que la politique n'est pas encore appliquée.](data-exposure-guide-unsaved.png)

### 6. Enregistrer la politique

Ouvrez les points de la page en haut à droite et sélectionnez **Save**.

![Ouvrez les points de la page Data Exposure.](data-exposure-guide-page-actions.png)

![Choisissez Save pour appliquer la politique de colonnes.](data-exposure-guide-save-hidden.png)

**Résultat attendu :** l'indicateur disparaît. La colonne reste Hidden après réouverture et n'apparaît plus parmi les colonnes supplémentaires du créateur.

![La colonne enregistrée reste Hidden après réouverture de la page.](data-exposure-guide-hidden-result.png)

## Abandonner les modifications non enregistrées

Utilisez cette tâche pour conserver la politique enregistrée après avoir changé un interrupteur.

### 1. Vérifier la modification du brouillon

Vérifiez l'interrupteur modifié. L'exemple a réactivé la colonne masquée sans enregistrer.

![Changer un interrupteur prépare seulement une politique. Cet exemple n'a pas été enregistré.](data-exposure-guide-discard-draft.png)

### 2. Choisir Discard

Ouvrez les points de la page et sélectionnez **Discard**.

![Discard recharge la politique enregistrée et retire les modifications du brouillon.](data-exposure-guide-discard-menu.png)

**Résultat attendu :** la page recharge la politique enregistrée. La modification non enregistrée de l'interrupteur disparaît.

![La colonne retrouve son état enregistré Hidden.](data-exposure-guide-discard-result.png)

## Approuver l'affichage d'une colonne identifiante

Utilisez cette tâche seulement après avoir décidé que les utilisateurs des tableaux de bord doivent disposer de cette colonne. Les images utilisent une installation de test.

### 1. Vérifier le badge PII

Trouvez la bonne table et la bonne colonne. L'exemple utilise `surname` dans Patient, marqué **PII** et Hidden.

![PII identifie les colonnes contenant des informations permettant d'identifier une personne.](data-exposure-guide-pii-hidden.png)

### 2. Lire et confirmer l'avertissement

Activez l'interrupteur. Lisez l'avertissement, puis sélectionnez **Un-hide** pour approuver le brouillon. Sélectionnez Cancel pour garder la colonne masquée.

![Lisez l'avertissement d'exposition avant de choisir Un-hide.](data-exposure-guide-pii-confirm.png)

### 3. Vérifier l'état du brouillon

La colonne indique maintenant **Shown**. La politique comporte encore des modifications non enregistrées.

![La confirmation marque la colonne Shown dans le brouillon. Save reste nécessaire pour l'appliquer.](data-exposure-guide-pii-draft.png)

### 4. Enregistrer l'approbation

Ouvrez les points de la page et sélectionnez **Save**.

![Choisissez Save pour appliquer la politique de colonnes.](data-exposure-guide-save-pii.png)

**Résultat attendu :** la colonne enregistrée est disponible parmi les colonnes supplémentaires du créateur de tableaux de bord.

![La colonne identifiante enregistrée indique maintenant Shown.](data-exposure-guide-pii-result.png)

## Masquer à nouveau une colonne identifiante

Utilisez cette tâche lorsqu'une colonne identifiante approuvée ne doit plus être proposée.

### 1. Désactiver la colonne

Trouvez la colonne et désactivez son interrupteur. L'exemple masque à nouveau `surname`.

![Désactivez à nouveau la colonne identifiante lorsqu'elle doit être masquée.](data-exposure-guide-rehide-pii.png)

### 2. Enregistrer la nouvelle politique

Ouvrez les points de la page et sélectionnez **Save**.

![Choisissez Save pour appliquer la politique de colonnes.](data-exposure-guide-save-rehide.png)

**Résultat attendu :** la colonne est Hidden dans la politique enregistrée. Aucune donnée identifiante n'a été supprimée.

## Afficher une colonne sans avertissement PII

Utilisez cette tâche pour rendre à nouveau disponible une colonne supplémentaire sans PII.

### 1. Activer la colonne

Trouvez la bonne colonne et activez son interrupteur. L'exemple rétablit `managing_organization`.

![Activez une colonne sans PII lorsqu'elle doit être à nouveau disponible.](data-exposure-guide-show-normal.png)

### 2. Enregistrer la politique

Ouvrez les points de la page et sélectionnez **Save**.

![Choisissez Save pour appliquer la politique de colonnes.](data-exposure-guide-restore-column.png)

**Résultat attendu :** la colonne enregistrée est de nouveau disponible parmi les colonnes supplémentaires du créateur.

## Vérifier la politique sur téléphone

Utilisez les mêmes groupes et interrupteurs sur téléphone. Faites défiler les groupes verticalement.

### 1. Trouver le groupe de table

Trouvez le bon groupe avant de modifier une colonne.

![Faites défiler les groupes de tables sur téléphone.](data-exposure-guide-phone-group.png)

### 2. Lire la colonne et son état

Vérifiez son nom, son éventuel badge PII et son état Shown ou Hidden avant de changer l'interrupteur. Enregistrez avec les points de la page.

![Lisez le nom, le badge PII et l'état Shown ou Hidden avant modification.](data-exposure-guide-phone-column.png)

## Exercice facultatif

Utilisez une installation de test. Masquez une colonne sans PII, enregistrez, puis rétablissez-la. Essayez Discard après une modification non enregistrée. Exercez-vous à l'approbation PII avec des données fictives uniquement, puis rétablissez la politique voulue.

## Limites

Cette fonction n'est ni une limite de sécurité de la base ni un outil de suppression. Les dimensions intégrées, le SQL brut et les rapports de connecteurs sont exclus. Les modifications restent des brouillons jusqu'à Save.

## Dépannage

**La politique n'a pas changé.** Vérifiez Unsaved changes, puis choisissez Save dans les points de la page.

**Discard est indisponible.** Aucune modification d'interrupteur non enregistrée n'existe.

**Un champ masqué reste disponible ailleurs.** Vérifiez s'il s'agit d'une dimension intégrée, d'un champ SQL brut ou d'un rapport de connecteur. Cette politique ne les couvre pas.

## Guides associés

Lisez [Tableaux de bord](/docs/dashboard) pour créer des widgets et [Rôles](/docs/roles) pour les permissions. Lisez [Commencer ici](/docs/start-here) pour configurer la CLI.
