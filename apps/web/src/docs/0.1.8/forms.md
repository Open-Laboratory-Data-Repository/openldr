# Form submissions

## English

### Submission eligibility

Publishing makes a form available for sharing and embedded editors. It does not guarantee View/Run submissions. Capture currently supports ServiceRequest forms and enabled answer fields with Observation Extract and at least one code. A plain custom text form without extraction cannot submit. Patient and Facility templates can still serve their dedicated editors.

The builder and capture page show eligibility before entry. For observations, open the field sheet, select a terminology code under Codes, and check Observation Extract under Mapping. Enable the field. Save and publish. Answer at least one extraction field during capture; an unanswered or hidden extraction field produces no Observation.

Eligibility checks configuration only. Required answers, reference validation, and the enabled ingest workflow must still succeed.

### Example: submit a lab request

Use a test installation with an existing patient, loaded LOINC terminology, and an enabled ingest workflow. You need permission to edit and publish forms and submit responses.

1. In Forms, open the page's ⋯ menu and choose New. Name the form Lab request example.
2. Set FHIR version to R4, resource type to ServiceRequest, and target page to Forms. Open the builder.
3. Add an enabled, required reference field labeled Patient. In **Reference Configuration**, set Target to Patient. Under Mapping, set FHIR Path to ServiceRequest.subject.
4. Add an enabled, required reference field labeled Tests. In **Reference Configuration**, set Target to the installed LOINC system, http://loinc.org. Set FHIR Path to ServiceRequest.code. Choose codes through the terminology picker; do not enter a made-up code.
5. Save each field through its ⋯ menu. Confirm the submission configuration message. No Observation Extract flag is needed for this ServiceRequest form.
6. Open the builder's ⋯ menu and choose Publish. Resolve any publish errors. Publishing also saves the current schema.
7. Return to Forms and choose View/Run from the form's ⋯ menu. Select an existing patient and one loaded test from the lists.
8. Choose Submit from Form actions. Wait for Response captured. The response and derived ServiceRequest enter the ingest workflow.
9. Check the corresponding workflow run and stored request before repeating the submission. If the server reports partial persistence, inspect the run first; a retry can create duplicates.

If a reference list is empty, check the configured source and loaded terminology. If the workflow is disabled, enable it before retrying. Required-field messages identify the field by its visible label.

### How the field list shows structure

- **Which entry of a list a field fills.** A field bound to one entry of a FHIR list shows a second line under its path, such as `system = urn:x`. Two fields on `Location.identifier.value` differ only by this line.
- **Slots of one list.** Fields that share a list and have both a discriminator and a value field sit under one header. The header shows the list name, its path, and how many slots it has. The list draws it from the fields, so it cannot be dragged or deleted.
- **The shipped forms.** The Patient form draws its first and last name under `Patient.name` and its phone under `Patient.telecom`. The Users form draws its first and last name under `Practitioner.name` and its email under `Practitioner.telecom`. The Facility form draws its code under `Location.identifier`, and the Lab order form draws its reference number under `ServiceRequest.identifier`. An install whose operator has edited either form keeps its own fields.
- **Groups inside groups.** Set a group's **Group** to put it inside another group, to any depth. The picker never offers the group itself or anything already inside it.
- **The repeat icon.** A field that takes more than one answer, or a group that holds many entries, shows a repeat icon. A group holds one entry when it is bound to an element that holds one, such as `Location.address`, or when **Max Items** is 1. The Questionnaire export marks such a group as not repeating.
- Data entry still shows every group once. Adding more entries to a group during data entry comes in a later release.

### Editing a field

- **Which entry of a list.** Under Mapping, tick **Array element (discriminator)**. Each condition is an element, an operator, and a value, such as `system` `equals` `urn:x`. The operators are `equals`, `not equals`, and `starts with`. With two or more conditions, choose **All** when every condition must hold, or **Any** when one is enough. **Value Field** names the element that holds the answer, usually `value`.
- A discriminator is used by the form checks and the Questionnaire export. Data entry does not use it yet, with one exception: when a Lab order is submitted, its reference number carries the `system` its discriminator names.
- **Another slot.** Under the last slot of a list, **+ Add a named slot** adds a copy with the same path, value field, and type, and blank discriminator values. The API property, codes, and translations are left blank.
- **Parts of a group.** A group's editor lists its parts after Mapping. Click one to edit it. Your unsaved changes to the group are saved first. **+ Add a part** adds a field inside the group with no FHIR path.
- **Reference fields.** A reference field has a **Reference Configuration** block after General. **Target** is `Patient` or an active code system. **Searchable** is saved and exported, but data entry does not use it yet. **Depends On** is used in one case: a field that depends on a Tests field bound to this lab's test list offers only the specimens the chosen tests accept (see Test catalog). Any other **Depends On** setting is saved but not used.
- **Locked fields.** A locked field cannot be switched off or deleted from the field list. You can still relabel, reorder, and translate it.
- **Survey forms.** When the form's Resource Type is `Questionnaire`, the editor hides FHIR Path, API Property, and the discriminator. Observation Extract and the other settings stay.

