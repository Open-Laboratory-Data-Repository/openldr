# Formulaires

Forms permet au personnel de saisir des données dans des formulaires publiés. Les auteurs utilisent le créateur pour choisir les champs, prévisualiser et publier les versions.

Utilisez vos patients, les tests activés du catalogue et un formulaire approuvé. Les images montrent des dossiers fictifs et Example request form dans une installation de test isolée. Aucun fichier d'exemple documentaire n'est requis.

Use forms permet de lire les définitions. Submit forms permet la saisie. Edit forms permet de modifier le modèle et Publish forms de le publier. Pour écrire des données, le formulaire doit aussi avoir une configuration d'envoi valide et un workflow activé pour les données entrantes.

Les formulaires Draft et Archived s'ouvrent encore avec View/Run. Submit reste désactivé jusqu'à l'état Published. Preview dans le créateur permet d'essayer le modèle sans enregistrer de réponse.

Les numéros de version des images sont des exemples. Chaque publication enregistre un instantané et prend le numéro suivant. Vos numéros dépendent de votre historique. Lisez [Commencer ici](/docs/start-here) pour l'installation et la CLI.

## Choisir le patient, le test et le prélèvement d'une demande

Utilisez cette tâche pour enregistrer une demande voulue dans votre formulaire publié Lab order. Choisissez le patient et les tests adaptés à cette demande.

### 1. Ouvrir Forms

Sélectionnez **Forms** dans le menu principal.

![Forms se trouve dans le menu principal à gauche.](forms-guide-open-page.png)

### 2. Ouvrir Lab order

Ouvrez les points de la ligne **Lab order** et sélectionnez **View/Run**.

![Utilisez les points de la ligne Lab order pour ouvrir sa page de saisie.](forms-guide-order-row-actions.png)

![View/Run ouvre le formulaire publié pour la saisie.](forms-guide-order-run.png)

### 3. Rechercher le patient

Dans **Patient**, recherchez le nom ou l'identifiant du patient.

![Recherchez votre patient réel par nom ou identifiant.](forms-guide-order-patient-search.png)

### 4. Sélectionner le patient

Vérifiez le dossier correspondant et sélectionnez le bon patient.

![Sélectionnez le bon patient dans les résultats.](forms-guide-order-patient-choice.png)

### 5. Rechercher le test

Dans **Tests**, recherchez le test demandé dans le catalogue. La liste utilise les tests activés pour ce laboratoire.

![Tests liste les tests du catalogue activés pour ce laboratoire.](forms-guide-order-test-search.png)

### 6. Choisir le test

Sélectionnez le test demandé. Répétez seulement si la demande nécessite un autre test.

![Choisissez le test du catalogue demandé pour ce patient.](forms-guide-order-test-choice.png)

### 7. Ouvrir ses détails

Dans **Results**, sélectionnez la ligne du test choisi pour ouvrir ses détails.

![Ouvrez la ligne du test dans Results pour compléter le prélèvement et les détails du résultat.](forms-guide-order-test-details.png)

### 8. Choisir le prélèvement

Sélectionnez le type de prélèvement enregistré pour ce test dans votre liste configurée.

![Sélectionnez le type de prélèvement utilisé pour ce test.](forms-guide-order-specimen.png)

**Résultat attendu :** les détails du test contiennent le prélèvement choisi. La demande n'est pas encore envoyée.

## Vérifier et envoyer la demande de laboratoire

Continuez après avoir choisi le patient, les tests et les détails de prélèvement. Complétez les autres champs obligatoires avant l'envoi.

### 1. Fermer les détails du test

Sélectionnez **Close** en haut à droite du panneau des détails.

![Close revient à la demande avec le prélèvement choisi.](forms-guide-order-details-close.png)

### 2. Choisir la priorité

Choisissez la **Priority** enregistrée. L'image utilise **Routine**.

