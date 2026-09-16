# Formulaires

## Conditions de soumission

La publication permet le partage et les éditeurs intégrés. Elle ne garantit pas les soumissions View/Run. La saisie prend actuellement en charge ServiceRequest et les champs de réponse actifs avec Observation Extract et au moins un code. Un formulaire texte personnalisé sans extraction ne peut pas être soumis. Les modèles Patient et Facility restent utilisables dans leurs éditeurs dédiés.

L’éditeur et la page de saisie indiquent cette capacité avant la saisie. Pour une observation, ouvrez la fiche du champ, sélectionnez un code terminologique sous Codes et cochez Observation Extract sous Mapping. Activez le champ, enregistrez et publiez. Renseignez au moins un champ d'extraction : un champ vide ou masqué ne produit aucune Observation.

Ce contrôle porte sur la configuration. Les réponses obligatoires, les références et le workflow d'ingestion actif doivent encore être validés.

## Structure de la liste des champs

- **L'entrée d'une liste remplie par un champ.** Un champ lié à une entrée d'une liste FHIR affiche une deuxième ligne sous son chemin, par exemple `system = urn:x`. Deux champs sur `Location.identifier.value` ne diffèrent que par cette ligne.
- **Emplacements d'une même liste.** Les champs qui partagent une liste et ont un discriminateur et un champ de valeur sont réunis sous un en-tête. L'en-tête indique le nom de la liste, son chemin et le nombre d'emplacements. La liste le déduit des champs : on ne peut ni le déplacer ni le supprimer.
- **Les formulaires fournis.** Le formulaire Patient réunit le prénom et le nom sous `Patient.name`, et le téléphone sous `Patient.telecom`. Le formulaire Users réunit le prénom et le nom sous `Practitioner.name`, et l'adresse e-mail sous `Practitioner.telecom`. Le formulaire Facility place son code sous `Location.identifier`, et le formulaire Lab order place son numéro de référence sous `ServiceRequest.identifier`. Une installation dont l'opérateur a modifié l'un de ces formulaires garde ses propres champs.
- **Groupes imbriqués.** Définissez le **Group** d'un groupe pour le placer dans un autre groupe, à n'importe quelle profondeur. Le sélecteur ne propose jamais le groupe lui-même ni ce qu'il contient déjà.
- **L'icône de répétition.** Un champ qui accepte plusieurs réponses, ou un groupe qui contient plusieurs entrées, affiche une icône de répétition. Un groupe contient une seule entrée s'il est lié à un élément unique, comme `Location.address`, ou si **Max Items** vaut 1. L'export Questionnaire marque alors ce groupe comme non répétable.
- La saisie affiche encore chaque groupe une seule fois. L'ajout d'entrées à un groupe pendant la saisie arrivera dans une version ultérieure.

## Modifier un champ

- **L'entrée d'une liste.** Sous Mapping, cochez **Array element (discriminator)**. Chaque condition est un élément, un opérateur et une valeur, par exemple `system` `equals` `urn:x`. Les opérateurs sont `equals`, `not equals` et `starts with`. À partir de deux conditions, choisissez **All** si toutes doivent être vraies, ou **Any** si une seule suffit. **Value Field** désigne l'élément qui porte la réponse, en général `value`.
- Le discriminateur sert aux contrôles du formulaire et à l'export Questionnaire. La saisie ne l'utilise pas encore, à une exception près : quand une demande Lab order est soumise, son numéro de référence porte le `system` que nomme son discriminateur.
- **Un autre emplacement.** Sous le dernier emplacement d'une liste, **+ Add a named slot** ajoute une copie avec le même chemin, le même champ de valeur et le même type, et des valeurs de discriminateur vides. La propriété API, les codes et les traductions restent vides.
- **Parties d'un groupe.** L'éditeur d'un groupe liste ses parties après Mapping. Cliquez sur une partie pour la modifier. Vos modifications non enregistrées du groupe sont d'abord enregistrées. **+ Add a part** ajoute un champ dans le groupe, sans chemin FHIR.
- **Champs reference.** Un champ reference a un bloc **Reference Configuration** après General. **Target** vaut `Patient` ou un système de codes actif. **Searchable** est enregistré et exporté, mais la saisie ne l'utilise pas encore. **Depends On** sert dans un seul cas : un champ qui dépend d'un champ Tests lié à la liste des examens de ce laboratoire ne propose que les prélèvements acceptés par les examens choisis. La demande d'examens livrée ne s'en sert plus : chaque examen porte son propre prélèvement (voir Catalogue des examens). Tout autre réglage **Depends On** est enregistré mais pas utilisé.
- **Champs verrouillés.** Un champ verrouillé ne peut être ni désactivé ni supprimé depuis la liste. Vous pouvez encore le renommer, le déplacer et le traduire.
- **Formulaires d'enquête.** Si le Resource Type du formulaire est `Questionnaire`, l'éditeur masque FHIR Path, API Property et le discriminateur. Observation Extract et les autres réglages restent.