### Options and ValueSets

- A select or multiselect field can take its options from a ValueSet. In the Options block, search for a set and pick it. Its codes are copied into the options, and the field keeps a link to the set with a strength. A required strength stops data entry accepting other values.
- **Unbind**, in the Options ⋯ menu, drops the link and keeps the options. **Save as a new ValueSet** turns typed options into a set you can reuse; it shows only if you may manage terminology.
- Under the FHIR path, **bound:** names the ValueSet FHIR itself binds that element to, and how strongly. **Load from terminology**, in the Options ⋯ menu, fills the options from that set.
- Picking a path FHIR binds as required or extensible, on a field with no ValueSet, binds it for you and makes it a select. Preferred and example bindings are left to you, and so is a field that already names a reference source.
- A reference field picks its ValueSet in the Reference Configuration block. It searches the set live, so nothing is copied.
- Every install holds FHIR's 672 standard ValueSets. Survey forms have no bound elements, so they show no **bound:** line.

### Suggested codes

- For a field with a FHIR path, the Codes block lists **Suggested codes** above the term search.
- A **Binding** code comes from the field's ValueSet, or from the set FHIR binds the element to. **Your forms · N** means N other forms put that code on the same path.
- Click a row to put the code on the field.
- **not in your terminology** marks a code CE does not hold. Adding it also adds it to your terminology, and the panel says so, with **Undo**. Undo removes it from your terminology; the code stays on the field.
- Only a user who can manage terminology can add such a code. Other authors see it greyed.
- A code from a coding system CE does not have is refused. Add the system on the Terminology page first.
- An empty list means your terminology is thin, not that no code exists. Search below, or add codes on the Terminology page.
- When a set holds many codes, the panel shows 50 that no form uses, and says how many more there are.

### Starter packs

- A starter pack is a ready list of fields for one resource type, taken from the forms OpenLDR ships: Location (Facility), Practitioner (Users), Patient, and ServiceRequest (Lab order).
- When you pick a resource type on an empty form, its pack opens by itself in a sheet. On a form that has fields, choose **Start from a pack** from the ⋯ menu.
- Each entry says why it is there. Uncheck what you do not collect, then choose **Add N fields** from the sheet's ⋯ menu. Adding is one undo step.
- A locked entry stays checked, because the page the form feeds cannot save a record without it.
- Entries already on the form are left out of the sheet.
- Coded entries take their options from FHIR's own list. The Lab order pack leaves out Ward / Department, because its codes are local; add it from the Library and give it options.
- Survey forms and forms with no resource type have no pack.

### The Library

- The pane on the right lists the FHIR elements of the form's resource type that no field uses yet. Click one to add it as a field; its editor opens.
- Above the elements, **Left out of the pack** lists the pack entries the form does not have, in the pack's order. Click one to add it.
- A field added this way is named from the element and typed from it. Coded elements become a select, with options when the element lists its codes. Dates arrive as text fields; change the type in the editor.
- An element inside a group that is already on the form goes into that group.
- Search filters by name and path. The list goes two levels deep, such as `Location.address.city`.
- A survey form has no Library.
- When the builder is narrower than 980 pixels, Form and Library become tabs. Adding from the Library switches back to Form. Collapsing the sidebar can bring both panes back.

### Working with many fields