![Choisissez la priorité de cette demande. L'exemple utilise Routine.](forms-guide-order-priority.png)

### 3. Vérifier la demande et ouvrir ses actions

Vérifiez le patient, les tests et les prélèvements, puis ouvrez les points en haut à droite.

![Vérifiez la demande, puis ouvrez son menu de points.](forms-guide-order-submit-actions.png)

### 4. Envoyer la demande voulue

Sélectionnez **Submit** une seule fois. Attendez le résultat. Ne renvoyez pas simplement pour confirmer la réussite.

![Submit écrit une réponse de formulaire. Utilisez-le une fois pour cette demande voulue.](forms-guide-order-submit.png)

**Résultat attendu :** **Response captured.** confirme la réponse enregistrée. Les réponses restent affichées. Un autre Submit est une autre écriture. Utilisez-le uniquement pour un envoi voulu.

![Response captured confirme la réponse envoyée. Ne renvoyez que pour une autre demande voulue.](forms-guide-order-result.png)

## Saisir un formulaire pour votre propre site

Faites-le quand votre compte est limité à un site ou à quelques sites. Un administrateur fixe cette limite dans [Utilisateurs](/docs/users).

1. Sélectionnez **Formulaires** dans le menu principal.
2. Ouvrez les points de la ligne du formulaire et sélectionnez **View/Run**.
3. Vérifiez le champ de l'établissement. Si votre limite couvre un seul établissement, il est déjà rempli et vous ne pouvez pas le changer.
4. Si votre limite couvre plusieurs établissements, ouvrez le champ de l'établissement et choisissez-en un.
5. Remplissez les autres champs.
6. Ouvrez le menu de points en haut à droite et sélectionnez **Submit**.

**Résultat attendu :** **Response captured.** s'affiche, et la saisie apparaît sous **Saisies**.

Le serveur vérifie de nouveau l'établissement à l'envoi. Un formulaire n'est jamais enregistré pour un établissement hors de votre limite.

## Voir les saisies d'un formulaire

Chaque envoi d'un formulaire crée une saisie. L'onglet **Saisies** les liste, de la plus récente à la plus ancienne. Il vous faut **Utiliser les formulaires**, et vous devez avoir le droit d'ouvrir le formulaire.

1. Sélectionnez **Formulaires** dans le menu principal.
2. Ouvrez les points de la ligne du formulaire et sélectionnez **View/Run**.
3. Sélectionnez l'onglet **Saisies**, à côté de **Nouvelle saisie**.
4. Tapez le début d'un numéro de demande dans **Rechercher un numéro de demande**.
5. Ouvrez la liste qui affiche **Tous les statuts** et choisissez **Active**, **Pas entièrement enregistrée** ou **Saisie par erreur**.
6. Ouvrez la liste qui affiche **Tout le monde** et choisissez la personne qui a fait la saisie.
7. Sélectionnez la ligne de la saisie.

**Résultat attendu :** un panneau s'ouvre avec toutes les réponses de la saisie, en lecture seule, ainsi que l'auteur et la date de la saisie.

Les colonnes sont **Demande**, **Résumé**, **Saisie le** et **Par**. Sur un téléphone, **Par** est masquée. **Tout le monde** propose seulement les personnes dont vous avez déjà vu des saisies pendant cette visite.

Si votre compte n'a pas de limite de données, vous voyez toutes les saisies du formulaire. Si vous êtes limité à un site, vous voyez les saisies des établissements de votre limite, et les saisies que vous avez faites vous-même. Une saisie sur un formulaire sans champ d'établissement est visible par la personne qui l'a faite et par les utilisateurs sans limite.

## Corriger un numéro de demande répété

Un numéro de demande ne sert qu'une fois par formulaire et par établissement. Si vous envoyez un numéro déjà utilisé, rien n'est enregistré. Un message comme celui-ci s'affiche sous le champ du numéro de demande :

`CS-0001 was already entered on 22 Nov 2026 at 13:50 by aisha.`

1. Sélectionnez **Voir cette saisie** à la fin du message.
2. Comparez cette saisie avec la demande que vous avez sous les yeux.
3. S'il s'agit de la même demande, fermez le panneau et arrêtez-vous. Elle est déjà enregistrée.
4. Si vous avez mal tapé le numéro, corrigez-le dans le champ du numéro de demande.
5. Ouvrez le menu de points en haut à droite et sélectionnez **Submit**.

**Résultat attendu :** **Response captured.** s'affiche. Le message disparaît dès que vous changez le numéro.

Vos réponses restent à l'écran après le refus, vous n'avez donc pas à les retaper. Si c'est l'ancienne saisie qui est fausse, demandez à une personne autorisée de la marquer comme saisie par erreur. Son numéro redevient libre, et vous pouvez envoyer la vôtre. Le serveur écrit ce message en anglais. L'heure suit le fuseau horaire du laboratoire s'il est défini, sinon UTC.

Deux formulaires peuvent utiliser le même numéro, deux établissements aussi. Un formulaire sans champ de numéro de demande n'a pas de contrôle des répétitions.

## Marquer une saisie comme saisie par erreur

Faites-le quand une saisie n'aurait pas dû être enregistrée, par exemple un mauvais patient ou une demande saisie deux fois. Il vous faut **Marquer des saisies comme erronées**. Les rôles Administrator et Lab Manager l'ont.

1. Ouvrez l'onglet **Saisies** du formulaire.
2. Trouvez la saisie avec **Rechercher un numéro de demande**.
3. Ouvrez les points de la ligne de la saisie et sélectionnez **Marquer comme saisie par erreur**.
4. Tapez dans **Motif** pourquoi la saisie est fausse.
5. Sélectionnez **Marquer comme saisie par erreur**.

**Résultat attendu :** un message indique `<numéro> est marquée comme saisie par erreur.` La ligne reste dans la liste, barrée, avec **Saisie par erreur** sous son résumé.

Cette action est irréversible. La saisie reste enregistrée, et son panneau affiche **Marquée par**, **Marquée le** et **Motif**. La demande, les échantillons et les résultats que la saisie a enregistrés sont aussi marqués. Son numéro de demande peut être réutilisé. Le motif est obligatoire et compte au plus 500 caractères. Chaque marquage est inscrit dans **Audit**.

Aujourd'hui, une demande marquée compte encore dans les rapports et les tableaux de bord. Aucun rapport ne l'écarte pour l'instant.

## Choisir les réponses affichées dans la liste des saisies

La colonne **Résumé** affiche jusqu'à trois réponses de chaque saisie. Si aucun champ n'est choisi, elle affiche les trois premiers champs remplis de premier niveau, sans le numéro de demande. Un champ placé dans un groupe n'y apparaît jamais.

1. Ouvrez le formulaire dans le générateur.
2. Sélectionnez la commande de modification du champ.
3. Activez **Afficher dans la liste des saisies**.
4. Ouvrez les points de l'éditeur de champ et sélectionnez **Enregistrer**.
5. Recommencez pour chaque champ voulu. Vous pouvez en choisir autant que vous voulez, mais la liste affiche les trois premiers qui ont une réponse.
6. Ouvrez les points du générateur et sélectionnez **Enregistrer le brouillon**, puis **Publier**.

**Résultat attendu :** les nouvelles saisies affichent les réponses choisies sous **Résumé**. Les saisies plus anciennes gardent leur résumé.

## Commencer un formulaire de demande

Utilisez cette tâche si un formulaire existant ne recueille pas les informations nécessaires au workflow. Le créateur choisit une version du format de données de santé FHIR et un type de ressource.

### 1. Choisir New

Dans Forms, ouvrez les points en haut à droite et sélectionnez **New**.

![Le menu de points de Forms contient New.](forms-guide-page-actions.png)

![New ouvre Form Builder.](forms-guide-new-menu.png)

### 2. Nommer le formulaire

Saisissez un nom décrivant sa tâche. L'exemple utilise `Example request form`.

![Nommez le formulaire selon la tâche qu'il doit servir.](forms-guide-builder-name.png)

### 3. Choisir la version FHIR

Ouvrez **FHIR Version** et choisissez la version requise par vos dossiers. L'exemple sélectionne **R4 (most common)**.

![Choisissez la version FHIR des ressources cibles. Cet exemple utilise R4.](forms-guide-builder-fhir-version.png)

### 4. Choisir le type de ressource

Ouvrez **Resource Type**, trouvez **ServiceRequest** et sélectionnez-le pour cet exemple de demande.

![Sélectionnez ServiceRequest pour construire un formulaire de demande.](forms-guide-builder-resource.png)

**Résultat attendu :** le pack de départ disponible s'ouvre pour choisir ses champs.

## Choisir les champs du pack et enregistrer un brouillon

Conservez les champs nécessaires dans le pack de départ. Cet exemple garde Patient, Tests, Results, Priority et Reference Number. Votre workflow peut en nécessiter davantage.

### 1. Décocher Requesting Clinician pour cet exemple

Décochez **Requesting Clinician** lorsque ce formulaire d'exemple ne le recueille pas.

![Décochez Requesting Clinician si le formulaire d'exemple n'en a pas besoin.](forms-guide-pack-clinician.png)

### 2. Décocher Clinical Notes pour cet exemple

Décochez **Clinical Notes**. Conservez-le dans votre formulaire si votre workflow en a besoin.

![Décochez Clinical Notes si le formulaire d'exemple n'en a pas besoin.](forms-guide-pack-notes.png)

### 3. Décocher Referring Facility pour cet exemple

Décochez **Referring Facility** pour l'exemple à cinq champs.

![Décochez Referring Facility si le formulaire d'exemple n'en a pas besoin.](forms-guide-pack-facility.png)

### 4. Décocher Order rejection pour cet exemple

Décochez **Order rejection** pour cet exemple.

![Décochez Order rejection si le formulaire d'exemple n'en a pas besoin.](forms-guide-pack-rejection.png)

### 5. Vérifier la sélection restante

Vérifiez que **Patient**, **Tests**, **Results**, **Priority** et **Reference Number** restent cochés. Le pack illustré indique **5 of 9 selected**.

![Gardez les champs nécessaires. Cet exemple conserve Patient, Tests, Results, Priority et Reference Number.](forms-guide-pack-choices.png)

![Cinq champs restent sélectionnés pour cet exemple.](forms-guide-pack-selected-count.png)

### 6. Ajouter les champs

Ouvrez les points du pack et sélectionnez **Add 5 fields**.

![Le pack de départ possède son propre menu de points.](forms-guide-pack-actions.png)

![Ajoutez les cinq champs choisis à ce nouveau formulaire.](forms-guide-pack-add.png)

### 7. Enregistrer le brouillon

Ouvrez les points du créateur en haut à droite et sélectionnez **Save draft**.

![Ouvrez Builder actions pour prévisualiser et enregistrer.](forms-guide-builder-actions-step-7.png)

![Save draft conserve le modèle actuel sans le publier.](forms-guide-draft-save.png)

**Résultat attendu :** la définition est enregistrée en Draft. Enregistrer le modèle n'envoie aucune réponse et ne le publie pas.

![Le créateur liste les champs ajoutés depuis le pack.](forms-guide-builder-fields.png)

## Modifier le texte du champ de référence

Utilisez cette tâche pour employer les mots reconnus par le personnel. L'exemple remplace Reference Number par Requisition reference.

### 1. Ouvrir l'éditeur de champ

Sélectionnez Edit du champ **Reference Number** dans le créateur.

![Ouvrez Reference Number pour modifier son libellé.](forms-guide-field-open.png)

### 2. Modifier Display Label

Dans **Display Label**, saisissez `Requisition reference`.

![Display Label change le texte visible pour la personne qui saisit.](forms-guide-field-label.png)

### 3. Saisir une indication

Dans **Placeholder**, saisissez `Enter the requisition number`. Cette indication apparaît dans le champ vide.

![Placeholder donne une courte indication dans un champ vide.](forms-guide-field-placeholder.png)

### 4. Vérifier Required

Gardez **Required** désactivé si la réponse est facultative. Activez-le seulement si votre workflow exige une réponse.

![Required rend la réponse obligatoire. Laissez-le désactivé pour un champ facultatif.](forms-guide-field-required.png)

### 5. Vérifier Enabled

Gardez **Enabled** activé pour afficher le champ et recueillir une réponse.

![Enabled contrôle l'affichage du champ et la saisie d'une réponse.](forms-guide-field-enabled.png)

### 6. Appliquer la modification du champ

Ouvrez les points de l'éditeur de champ et sélectionnez **Save**. La modification s'applique au modèle actuel du créateur.

![Field actions contient Save et Cancel.](forms-guide-field-actions.png)

![Save applique les modifications du champ au modèle actuel.](forms-guide-field-save.png)

**Résultat attendu :** la liste affiche Requisition reference. Utilisez Save draft ou Publish du créateur pour enregistrer le formulaire modifié.

![La liste des champs utilise le nouveau libellé.](forms-guide-field-updated.png)

## Essayer le modèle sans enregistrer de réponse

Utilisez Preview pour inspecter le modèle actuel avant publication. Ses réponses d'exemple ne deviennent pas des réponses envoyées.

### 1. Ouvrir Preview

Ouvrez les points du créateur et sélectionnez **Preview**.

![Ouvrez Builder actions pour prévisualiser et enregistrer.](forms-guide-builder-actions-step-1.png)

![Preview ouvre le modèle actuel sans envoyer de données.](forms-guide-preview-menu.png)

### 2. Ouvrir Preview actions

Sélectionnez les points dans l'en-tête du panneau Preview.

![Preview actions contient Fill example et Reset.](forms-guide-preview-actions.png)

### 3. Remplir les réponses d'exemple

Sélectionnez **Fill example**.

![Fill example fournit des réponses de démonstration sans enregistrer de réponse.](forms-guide-preview-fill.png)

### 4. Lire l'aperçu

Vérifiez le texte, les champs et les réponses d'exemple. L'exemple montre le champ Requisition reference.

![Preview montre le formulaire avec des réponses d'exemple.](forms-guide-preview-filled.png)

### 5. Effacer les réponses d'exemple

Ouvrez à nouveau Preview actions et sélectionnez **Reset**.

![Reset efface les réponses de démonstration.](forms-guide-preview-reset.png)

### 6. Fermer Preview

Sélectionnez **Close** en haut à droite pour revenir au créateur.

![Close revient au créateur.](forms-guide-preview-close.png)

**Résultat attendu :** vous retrouvez le même modèle. Fill example et Reset n'ont envoyé aucune réponse ni enregistré la définition.

## Enregistrer et publier le modèle vérifié

Utilisez cette tâche quand le modèle est prêt. Publier conserve le modèle actuel et crée un instantané numéroté.

### 1. Enregistrer le brouillon modifié

Ouvrez les points du créateur et sélectionnez **Save draft**.

![Save draft conserve le modèle modifié sans le publier.](forms-guide-draft-save-edited.png)

### 2. Publier le modèle

Ouvrez à nouveau les points du créateur et sélectionnez **Publish**.

![Publish enregistre le modèle et crée une version publiée.](forms-guide-publish-menu.png)

### 3. Lire la version publiée

Vérifiez l'état publié et le numéro d'instantané généré dans l'en-tête. Ce numéro n'est pas saisissable.

![L'en-tête affiche l'état publié et le numéro de version.](forms-guide-published-version.png)

**Résultat attendu :** la liste Forms indique Published. L'envoi exige encore des réponses valides et un workflow de saisie configuré.

![Le nouveau formulaire apparaît en Published dans la liste.](forms-guide-published-row.png)

## Comparer une indication modifiée à une version publiée

Utilisez cette tâche avant de publier une modification ultérieure. L'exemple change seulement l'indication du champ de référence. Son libellé correspond déjà à la version publiée.

### 1. Modifier l'indication

Ouvrez l'éditeur Requisition reference. Remplacez **Placeholder** par `Enter the reference from the paper form`, puis utilisez les points du champ pour Save.

![Faites la modification à comparer. L'exemple change l'indication du champ.](forms-guide-version-draft-change.png)

### 2. Ouvrir Compare

Ouvrez les points du créateur et sélectionnez **Compare**.

![Compare lit les différences entre versions et brouillon actuel.](forms-guide-compare-menu.png)

### 3. Choisir la version de gauche

Ouvrez le sélecteur gauche et choisissez l'instantané publié à comparer. L'exemple sélectionne **v1**.

![Choisissez la version publiée du côté From.](forms-guide-compare-from.png)

![Sélectionnez la version de référence pour la comparaison.](forms-guide-compare-from-version.png)

### 4. Vérifier la version de droite

Gardez **Current draft** dans le sélecteur droit pour comparer le modèle actuel du créateur. Vous pouvez aussi choisir une autre version publiée.

![Le côté To peut être Current draft ou une autre version publiée.](forms-guide-compare-to.png)

### 5. Lire la différence signalée

L'exemple indique une propriété de champ modifiée, **Field reference-number · placeholder**. Il ne signale aucun changement de libellé.

![Lisez les différences avant de décider de publier ou restaurer.](forms-guide-compare-result.png)

### 6. Fermer Compare avec Escape

Appuyez sur Escape pour revenir au créateur. Fermer Compare n'enregistre ni ne publie le modèle modifié.

![Escape revient au créateur sans modifier une version enregistrée.](forms-guide-compare-close.png)

**Résultat attendu :** vous avez vérifié la différence en conservant la modification actuelle du créateur.

## Enregistrer et publier une modification ultérieure

Utilisez cette tâche après comparaison avec une version publiée.

### 1. Enregistrer le brouillon modifié

Ouvrez les points du créateur et sélectionnez **Save draft**.

![Enregistrez la modification vérifiée en brouillon avant publication.](forms-guide-changed-save-draft.png)

### 2. Vérifier l'état Draft

Si le contenu enregistré diffère du contenu publié, le formulaire devient **Draft**. View/Run l'ouvre encore, mais Submit reste désactivé jusqu'à publication.

![Modifier le contenu publié enregistré remet le formulaire en Draft.](forms-guide-changed-draft-status.png)

### 3. Publier la modification vérifiée

Ouvrez les points du créateur et sélectionnez **Publish** lorsque la modification est prête.

![Publiez le brouillon modifié vérifié pour créer la version suivante.](forms-guide-changed-publish.png)

**Résultat attendu :** le formulaire devient Published avec le numéro suivant. Un enregistrement sans changement ne remet pas à lui seul un formulaire Published en Draft.

## Restaurer le contenu d'un instantané publié

Utilisez cette tâche si un ancien modèle publié contient le contenu voulu. La restauration remplace le formulaire modifiable par cet instantané.

### 1. Ouvrir Versions

Ouvrez les points du créateur et sélectionnez **Versions**.

![Versions ouvre les instantanés publiés, les plus récents en premier.](forms-guide-versions-menu.png)

### 2. Trouver l'instantané

Lisez son numéro, son libellé et sa date de publication. Les versions récentes sont en premier. La liste possède une pagination si nécessaire.

![Lisez le numéro de version, le libellé et la date de publication.](forms-guide-versions-list.png)

### 3. Ouvrir les actions de version

Sélectionnez les points de l'instantané à restaurer. L'image utilise la version 1.

![Chaque version publiée a son propre menu de points.](forms-guide-version-row-actions.png)

### 4. Choisir Restore

Sélectionnez **Restore**.

![Restore remplace le formulaire modifiable par l'instantané choisi.](forms-guide-restore-menu.png)

### 5. Confirmer l'instantané

Lisez la confirmation et sélectionnez **Restore** pour remplacer le modèle actuel. Cancel le conserve.

![Vérifiez la version choisie. Restaurer un contenu différent remet en Draft et désactive l'envoi jusqu'à publication.](forms-guide-restore-confirm.png)

### 6. Vérifier l'état résultant

La restauration illustrée modifie le contenu publié. Le formulaire devient donc **Draft**. Restaurer un contenu identique peut laisser un formulaire Published en Published.

![Le formulaire restauré est Draft. Ne le republiez qu'après vérification.](forms-guide-restore-result.png)

**Résultat attendu :** le créateur contient le contenu restauré. Un Draft restauré reste visible avec View/Run, avec Submit désactivé jusqu'à publication.

## Publier le contenu restauré vérifié

Utilisez cette tâche après avoir vérifié que le Draft restauré est bien le modèle destiné au personnel.

### 1. Publier le formulaire restauré

Ouvrez les points du créateur et sélectionnez **Publish**.

![Publish rend à nouveau disponible le formulaire restauré vérifié.](forms-guide-republish-menu.png)

### 2. Vérifier le nouveau numéro d'instantané

Lisez la version publiée dans l'en-tête. Republier crée l'instantané suivant sans réutiliser le numéro restauré.

![Le formulaire restauré vérifié est republié avec le numéro suivant.](forms-guide-republished-version.png)

**Résultat attendu :** le modèle restauré est de nouveau Published. L'installation d'exemple a les instantanés 1 à 4. Ces numéros sont illustratifs.

## Choisir qui peut ouvrir et soumettre un formulaire

Faites-le quand seuls certains rôles doivent utiliser un formulaire, par exemple un formulaire de suivi des échantillons pour une équipe.

### 1. Ouvrir les actions du constructeur

Ouvrez le formulaire dans le constructeur, puis ouvrez le menu à points en haut à droite.

### 2. Choisir Accès

Sélectionnez **Accès**. Le panneau **Qui peut utiliser ce formulaire** s’ouvre.

### 3. Ajouter les rôles qui peuvent l’ouvrir

Sous **Qui peut ouvrir**, sélectionnez **Ajouter un rôle** et choisissez un rôle. Répétez pour chaque rôle.

### 4. Ajouter les rôles qui peuvent le soumettre

Sous **Qui peut soumettre**, sélectionnez **Ajouter un rôle** et choisissez un rôle. Répétez pour chaque rôle.

### 5. Enregistrer

Ouvrez le menu à points de la ligne **Rôles** et sélectionnez **Enregistrer**.

**Résultat attendu :** **Accès enregistré** s’affiche. Les personnes sans aucun des rôles listés ne voient plus le formulaire dans Formulaires. Une liste vide affiche **Tous ceux qui ont la permission**.

## Exporter la définition du formulaire

Utilisez cette tâche pour obtenir un fichier JSON FHIR Questionnaire. Cet export contient la définition, pas les réponses envoyées.

### 1. Ouvrir les actions de la ligne du formulaire

Revenez dans Forms et ouvrez les points du formulaire à exporter.

![Le menu de ligne contient les actions de cycle de vie et d'export.](forms-guide-list-actions.png)

### 2. Choisir Export

Sélectionnez **Export**. Le navigateur télécharge le fichier JSON Questionnaire.

![Export télécharge le formulaire en fichier JSON Questionnaire.](forms-guide-export-menu.png)

**Résultat attendu :** le fichier contient la définition du formulaire. Export ne l'envoie ni ne le modifie.

## Importer un formulaire depuis un fichier

Utilisez cette tâche pour ajouter un formulaire depuis un fichier `.form.json`. L'import ajoute un nouveau formulaire. Il n'en remplace jamais un.

### 1. Ouvrir le menu de la page

Dans Forms, ouvrez les points au bout de la barre d'outils, à droite.

### 2. Choisir Importer

Sélectionnez **Importer**. Le sélecteur de fichiers s'ouvre.

### 3. Choisir le fichier

Choisissez le fichier `.form.json`.

Des exemples à importer se trouvent dans [examples/forms](https://github.com/Open-Laboratory-Data-Repository/openldr/tree/v{{version}}/examples/forms).

**Résultat attendu :** le nom du formulaire apparaît, suivi de **importé**. Le formulaire est listé en **Brouillon**. Publiez-le quand il est prêt.

## Créer un brouillon distinct et vérifier son état d'envoi

Utilisez Duplicate pour adapter un formulaire existant tout en conservant sa définition d'origine.

### 1. Choisir Duplicate

Dans les points du formulaire d'origine, sélectionnez **Duplicate**.

![Duplicate crée un brouillon distinct pour adapter un formulaire existant.](forms-guide-duplicate-menu.png)

### 2. Vérifier la copie distincte

Trouvez la nouvelle copie dans Forms. Elle commence en **Draft**. L'original reste présent.

![Duplicate crée un Draft distinct en conservant l'original.](forms-guide-duplicate-result.png)

### 3. Ouvrir View/Run sur le Draft

Ouvrez les points de la copie et sélectionnez **View/Run**. La page avertit que l'envoi est désactivé jusqu'à publication.

![Un Draft peut être ouvert pour consultation, mais l'envoi reste désactivé jusqu'à publication.](forms-guide-draft-run-warning.png)

### 4. Vérifier Submit

Ouvrez les points de la page. **Submit** est désactivé sur ce formulaire non publié.

![Submit est désactivé sur ce formulaire non publié.](forms-guide-draft-submit-disabled.png)

**Résultat attendu :** la copie reste un Draft distinct. Ouvrir View/Run ne publie rien et n'envoie aucune réponse.

## Archiver ou supprimer une copie inutilisée

Archive conserve la définition en arrêtant son usage pour les envois. Delete supprime définitivement la définition choisie. Les images retirent uniquement la copie de démonstration distincte.

### 1. Revenir dans Forms

Sélectionnez **Forms** dans le menu principal. Trouvez la copie à retirer.

![Forms se trouve dans le menu principal à gauche.](forms-guide-open-page.png)

### 2. Archiver la copie

Ouvrez les points de sa ligne et sélectionnez **Archive**.

![Archive arrête l'usage normal pour les envois tout en conservant la définition.](forms-guide-archive-menu.png)

### 3. Vérifier Archived

La copie reste dans la liste de gestion avec l'état **Archived**. Elle n'est plus Published pour l'envoi.

![Le formulaire archivé reste dans la liste avec son état.](forms-guide-archive-result.png)

### 4. Choisir Delete pour une suppression voulue

Pour une suppression définitive, ouvrez les points de cette même copie et sélectionnez **Delete**. Vérifiez qu'il s'agit de la copie et non de l'original.

![Delete supprime définitivement la définition choisie. Il s'agit uniquement de la copie de démonstration prévue.](forms-guide-delete-menu.png)

### 5. Confirmer le formulaire nommé

Lisez le nom dans la confirmation. Sélectionnez **Delete** pour supprimer ou Cancel pour conserver.

![Lisez le nom avant confirmation. Cancel conserve le formulaire.](forms-guide-delete-confirm.png)

**Résultat attendu :** la copie supprimée disparaît de Forms. L'exemple a conservé son formulaire original.

## Consulter les formulaires et aperçus sur téléphone

Utilisez les mêmes actions de liste et de créateur sur téléphone. Une table large peut défiler horizontalement.

### 1. Trouver le formulaire

Utilisez **Search forms** dans la liste à largeur de téléphone.

![Forms est disponible sur téléphone. Les colonnes larges peuvent défiler horizontalement.](forms-guide-phone-list.png)

### 2. Ouvrir Builder actions

Ouvrez le formulaire dans le créateur et sélectionnez ses points en haut à droite.

![Builder actions reste disponible sur téléphone.](forms-guide-phone-builder-actions.png)

### 3. Choisir Preview

Sélectionnez **Preview** dans le menu du créateur.

![Ouvrez Preview depuis le même menu du créateur.](forms-guide-phone-preview-menu.png)

### 4. Inspecter l'aperçu sur téléphone

Lisez l'aperçu et faites défiler ses champs. Preview actions reste dans les points de l'en-tête.

![Preview s'ouvre au-dessus du créateur à largeur de téléphone.](forms-guide-phone-preview.png)

**Résultat attendu :** le modèle reste consultable à largeur de téléphone.

## Limites

Ce parcours saisit une demande et un choix de prélèvement. Il ne montre ni la saisie de résultats de laboratoire ni le rejet d'une demande.

Les listes d’accès nomment des rôles. Une personne passe quand l’un de ses rôles est listé. Pour soumettre, il faut aussi pouvoir ouvrir le formulaire. Un gestionnaire des rôles ouvre toujours tous les formulaires, et seuls les éditeurs de formulaires voient **Accès**.

Save de l'éditeur de champ applique une modification locale du créateur. Save draft du créateur enregistre la définition. Publish enregistre le modèle et crée une version. Les actions Preview ne font aucune de ces écritures.

Enregistrer ou restaurer un contenu différent peut remettre un formulaire Published en Draft. Un contenu identique ne force pas ce changement. View/Run reste disponible, mais l'envoi exige l'état Published.

Le panneau d'une saisie affiche chaque réponse sous le libellé actuel du champ. Si vous renommez un champ, les saisies plus anciennes affichent aussi le nouveau libellé.

Les formulaires **Users** et **Facility** remplissent les pages Utilisateurs et Établissements. La liste des formulaires ne les montre qu'aux personnes qui ont **Modifier les formulaires**. Sur une nouvelle installation, le formulaire **Lab order** ne s'ouvre que pour les rôles Lab Technician et Lab Manager. Une personne qui gère les rôles ou modifie les formulaires l'ouvre toujours. Une installation qui avait déjà ce formulaire garde sa liste d'accès.

## Dépannage

**Aucun patient correspondant.** Vérifiez la recherche et si votre flux habituel a fourni ce patient. Utilisez Patients pour inspecter le dossier reçu.

**Un test manque.** Vérifiez sa présence dans Test catalog et son activation pour ce laboratoire.

**Submit est désactivé.** Vérifiez l'état du formulaire et son message de préparation à l'envoi. Publiez un Draft vérifié et contrôlez la configuration de saisie.

**Submit signale des réponses invalides.** Lisez les erreurs de champs et corrigez les valeurs obligatoires ou invalides avant de réessayer. Un message Response captured réussi n'exige pas de second envoi.

**Restore laisse Draft.** Vérifiez le contenu restauré, puis publiez-le avec Publish lorsqu'il doit permettre à nouveau les envois.

**Une saisie affiche Pas entièrement enregistrée.** L'enregistrement s'est arrêté après avoir stocké une partie de la saisie. Une demande existe peut-être, donc la saisie garde son numéro de demande. Ouvrez la saisie pour voir ce qu'elle contient. Demandez ensuite à une personne qui a **Marquer des saisies comme erronées** de la marquer, puis saisissez la demande de nouveau.

**Submit affiche `this entry names a facility outside your limit`.** L'établissement choisi est hors de votre limite, ou vous l'avez laissé vide. Choisissez l'un de vos établissements.

**Submit affiche `this form's facility field is free text, so it cannot be used by a user limited to a site`.** Un utilisateur limité ne peut utiliser qu'un champ d'établissement qui choisit dans le registre des établissements. Demandez à un éditeur de formulaires de changer le champ.

**Submit affiche `your data limit names no facility, so you cannot enter this form`.** Votre limite ne liste aucun établissement. Le champ de l'établissement affiche alors **Votre compte n’est lié à aucun établissement. Demandez à un administrateur.** Demandez à un administrateur d'ajouter votre établissement dans Utilisateurs.

**Après le marquage, un message affiche `The entry is marked in error, but its saved records were not updated.`** La saisie est marquée et son numéro est libre, mais sa demande, ses échantillons et ses résultats ne sont pas marqués. Demandez à un administrateur de vérifier l'exécution nommée dans le message, ou le workflow d'ingestion.

**Après le marquage, un message affiche `The records this entry made are not known yet. If its save is still running, they will be marked when it finishes.`** Le serveur ne sait pas encore quelles données la saisie a créées. Si sa sauvegarde est encore en cours, elles sont marquées quand cette sauvegarde se termine.

**Après le marquage, un message affiche `Some records this entry made may exist but are not known, so they were not marked.`** La sauvegarde de la saisie a échoué en cours de route. Elle a peut-être enregistré une demande, des échantillons ou des résultats, mais le serveur n'a pas pu savoir lesquels. La saisie est marquée et son numéro est libre. Demandez à un administrateur de retrouver ces données et de les corriger.

## Guides associés

Lisez [Patients](/docs/patients) pour les dossiers reçus et [Catalogue des tests](/docs/test-catalog) pour les tests activés. Lisez [Workflows](/docs/workflows) pour le workflow de saisie et [Commencer ici](/docs/start-here) pour l'installation et la CLI. Lisez [Utilisateurs](/docs/users) pour limiter une personne à un site, et [Rôles](/docs/roles) pour donner à un rôle **Marquer des saisies comme erronées**.

## Exercice facultatif

Utilisez une installation de test avec des patients fictifs et des tests activés au laboratoire. Les tâches de saisie utilisent vos dossiers reçus. Aucun fichier d'exemple n'est requis.

Pour concevoir, utilisez un nom distinct et l'exemple ServiceRequest à cinq champs. Essayez Preview, Save draft, Publish, Compare et Versions. Dupliquez cette définition avant de vous exercer à Archive ou Delete.

Envoyez un Lab order de test seulement pour une écriture voulue. L'exemple documenté a envoyé une réponse. Les captures suivantes n'ont envoyé aucune autre réponse.
