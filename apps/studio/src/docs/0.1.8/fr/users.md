# Utilisateurs

Utilisez Users pour trouver des comptes, modifier leurs profils, attribuer un rôle et contrôler les accès. Les rôles définissent les droits du compte. Le panneau Users sélectionne un rôle par personne.

Utilisez vos comptes de personnel et vos décisions d'accès approuvées. Les images utilisent un compte fictif sur une installation de test isolée. Aucun jeu de données n'est nécessaire.

View users donne accès à l'annuaire. Manage users permet de créer des comptes, modifier les profils et activer ou désactiver l'accès. Manage roles permet d'attribuer les rôles. Reset passwords et Force logout permettent les actions de sécurité correspondantes.

Créer des comptes, modifier les profils du fournisseur, réinitialiser les mots de passe et terminer les sessions du fournisseur exige une administration d'identité configurée. Sinon, la page demande de contacter l'administrateur du fournisseur d'identité. Les contrôles de rôle et d'accès OpenLDR restent disponibles.

Pour l'installation et la ligne de commande, lisez [Commencer ici](/docs/start-here). Pour définir les droits des rôles, lisez [Rôles](/docs/roles).

## Créer un compte opérateur

Effectuez cette tâche lorsqu'une personne a besoin de son propre accès. Vérifiez le rôle requis avant de créer le compte.

### 1. Ouvrir Users

Sélectionnez **Users** dans le menu principal.

![Sélectionnez Users dans le menu principal.](users-guide-open-users.png)

### 2. Choisir New user

Ouvrez les points de la page au-dessus de l'annuaire et sélectionnez **New user**. Si l'action est indisponible, contactez l'administrateur du fournisseur d'identité.

![Ouvrez le menu à points de Users.](users-guide-page-actions.png)

![Choisissez New user.](users-guide-new-user.png)

### 3. Saisir le nom d'utilisateur

Saisissez le nom de connexion de la personne. L'exemple utilise `documentation.operator`.