## Options et ValueSets

- Un champ select ou multiselect peut prendre ses options dans un ValueSet. Dans le bloc Options, cherchez un ValueSet et choisissez-le. Ses codes sont copiés dans les options, et le champ garde un lien vers le ValueSet avec une force. Une force required empêche la saisie d'accepter d'autres valeurs.
- **Unbind**, dans le menu ⋯ du bloc Options, retire le lien et garde les options. **Save as a new ValueSet** transforme des options saisies en un ValueSet réutilisable ; il n'apparaît que si vous pouvez gérer la terminologie.
- Sous le FHIR Path, **bound:** nomme le ValueSet auquel FHIR lui-même lie cet élément, et avec quelle force. **Load from terminology**, dans le menu ⋯ du bloc Options, remplit les options depuis ce ValueSet.
- Choisir un chemin que FHIR lie en required ou extensible, sur un champ sans ValueSet, le lie pour vous et en fait un select. Les liaisons preferred et example restent à votre choix, tout comme un champ qui nomme déjà une source de référence.
- Un champ de référence choisit son ValueSet dans le bloc Reference Configuration. Il y cherche en direct, donc rien n'est copié.
- Chaque installation contient les 672 ValueSets standard de FHIR. Les formulaires d'enquête n'ont aucun élément lié, donc ils n'affichent pas de ligne **bound:**.

## Codes suggérés

- Pour un champ qui a un FHIR Path, le bloc Codes affiche **Suggested codes** au-dessus de la recherche de termes.
- Un code **Binding** vient du ValueSet du champ, ou du ValueSet auquel FHIR lie l'élément. **Your forms · N** signifie que N autres formulaires mettent ce code sur le même chemin.
- Cliquez sur une ligne pour mettre le code sur le champ.
- **not in your terminology** marque un code que CE ne contient pas. L'ajouter l'ajoute aussi à votre terminologie, et le panneau le dit, avec **Undo**. Undo le retire de votre terminologie ; le code reste sur le champ.
- Seul un utilisateur qui peut gérer la terminologie peut ajouter un tel code. Les autres auteurs le voient grisé.
- Un code d'un système de codage que CE n'a pas est refusé. Ajoutez d'abord le système sur la page Terminology.
- Une liste vide signifie que votre terminologie est incomplète, pas qu'aucun code n'existe. Cherchez plus bas, ou ajoutez des codes sur la page Terminology.
- Quand un ValueSet contient beaucoup de codes, le panneau en affiche 50 qu'aucun formulaire n'utilise, et indique combien il en reste.

## Packs de départ

- Un pack de départ est une liste de champs prête pour un Resource Type, tirée des formulaires fournis avec OpenLDR : Location (Facility), Practitioner (Users), Patient et ServiceRequest (Lab order).
- Quand vous choisissez un Resource Type sur un formulaire vide, son pack s'ouvre tout seul dans un panneau latéral. Sur un formulaire qui a déjà des champs, choisissez **Start from a pack** dans le menu ⋯.
- Chaque entrée dit pourquoi elle est là. Décochez ce que vous ne collectez pas, puis choisissez **Add N fields** dans le menu ⋯ du panneau. L'ajout s'annule en une seule fois.
- Une entrée verrouillée reste cochée, car la page qu'alimente le formulaire ne peut pas enregistrer sans elle.
- Les entrées déjà présentes sur le formulaire n'apparaissent pas dans le panneau.
- Les entrées codées prennent leurs options dans la liste propre à FHIR. Le pack Lab order laisse de côté **Ward / Department**, car ses codes sont locaux ; ajoutez-le depuis **Library** et donnez-lui des options.
- Les formulaires d'enquête et les formulaires sans Resource Type n'ont pas de pack.

## Le volet Library

- Le volet de droite liste les éléments FHIR du Resource Type du formulaire qu'aucun champ n'utilise encore. Cliquez sur un élément pour l'ajouter comme champ ; son éditeur s'ouvre.
- Au-dessus des éléments, **Left out of the pack** liste les entrées du pack absentes du formulaire, dans l'ordre du pack. Cliquez sur une entrée pour l'ajouter.
- Un champ ajouté ainsi prend le nom et le type de l'élément. Un élément codé devient un select, avec des options quand l'élément liste ses codes. Les dates arrivent en champs texte ; changez le type dans l'éditeur.
- Un élément qui appartient à un groupe déjà présent sur le formulaire va dans ce groupe.
- La recherche filtre par nom et par chemin. La liste descend sur deux niveaux, par exemple `Location.address.city`.
- Un formulaire d'enquête n'a pas de **Library**.
- Si l'éditeur fait moins de 980 pixels de large, **Form** et **Library** deviennent des onglets. Un ajout depuis **Library** ramène à **Form**. Replier la barre latérale peut réafficher les deux volets.

## Travailler sur plusieurs champs

