# Laboratoire

Laboratory conserve le nom, l'adresse, les coordonnées et le logo du laboratoire émetteur pour les modèles de rapport. Cette page définit aussi le registre d'établissements par défaut et le fuseau horaire local.

Utilisez les coordonnées réelles et le logo approuvé de votre laboratoire. Les images montrent un laboratoire fictif sur une installation de test. Aucun jeu de données n'est nécessaire. View settings permet d'ouvrir la page. Edit general settings permet d'enregistrer. L'interrupteur d'auto-validation et le tableau Sections exigent Lab settings. Un compte qui n'a que Lab settings peut ouvrir la page. Il ne voit alors que l'interrupteur et les sections, sous le titre **Paramètres du laboratoire**.

Le laboratoire émetteur produit les rapports. Les établissements envoient les demandes. Choisir un registre par défaut ici ne crée ni n'importe d'établissements.

## Enregistrer les coordonnées du laboratoire

Effectuez cette tâche après l'installation ou lorsque les coordonnées du laboratoire émetteur changent.

### 1. Ouvrir Settings puis Laboratory

Ouvrez votre menu utilisateur en bas à gauche, choisissez **Settings**, puis **Laboratory**.

![Ouvrez votre menu utilisateur en bas à gauche.](laboratory-guide-user-menu.png)

![Choisissez Settings.](laboratory-guide-settings-menu.png)

![Sélectionnez Laboratory dans Settings.](laboratory-guide-laboratory-page.png)

### 2. Saisir le nom du laboratoire

Saisissez le nom du laboratoire émetteur dans **Laboratory name**. L'exemple utilise `Documentation laboratory`.

![Saisissez le nom du laboratoire émetteur.](laboratory-guide-name.png)

### 3. Saisir l'adresse

Saisissez l'adresse à imprimer sur l'en-tête dans **Address**. Elle peut comporter plusieurs lignes.

