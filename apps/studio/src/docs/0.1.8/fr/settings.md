# Paramètres

General présente les informations de l'application, les fonctions facultatives et les limites d'exécution. La page contient aussi la validation des données et les opérations de maintenance destructives.

View settings permet d'ouvrir General. Edit general settings permet de modifier les limites numériques et la validation. Manage feature flags autorise les interrupteurs facultatifs. Danger zone autorise la maintenance destructive.

Appliquez vos choix opérationnels approuvés. Les captures montrent une installation de test isolée. Les exemples destructifs ont utilisé seulement cette installation jetable, après vérification de la propriété de sa base et de son fournisseur d'identité. Aucune donnée de pratique n'est nécessaire.

Dans Settings, utilisez les pages liées Laboratory, Setup checks, Connectors, Roles, Layouts et Data Exposure. Ce guide couvre General. Consultez [Commencer ici](/docs/start-here) pour configurer la ligne de commande.

## Lire la version et l'état des mises à jour

Utilisez cette tâche pour signaler un problème ou décider de planifier une mise à niveau.

### 1. Ouvrir Settings puis General

Ouvrez votre menu utilisateur en bas à gauche, choisissez **Settings**, puis **General**.

![Ouvrir le menu utilisateur en bas à gauche.](settings-guide-user-menu.png)

![Choisir Settings.](settings-guide-settings-menu.png)

![Choisir General dans Settings.](settings-guide-general-page.png)

### 2. Lire About

Lisez la **Version** active, l'environnement et les services configurés dans About.

![About présente la version active et les services configurés.](settings-guide-about.png)

### 3. Lire Latest

Lisez **Latest** et l'heure de dernière vérification. Utilisez les liens vers les notes de version et la procédure de mise à niveau pour la planifier. Cette page n'installe pas de mise à jour.