- Click a field to open its editor. Shift-click selects every field from the last one you clicked to this one. Ctrl-click (Cmd-click on a Mac) adds or removes one field. Neither opens the editor.
- Ctrl+A (Cmd+A) selects every field the list shows. Escape clears the selection.
- With two or more selected, the list header shows how many, and its ⋯ menu moves them to a section, switches them on or off, or deletes them. Delete asks first. Each is one undo step.
- **Toggle enabled** switches them all off when at least half are on, and all on otherwise. It skips locked fields, and so does **Delete**.
- When no box or menu has focus: j and k (or the arrow keys) move down and up the list, Enter opens the field, Space switches it on or off, d deletes it, and Ctrl+D duplicates it. With two or more selected, Space and d act on all of them. Ctrl+F jumps to the field search.
- A phone has no Shift or Ctrl key, so on a phone you select one field at a time.

### Sections

- Drag a field by its handle. While you drag, a panel at the top of the list shows **(no section)** and each section, with how many fields it has. Drop the field on one to move it there. The panel only appears when the form has sections.
- In the Sections list, each section's ⋯ menu has **Edit visibility**, **Move up**, **Move down** and **Delete**.
- **Edit visibility** opens the same rule editor a field has. Only enabled fields can be used in a condition. Data entry hides the section while its rule is not met.
- A field or section with a visibility rule shows a branch icon.



On a Lab order, each chosen test gets a row where the bench types its results, sees the reference range that fits the patient, and can reject the test or the whole order with a coded reason. Results are typed with the order, in one pass.

## Français

### Conditions de soumission

La publication permet le partage et les éditeurs intégrés. Elle ne garantit pas les soumissions View/Run. La saisie prend actuellement en charge ServiceRequest et les champs de réponse actifs avec Observation Extract et au moins un code. Un formulaire texte personnalisé sans extraction ne peut pas être soumis. Les modèles Patient et Facility restent utilisables dans leurs éditeurs dédiés.

L'éditeur et la page de saisie indiquent cette capacité avant la saisie. Pour une observation, ouvrez la fiche du champ, sélectionnez un code terminologique sous Codes et cochez Observation Extract sous Mapping. Activez le champ, enregistrez et publiez. Renseignez au moins un champ d'extraction : un champ vide ou masqué ne produit aucune Observation.

Ce contrôle porte sur la configuration. Les réponses obligatoires, les références et le workflow d'ingestion actif doivent encore être validés.

### Exemple : soumettre une demande de laboratoire

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

### Structure de la liste des champs

- **L'entrée d'une liste remplie par un champ.** Un champ lié à une entrée d'une liste FHIR affiche une deuxième ligne sous son chemin, par exemple `system = urn:x`. Deux champs sur `Location.identifier.value` ne diffèrent que par cette ligne.
- **Emplacements d'une même liste.** Les champs qui partagent une liste et ont un discriminateur et un champ de valeur sont réunis sous un en-tête. L'en-tête indique le nom de la liste, son chemin et le nombre d'emplacements. La liste le déduit des champs : on ne peut ni le déplacer ni le supprimer.
- **Les formulaires fournis.** Le formulaire Patient réunit le prénom et le nom sous `Patient.name`, et le téléphone sous `Patient.telecom`. Le formulaire Users réunit le prénom et le nom sous `Practitioner.name`, et l'adresse e-mail sous `Practitioner.telecom`. Le formulaire Facility place son code sous `Location.identifier`, et le formulaire Lab order place son numéro de référence sous `ServiceRequest.identifier`. Une installation dont l'opérateur a modifié l'un de ces formulaires garde ses propres champs.
- **Groupes imbriqués.** Définissez le **Group** d'un groupe pour le placer dans un autre groupe, à n'importe quelle profondeur. Le sélecteur ne propose jamais le groupe lui-même ni ce qu'il contient déjà.
- **L'icône de répétition.** Un champ qui accepte plusieurs réponses, ou un groupe qui contient plusieurs entrées, affiche une icône de répétition. Un groupe contient une seule entrée s'il est lié à un élément unique, comme `Location.address`, ou si **Max Items** vaut 1. L'export Questionnaire marque alors ce groupe comme non répétable.
- La saisie affiche encore chaque groupe une seule fois. L'ajout d'entrées à un groupe pendant la saisie arrivera dans une version ultérieure.

### Modifier un champ

