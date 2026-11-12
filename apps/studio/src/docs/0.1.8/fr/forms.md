# Formulaires

Les **formulaires** sont les écrans de saisie à la main : une demande d'examens à la réception, un dossier patient, un établissement. Chaque formulaire se construit dans le **Générateur de formulaires** à partir de champs, et chaque champ peut correspondre à un élément FHIR, pour que la saisie devienne un vrai enregistrement. Un formulaire passe de **Brouillon** à **Publié** puis **Archivé**, pour être conçu sans risque avant que quelqu'un l'utilise.

Une installation neuve contient quatre formulaires publiés : **Lab order**, **Patient**, **Users** et **Facility**. Ce guide saisit une demande d'examens avec le formulaire fourni, puis construit et publie votre propre formulaire. Comptez 15 minutes. Sélectionnez une image ou un clip pour l'agrandir.

Le Générateur de formulaires s'affiche dans la langue du studio. Les noms des champs du Lab order fourni, comme **Tests** ou **Priority**, restent en anglais. Ce guide les cite tels qu'ils s'affichent.

![Formulaires : les quatre formulaires fournis, avec leur type FHIR, nombre de champs, version et statut.](forms-tour.png)

## Qui peut faire quoi

| Capacité | Ce qu'elle permet |
| --- | --- |
| **Use forms** | Ouvrir les formulaires et lire leur définition |
| **Submit forms** | Remplir un formulaire avec **View/Run** et l'envoyer. L'envoi écrit des données cliniques |
| **Edit forms** | Créer et modifier des formulaires dans le générateur, et les exporter |
| **Publish forms** | Publier une nouvelle version |

## Avant de commencer

L'Exemple 1 a besoin de trois choses sur l'installation :

