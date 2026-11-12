# Établissements

Donnez aux établissements de vos données des noms, des codes et des localisations cohérents. Ajoutez des établissements, importez un registre, puis reliez les codes reçus aux bons établissements.

**Cette configuration est facultative.** OpenLDR peut recevoir et traiter des données avant la configuration de Facilities. Nous recommandons de la compléter pendant votre utilisation du système pour identifier les établissements dans les rapports.

**Registry** contient les établissements ajoutés ou importés. **Observed** contient les codes reçus et indique leur établissement de destination. Ajouter un établissement et relier un code reçu sont deux tâches distinctes.

Un **registre** est une liste maintenue par un organisme, par exemple un annuaire national ou la liste de votre organisation. **System** sélectionne ce registre. Son URI et le **Facility code** identifient ensemble l'établissement.

Utilisez votre propre registre, vos informations et vos fichiers. Les captures montrent des établissements fictifs. Aucune donnée d'exemple n'est nécessaire. Les [fichiers de pratique facultatifs](#pratique-facultative-avec-des-donnees-fictives) sont à la fin.

La lecture nécessite **View facilities**. L'ajout, la modification, l'import et les liens nécessitent **Manage facilities**. Add et Edit nécessitent aussi un formulaire publié ciblant Facilities. Ce formulaire détermine les champs et les indications obligatoires.

## Enregistrer la source de votre liste

Faites cette opération une seule fois par registre. Si votre registre apparaît déjà sous **System** ou **National system**, utilisez-le et passez cette tâche. Ne créez pas une seconde source pour le même registre.

### 1. Ouvrir Facilities

Sélectionnez **Facilities** dans le menu principal à gauche.

![Capture de Studio : Ouvrir Facilities](facilities-guide-open-facilities.png)

### 2. Ouvrir Import facilities

Dans **Registry**, ouvrez les points à droite des onglets et sélectionnez **Import facilities**.

![Capture de Studio : Ouvrir Import facilities](facilities-guide-source-actions.png)

![Capture de Studio : Ouvrir Import facilities](facilities-guide-source-import.png)

### 3. Choisir Register a source

Sélectionnez **Register a source**. Vous pouvez enregistrer la source avant de choisir un fichier. Si des sources existent déjà, cette action se trouve dans le menu du panneau d'import.

![Capture de Studio : Choisir Register a source](facilities-guide-register-source-button.png)

![Capture de Studio : Choisir Register a source](facilities-guide-register-existing-actions.png)

![Capture de Studio : Choisir Register a source](facilities-guide-register-existing-menu.png)

### 4. Saisir l'URI permanente du registre

Dans **Canonical URI**, utilisez l'identifiant fourni par l'organisme responsable. Pour votre propre liste, choisissez une URI stable. L'exemple fictif utilise `urn:example:facilities:guide`.

![Capture de Studio : Saisir l'URI permanente du registre](facilities-guide-register-url.png)

### 5. Saisir son nom

Dans **Display name**, saisissez le nom à afficher dans les choix. L'exemple utilise `Example facility register`.

![Capture de Studio : Saisir son nom](facilities-guide-register-name.png)

### 6. Saisir un code court

Dans **Code**, saisissez un identifiant court pour le registre. L'exemple utilise `EXAMPLE`. Version, jurisdiction et contact sont facultatifs.

![Capture de Studio : Saisir un code court](facilities-guide-register-code.png)

### 7. Enregistrer la source

Ouvrez le menu de ce panneau et sélectionnez **Register**.

![Capture de Studio : Enregistrer la source](facilities-guide-register-actions.png)

![Capture de Studio : Enregistrer la source](facilities-guide-register-save.png)

**Résultat attendu :** le nouveau registre est sélectionné dans le panneau d'import. L'enregistrement de la source n'a importé aucun établissement.

![Capture de Studio : Enregistrer la source](facilities-guide-register-selected.png)

### 8. Fermer le panneau pour un ajout manuel

Sélectionnez **Close** en haut à droite. Pour importer un fichier, gardez le panneau ouvert et [continuez avec l'import](#choisir-le-fichier-du-registre).

![Capture de Studio : Fermer le panneau pour un ajout manuel](facilities-guide-close-import.png)

## Commencer une fiche d'établissement

Ajoutez un établissement manuellement pour saisir un seul site. Les étapes suivantes utilisent le formulaire publié dans cette installation. Complétez les champs obligatoires de votre propre formulaire.

### 1. Choisir Add facility

Dans **Registry**, ouvrez le menu de la page et sélectionnez **Add facility**.

![Capture de Studio : Choisir Add facility](facilities-guide-add-actions.png)

![Capture de Studio : Choisir Add facility](facilities-guide-add-menu.png)

### 2. Choisir System

Sous **System**, choisissez la source enregistrée de cet établissement. Le nom sélectionne son URI canonique.

![Capture de Studio : Choisir System](facilities-guide-add-system.png)

### 3. Saisir Facility code

Saisissez le code exact du registre, en conservant les zéros initiaux. L'exemple utilise `EXAMPLE-CLINIC-01`.

![Capture de Studio : Saisir Facility code](facilities-guide-add-code.png)

### 4. Saisir Name

Saisissez le nom lisible de l'établissement. L'exemple utilise `Example Clinic North`.

![Capture de Studio : Saisir Name](facilities-guide-add-name.png)

### 5. Choisir Country

Recherchez le pays, puis sélectionnez un résultat. Saisir uniquement le texte de recherche ne sélectionne pas de réponse.

![Capture de Studio : Choisir Country](facilities-guide-add-country.png)

### 6. Saisir Zone si votre formulaire l'exige

Saisissez la zone réelle de l'établissement. Les suggestions viennent des localisations déjà saisies dans ce registre. La capture utilise `Example Zone`.

![Capture de Studio : Saisir Zone si votre formulaire l'exige](facilities-guide-add-zone.png)

### 7. Saisir District et les autres localisations obligatoires

Ce formulaire exige aussi **District**. Saisissez le district de l'établissement. Complétez Region ou Council si vous avez ces informations.

![Capture de Studio : Saisir District et les autres localisations obligatoires](facilities-guide-add-district.png)

**Continuez ci-dessous :** la fiche reste ouverte dans New facility. Elle n'est pas encore enregistrée.

## Compléter et enregistrer l'établissement

Continuez dans le panneau **New facility** ouvert. Choisissez le statut et le type dans la terminologie configurée, puis enregistrez.

### 1. Choisir Status

Recherchez sous **Status** et sélectionnez le bon résultat. L'exemple choisit **Active**.

![Capture de Studio : Choisir Status](facilities-guide-add-status.png)

### 2. Choisir Level

**Level** sélectionne le type d'établissement. Recherchez et choisissez le type correspondant au site parmi les valeurs de votre installation.

![Capture de Studio : Choisir Level](facilities-guide-add-level.png)

### 3. Ouvrir le menu du panneau

Sélectionnez les points sous le titre du panneau, vers la droite.

![Capture de Studio : Ouvrir le menu du panneau](facilities-guide-add-sheet-actions.png)

### 4. Choisir Create

Sélectionnez **Create**. Si le formulaire indique des champs manquants, complétez-les et réessayez.

![Capture de Studio : Choisir Create](facilities-guide-add-create.png)

**Résultat attendu :** le panneau se ferme et Registry se recharge. L'établissement apparaît avec son code, son nom et sa source. Si un filtre le masque, recherchez son code.

![Capture de Studio : Choisir Create](facilities-guide-add-result.png)

## Trouver et modifier un établissement

Utilisez cette tâche pour corriger un nom, une localisation ou un autre détail. Rechercher d'abord évite aussi de créer un second enregistrement pour un établissement existant.

### 1. Rechercher l'établissement

Dans **Search facilities…**, saisissez son nom ou son code. L'exemple recherche `EXAMPLE-CLINIC-01`.

![Capture de Studio : Rechercher l'établissement](facilities-guide-search-input.png)

### 2. Ouvrir sa ligne

Sélectionnez la ligne de l'établissement. Ses informations s'ouvrent dans **Edit facility**.

![Capture de Studio : Ouvrir sa ligne](facilities-guide-edit-row.png)

### 3. Modifier les informations

Modifiez le champ à corriger. Ici, Name devient `Example Clinic North Updated`.

![Capture de Studio : Modifier les informations](facilities-guide-edit-name.png)

### 4. Ouvrir le menu du panneau

Sélectionnez les points sous le titre du panneau.

![Capture de Studio : Ouvrir le menu du panneau](facilities-guide-edit-actions.png)

### 5. Choisir Save

Sélectionnez **Save**. Les fiches existantes utilisent Save ; les nouvelles utilisent Create.

![Capture de Studio : Choisir Save](facilities-guide-edit-save.png)

**Résultat attendu :** Registry affiche les changements. L'exemple conserve le code. System et Facility code peuvent aussi être corrigés. Ne supprimez pas la fiche uniquement pour corriger son code.

![Capture de Studio : Choisir Save](facilities-guide-edit-result.png)

## Consulter les changements

History affiche les changements d'un établissement avec leur date et leur auteur. Vous pouvez le consulter sans modifier la fiche.

### 1. Ouvrir le menu de la ligne

Sélectionnez les points à droite de la ligne de l'établissement.

![Capture de Studio : Ouvrir le menu de la ligne](facilities-guide-history-row-actions.png)

### 2. Choisir History

Sélectionnez **History**.

![Capture de Studio : Choisir History](facilities-guide-history-menu.png)

**Résultat attendu :** Facility history affiche les changements les plus récents en premier. L'exemple montre le changement de nom et la création initiale.

![Capture de Studio : Choisir History](facilities-guide-history-result.png)

### 3. Fermer History

Sélectionnez **Close** en haut à droite pour revenir à Registry.

![Capture de Studio : Fermer History](facilities-guide-history-close.png)

## Choisir le fichier du registre

Importez votre liste existante au format CSV, JSON Lines ou Excel `.xlsx`. Il faut une colonne de codes et une colonne de noms. Les autres champs peuvent être associés, fournis comme valeurs fixes ou conservés comme données supplémentaires.

Utilisez la source enregistrée qui possède les codes du fichier. Les exigences du formulaire manuel ne déterminent pas les colonnes obligatoires de l'import.

### 1. Ouvrir Import facilities

Dans Registry, ouvrez le menu de la page et sélectionnez **Import facilities**.

![Capture de Studio : Ouvrir Import facilities](facilities-guide-import-actions.png)

![Capture de Studio : Ouvrir Import facilities](facilities-guide-import-menu.png)

### 2. Choisir le fichier

Sélectionnez la zone File et choisissez votre fichier. Son nom apparaît sous Source. Le format suit le fichier choisi.

![Capture de Studio : Choisir le fichier](facilities-guide-import-file.png)

![Capture de Studio : Choisir le fichier](facilities-guide-import-format.png)

### 3. Choisir National system

Sélectionnez la source enregistrée de ce fichier. Si elle manque, [enregistrez sa source](#enregistrer-la-source-de-votre-liste) d'abord.

![Capture de Studio : Choisir National system](facilities-guide-import-register-step-3.png)

### 4. Indiquer si le fichier est une version complète

Cochez **This file is a complete release** uniquement si le fichier contient le registre entier. Laissez cette case vide pour un fichier partiel. Une version complète permet de vérifier les établissements existants absents du fichier.

![Capture de Studio : Indiquer si le fichier est une version complète](facilities-guide-import-complete-release.png)

### 5. Continuer vers Mapping

Sélectionnez **Continue**. Le fichier est envoyé et stocké, puis Mapping s'ouvre. Aucun établissement n'a encore été importé.

![Capture de Studio : Continuer vers Mapping](facilities-guide-import-continue.png)

## Associer les colonnes et les valeurs fixes

Mapping relie les en-têtes du fichier aux champs OpenLDR. Vérifiez les suggestions pour le code et le nom, puis décidez du traitement des autres colonnes.

### 1. Vérifier les colonnes obligatoires

La colonne du code doit correspondre à `national_code`. Le nom lisible doit correspondre à `name`. Ouvrez la liste à côté d'un en-tête pour corriger sa destination.

![Capture de Studio : Vérifier les colonnes obligatoires](facilities-guide-map-code.png)

![Capture de Studio : Vérifier les colonnes obligatoires](facilities-guide-map-name.png)

### 2. Corriger les autres destinations

Choisissez le champ approprié à côté de chaque en-tête. Ici, **Operating Status** doit correspondre à `status` au lieu de rester une donnée supplémentaire.

![Capture de Studio : Corriger les autres destinations](facilities-guide-map-status-option.png)

### 3. Conserver les colonnes supplémentaires utiles

Pour une colonne sans champ standard, ouvrez le menu de sa ligne et sélectionnez **Keep as extra**. L'exemple conserve Notes.

![Capture de Studio : Conserver les colonnes supplémentaires utiles](facilities-guide-map-extra-actions.png)

![Capture de Studio : Conserver les colonnes supplémentaires utiles](facilities-guide-map-extra-save.png)

### 4. Fournir des valeurs fixes pour les colonnes absentes

Si tous les établissements partagent une valeur absente du fichier, saisissez-la sous **Fixed values**. Ici, Country est sélectionné dans la terminologie. Chaque ligne reçoit ce pays.

![Capture de Studio : Fournir des valeurs fixes pour les colonnes absentes](facilities-guide-map-fixed-country.png)

### 5. Décider du traitement des changements après l'aperçu

Sous **Rows changed since this preview**, choisissez d'ignorer ces lignes ou de les remplacer par le fichier. Par défaut, ces lignes du registre restent inchangées.

![Capture de Studio : Décider du traitement des changements après l'aperçu](facilities-guide-map-conflict-policy.png)

### 6. Valider le fichier

Sélectionnez **Validate all**. La vérification s'exécute en arrière-plan, puis Review s'ouvre. Corrigez toute colonne obligatoire non associée avant de continuer.

![Capture de Studio : Valider le fichier](facilities-guide-map-validate.png)

**Résultat attendu :** Review décrit les effets du fichier et des associations actuelles. Si des valeurs n'ont pas d'association canonique, définissez-les comme ci-dessous.

![Capture de Studio : Valider le fichier](facilities-guide-review-unmapped.png)

## Définir les valeurs inconnues

Le fichier peut utiliser d'autres mots que votre terminologie. Associez-les aux valeurs voulues. L'exemple utilise Operating et Closed comme statuts.

### 1. Revenir à Mapping

Dans Review, sélectionnez **Map these values**. Les choix apparaissent sous la colonne concernée dans Mapping.

![Capture de Studio : Revenir à Mapping](facilities-guide-review-map-values.png)

### 2. Définir le sens de Operating

Pour cet exemple, choisissez **Active** pour Operating. Pour votre fichier, choisissez une valeur ayant le même sens.

![Capture de Studio : Définir le sens de Operating](facilities-guide-map-operating.png)

### 3. Définir le sens de Closed

Pour cet exemple, choisissez **Inactive** pour Closed. Ne fusionnez pas des sens différents uniquement pour supprimer un avertissement.

![Capture de Studio : Définir le sens de Closed](facilities-guide-map-closed.png)

### 4. Vérifier à nouveau

Sélectionnez **Validate all**. Les décisions sont enregistrées pour ce registre et le fichier est vérifié à nouveau.

![Capture de Studio : Vérifier à nouveau](facilities-guide-map-revalidate.png)

**Résultat attendu :** Review reflète les nouvelles décisions. Dans cet exemple, l'avertissement de statut non associé disparaît.

## Vérifier et appliquer l'import

Lisez les changements prévus avant de les appliquer. Un fichier peut créer des lignes, modifier des lignes ou correspondre aux lignes existantes. Les nombres dépendent du fichier et du registre actuel.

### 1. Lire le résumé

Vérifiez les nombres de lignes nouvelles, modifiées, inchangées et ignorées, ainsi que les avertissements. Si nécessaire, revenez à Mapping et validez à nouveau. Review présente les décisions sans les modifier.

![Capture de Studio : Lire le résumé](facilities-guide-review-summary.png)

### 2. Confirmer l'import vérifié

Sélectionnez **Confirm import**. Attendez le panneau de fin.

![Capture de Studio : Confirmer l'import vérifié](facilities-guide-import-confirm.png)

**Résultat attendu :** Import complete indique les créations, mises à jour, lignes inchangées et lignes ignorées.

![Capture de Studio : Confirmer l'import vérifié](facilities-guide-import-complete.png)

### 3. Revenir à Registry

Sélectionnez **Close** en haut à droite. Le registre se recharge avec les établissements importés.

![Capture de Studio : Revenir à Registry](facilities-guide-import-close.png)

![Capture de Studio : Revenir à Registry](facilities-guide-import-result.png)

## Actualiser un registre existant

À la prochaine version du fichier, répétez l'import avec le même National system. Le registre et le code identifient les lignes existantes. Inutile de recréer ces établissements manuellement.

### 1. Réutiliser la source enregistrée

Choisissez le même registre dans le nouvel import et répétez les étapes Source et Mapping. Vérifiez à nouveau les colonnes.

![Capture de Studio : Réutiliser la source enregistrée](facilities-guide-import-register-step-1.png)

### 2. Lire les changements prévus

Après validation, vérifiez les nombres. Le même fichier d'exemple retrouve deux lignes inchangées et n'en crée aucune.

![Capture de Studio : Lire les changements prévus](facilities-guide-reimport-summary.png)

### 3. Appliquer les changements vérifiés

Sélectionnez **Confirm import** quand le résumé correspond à votre intention.

![Capture de Studio : Appliquer les changements vérifiés](facilities-guide-reimport-confirm.png)

**Résultat attendu :** le fichier répété signale les lignes inchangées sans créer de doublons. Un fichier modifié présente ses différences réelles.

![Capture de Studio : Appliquer les changements vérifiés](facilities-guide-reimport-complete.png)

## Relier les codes reçus qui correspondent au registre

Faites cette tâche après l'arrivée des données de laboratoire. Observed liste les codes reçus. Si cette liste est vide, vous pouvez construire Registry maintenant et revenir après l'arrivée du flux habituel.

La correspondance exacte relie un code reçu à l'établissement portant le même code dans le registre choisi. Les associations existantes sont conservées.

### 1. Ouvrir Observed

Sélectionnez **Observed** à côté de Registry.

![Capture de Studio : Ouvrir Observed](facilities-guide-observed-tab.png)

### 2. Choisir Link matching codes

Ouvrez le menu de la page Observed et sélectionnez **Link matching codes**.

![Capture de Studio : Choisir Link matching codes](facilities-guide-observed-actions.png)

![Capture de Studio : Choisir Link matching codes](facilities-guide-matching-menu.png)

### 3. Choisir le registre

Sélectionnez le registre dont vous voulez rapprocher les codes.

![Capture de Studio : Choisir le registre](facilities-guide-matching-register.png)

### 4. Lire les correspondances proposées

Vérifiez les nombres et les noms. L'exemple comporte trois codes à relier et un sans correspondance. Vos nombres viennent de vos données.

![Capture de Studio : Lire les correspondances proposées](facilities-guide-matching-preview.png)

### 5. Ouvrir Link actions

Sélectionnez les points en haut à droite de ce panneau.

![Capture de Studio : Ouvrir Link actions](facilities-guide-matching-actions.png)

### 6. Appliquer les correspondances

Sélectionnez **Link N codes**, N étant le nombre de votre aperçu. L'exemple affiche Link 3 codes.

![Capture de Studio : Appliquer les correspondances](facilities-guide-matching-apply.png)

**Résultat attendu :** les codes correspondants affichent l'établissement sous Resolves to. Report facilities peut afficher Updating pendant la reconstruction des liens de rapports, puis Current.

![Capture de Studio : Appliquer les correspondances](facilities-guide-matching-result.png)

## Relier un code différent utilisé par la source

Utilisez cette tâche quand une source emploie un autre code pour le même établissement. Choisissez sa véritable fiche Registry. L'exemple relie EXTERNAL-CLINIC à la clinique nord existante.

### 1. Choisir Map sur la ligne reçue

Ouvrez le menu de cette ligne et sélectionnez **Map**. Une ligne déjà associée propose Edit mapping.

![Capture de Studio : Choisir Map sur la ligne reçue](facilities-guide-mapping-row-actions.png)

![Capture de Studio : Choisir Map sur la ligne reçue](facilities-guide-mapping-menu.png)

### 2. Rechercher l'établissement de destination

Dans Target, utilisez **Search terms** pour rechercher le nom ou le code. System est fixé à FACILITY-REGISTRY dans ce parcours.

![Capture de Studio : Rechercher l'établissement de destination](facilities-guide-mapping-search.png)

### 3. Sélectionner l'établissement correspondant

Choisissez le bon établissement parmi les résultats.

![Capture de Studio : Sélectionner l'établissement correspondant](facilities-guide-mapping-target.png)

### 4. Vérifier le type d'association

Gardez **Same as** lorsque les codes désignent le même établissement. Une relation plus large ou plus étroite n'est pas une correspondance d'identité.

![Capture de Studio : Vérifier le type d'association](facilities-guide-mapping-type.png)

### 5. Ouvrir le menu de l'association

Sélectionnez les points en haut à droite du panneau d'association.

![Capture de Studio : Ouvrir le menu de l'association](facilities-guide-mapping-sheet-actions.png)

### 6. Choisir Create

Sélectionnez **Create** pour une nouvelle association. Une association existante utilise Save.

![Capture de Studio : Choisir Create](facilities-guide-mapping-create.png)

**Résultat attendu :** Resolves to affiche l'établissement choisi à côté du code différent de la source.

![Capture de Studio : Choisir Create](facilities-guide-mapping-result.png)

## Utiliser Facilities sur un téléphone

Les tâches Registry et Observed restent disponibles sur téléphone. L'en-tête passe à la ligne pour laisser de la place au statut des rapports.

### 1. Choisir Registry

Sélectionnez **Registry** en haut pour consulter la liste des établissements.

![Capture de Studio : Choisir Registry](facilities-guide-phone-registry.png)

### 2. Choisir Observed

Sélectionnez **Observed** pour consulter les codes reçus.

![Capture de Studio : Choisir Observed](facilities-guide-phone-observed.png)

### 3. Ouvrir le menu de cet onglet

Sélectionnez les points à droite des onglets. Les actions dépendent de l'onglet choisi. Faites défiler le tableau horizontalement pour voir les colonnes restantes.

![Capture de Studio : Ouvrir le menu de cet onglet](facilities-guide-phone-actions.png)

## Pratique facultative avec des données fictives

Toutes les tâches ci-dessus peuvent utiliser vos propres données. Ces fichiers servent uniquement à pratiquer dans une installation de test :

- [Télécharger le CSV de deux établissements](https://openldr.online/docs-samples/example-facilities.csv) utilisé dans les captures d'import.
- [Télécharger le lot de sept ressources](https://openldr.online/docs-samples/example-observed-data.json) utilisé pour montrer les codes reçus. Il contient un patient fictif, trois demandes et trois rapports.

Pour obtenir les trois correspondances exactes montrées, ajoutez aussi `EXAMPLE-CLINIC-01` avec la tâche manuelle. Utilisez Example facility register pour ces fiches fictives. Le CSV seul donne moins de correspondances ; l'aperçu indique les codes sans correspondance.

Importez le CSV dans le navigateur avec les étapes précédentes. Avant de charger le lot facultatif, lisez [Start here](/docs/start-here) pour les instructions CLI installées et de développement. Placez le JSON dans le dossier `data` de l'installation.

Exemple pour une installation Linux ou macOS :

```shell
cd ~/Downloads/openldr_ce
./openldr ingest data/example-observed-data.json
```

Exemple pour une installation Windows :

```shell
cd C:\openldr_ce
.\openldr.ps1 ingest data\example-observed-data.json
```

Exemple pour un dépôt de développement, après avoir placé le fichier dans son dossier `data` :

```shell
cd ~/Downloads/openldr_ce
pnpm openldr ingest data/example-observed-data.json
```

Ces dossiers sont des exemples. Remplacez-les par votre vrai dossier, comme expliqué dans Start here. Revenez à Observed après l'import, puis suivez les tâches de liaison.

## Dépannage

### Create signale des champs obligatoires

Complétez les champs indiqués. Pour un champ de terminologie, sélectionnez un résultat au lieu de laisser le texte de recherche seul. Choisissez ensuite Create à nouveau.

![Capture de Studio : Dépannage](facilities-guide-required-error.png)

### Un établissement porte déjà ce code dans ce registre

Une paire System et Facility code ne peut pas être ajoutée deux fois. Fermez le formulaire, trouvez la ligne existante et modifiez-la. L'erreur reproduite parle de code national ; ce formulaire l'appelle Facility code.

![Capture de Studio : Dépannage](facilities-guide-duplicate-error.png)

### Une colonne manque pour un champ obligatoire

Associez la colonne de codes à `national_code` et celle des noms à `name`, ou fournissez la valeur fixe appropriée. Validez à nouveau.

![Capture de Studio : Dépannage](facilities-guide-missing-code-error.png)

![Capture de Studio : Dépannage](facilities-guide-missing-code-fix.png)

### Un code reçu indique encore Not mapped

Importer un registre ne relie pas les codes reçus. Utilisez Link matching codes pour les codes exacts, ou Map sur la ligne quand la source utilise un code différent.

### Add ou Edit est indisponible

Ces actions nécessitent Manage facilities et un formulaire publié ciblant Facilities. La page indique le formulaire manquant. Ouvrez Forms pour le publier ou le corriger. L'import d'un registre ne nécessite pas ce formulaire.

### Un établissement enregistré est absent de la liste visible

La recherche, les filtres et la page restent appliqués après l'enregistrement. Recherchez le code pour retrouver la fiche.

## Distinguer ces opérations

Les saisies manuelles suivent votre formulaire Facilities. Les imports utilisent leurs associations de colonnes. Une source de registre, un établissement Registry et une association de code Observed sont des enregistrements distincts.

Un fichier partiel n'évalue pas les établissements absents du fichier. Indiquez une version complète uniquement pour le registre entier, puis lisez les décisions supplémentaires dans Mapping et le résultat dans Review.

## Guides associés

[Terminology](/docs/terminology) explique les listes et les codes. [Start here](/docs/start-here) explique la CLI. [Dashboards](/docs/dashboard) traite des graphiques et de la pratique facultative. [Your preferences](/docs/user-preferences) traite des réglages personnels.