- **L'entrée d'une liste.** Sous Mapping, cochez **Array element (discriminator)**. Chaque condition est un élément, un opérateur et une valeur, par exemple `system` `equals` `urn:x`. Les opérateurs sont `equals`, `not equals` et `starts with`. À partir de deux conditions, choisissez **All** si toutes doivent être vraies, ou **Any** si une seule suffit. **Value Field** désigne l'élément qui porte la réponse, en général `value`.
- Le discriminateur sert aux contrôles du formulaire et à l'export Questionnaire. La saisie ne l'utilise pas encore, à une exception près : quand une demande Lab order est soumise, son numéro de référence porte le `system` que nomme son discriminateur.
- **Un autre emplacement.** Sous le dernier emplacement d'une liste, **+ Add a named slot** ajoute une copie avec le même chemin, le même champ de valeur et le même type, et des valeurs de discriminateur vides. La propriété API, les codes et les traductions restent vides.
- **Parties d'un groupe.** L'éditeur d'un groupe liste ses parties après Mapping. Cliquez sur une partie pour la modifier. Vos modifications non enregistrées du groupe sont d'abord enregistrées. **+ Add a part** ajoute un champ dans le groupe, sans chemin FHIR.
- **Champs reference.** Un champ reference a un bloc **Reference Configuration** après General. **Target** vaut `Patient` ou un système de codes actif. **Searchable** est enregistré et exporté, mais la saisie ne l'utilise pas encore. **Depends On** sert dans un seul cas : un champ qui dépend d'un champ Tests lié à la liste des examens de ce laboratoire ne propose que les prélèvements acceptés par les examens choisis (voir Catalogue des examens). Tout autre réglage **Depends On** est enregistré mais pas utilisé.
- **Champs verrouillés.** Un champ verrouillé ne peut être ni désactivé ni supprimé depuis la liste. Vous pouvez encore le renommer, le déplacer et le traduire.
- **Formulaires d'enquête.** Si le Resource Type du formulaire est `Questionnaire`, l'éditeur masque FHIR Path, API Property et le discriminateur. Observation Extract et les autres réglages restent.

### Options et ValueSets

- Un champ select ou multiselect peut prendre ses options dans un ValueSet. Dans le bloc Options, cherchez un ValueSet et choisissez-le. Ses codes sont copiés dans les options, et le champ garde un lien vers le ValueSet avec une force. Une force required empêche la saisie d'accepter d'autres valeurs.
- **Unbind**, dans le menu ⋯ du bloc Options, retire le lien et garde les options. **Save as a new ValueSet** transforme des options saisies en un ValueSet réutilisable ; il n'apparaît que si vous pouvez gérer la terminologie.
- Sous le FHIR Path, **bound:** nomme le ValueSet auquel FHIR lui-même lie cet élément, et avec quelle force. **Load from terminology**, dans le menu ⋯ du bloc Options, remplit les options depuis ce ValueSet.
- Choisir un chemin que FHIR lie en required ou extensible, sur un champ sans ValueSet, le lie pour vous et en fait un select. Les liaisons preferred et example restent à votre choix, tout comme un champ qui nomme déjà une source de référence.
- Un champ de référence choisit son ValueSet dans le bloc Reference Configuration. Il y cherche en direct, donc rien n'est copié.
- Chaque installation contient les 672 ValueSets standard de FHIR. Les formulaires d'enquête n'ont aucun élément lié, donc ils n'affichent pas de ligne **bound:**.

### Codes suggérés

- Pour un champ qui a un FHIR Path, le bloc Codes affiche **Suggested codes** au-dessus de la recherche de termes.
- Un code **Binding** vient du ValueSet du champ, ou du ValueSet auquel FHIR lie l'élément. **Your forms · N** signifie que N autres formulaires mettent ce code sur le même chemin.
- Cliquez sur une ligne pour mettre le code sur le champ.
- **not in your terminology** marque un code que CE ne contient pas. L'ajouter l'ajoute aussi à votre terminologie, et le panneau le dit, avec **Undo**. Undo le retire de votre terminologie ; le code reste sur le champ.
- Seul un utilisateur qui peut gérer la terminologie peut ajouter un tel code. Les autres auteurs le voient grisé.
- Un code d'un système de codage que CE n'a pas est refusé. Ajoutez d'abord le système sur la page Terminology.
- Une liste vide signifie que votre terminologie est incomplète, pas qu'aucun code n'existe. Cherchez plus bas, ou ajoutez des codes sur la page Terminology.
- Quand un ValueSet contient beaucoup de codes, le panneau en affiche 50 qu'aucun formulaire n'utilise, et indique combien il en reste.

### Packs de départ