![Saisissez l'adresse que vos modèles de rapport doivent imprimer.](laboratory-guide-address.png)

### 4. Saisir les coordonnées

Saisissez les coordonnées approuvées dans **Contact**. L'image utilise une adresse électronique example.invalid.

![Saisissez les coordonnées du laboratoire émetteur.](laboratory-guide-contact.png)

### 5. Choisir le registre d'établissements

Dans **Facility register**, sélectionnez une source déjà enregistrée. Si elle manque, enregistrez-la d'abord dans Facilities. Ce choix fournit le registre par défaut du formulaire Facility.

![Choisissez un registre existant. Enregistrez la source dans Facilities si elle manque.](laboratory-guide-register.png)

### 6. Définir le fuseau horaire si nécessaire

Pour PostgreSQL ou MySQL, saisissez un fuseau nommé comme `Africa/Dar_es_Salaam`. Lisez l'aide sous le champ. SQL Server exige plutôt un nom de fuseau Windows à chaque exécution de rapport. Laissez donc ce réglage vide avec SQL Server.

![Saisissez un fuseau nommé pour PostgreSQL ou MySQL. Lisez l'exception SQL Server sous le champ.](laboratory-guide-timezone.png)

### 7. Enregistrer les coordonnées

Ouvrez le menu à points de la page en haut à droite et sélectionnez **Save**.

![Ouvrez le menu à points de Laboratory.](laboratory-guide-page-actions.png)

![Choisissez Save pour conserver les paramètres du laboratoire.](laboratory-guide-save-identity.png)

**Résultat attendu :** les coordonnées enregistrées restent présentes lorsque vous rouvrez Laboratory.

![L'identité enregistrée du laboratoire reste présente après réouverture de la page.](laboratory-guide-identity-result.png)

## Retirer un ancien logo

Effectuez cette tâche lorsque le logo actuel ne doit plus apparaître dans les modèles utilisant le logo du laboratoire.

### 1. Effacer le logo du brouillon

Sélectionnez **Clear** à côté de Logo. Seul le brouillon change.

![Clear retire le logo actuel du brouillon.](laboratory-guide-clear-logo.png)

### 2. Enregistrer le retrait

Ouvrez le menu à points de la page et sélectionnez **Save**.

![Choisissez Save pour conserver les paramètres du laboratoire.](laboratory-guide-save-clear-logo.png)

**Résultat attendu :** les paramètres enregistrés du laboratoire ne contiennent plus de logo.

## Importer le logo du laboratoire

Utilisez un fichier PNG ou JPEG de 256 Ko maximum. Un PNG transparent convient à un logo d'en-tête.

### 1. Choisir l'image

Sélectionnez **Choose file…** à côté de Logo, puis votre image locale approuvée.

![Choose file ouvre la sélection d'un fichier image.](laboratory-guide-choose-logo.png)

### 2. Vérifier l'aperçu

Vérifiez que l'image attendue apparaît à côté de Logo. L'image reprend le symbole fourni avec l'installation de test.

![Le PNG choisi apparaît dans l'aperçu avant l'enregistrement.](laboratory-guide-logo-preview.png)

### 3. Enregistrer le logo

Ouvrez le menu à points de la page et sélectionnez **Save**.

![Choisissez Save pour conserver les paramètres du laboratoire.](laboratory-guide-save-logo.png)

**Résultat attendu :** le logo reste présent après réouverture de Laboratory. Un modèle doit utiliser les variables du laboratoire pour afficher ces valeurs.

![Le logo enregistré reste présent après réouverture de Laboratory.](laboratory-guide-logo-result.png)

## Modifier les coordonnées sur un téléphone

Utilisez les mêmes champs sur un téléphone. La page défile verticalement.

### 1. Modifier les champs d'identité

Saisissez le nom du laboratoire et les autres champs dans le formulaire adapté au téléphone.

![Les champs de Laboratory tiennent dans la largeur du téléphone.](laboratory-guide-phone-name.png)

### 2. Faire défiler jusqu'à Logo

Descendez jusqu'à l'aperçu du logo et à Choose file. Enregistrez par le menu à points de la page.

![Descendez jusqu'à Logo. L'aperçu et les commandes restent disponibles.](laboratory-guide-phone-logo.png)

## Autoriser une personne à valider ses propres résultats

Par défaut, la personne qui a saisi un résultat ne peut pas le valider. Activez ce réglage seulement si votre laboratoire permet à une personne de faire les deux. Il faut Lab settings. La vérification des résultats ne fait pas partie de cette version, donc l'interrupteur n'a encore aucun effet. Il est enregistré pour l'arrivée de la vérification.

### 1. Trouver l'interrupteur

Ouvrez **Paramètres**, puis **Laboratoire**. Trouvez **Autoriser une personne à valider les résultats qu'elle a saisis**.

### 2. L'activer ou le désactiver

Sélectionnez l'interrupteur. Il s'enregistre dès que vous le changez. Il n'y a pas d'étape d'enregistrement à part.

**Résultat attendu :** un message indique **Enregistré.** L'interrupteur garde sa position quand vous rouvrez Laboratoire.

## Ajouter une section

Une section est une partie du laboratoire, comme l'hématologie. Un examen peut être classé dans une section. Il faut Lab settings.

### 1. Choisir Ajouter une section

Ouvrez les points de la page en haut à droite et sélectionnez **Ajouter une section**.

### 2. Saisir le code et le nom

Saisissez le code dans **Code**, par exemple `haem`. Utilisez des lettres minuscules, des chiffres et des tirets, en commençant par une lettre. Le code ne peut plus changer ensuite. Saisissez le nom dans **Nom**, par exemple `Hématologie`.

### 3. Enregistrer la section

Ouvrez les points du panneau et sélectionnez **Enregistrer**.

**Résultat attendu :** un message indique **Section haem ajoutée.** La section figure sous **Sections** et apparaît tout de suite dans le catalogue des examens.

## Supprimer une section

### 1. Choisir Supprimer

Ouvrez les points de la ligne de la section et sélectionnez **Supprimer**.

### 2. Confirmer

Lisez la demande de confirmation et sélectionnez **Supprimer**.

**Résultat attendu :** un message indique que la section est supprimée. Cette action est définitive. OpenLDR refuse de supprimer une section encore utilisée par un examen, et le message indique combien d'examens l'utilisent.

[Configuration du laboratoire](/docs/lab-setup) montre la place des sections et de l'interrupteur dans la configuration du laboratoire, avec les commandes `openldr lab` correspondantes.

## Utiliser les coordonnées dans les modèles de rapport

Les modèles peuvent utiliser `{{lab.name}}`, `{{lab.address}}`, `{{lab.contact}}` et `{{lab.logo}}`. La page affiche ces noms sous sa description. Placez-les dans un modèle avec Report Designer. Enregistrer Laboratory ne modifie aucun modèle.

## Exercice facultatif

Sur une installation de test, enregistrez un nom de laboratoire fictif et une adresse example.invalid. Utilisez un PNG ou JPEG de test approuvé pour l'importation. Rétablissez ensuite les paramètres souhaités.

## Limites

Le logo accepte les formats PNG et JPEG, jusqu'à 256 Ko. SVG, WebP et les adresses web d'images ne sont pas acceptés. Le sélecteur de registre liste les sources existantes. Il ne peut pas en enregistrer une.

## Résolution des problèmes

**La liste des registres est vide.** Ouvrez Facilities et enregistrez la source avant de revenir ici.

**Le fuseau horaire est refusé.** Utilisez un fuseau nommé, sans décalage fixe. Suivez l'exception SQL Server indiquée sous le champ.

**Le logo est refusé.** Vérifiez son format et sa taille. Choisissez un PNG ou JPEG de 256 Ko maximum.

**Un rapport n'affiche pas les coordonnées enregistrées.** Vérifiez que son modèle utilise les variables du laboratoire.

**Ajouter une section manque.** Votre compte n'a pas Lab settings.

**Une section n'est pas supprimée.** Un examen l'utilise encore. Déplacez d'abord ces examens vers une autre section dans le catalogue des examens.

## Guides associés

Lisez [Établissements](/docs/facilities) pour enregistrer une source. Lisez [Vérifications de configuration](/docs/setup-checks) pour contrôler la préparation. Lisez [Commencer ici](/docs/start-here) pour la configuration en ligne de commande. Lisez [Configuration du laboratoire](/docs/lab-setup) pour préparer le module laboratoire.