![Saisissez le nom d'utilisateur du compte.](users-guide-username.png)

### 4. Choisir un mot de passe initial

Saisissez un **Password** initial, ou laissez-le vide et organisez l'activation via votre fournisseur d'identité. Un mot de passe initial impose un changement à la prochaine connexion. Transmettez les identifiants selon votre procédure approuvée.

![Saisissez un mot de passe initial ou laissez-le vide et organisez l'activation via le fournisseur.](users-guide-password.png)

### 5. Confirmer le mot de passe

Si vous avez saisi un mot de passe, répétez-le dans **Confirm password**.

![Saisissez de nouveau le même mot de passe initial.](users-guide-confirm-password.png)

### 6. Choisir le rôle

Sélectionnez le rôle autorisant les actions nécessaires à cette personne. Les nouveaux comptes ont **Lab Technician** par défaut.

![Choisissez le rôle adapté. L'exemple utilise Lab Technician.](users-guide-choose-role.png)

### 7. Compléter le profil

Remplissez les champs de votre formulaire Users publié. Le formulaire illustré demande le prénom, le nom et l'adresse électronique. Le vôtre peut proposer d'autres champs. Un formulaire publié est facultatif pour créer un compte.

![Complétez le formulaire Users publié. Ce formulaire de test demande le nom et l'adresse électronique.](users-guide-profile.png)

### 8. Créer le compte

Ouvrez les points du panneau et sélectionnez **Create**. Si l'attribution du rôle échoue après l'enregistrement du compte, choisissez un rôle valide et réessayez dans le même panneau.

![Ouvrez les points du panneau New user.](users-guide-sheet-actions.png)

![Choisissez Create pour enregistrer le compte et le rôle.](users-guide-create-user.png)

**Résultat attendu :** le panneau se ferme et le nouveau compte apparaît Active dans l'annuaire.

![Le compte apparaît Active avec son nom et son adresse électronique.](users-guide-created-result.png)

## Modifier un profil ou attribuer un autre rôle

Effectuez cette tâche lorsque les coordonnées ou responsabilités changent. Changer le rôle change les droits accordés à la personne.

### 1. Trouver le compte

Recherchez par nom d'utilisateur, nom ou adresse électronique. La recherche couvre tout l'annuaire.

![Recherchez dans tout l'annuaire par nom d'utilisateur, nom ou adresse électronique.](users-guide-search-user.png)

### 2. Ouvrir ses actions

Sélectionnez les points du bon compte.

![Ouvrez les points du bon utilisateur.](users-guide-row-actions.png)

### 3. Choisir Edit

Sélectionnez **Edit**. Sélectionner la ligne ouvre le même panneau. Sans administration d'identité disponible, le menu affiche **Edit role**.

![Choisissez Edit pour ouvrir le profil et le rôle.](users-guide-edit-user.png)

### 4. Modifier le profil

Modifiez les champs fournis par votre formulaire Users. Le nom d'utilisateur ne peut pas être changé ici.

![Modifiez les champs de profil fournis par votre formulaire Users.](users-guide-edit-profile.png)

### 5. Choisir le rôle

Ouvrez **Role** et sélectionnez le rôle requis. L'exemple choisit **System Auditor**.

![Choisissez un autre rôle. L'exemple passe à System Auditor.](users-guide-change-role.png)

### 6. Enregistrer le compte

Ouvrez les points du panneau et sélectionnez **Save**.

![Choisissez Save dans les points du panneau.](users-guide-save-user.png)

**Résultat attendu :** le panneau se ferme et l'annuaire montre le profil enregistré. Rouvrez le compte pour consulter son rôle enregistré.

![Le profil enregistré apparaît dans le tableau Users.](users-guide-edited-result.png)

## Désactiver l'accès d'un compte

Effectuez cette tâche lorsqu'une personne ne doit plus se connecter. Vous ne pouvez pas désactiver votre propre compte par son menu de ligne.

### 1. Choisir Disable

Trouvez le compte. Ouvrez les points de sa ligne et sélectionnez **Disable**.

![Choisissez Disable pour le bon utilisateur.](users-guide-disable-menu.png)

### 2. Confirmer le compte

Vérifiez le nom d'utilisateur dans la confirmation. Sélectionnez **Disable** pour continuer.

![Vérifiez le nom du compte avant de sélectionner Disable.](users-guide-disable-confirm.png)

### 3. Ouvrir Status

Les comptes désactivés disparaissent de la liste Active par défaut. Ouvrez **Status**.

![Utilisez Status pour trouver un compte désactivé.](users-guide-status-filter.png)

### 4. Choisir Disabled

Sélectionnez **Disabled**.

![Choisissez Disabled.](users-guide-disabled-option.png)

**Résultat attendu :** le compte apparaît avec le statut Disabled. La désactivation de l'accès conserve le compte et son profil.

![Le compte apparaît avec le statut Disabled.](users-guide-disabled-result.png)

## Rétablir l'accès d'un compte

Effectuez cette tâche lorsqu'une personne désactivée doit pouvoir se reconnecter.

### 1. Choisir Enable

Trouvez le compte avec Status réglé sur Disabled ou All statuses. Ouvrez les points de sa ligne et sélectionnez **Enable**.

![Choisissez Enable pour rétablir l'accès du compte.](users-guide-enable-menu.png)

### 2. Confirmer le compte

Vérifiez le nom d'utilisateur, puis sélectionnez **Enable**.

![Vérifiez le compte, puis confirmez Enable.](users-guide-enable-confirm.png)

### 3. Revenir à Active

Ouvrez **Status** et choisissez **Active**.

![Choisissez Active pour trouver le compte réactivé.](users-guide-active-option.png)

**Résultat attendu :** le compte revient dans la liste Active.

![Le compte revient dans la liste Active.](users-guide-enabled-result.png)

## Réinitialiser un mot de passe

Effectuez cette tâche lorsqu'un compte a besoin d'un nouveau mot de passe. L'administration d'identité et Reset passwords sont requis.

### 1. Ouvrir Reset password

Trouvez le compte. Ouvrez les points de sa ligne et sélectionnez **Reset password**.

![Choisissez Reset password pour le bon compte.](users-guide-reset-menu.png)

### 2. Saisir un nouveau mot de passe

Saisissez **New password**. **Generate** crée un mot de passe et remplit les deux champs. L'œil le révèle et Copy le copie.

![Saisissez un nouveau mot de passe. Generate peut remplir les deux champs.](users-guide-reset-new-password.png)

### 3. Confirmer le nouveau mot de passe

Saisissez le même mot de passe dans **Confirm password**. Generate l'a déjà rempli.

![Saisissez de nouveau le même nouveau mot de passe.](users-guide-reset-confirm-password.png)

### 4. Choisir s'il est temporaire

Gardez **Require password change at next sign-in** coché pour un mot de passe temporaire. Décochez uniquement si la personne doit utiliser directement ce mot de passe.

![Gardez Require password change actif pour un mot de passe temporaire, ou désactivez-le si nécessaire.](users-guide-reset-change.png)

### 5. Réinitialiser le mot de passe

Sélectionnez **Reset password**. Transmettez le mot de passe de manière sûre selon votre procédure approuvée.

![Sélectionnez Reset password après avoir vérifié le choix de changement de mot de passe.](users-guide-reset-submit.png)

**Résultat attendu :** la page confirme la réinitialisation. Avec l'option temporaire par défaut, la personne doit le changer à sa prochaine connexion.

![La page confirme la réinitialisation du mot de passe.](users-guide-reset-result.png)

## Terminer les sessions du fournisseur d'un utilisateur

Effectuez cette tâche lorsque les sessions existantes du fournisseur doivent se terminer. L'administration d'identité et Force logout sont requis.

### 1. Choisir Force sign-out

Trouvez le compte. Ouvrez les points de sa ligne et sélectionnez **Force sign-out**. Vous ne pouvez pas utiliser cette action sur vous-même ici.

![Choisissez Force sign-out pour terminer les sessions du fournisseur de cet utilisateur.](users-guide-logout-menu.png)

### 2. Confirmer le compte

Vérifiez le nom d'utilisateur et sélectionnez **Force sign-out**.

![Confirmez Force sign-out pour le bon compte.](users-guide-logout-confirm.png)

**Résultat attendu :** la page confirme la fermeture de toutes les sessions. Cette action ne désactive pas le compte.

![La page confirme la fermeture de toutes les sessions.](users-guide-logout-result.png)

## Utiliser Users sur un téléphone

Utilisez le même annuaire et le même panneau de compte sur un téléphone. Les colonnes larges peuvent nécessiter un défilement horizontal.

### 1. Trouver le compte

Recherchez par nom d'utilisateur, nom ou adresse électronique.

![Recherchez un compte sur un téléphone.](users-guide-phone-search.png)

### 2. Ouvrir le compte

Sélectionnez sa ligne. Faites défiler le panneau User pour lire le profil et le rôle. Sélectionnez **Close** en haut à droite pour revenir.

![Le panneau User utilise la largeur du téléphone. Faites défiler pour lire les champs du profil.](users-guide-phone-profile.png)

## Envoyer un courriel de réinitialisation si la messagerie est configurée

Les points du compte proposent aussi **Send reset email**. Cette action demande au fournisseur d'identité d'envoyer un lien de réinitialisation. Vérifiez d'abord l'adresse et la configuration d'envoi du fournisseur. Le test documenté n'a envoyé aucun courriel.

## Exercice facultatif

Utilisez une installation de test et un opérateur fictif. Suivez les tâches avec votre nom d'utilisateur de test et une adresse example.invalid. Ne testez ni la désactivation, ni la réinitialisation, ni la fermeture forcée sur le compte d'autrui sans autorisation.

## Limites

Users ne permet pas de supprimer un compte. Désactivez l'accès lorsqu'il ne doit plus se connecter. Les champs sous Role dépendent de votre formulaire Users publié. OpenLDR ne peut pas configurer l'envoi des courriels du fournisseur ici.

## Résolution des problèmes

**New user ou les actions de mot de passe manquent.** Lisez l'avis au-dessus de l'annuaire. Demandez à l'administrateur du fournisseur d'identité de configurer l'administration des comptes.

**Le compte disparaît après un changement de statut.** Réglez Status sur Active, Disabled ou All statuses pour le retrouver.

**Le compte est enregistré, mais l'attribution du rôle échoue.** Gardez le panneau ouvert, choisissez un rôle valide et enregistrez de nouveau. Ne retirez pas la dernière personne capable de gérer les rôles.

## Guides associés

Lisez [Rôles](/docs/roles) pour définir les droits. Lisez [Commencer ici](/docs/start-here) pour l'installation et la ligne de commande.