- Un pack de départ est une liste de champs prête pour un Resource Type, tirée des formulaires fournis avec OpenLDR : Location (Facility), Practitioner (Users), Patient et ServiceRequest (Lab order).
- Quand vous choisissez un Resource Type sur un formulaire vide, son pack s'ouvre tout seul dans un panneau latéral. Sur un formulaire qui a déjà des champs, choisissez **Start from a pack** dans le menu ⋯.
- Chaque entrée dit pourquoi elle est là. Décochez ce que vous ne collectez pas, puis choisissez **Add N fields** dans le menu ⋯ du panneau. L'ajout s'annule en une seule fois.
- Une entrée verrouillée reste cochée, car la page qu'alimente le formulaire ne peut pas enregistrer sans elle.
- Les entrées déjà présentes sur le formulaire n'apparaissent pas dans le panneau.
- Les entrées codées prennent leurs options dans la liste propre à FHIR. Le pack Lab order laisse de côté **Ward / Department**, car ses codes sont locaux ; ajoutez-le depuis **Library** et donnez-lui des options.
- Les formulaires d'enquête et les formulaires sans Resource Type n'ont pas de pack.

### Le volet Library

- Le volet de droite liste les éléments FHIR du Resource Type du formulaire qu'aucun champ n'utilise encore. Cliquez sur un élément pour l'ajouter comme champ ; son éditeur s'ouvre.
- Au-dessus des éléments, **Left out of the pack** liste les entrées du pack absentes du formulaire, dans l'ordre du pack. Cliquez sur une entrée pour l'ajouter.
- Un champ ajouté ainsi prend le nom et le type de l'élément. Un élément codé devient un select, avec des options quand l'élément liste ses codes. Les dates arrivent en champs texte ; changez le type dans l'éditeur.
- Un élément qui appartient à un groupe déjà présent sur le formulaire va dans ce groupe.
- La recherche filtre par nom et par chemin. La liste descend sur deux niveaux, par exemple `Location.address.city`.
- Un formulaire d'enquête n'a pas de **Library**.
- Si l'éditeur fait moins de 980 pixels de large, **Form** et **Library** deviennent des onglets. Un ajout depuis **Library** ramène à **Form**. Replier la barre latérale peut réafficher les deux volets.

### Travailler sur plusieurs champs

- Cliquez sur un champ pour ouvrir son éditeur. Maj-clic sélectionne tous les champs entre le dernier cliqué et celui-ci. Ctrl-clic (Cmd-clic sur Mac) ajoute ou retire un champ. Aucun des deux n'ouvre l'éditeur.
- Ctrl+A (Cmd+A) sélectionne tous les champs affichés par la liste. Échap vide la sélection.
- Avec deux champs ou plus sélectionnés, l'en-tête de la liste en indique le nombre, et son menu ⋯ les déplace vers une section, les active ou les désactive, ou les supprime. La suppression demande confirmation. Chaque action s'annule en une seule fois.
- **Toggle enabled** les désactive tous si au moins la moitié sont actifs, et les active tous sinon. Il ignore les champs verrouillés, tout comme **Delete**.
- Quand aucune zone de saisie ni aucun menu n'a le focus : j et k (ou les flèches) descendent et remontent dans la liste, Entrée ouvre le champ, Espace l'active ou le désactive, d le supprime et Ctrl+D le duplique. Avec deux champs ou plus sélectionnés, Espace et d agissent sur tous. Ctrl+F place le curseur dans la recherche de champs.
- Un téléphone n'a pas de touche Maj ni Ctrl : sur téléphone, on sélectionne un champ à la fois.

### Sections

- Faites glisser un champ par sa poignée. Pendant le glissement, un panneau en haut de la liste affiche **(no section)** et chaque section, avec son nombre de champs. Déposez le champ sur l'une d'elles pour l'y déplacer. Le panneau n'apparaît que si le formulaire a des sections.
- Dans la liste Sections, le menu ⋯ de chaque section propose **Edit visibility**, **Move up**, **Move down** et **Delete**.
- **Edit visibility** ouvre le même éditeur de règle que pour un champ. Seuls les champs actifs peuvent servir dans une condition. La saisie masque la section tant que sa règle n'est pas remplie.
- Un champ ou une section qui a une règle de visibilité affiche une icône de branche.


Sur une demande d'examens, chaque examen choisi reçoit une ligne où la paillasse saisit ses résultats, voit l'intervalle de référence qui correspond au patient, et peut refuser l'examen ou la demande entière avec un motif codé. Les résultats se saisissent avec la demande, en une seule fois.

## Português

### Condições de envio