1. **Les données d'exemple de la documentation**, pour leurs patients. Voir [Tableaux de bord, Charger les données d'exemple](/docs/dashboard#charger-les-donnees-d-exemple).
2. **Des examens activés dans ce laboratoire.** Le champ **Tests** du Lab order ne liste qu'eux. Suivez d'abord [Catalogue des examens, Exemples 1 et 2](/docs/test-catalog#exemple-2-activer-des-examens-dans-ce-laboratoire).
3. **Le workflow Ingest actif.** Il l'est sur une installation neuve. Un formulaire envoyé passe par lui. Voir [Workflows](/docs/workflows).

> **Utilisez une installation de test.** Envoyer un formulaire écrit une vraie demande, qui ne peut pas être supprimée. Après l'Exemple 1, les données d'exemple comptent 61 demandes, et non 60.

## Exemple 1 : saisir une demande d'examens

![Ouvrir le Lab order, choisir le patient, l'examen, son prélèvement et la priorité.](forms-lab-order.mp4)

1. Ouvrez **Formulaires**. Sur la ligne **Lab order**, ouvrez **⋯** et sélectionnez **View/Run**.
2. Dans **Patient**, tapez `Chausiku` et choisissez **Demo Chausiku**, né le 1994-05-14. Les noms s'affichent nom de famille en premier.
3. Dans **Tests**, tapez `Full` et choisissez **Full blood count**. Une ligne apparaît sous **Results** : **FBC Full blood count**, **Type de prélèvement non défini**.
4. Sélectionnez cette ligne. Dans le panneau, réglez le type de prélèvement sur **Blood**, puis fermez le panneau. La ligne affiche **Blood**.
5. Réglez **Priority** sur **Routine**.

![La demande prête à être envoyée.](forms-lab-order-filled.png)

6. Ouvrez le menu **⋯** de la page et sélectionnez **Submit**.

![Envoyer depuis le menu de la page. Response captured s'affiche.](forms-lab-order-submit.mp4)

**Résultat attendu :** un bandeau vert **Response captured** en haut. La demande passe par le workflow Ingest jusqu'à l'entrepôt, avec le code d'examen `58410-2` et la priorité `routine`. Dans [Patients](/docs/patients), Chausiku Demo a maintenant cinq demandes.

Le formulaire reste rempli après l'envoi. N'envoyez pas de nouveau, sauf pour une seconde demande.

**Referring Facility** cherche dans votre registre d'établissements, par nom ou par code. Un établissement apparaît dès qu'il figure dans [Établissements](/docs/facilities). **Requesting Clinician** prend un nom saisi. La demande garde les deux, qui arrivent donc avec elle dans l'entrepôt.

## Exemple 2 : construire un formulaire depuis un pack de départ

Construisez un formulaire plus court pour les demandes de charge virale à partir du pack Lab order, prévisualisez-le et publiez-le.

![Nommer le formulaire, choisir R4 et ServiceRequest, garder cinq champs du pack et les ajouter.](forms-build.mp4)

1. Sur **Formulaires**, ouvrez le menu **⋯** de la page et sélectionnez **Nouveau**. Le **Générateur de formulaires** s'ouvre.
2. Dans **Nom du formulaire**, tapez `Quick viral load request`.
3. Réglez **Version FHIR** sur **R4 (la plus courante)**.
4. Réglez **Type de ressource** sur **ServiceRequest**. Tapez pour filtrer la longue liste. Le **Pack Lab order** s'ouvre de lui-même, avec **9 sur 9 sélectionnés**. Chaque entrée dit pourquoi elle est là.
5. Décochez **Requesting Clinician**, **Clinical Notes**, **Referring Facility** et **Order rejection**.
6. Ouvrez le menu **⋯** du pack et sélectionnez **Ajouter 5 champs**.

**Résultat attendu :** le générateur liste **5 champs (5 activés)** : Patient, Tests, Results, Priority, et Reference Number sous `identifier`. La **Bibliothèque** à droite liste les entrées du pack laissées de côté, et tous les autres éléments ServiceRequest, à ajouter d'un clic. Une note indique que la soumission est configurée.

![Le générateur avec cinq champs, et la Bibliothèque à côté.](forms-builder.png)

### Le prévisualiser

![Ouvrir Preview depuis le menu du générateur et le remplir de valeurs d'exemple.](forms-preview.mp4)

1. Ouvrez **Actions du générateur**, le **⋯** en haut à droite, et sélectionnez **Aperçu**. Le formulaire s'ouvre dans un panneau, exactement comme un utilisateur le voit.
2. Ouvrez le menu **⋯** du panneau et sélectionnez **Remplir un exemple**. Chaque champ reçoit une valeur d'exemple. **Réinitialiser**, dans le même menu, les efface.

![L'aperçu avec des valeurs d'exemple.](forms-preview-filled.png)

L'aperçu n'envoie jamais rien.

### Le publier

![Publier depuis le menu du générateur.](forms-publish.mp4)

1. Fermez l'aperçu. Ouvrez **Actions du générateur** et sélectionnez **Publier**. Publish enregistre d'abord le formulaire, il n'y a donc pas d'étape d'enregistrement à part.

**Résultat attendu :** un message le confirme, et la pastille d'état à côté du nom passe au vert avec **v1**. Sur **Formulaires**, **Quick viral load request** est listé **Publié**, avec **5** champs.

![Le nouveau formulaire dans la liste, Published.](forms-list-published.png)

Pour le retirer, ouvrez le menu **⋯** de sa ligne et sélectionnez **Supprimer**.

## Le cycle de vie

- **Enregistrer le brouillon**, dans **Actions du générateur**, enregistre sans rien publier.
- **Publier** enregistre le formulaire à l'écran, puis le publie.
- **Comparer** montre les changements entre deux versions.
- **Versions** liste chaque version publiée, la plus récente d'abord, avec sa date. Elle est grisée tant que le formulaire n'a jamais été enregistré.
- **Restaurer**, dans les actions d'une version, la remet en place. Cela remplace le formulaire en cours d'édition, et un formulaire publié repasse tout de suite en brouillon. Il disparaît de View/Run jusqu'à la prochaine publication. Undo dans le générateur ne change que l'écran : enregistrez pour l'écrire.
- Décocher un champ dans la liste le désactive : il n'est ni affiché, ni validé, et ne recueille aucune réponse. Il reste dans le formulaire pour être réactivé.
- Le menu de chaque ligne de la liste duplique, compare, publie, archive, exporte (aussi en paquet marketplace) ou supprime le formulaire.
- **Libellé de version** est une légende libre. Le numéro de version est donné à la publication et s'affiche à côté du statut.

## Conditions de soumission

La publication permet le partage et les éditeurs intégrés. Elle ne garantit pas les soumissions View/Run. La saisie prend actuellement en charge ServiceRequest et les champs de réponse actifs avec Extraction en Observation et au moins un code. Un formulaire texte personnalisé sans extraction ne peut pas être soumis. Les modèles Patient et Facility restent utilisables dans leurs éditeurs dédiés.

L’éditeur et la page de saisie indiquent cette capacité avant la saisie. Pour une observation, ouvrez la fiche du champ, sélectionnez un code terminologique sous Codes et cochez Extraction en Observation sous Correspondance. Activez le champ, enregistrez et publiez. Renseignez au moins un champ d'extraction : un champ vide ou masqué ne produit aucune Observation.

Ce contrôle porte sur la configuration. Les réponses obligatoires, les références et le workflow d'ingestion actif doivent encore être validés.

## Structure de la liste des champs

- **L'entrée d'une liste remplie par un champ.** Un champ lié à une entrée d'une liste FHIR affiche une deuxième ligne sous son chemin, par exemple `system = urn:x`. Deux champs sur `Location.identifier.value` ne diffèrent que par cette ligne.
- **Emplacements d'une même liste.** Les champs qui partagent une liste et ont un discriminateur et un champ de valeur sont réunis sous un en-tête. L'en-tête indique le nom de la liste, son chemin et le nombre d'emplacements. La liste le déduit des champs : on ne peut ni le déplacer ni le supprimer.
- **Les formulaires fournis.** Le formulaire Patient réunit le prénom et le nom sous `Patient.name`, et le téléphone sous `Patient.telecom`. Le formulaire Users réunit le prénom et le nom sous `Practitioner.name`, et l'adresse e-mail sous `Practitioner.telecom`. Le formulaire Facility place son code sous `Location.identifier`, et le formulaire Lab order place son numéro de référence sous `ServiceRequest.identifier`. Une installation dont l'opérateur a modifié l'un de ces formulaires garde ses propres champs.
- **Groupes imbriqués.** Définissez le **Groupe** d'un groupe pour le placer dans un autre groupe, à n'importe quelle profondeur. Le sélecteur ne propose jamais le groupe lui-même ni ce qu'il contient déjà.
- **L'icône de répétition.** Un champ qui accepte plusieurs réponses, ou un groupe qui contient plusieurs entrées, affiche une icône de répétition. Un groupe contient une seule entrée s'il est lié à un élément unique, comme `Location.address`, ou si **Nombre max d'éléments** vaut 1. L'export Questionnaire marque alors ce groupe comme non répétable.
- La saisie affiche encore chaque groupe une seule fois. L'ajout d'entrées à un groupe pendant la saisie arrivera dans une version ultérieure.

## Modifier un champ

- **L'entrée d'une liste.** Sous Correspondance, cochez **Élément de liste (discriminant)**. Chaque condition est un élément, un opérateur et une valeur, par exemple `system` `equals` `urn:x`. Les opérateurs sont `equals`, `not equals` et `starts with`. À partir de deux conditions, choisissez **Toutes** si toutes doivent être vraies, ou **L'une** si une seule suffit. **Champ de valeur** désigne l'élément qui porte la réponse, en général `value`.
- Le discriminateur sert aux contrôles du formulaire et à l'export Questionnaire. La saisie ne l'utilise pas encore, à une exception près : quand une demande Lab order est soumise, son numéro de référence porte le `system` que nomme son discriminateur.
- **Un autre emplacement.** Sous le dernier emplacement d'une liste, **+ Ajouter un emplacement nommé** ajoute une copie avec le même chemin, le même champ de valeur et le même type, et des valeurs de discriminateur vides. La propriété API, les codes et les traductions restent vides.
- **Parties d'un groupe.** L'éditeur d'un groupe liste ses parties après Correspondance. Cliquez sur une partie pour la modifier. Vos modifications non enregistrées du groupe sont d'abord enregistrées. **+ Ajouter une partie** ajoute un champ dans le groupe, sans chemin FHIR.
- **Champs reference.** Un champ référence a un bloc **Configuration de la référence** après Général. **Cible** vaut `Patient` ou un système de codes actif. **Recherchable** est enregistré et exporté, mais la saisie ne l'utilise pas encore. **Dépend de** sert dans un seul cas : un champ qui dépend d'un champ Tests lié à la liste des examens de ce laboratoire ne propose que les prélèvements acceptés par les examens choisis. La demande d'examens livrée ne s'en sert plus : chaque examen porte son propre prélèvement (voir Catalogue des examens). Tout autre réglage **Dépend de** est enregistré mais pas utilisé.
- **Champs verrouillés.** Un champ verrouillé ne peut être ni désactivé ni supprimé depuis la liste. Vous pouvez encore le renommer, le déplacer et le traduire.
- **Formulaires d'enquête.** Si le Type de ressource du formulaire est `Questionnaire`, l'éditeur masque Chemin FHIR, Propriété d'API et le discriminateur. Extraction en Observation et les autres réglages restent.

## Options et ValueSets

- Un champ liste ou liste multiple peut prendre ses options dans un ValueSet. Dans le bloc Options, cherchez un ValueSet et choisissez-le. Ses codes sont copiés dans les options, et le champ garde un lien vers le ValueSet avec une force. Une force required empêche la saisie d'accepter d'autres valeurs.
- **Délier**, dans le menu ⋯ du bloc Options, retire le lien et garde les options. **Enregistrer comme nouveau jeu de valeurs** transforme des options saisies en un ValueSet réutilisable ; il n'apparaît que si vous pouvez gérer la terminologie.
- Sous le Chemin FHIR, **lié :** nomme le ValueSet auquel FHIR lui-même lie cet élément, et avec quelle force. **Charger depuis la terminologie**, dans le menu ⋯ du bloc Options, remplit les options depuis ce ValueSet.
- Choisir un chemin que FHIR lie en required ou extensible, sur un champ sans ValueSet, le lie pour vous et en fait une liste. Les liaisons preferred et example restent à votre choix, tout comme un champ qui nomme déjà une source de référence.
- Un champ de référence choisit son ValueSet dans le bloc Reference Configuration. Il y cherche en direct, donc rien n'est copié.
- Chaque installation contient les 672 ValueSets standard de FHIR. Les formulaires d'enquête n'ont aucun élément lié, donc ils n'affichent pas de ligne **lié :**.

## Codes suggérés

- Pour un champ qui a un Chemin FHIR, le bloc Codes affiche **Codes suggérés** au-dessus de la recherche de termes.
- Un code **Liaison** vient du ValueSet du champ, ou du ValueSet auquel FHIR lie l'élément. **Vos formulaires · N** signifie que N autres formulaires mettent ce code sur le même chemin.
- Cliquez sur une ligne pour mettre le code sur le champ.
- **absent de votre terminologie** marque un code que CE ne contient pas. L'ajouter l'ajoute aussi à votre terminologie, et le panneau le dit, avec **Annuler**. Undo le retire de votre terminologie ; le code reste sur le champ.
- Seul un utilisateur qui peut gérer la terminologie peut ajouter un tel code. Les autres auteurs le voient grisé.
- Un code d'un système de codage que CE n'a pas est refusé. Ajoutez d'abord le système sur la page Terminology.
- Une liste vide signifie que votre terminologie est incomplète, pas qu'aucun code n'existe. Cherchez plus bas, ou ajoutez des codes sur la page Terminology.
- Quand un ValueSet contient beaucoup de codes, le panneau en affiche 50 qu'aucun formulaire n'utilise, et indique combien il en reste.

## Packs de départ

- Un pack de départ est une liste de champs prête pour un Type de ressource, tirée des formulaires fournis avec OpenLDR : Location (Facility), Practitioner (Users), Patient et ServiceRequest (Lab order).
- Quand vous choisissez un Type de ressource sur un formulaire vide, son pack s'ouvre tout seul dans un panneau latéral. Sur un formulaire qui a déjà des champs, choisissez **Partir d'un pack** dans le menu ⋯.
- Chaque entrée dit pourquoi elle est là. Décochez ce que vous ne collectez pas, puis choisissez **Ajouter N champs** dans le menu ⋯ du panneau. L'ajout s'annule en une seule fois.
- Une entrée verrouillée reste cochée, car la page qu'alimente le formulaire ne peut pas enregistrer sans elle.
- Les entrées déjà présentes sur le formulaire n'apparaissent pas dans le panneau.
- Les entrées codées prennent leurs options dans la liste propre à FHIR. Le pack Lab order laisse de côté **Ward / Department**, car ses codes sont locaux ; ajoutez-le depuis **Bibliothèque** et donnez-lui des options.
- Les formulaires d'enquête et les formulaires sans Type de ressource n'ont pas de pack.

## Le volet Bibliothèque

- Le volet de droite liste les éléments FHIR du Type de ressource du formulaire qu'aucun champ n'utilise encore. Cliquez sur un élément pour l'ajouter comme champ ; son éditeur s'ouvre.
- Au-dessus des éléments, **Laissés hors du pack** liste les entrées du pack absentes du formulaire, dans l'ordre du pack. Cliquez sur une entrée pour l'ajouter.
- Un champ ajouté ainsi prend le nom et le type de l'élément. Un élément codé devient une liste, avec des options quand l'élément liste ses codes. Les dates arrivent en champs texte ; changez le type dans l'éditeur.
- Un élément qui appartient à un groupe déjà présent sur le formulaire va dans ce groupe.
- La recherche filtre par nom et par chemin. La liste descend sur deux niveaux, par exemple `Location.address.city`.
- Un formulaire d'enquête n'a pas de **Bibliothèque**.
- Si l'éditeur fait moins de 980 pixels de large, **Formulaire** et **Bibliothèque** deviennent des onglets. Un ajout depuis **Bibliothèque** ramène à **Formulaire**. Replier la barre latérale peut réafficher les deux volets.

## Travailler sur plusieurs champs

- Cliquez sur un champ pour ouvrir son éditeur. Maj-clic sélectionne tous les champs entre le dernier cliqué et celui-ci. Ctrl-clic (Cmd-clic sur Mac) ajoute ou retire un champ. Aucun des deux n'ouvre l'éditeur.
- Ctrl+A (Cmd+A) sélectionne tous les champs affichés par la liste. Échap vide la sélection.
- Avec deux champs ou plus sélectionnés, l'en-tête de la liste en indique le nombre, et son menu ⋯ les déplace vers une section, les active ou les désactive, ou les supprime. La suppression demande confirmation. Chaque action s'annule en une seule fois.
- **Activer ou désactiver** les désactive tous si au moins la moitié sont actifs, et les active tous sinon. Il ignore les champs verrouillés, tout comme **Supprimer**.
- Quand aucune zone de saisie ni aucun menu n'a le focus : j et k (ou les flèches) descendent et remontent dans la liste, Entrée ouvre le champ, Espace l'active ou le désactive, d le supprime et Ctrl+D le duplique. Avec deux champs ou plus sélectionnés, Espace et d agissent sur tous. Ctrl+F place le curseur dans la recherche de champs.
- Un téléphone n'a pas de touche Maj ni Ctrl : sur téléphone, on sélectionne un champ à la fois.

## Sections

- Faites glisser un champ par sa poignée. Pendant le glissement, un panneau en haut de la liste affiche **(aucune section)** et chaque section, avec son nombre de champs. Déposez le champ sur l'une d'elles pour l'y déplacer. Le panneau n'apparaît que si le formulaire a des sections.
- Dans la liste Sections, le menu ⋯ de chaque section propose **Modifier la visibilité**, **Monter**, **Descendre** et **Supprimer**.
- **Modifier la visibilité** ouvre le même éditeur de règle que pour un champ. Seuls les champs actifs peuvent servir dans une condition. La saisie masque la section tant que sa règle n'est pas remplie.
- Un champ ou une section qui a une règle de visibilité affiche une icône de branche.

## Exemple : soumettre une demande de laboratoire

Utilisez une installation de test avec un patient existant, la terminologie LOINC chargée et le workflow d'ingestion actif. Il faut pouvoir modifier et publier les formulaires et soumettre des réponses.

1. Dans Forms, ouvrez le menu ⋯ de la page et choisissez New. Nommez le formulaire Exemple de demande.
2. Sélectionnez R4, le type ServiceRequest et la page cible Forms. Ouvrez l'éditeur.
3. Ajoutez un champ référence actif et obligatoire, nommé Patient. Dans **Configuration de la référence**, définissez Cible sur Patient. Sous Correspondance, définissez Chemin FHIR sur ServiceRequest.subject.
4. Ajoutez un champ référence actif et obligatoire, nommé Tests. Dans **Configuration de la référence**, définissez Cible sur le système LOINC installé, http://loinc.org, et Chemin FHIR sur ServiceRequest.code. Sélectionnez les codes dans la terminologie, sans inventer de code.
5. Enregistrez chaque champ dans son menu ⋯. Vérifiez le message de configuration. Extraction en Observation n'est pas nécessaire pour ce formulaire ServiceRequest.
6. Dans le menu ⋯ de l'éditeur, choisissez Publish. Corrigez les erreurs éventuelles. La publication enregistre aussi le schéma actuel.
7. Revenez à Forms et choisissez View/Run dans le menu ⋯ du formulaire. Sélectionnez un patient existant et un test chargé dans les listes.
8. Choisissez Submit dans Form actions. Attendez Response captured. La réponse et le ServiceRequest dérivé passent par le workflow d'ingestion.
9. Vérifiez l'exécution du workflow et la demande enregistrée avant de recommencer. En cas de stockage partiel, inspectez d'abord l'exécution : une nouvelle soumission peut créer des doublons.

Si une liste est vide, vérifiez sa source et la terminologie chargée. Activez un workflow désactivé avant de réessayer. Les messages de champ obligatoire utilisent le libellé visible.


## Choisir les examens sur la demande d'examens

Tapez au moins deux caractères du code ou du nom d'un examen dans le champ Tests pour le chercher. Si vous ne connaissez ni l'un ni l'autre, ouvrez le menu ⋯ à côté du libellé Tests et choisissez **Parcourir tous les examens**. Le volet liste tout le catalogue page par page, avec une recherche et un filtre par catégorie.

Choisissez un examen pour l'ajouter à ceux déjà choisis. Un examen que ce laboratoire ne réalise pas est marqué **Non proposé ici** et ne peut pas être choisi, car la demande serait refusée à l'envoi. Une personne qui peut gérer le catalogue l'active depuis la page Catalogue des examens.

Une installation sans catalogue chargé n'a rien à parcourir, et le volet le dit. Les examens viennent de la page Catalogue des examens, où un laboratoire importe sa liste. OpenLDR ne fournit aucun examen.

## Résultats sur la demande d'examens

Chaque examen choisi sur une demande reçoit une ligne sous le champ Tests. La ligne montre le code et le nom de l'examen, et si son prélèvement est défini. Ouvrir une ligne montre le choix du prélèvement, l'intervalle de référence qui correspond à ce patient, et une saisie par paramètre de résultat.

Une valeur hors de son intervalle est signalée à côté de la saisie. Elle n'est jamais refusée : c'est la paillasse qui décide.

Chaque résultat numérique a un sélecteur d'intervalle sous sa saisie, qui liste chaque intervalle par son nom, ou, s'il n'en a pas, par qui il vise. Il démarre sur l'intervalle qui correspond au patient. Choisir un intervalle qui ne correspond pas affiche un avertissement et reste permis. Le signalement suit l'intervalle choisi. Si les intervalles de l'examen ont changé depuis l'ouverture du panneau, l'envoi de la demande est refusé. Rouvrez l'examen et choisissez de nouveau un intervalle.

Un examen peut être refusé depuis le menu de sa ligne, avec un motif pris dans une liste. Un examen refusé est enregistré avec son motif, mais le motif n'atteint pas les rapports. Sur sa demande, l'examen apparaît comme une ligne de résultat sans valeur.

La demande entière peut être refusée depuis le menu de la page, avec **Refuser la demande**. Choisissez un motif dans la liste. Si les motifs ne peuvent pas être lus, le panneau le dit et vous ne pouvez pas refuser. Rien ne réessaie de lui-même, donc fermez le panneau et rouvrez-le. Une fois la demande refusée, une ligne sous l'en-tête montre le motif, et chaque ligne d'examen indique "Demande refusée" et est fermée à la saisie. Les valeurs déjà saisies restent à l'écran mais ne sont pas écrites. **Annuler le refus**, dans le même menu, rouvre les lignes.

Une demande refusée est marquée comme refusée, avec le code et le texte du motif. Le motif parvient au dossier du laboratoire (le code et le motif de refus sur la demande), donc un rapport peut la compter. Le code de refus de la demande se trouve au même endroit que les codes de refus qui arrivent du système du laboratoire, donc un rapport qui regroupe par code voit les deux sortes. Aucun résultat n'est écrit pour une demande refusée.

Chaque résultat écrit est lié à sa demande, pour que les rapports puissent joindre un résultat à la demande dont il vient.

Une demande envoyée écrit un enregistrement de résultat par valeur saisie. Les résultats se saisissent avec la demande, en une seule fois. Il n'existe pas encore de moyen de rouvrir une demande envoyée pour les ajouter plus tard.

## Validation des chemins FHIR

Quand un formulaire correspond à un type de ressource FHIR, le générateur vérifie le chemin FHIR de chaque champ dans la liste des éléments. Un badge rouge est une erreur qui bloque la publication. Un badge jaune est un avertissement qui ne la bloque pas, mais à revoir. Le générateur ne vérifie que neuf types de ressource courants. Les autres types n'ont aucun badge, car leurs chemins ne sont pas vérifiés.

- **unknown-fhir-path (erreur).** Le chemin n'est pas un élément de ce type de ressource. En général une faute de frappe : vérifiez l'orthographe et la profondeur.
- **facility-admin-order (erreur).** Les niveaux administratifs de l'établissement sont liés aux parties d'adresse FHIR dans le mauvais ordre. FHIR Address a quatre niveaux, le registre six. Zone est le niveau sans place : effacez le chemin FHIR du champ Zone et laissez-le sans correspondance. Un formulaire Facility enregistré par une ancienne migration peut encore lier Zone à `address.district`. Aucune migration ne le corrige : effacez ce chemin à la main.
- **fhir-path-cardinality (avertissement).** Le chemin passe par un élément répétable sans discriminateur. Ajoutez un discriminateur FHIR au champ pour choisir l'occurrence.
- **fhir-path-type-mismatch (avertissement).** Un champ simple est lié à un élément FHIR structuré qu'une seule valeur ne peut pas remplir. Changez le type de champ, ou liez un chemin plus précis.

## En ligne de commande

- `openldr forms lint` donne les mêmes constats sans le studio. Passez un id de formulaire pour n'en vérifier qu'un, et `--json` pour une sortie structurée. La commande sort en erreur dès qu'une erreur existe.
- `openldr forms versions <id>` liste les versions publiées d'un formulaire, la plus récente d'abord.
- `openldr forms restore <id> <version> --force` remet une version publiée à la place du brouillon. Elle refuse sans `--force`.

## Limites

- **Un Lab order modifié garde l'ancien Referring Facility.** La mise à jour ne change le Lab order fourni que si personne ne l'a modifié. Sur une copie modifiée, Referring Facility reste un champ de texte, et la demande ne le garde pas. Pour corriger, ouvrez le champ. Mettez **Type de champ** à `référence` : le bloc **Configuration de la référence** apparaît. Mettez-y **Cible** à `urn:openldr:cs:facility-registry`. Mettez **Chemin FHIR** à `ServiceRequest.requester`. Cochez **Élément de liste (discriminant)** et faites correspondre `type` égal à `Organization`. Donnez ensuite le même chemin à **Requesting Clinician**, avec `type` égal à `Practitioner`.
- **La saisie affiche chaque groupe une seule fois.** Ajouter des entrées à un groupe pendant la saisie n'est pas encore possible.
- **Une demande envoyée ne se modifie pas.** Les résultats se saisissent avec la demande, en une fois.

## Sur un téléphone

Les formulaires fonctionnent sur un téléphone. **View/Run** place chaque libellé au-dessus de son champ. L'aperçu du générateur s'ouvre aussi en panneau. Un téléphone n'a pas de touche Maj ou Ctrl, donc dans le générateur on sélectionne un champ à la fois. Sous 980 pixels de large, **Formulaire** et **Bibliothèque** deviennent des onglets.

## Dépannage

- **Le champ Tests du Lab order est vide.** Aucun examen n'est activé dans ce laboratoire. Voir [Catalogue des examens](/docs/test-catalog).
- **La recherche de patient ne trouve personne.** Elle demande une partie du nom, un identifiant ou un téléphone. Sans **View patient identifiers**, elle ne trouve qu'un identifiant exact. Voir [Patients](/docs/patients).
- **L'envoi échoue.** Lisez le message. Un champ obligatoire est vide, ou le workflow Ingest est désactivé.
- **L'envoi semble ne rien faire.** Chaque action se confirme par un message. Sans message, l'action n'a pas eu lieu.
- **Publish n'est pas disponible.** Complétez les métadonnées obligatoires ou corrigez un champ mal configuré.
- **Un champ désactivé apparaît encore.** Vérifiez que sa case est décochée, puis enregistrez.

## Guides associés

- [Catalogue des examens](/docs/test-catalog)
- [Patients](/docs/patients)
- [Terminologie](/docs/terminology)
- [Workflows](/docs/workflows)
- [Marketplace](/docs/marketplace)