- Cliquez sur un champ pour ouvrir son éditeur. Maj-clic sélectionne tous les champs entre le dernier cliqué et celui-ci. Ctrl-clic (Cmd-clic sur Mac) ajoute ou retire un champ. Aucun des deux n'ouvre l'éditeur.
- Ctrl+A (Cmd+A) sélectionne tous les champs affichés par la liste. Échap vide la sélection.
- Avec deux champs ou plus sélectionnés, l'en-tête de la liste en indique le nombre, et son menu ⋯ les déplace vers une section, les active ou les désactive, ou les supprime. La suppression demande confirmation. Chaque action s'annule en une seule fois.
- **Toggle enabled** les désactive tous si au moins la moitié sont actifs, et les active tous sinon. Il ignore les champs verrouillés, tout comme **Delete**.
- Quand aucune zone de saisie ni aucun menu n'a le focus : j et k (ou les flèches) descendent et remontent dans la liste, Entrée ouvre le champ, Espace l'active ou le désactive, d le supprime et Ctrl+D le duplique. Avec deux champs ou plus sélectionnés, Espace et d agissent sur tous. Ctrl+F place le curseur dans la recherche de champs.
- Un téléphone n'a pas de touche Maj ni Ctrl : sur téléphone, on sélectionne un champ à la fois.

## Sections

- Faites glisser un champ par sa poignée. Pendant le glissement, un panneau en haut de la liste affiche **(no section)** et chaque section, avec son nombre de champs. Déposez le champ sur l'une d'elles pour l'y déplacer. Le panneau n'apparaît que si le formulaire a des sections.
- Dans la liste Sections, le menu ⋯ de chaque section propose **Edit visibility**, **Move up**, **Move down** et **Delete**.
- **Edit visibility** ouvre le même éditeur de règle que pour un champ. Seuls les champs actifs peuvent servir dans une condition. La saisie masque la section tant que sa règle n'est pas remplie.
- Un champ ou une section qui a une règle de visibilité affiche une icône de branche.

## Exemple : soumettre une demande de laboratoire

Utilisez une installation de test avec un patient existant, la terminologie LOINC chargée et le workflow d'ingestion actif. Il faut pouvoir modifier et publier les formulaires et soumettre des réponses.

1. Dans Forms, ouvrez le menu ⋯ de la page et choisissez New. Nommez le formulaire Exemple de demande.
2. Sélectionnez R4, le type ServiceRequest et la page cible Forms. Ouvrez l'éditeur.
3. Ajoutez un champ reference actif et obligatoire, nommé Patient. Dans **Reference Configuration**, définissez Target sur Patient. Sous Mapping, définissez FHIR Path sur ServiceRequest.subject.
4. Ajoutez un champ reference actif et obligatoire, nommé Tests. Dans **Reference Configuration**, définissez Target sur le système LOINC installé, http://loinc.org, et FHIR Path sur ServiceRequest.code. Sélectionnez les codes dans la terminologie, sans inventer de code.
5. Enregistrez chaque champ dans son menu ⋯. Vérifiez le message de configuration. Observation Extract n'est pas nécessaire pour ce formulaire ServiceRequest.
6. Dans le menu ⋯ de l'éditeur, choisissez Publish. Corrigez les erreurs éventuelles. La publication enregistre aussi le schéma actuel.
7. Revenez à Forms et choisissez View/Run dans le menu ⋯ du formulaire. Sélectionnez un patient existant et un test chargé dans les listes.
8. Choisissez Submit dans Form actions. Attendez Response captured. La réponse et le ServiceRequest dérivé passent par le workflow d'ingestion.
9. Vérifiez l'exécution du workflow et la demande enregistrée avant de recommencer. En cas de stockage partiel, inspectez d'abord l'exécution : une nouvelle soumission peut créer des doublons.

Si une liste est vide, vérifiez sa source et la terminologie chargée. Activez un workflow désactivé avant de réessayer. Les messages de champ obligatoire utilisent le libellé visible.


## Résultats sur la demande d'examens

Chaque examen choisi sur une demande reçoit une ligne sous le champ Tests. La ligne montre le code et le nom de l'examen, et si son prélèvement est défini. Ouvrir une ligne montre le choix du prélèvement, l'intervalle de référence qui correspond à ce patient, et une saisie par paramètre de résultat.

Une valeur hors de son intervalle est signalée à côté de la saisie. Elle n'est jamais refusée : c'est la paillasse qui décide.

Un examen peut être refusé depuis le menu de sa ligne, et la demande entière depuis le menu de la page, chacun avec un motif pris dans une liste. Un examen refusé est enregistré avec son motif, et n'apparaît pas encore dans les rapports.

Une demande envoyée écrit un enregistrement de résultat par valeur saisie. Les résultats se saisissent avec la demande, en une seule fois. Il n'existe pas encore de moyen de rouvrir une demande envoyée pour les ajouter plus tard.