A publicação permite a partilha e os editores integrados. Não garante envios por View/Run. A captura suporta ServiceRequest e campos de resposta ativos com Observation Extract e pelo menos um código. Um formulário de texto personalizado sem extração não pode ser enviado. Os modelos Patient e Facility continuam disponíveis nos seus editores próprios.

O editor e a página de captura indicam esta capacidade antes da introdução de dados. Para uma observação, abra o campo, selecione um código de terminologia em Codes e marque Observation Extract em Mapping. Ative o campo, guarde e publique. Preencha pelo menos um campo de extração: um campo vazio ou oculto não produz uma Observation.

Esta verificação cobre a configuração. As respostas obrigatórias, as referências e o fluxo de ingestão ativo ainda precisam de passar na validação.

### Exemplo: enviar um pedido de laboratório

Use uma instalação de teste com um paciente existente, terminologia LOINC carregada e o fluxo de ingestão ativo. Precisa de permissão para editar e publicar formulários e enviar respostas.

1. Em Forms, abra o menu ⋯ da página e escolha New. Dê ao formulário o nome Exemplo de pedido.
2. Selecione R4, o tipo ServiceRequest e a página de destino Forms. Abra o editor.
3. Adicione um campo reference ativo e obrigatório, com o rótulo Patient. Em **Reference Configuration**, defina Target como Patient. Em Mapping, defina FHIR Path como ServiceRequest.subject.
4. Adicione um campo reference ativo e obrigatório, com o rótulo Tests. Em **Reference Configuration**, defina Target como o sistema LOINC instalado, http://loinc.org, e FHIR Path como ServiceRequest.code. Selecione códigos na terminologia, sem inventar códigos.
5. Guarde cada campo no respetivo menu ⋯. Confirme a mensagem de configuração. Observation Extract não é necessário neste formulário ServiceRequest.
6. No menu ⋯ do editor, escolha Publish. Resolva eventuais erros. A publicação também guarda o esquema atual.
7. Volte a Forms e escolha View/Run no menu ⋯ do formulário. Selecione um paciente existente e um teste carregado nas listas.
8. Escolha Submit em Form actions. Aguarde Response captured. A resposta e o ServiceRequest derivado passam pelo fluxo de ingestão.
9. Verifique a execução do fluxo e o pedido guardado antes de repetir o envio. Se houver armazenamento parcial, inspecione primeiro a execução: uma repetição pode criar duplicados.

Se uma lista estiver vazia, verifique a fonte e a terminologia carregada. Ative um fluxo desativado antes de repetir. As mensagens de campos obrigatórios usam o rótulo visível.

### Estrutura da lista de campos

- **Qual entrada de uma lista um campo preenche.** Um campo ligado a uma entrada de uma lista FHIR mostra uma segunda linha sob o seu caminho, por exemplo `system = urn:x`. Dois campos em `Location.identifier.value` diferem apenas por esta linha.
- **Posições de uma mesma lista.** Os campos que partilham uma lista e têm um discriminador e um campo de valor ficam sob um cabeçalho. O cabeçalho mostra o nome da lista, o seu caminho e quantas posições tem. A lista deduz o cabeçalho dos campos, por isso não pode ser arrastado nem eliminado.
- **Os formulários fornecidos.** O formulário Patient agrupa o nome próprio e o apelido sob `Patient.name`, e o telefone sob `Patient.telecom`. O formulário Users agrupa o nome próprio e o apelido sob `Practitioner.name`, e o e-mail sob `Practitioner.telecom`. O formulário Facility coloca o seu código sob `Location.identifier`, e o formulário Lab order coloca o seu número de referência sob `ServiceRequest.identifier`. Uma instalação cujo operador editou um destes formulários mantém os seus próprios campos.
- **Grupos dentro de grupos.** Defina o **Group** de um grupo para o colocar dentro de outro grupo, a qualquer profundidade. O seletor nunca oferece o próprio grupo nem o que já está dentro dele.
- **O ícone de repetição.** Um campo que aceita mais de uma resposta, ou um grupo que contém várias entradas, mostra um ícone de repetição. Um grupo contém uma só entrada quando está ligado a um elemento único, como `Location.address`, ou quando **Max Items** é 1. A exportação Questionnaire marca esse grupo como não repetível.
- A introdução de dados ainda mostra cada grupo uma vez. Adicionar entradas a um grupo durante a introdução de dados chega numa versão posterior.