![Lire Latest et l'heure de dernière vérification des mises à jour.](settings-guide-update-state.png)

**Résultat attendu :** vous connaissez la version active et le résultat actuel de la vérification du serveur.

## Modifier les vérifications automatiques de mises à jour

Utilisez cette tâche pour décider si le serveur doit rechercher les versions disponibles.

### 1. Modifier Auto update check

Activez ou désactivez **Auto update check** dans About. Le changement s'enregistre immédiatement.

![Auto update check détermine si le serveur recherche les versions disponibles.](settings-guide-update-switch.png)

### 2. Lire l'état obtenu

Quand l'option est désactivée, Latest indique **update check is off**. La réactiver autorise de nouvelles vérifications. Cela ne met pas l'installation à niveau.

![La désactivation apparaît dans Latest. Elle n'installe aucune mise à jour.](settings-guide-update-off.png)

**Résultat attendu :** le choix de vérification est enregistré.

## Activer ou désactiver une fonction facultative

Décidez d'abord quelles fonctions l'installation doit proposer. Lisez la description avant de changer un interrupteur.

### 1. Modifier l'interrupteur de fonction

Dans **Feature Flags**, activez ou désactivez l'option voulue. L'exemple active **Dashboard raw SQL**.

![Activer ou désactiver la fonction facultative. L'exemple active Dashboard raw SQL.](settings-guide-flag.png)

### 2. Vérifier le message d'enregistrement

Le changement s'enregistre immédiatement. Vérifiez le message **Saved**. Ces fonctions n'ont pas de bouton Save séparé.

![Les interrupteurs de fonction enregistrent immédiatement.](settings-guide-flag-saved.png)

**Résultat attendu :** le nouveau choix s'applique immédiatement. L'exemple a rétabli l'état désactivé d'origine après les captures.

## Modifier une limite d'exécution

Utilisez cette tâche pour régler une limite sans redémarrer. Lisez sa description et choisissez une valeur adaptée à votre charge.

### 1. Saisir la valeur

Dans **Limits & tuning**, saisissez le nombre voulu. L'exemple définit **Dashboard SQL row cap** sur `5000`.

![Saisir la limite voulue. L'exemple fixe un plafond de 5000 lignes.](settings-guide-number-value.png)

### 2. Quitter le champ pour enregistrer

Sélectionnez un autre champ ou appuyez sur Tab. Quitter le champ numérique enregistre sa valeur. Le serveur la limite à l'intervalle accepté.

![Quitter le champ numérique enregistre la valeur.](settings-guide-number-saved.png)

### 3. Vérifier la valeur enregistrée

Rouvrez General pour vérifier la persistance. Lisez la valeur conservée par le serveur.

![La limite enregistrée reste présente après réouverture de General.](settings-guide-number-reopened.png)

**Résultat attendu :** la limite numérique reste enregistrée après réouverture de General.

## Modifier la validation des données reçues

Utilisez cette tâche pour changer les données acceptées. Une validation plus stricte peut rejeter des données auparavant acceptées. Une validation plus souple permet davantage de données incomplètes.

### 1. Ouvrir Data validation

Descendez à **Danger Zone** et ouvrez **Data validation**.

![Ouvrir Data validation dans Danger Zone.](settings-guide-validation-menu.png)

### 2. Choisir le niveau

Choisissez Low, Medium ou High selon vos besoins. L'exemple passe de High à **Medium**.

![Choisir le niveau requis. L'exemple passe à Medium.](settings-guide-validation-level.png)

### 3. Lire l'effet

Lisez l'avertissement correspondant au sens du changement.

![Lire l'effet du nouveau niveau sur les données reçues.](settings-guide-validation-warning.png)

### 4. Saisir la phrase de confirmation

Saisissez exactement le niveau en minuscules indiqué. L'exemple saisit `medium`.

![Saisir la phrase en minuscules affichée dans la confirmation.](settings-guide-validation-phrase.png)

### 5. Appliquer le changement

Sélectionnez **Apply**. Choisissez Cancel pour garder le niveau précédent.

![Choisir Apply pour enregistrer le nouveau niveau.](settings-guide-validation-apply.png)

**Résultat attendu :** Data validation affiche le niveau enregistré.

![Data validation affiche maintenant le niveau Medium enregistré.](settings-guide-validation-result.png)

## Rétablir le tableau de bord d'exemple

Utilisez cette action seulement pour supprimer tous les tableaux de bord et rétablir l'exemple intégré. Cette opération est irréversible.

### 1. Ouvrir les points de l'action

Dans Danger Zone, sélectionnez les points près de **Reset dashboards**.

![Ouvrir les points près de Reset dashboards.](settings-guide-reset-dashboards-actions.png)

### 2. Choisir Reset

Sélectionnez **Reset**.

![Choisir Reset.](settings-guide-reset-dashboards-menu.png)

### 3. Lire ce que supprime l'action

Vérifiez le titre et l'avertissement. Annulez si l'action ne correspond pas à votre intention.

![Lire ce que Reset dashboards supprime avant de confirmer.](settings-guide-reset-dashboards-warning.png)

### 4. Saisir la phrase exacte

Saisissez `reset dashboards` exactement comme indiqué.

![Saisir la phrase de confirmation exacte affichée par l'application.](settings-guide-reset-dashboards-phrase.png)

### 5. Confirmer Reset

Sélectionnez **Reset** pour exécuter l'opération. Attendez sa fin.

![Confirmer Reset seulement pour l'opération voulue.](settings-guide-reset-dashboards-confirm.png)

**Résultat attendu :** tous les tableaux de bord sont supprimés et l'exemple intégré est recréé.

![La page signale la fin de Reset dashboards.](settings-guide-reset-dashboards-result.png)

## Effacer les événements d'audit et l'historique des workflows

Utilisez cette action seulement pour supprimer définitivement l'audit et l'historique des workflows. Cette opération est irréversible.

### 1. Ouvrir les points de l'action

Dans Danger Zone, sélectionnez les points près de **Clear audit log**.

![Ouvrir les points près de Clear audit log.](settings-guide-clear-audit-actions.png)

### 2. Choisir Clear

Sélectionnez **Clear**.

![Choisir Clear.](settings-guide-clear-audit-menu.png)

### 3. Lire ce que supprime l'action

Vérifiez le titre et l'avertissement. Annulez si l'action ne correspond pas à votre intention.

![Lire ce que Clear audit log supprime avant de confirmer.](settings-guide-clear-audit-warning.png)

### 4. Saisir la phrase exacte

Saisissez `clear audit` exactement comme indiqué.

![Saisir la phrase de confirmation exacte affichée par l'application.](settings-guide-clear-audit-phrase.png)

### 5. Confirmer Clear

Sélectionnez **Clear** pour exécuter l'opération. Attendez sa fin.

![Confirmer Clear seulement pour l'opération voulue.](settings-guide-clear-audit-confirm.png)

**Résultat attendu :** les anciens événements et l'historique des workflows sont supprimés. L'effacement écrit lui-même un nouvel événement d'audit.

![La page signale la fin de Clear audit log.](settings-guide-clear-audit-result.png)

## Rétablir les valeurs internes d'usine

Utilisez cette action seulement pour vider toutes les données internes et les réinitialiser. Elle supprime formulaires, connecteurs, tableaux de bord, workflows, terminologie, utilisateurs locaux, audit et autres fiches internes. Cette opération est irréversible.

### 1. Ouvrir les points de l'action

Dans Danger Zone, sélectionnez les points près de **Factory reset**.

![Ouvrir les points près de Factory reset.](settings-guide-factory-reset-actions.png)

### 2. Choisir Factory reset

Sélectionnez **Factory reset**.

![Choisir Factory reset.](settings-guide-factory-reset-menu.png)

### 3. Lire ce que supprime l'action

Vérifiez le titre et l'avertissement. Annulez si l'action ne correspond pas à votre intention.

![Lire ce que Factory reset supprime avant de confirmer.](settings-guide-factory-reset-warning.png)

### 4. Saisir la phrase exacte

Saisissez `factory reset` exactement comme indiqué.

![Saisir la phrase de confirmation exacte affichée par l'application.](settings-guide-factory-reset-phrase.png)

### 5. Confirmer Factory reset

Sélectionnez **Factory reset** pour exécuter l'opération. Attendez sa fin.

![Confirmer Factory reset seulement pour l'opération voulue.](settings-guide-factory-reset-confirm.png)

**Résultat attendu :** la base interne est vidée et les valeurs d'usine sont recréées. Les données cibles externes et les comptes du fournisseur d'identité restent hors de cette opération.

![La page signale la fin de Factory reset.](settings-guide-factory-reset-result.png)

## Lire General sur téléphone

Utilisez la même page General sur téléphone. Elle défile verticalement.

### 1. Lire About

Lisez la version et les informations de mise à jour près du haut.

![Lire les informations General sur téléphone.](settings-guide-phone-about.png)

### 2. Descendre jusqu'aux limites

Lisez la description du champ avant de changer une limite numérique.

![Descendre jusqu'aux limites. Les commandes restent dans la largeur du téléphone.](settings-guide-phone-limit.png)

### 3. Lire Danger Zone attentivement

Descendez à l'action et lisez sa description avant d'ouvrir les points.

![Descendre à Danger Zone et lire la description avant d'ouvrir les points.](settings-guide-phone-danger.png)

## Pratique facultative

Utilisez une installation de test jetable. Changez une fonction réversible ou une limite, vérifiez l'enregistrement, puis rétablissez-la. N'essayez pas la maintenance destructive sur les données du personnel.

## Limites

La vérification des mises à jour n'installe pas de version. Les interrupteurs enregistrent immédiatement. Les champs numériques enregistrent à leur sortie. Les actions destructives touchent la base interne et ne peuvent pas être annulées sur cette page.

## Résolution de problèmes

**Une commande manque.** Vérifiez la permission distincte pour les fonctions, la modification générale ou les actions Danger Zone.

**Une valeur change après l'enregistrement.** Le serveur la ramène dans l'intervalle accepté. Lisez la valeur enregistrée.

**Une confirmation reste désactivée.** Saisissez la phrase exacte affichée.

**Latest ne confirme pas une mise à jour.** Lisez l'erreur de dernière vérification et corrigez la connexion sortante du serveur avant de vous fier au résultat.

## Guides associés

Consultez [Vérifications de configuration](/docs/setup-checks) pour la préparation et [Laboratoire](/docs/laboratory) pour le laboratoire émetteur. Consultez [Audit](/docs/audit) pour les actions administratives enregistrées.