### Editar um campo

- **Qual entrada de uma lista.** Em Mapping, marque **Array element (discriminator)**. Cada condição é um elemento, um operador e um valor, por exemplo `system` `equals` `urn:x`. Os operadores são `equals`, `not equals` e `starts with`. Com duas ou mais condições, escolha **All** quando todas têm de se cumprir, ou **Any** quando basta uma. **Value Field** indica o elemento que guarda a resposta, normalmente `value`.
- O discriminador é usado pelas verificações do formulário e pela exportação Questionnaire. A introdução de dados ainda não o usa, com uma exceção: quando um pedido Lab order é submetido, o seu número de referência leva o `system` que o seu discriminador indica.
- **Outra posição.** Sob a última posição de uma lista, **+ Add a named slot** acrescenta uma cópia com o mesmo caminho, o mesmo campo de valor e o mesmo tipo, e valores de discriminador em branco. A propriedade API, os códigos e as traduções ficam em branco.
- **Partes de um grupo.** O editor de um grupo lista as suas partes depois de Mapping. Clique numa parte para a editar. As alterações do grupo ainda não guardadas são guardadas primeiro. **+ Add a part** acrescenta um campo dentro do grupo, sem caminho FHIR.
- **Campos reference.** Um campo reference tem um bloco **Reference Configuration** depois de General. **Target** é `Patient` ou um sistema de códigos ativo. **Searchable** é guardado e exportado, mas a introdução de dados ainda não o usa. **Depends On** é usado num só caso: um campo que depende de um campo Tests ligado à lista de exames deste laboratório só oferece as amostras aceites pelos exames escolhidos (ver Catálogo de exames). Qualquer outra definição **Depends On** é guardada mas não usada.
- **Campos bloqueados.** Um campo bloqueado não pode ser desativado nem eliminado a partir da lista. Pode ainda mudar o rótulo, a ordem e a tradução.
- **Formulários de inquérito.** Quando o Resource Type do formulário é `Questionnaire`, o editor esconde FHIR Path, API Property e o discriminador. Observation Extract e as outras definições mantêm-se.

### Opções e ValueSets

- Um campo select ou multiselect pode tirar as opções de um ValueSet. No bloco Options, pesquise um ValueSet e escolha-o. Os códigos dele são copiados para as opções, e o campo guarda uma ligação ao ValueSet com uma força. Uma força required impede que a introdução de dados aceite outros valores.
- **Unbind**, no menu ⋯ do bloco Options, retira a ligação e mantém as opções. **Save as a new ValueSet** transforma opções escritas num ValueSet reutilizável; só aparece se puder gerir a terminologia.
- Por baixo do FHIR Path, **bound:** indica o ValueSet a que o próprio FHIR liga esse elemento, e com que força. **Load from terminology**, no menu ⋯ do bloco Options, preenche as opções a partir desse ValueSet.
- Escolher um caminho que o FHIR liga como required ou extensible, num campo sem ValueSet, faz a ligação por si e torna-o um select. As ligações preferred e example ficam à sua escolha, tal como um campo que já indica uma fonte de referência.
- Um campo de referência escolhe o ValueSet no bloco Reference Configuration. Pesquisa o ValueSet em direto, por isso nada é copiado.
- Todas as instalações têm os 672 ValueSets padrão do FHIR. Os formulários de inquérito não têm elementos ligados, por isso não mostram a linha **bound:**.

### Códigos sugeridos

- Num campo com FHIR Path, o bloco Codes mostra **Suggested codes** por cima da pesquisa de termos.
- Um código **Binding** vem do ValueSet do campo, ou do ValueSet a que o FHIR liga o elemento. **Your forms · N** significa que N outros formulários põem esse código no mesmo caminho.
- Clique numa linha para pôr o código no campo.
- **not in your terminology** marca um código que o CE não tem. Adicioná-lo também o adiciona à sua terminologia, e o painel indica-o, com **Undo**. O Undo retira-o da sua terminologia; o código fica no campo.
- Só um utilizador que possa gerir a terminologia pode adicionar esse código. Os outros autores veem-no a cinzento.
- Um código de um sistema de codificação que o CE não tem é recusado. Adicione primeiro o sistema na página Terminology.
- Uma lista vazia significa que a sua terminologia está incompleta, não que nenhum código exista. Pesquise abaixo, ou adicione códigos na página Terminology.
- Quando um ValueSet tem muitos códigos, o painel mostra 50 que nenhum formulário usa, e indica quantos mais existem.

### Pacotes iniciais

- Um pacote inicial é uma lista de campos pronta para um Resource Type, tirada dos formulários que o OpenLDR traz: Location (Facility), Practitioner (Users), Patient e ServiceRequest (Lab order).
- Quando escolhe um Resource Type num formulário vazio, o pacote abre sozinho num painel lateral. Num formulário que já tem campos, escolha **Start from a pack** no menu ⋯.
- Cada entrada diz porque está lá. Desmarque o que não recolhe e depois escolha **Add N fields** no menu ⋯ do painel. O acréscimo desfaz-se de uma só vez.
- Uma entrada bloqueada fica marcada, porque a página que o formulário alimenta não consegue guardar um registo sem ela.
- As entradas que já estão no formulário não aparecem no painel.
- As entradas codificadas tiram as opções da lista do próprio FHIR. O pacote Lab order deixa de fora **Ward / Department**, porque os códigos dele são locais; acrescente-o a partir de **Library** e dê-lhe opções.
- Os formulários de inquérito e os formulários sem Resource Type não têm pacote.

### O painel Library

- O painel à direita lista os elementos FHIR do Resource Type do formulário que nenhum campo usa ainda. Clique num elemento para o acrescentar como campo; o editor dele abre.
- Acima dos elementos, **Left out of the pack** lista as entradas do pacote que o formulário não tem, pela ordem do pacote. Clique numa para a acrescentar.
- Um campo acrescentado assim recebe o nome e o tipo do elemento. Um elemento codificado passa a ser um select, com opções quando o elemento lista os seus códigos. As datas chegam como campos de texto; mude o tipo no editor.
- Um elemento que pertence a um grupo já presente no formulário entra nesse grupo.
- A pesquisa filtra por nome e por caminho. A lista desce dois níveis, por exemplo `Location.address.city`.
- Um formulário de inquérito não tem **Library**.
- Quando o editor tem menos de 980 pixels de largura, **Form** e **Library** passam a ser separadores. Acrescentar a partir de **Library** volta a **Form**. Recolher a barra lateral pode mostrar de novo os dois painéis.

### Trabalhar com vários campos

- Clique num campo para abrir o editor dele. Shift-clique seleciona todos os campos entre o último clicado e este. Ctrl-clique (Cmd-clique num Mac) acrescenta ou retira um campo. Nenhum dos dois abre o editor.
- Ctrl+A (Cmd+A) seleciona todos os campos que a lista mostra. Escape limpa a seleção.
- Com dois ou mais selecionados, o cabeçalho da lista mostra quantos são, e o menu ⋯ dele move-os para uma secção, ativa-os ou desativa-os, ou elimina-os. A eliminação pede confirmação. Cada ação desfaz-se de uma só vez.
- **Toggle enabled** desativa todos quando pelo menos metade está ativa, e ativa todos no caso contrário. Ignora os campos bloqueados, tal como **Delete**.
- Quando nenhuma caixa ou menu tem o foco: j e k (ou as setas) descem e sobem na lista, Enter abre o campo, Espaço ativa-o ou desativa-o, d elimina-o e Ctrl+D duplica-o. Com dois ou mais selecionados, Espaço e d atuam sobre todos. Ctrl+F leva o cursor para a pesquisa de campos.
- Um telemóvel não tem teclas Shift nem Ctrl, por isso num telemóvel seleciona um campo de cada vez.

### Secções

- Arraste um campo pela pega. Enquanto arrasta, um painel no topo da lista mostra **(no section)** e cada secção, com o número de campos. Largue o campo numa delas para o mover para lá. O painel só aparece quando o formulário tem secções.
- Na lista Sections, o menu ⋯ de cada secção tem **Edit visibility**, **Move up**, **Move down** e **Delete**.
- **Edit visibility** abre o mesmo editor de regras de um campo. Só os campos ativos podem ser usados numa condição. A introdução de dados esconde a secção enquanto a regra não se cumpre.
- Um campo ou secção com uma regra de visibilidade mostra um ícone de ramificação.

Num pedido de exames, cada exame escolhido recebe uma linha onde a bancada escreve os resultados, vê o intervalo de referência que corresponde ao doente, e pode recusar o exame ou o pedido inteiro com um motivo codificado. Os resultados são escritos junto com o pedido, de uma só vez.
