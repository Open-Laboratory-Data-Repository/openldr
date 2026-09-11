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
3. Add an enabled, required reference field labeled Patient. Under Mapping, expand Advanced and set Reference Target to Patient and FHIR Path to ServiceRequest.subject.
4. Add an enabled, required reference field labeled Tests. Set Reference Target to the installed LOINC system URL, http://loinc.org. Set FHIR Path to ServiceRequest.code. Choose codes through the terminology picker; do not enter a made-up code.
5. Save each field through its ⋯ menu. Confirm the submission configuration message. No Observation Extract flag is needed for this ServiceRequest form.
6. Open the builder's ⋯ menu and choose Publish. Resolve any publish errors. Publishing also saves the current schema.
7. Return to Forms and choose View/Run from the form's ⋯ menu. Select an existing patient and one loaded test from the lists.
8. Choose Submit from Form actions. Wait for Response captured. The response and derived ServiceRequest enter the ingest workflow.
9. Check the corresponding workflow run and stored request before repeating the submission. If the server reports partial persistence, inspect the run first; a retry can create duplicates.

If a reference list is empty, check the configured source and loaded terminology. If the workflow is disabled, enable it before retrying. Required-field messages identify the field by its visible label.

## Français

### Conditions de soumission

La publication permet le partage et les éditeurs intégrés. Elle ne garantit pas les soumissions View/Run. La saisie prend actuellement en charge ServiceRequest et les champs de réponse actifs avec Observation Extract et au moins un code. Un formulaire texte personnalisé sans extraction ne peut pas être soumis. Les modèles Patient et Facility restent utilisables dans leurs éditeurs dédiés.

L'éditeur et la page de saisie indiquent cette capacité avant la saisie. Pour une observation, ouvrez la fiche du champ, sélectionnez un code terminologique sous Codes et cochez Observation Extract sous Mapping. Activez le champ, enregistrez et publiez. Renseignez au moins un champ d'extraction : un champ vide ou masqué ne produit aucune Observation.

Ce contrôle porte sur la configuration. Les réponses obligatoires, les références et le workflow d'ingestion actif doivent encore être validés.

### Exemple : soumettre une demande de laboratoire

Utilisez une installation de test avec un patient existant, la terminologie LOINC chargée et le workflow d'ingestion actif. Il faut pouvoir modifier et publier les formulaires et soumettre des réponses.

1. Dans Forms, ouvrez le menu ⋯ de la page et choisissez New. Nommez le formulaire Exemple de demande.
2. Sélectionnez R4, le type ServiceRequest et la page cible Forms. Ouvrez l'éditeur.
3. Ajoutez un champ reference actif et obligatoire, nommé Patient. Sous Mapping, ouvrez Advanced et définissez Reference Target sur Patient et FHIR Path sur ServiceRequest.subject.
4. Ajoutez un champ reference actif et obligatoire, nommé Tests. Définissez Reference Target sur l'URL du système LOINC installé, http://loinc.org, et FHIR Path sur ServiceRequest.code. Sélectionnez les codes dans la terminologie, sans inventer de code.
5. Enregistrez chaque champ dans son menu ⋯. Vérifiez le message de configuration. Observation Extract n'est pas nécessaire pour ce formulaire ServiceRequest.
6. Dans le menu ⋯ de l'éditeur, choisissez Publish. Corrigez les erreurs éventuelles. La publication enregistre aussi le schéma actuel.
7. Revenez à Forms et choisissez View/Run dans le menu ⋯ du formulaire. Sélectionnez un patient existant et un test chargé dans les listes.
8. Choisissez Submit dans Form actions. Attendez Response captured. La réponse et le ServiceRequest dérivé passent par le workflow d'ingestion.
9. Vérifiez l'exécution du workflow et la demande enregistrée avant de recommencer. En cas de stockage partiel, inspectez d'abord l'exécution : une nouvelle soumission peut créer des doublons.

Si une liste est vide, vérifiez sa source et la terminologie chargée. Activez un workflow désactivé avant de réessayer. Les messages de champ obligatoire utilisent le libellé visible.

## Português

### Condições de envio

A publicação permite a partilha e os editores integrados. Não garante envios por View/Run. A captura suporta ServiceRequest e campos de resposta ativos com Observation Extract e pelo menos um código. Um formulário de texto personalizado sem extração não pode ser enviado. Os modelos Patient e Facility continuam disponíveis nos seus editores próprios.

O editor e a página de captura indicam esta capacidade antes da introdução de dados. Para uma observação, abra o campo, selecione um código de terminologia em Codes e marque Observation Extract em Mapping. Ative o campo, guarde e publique. Preencha pelo menos um campo de extração: um campo vazio ou oculto não produz uma Observation.

Esta verificação cobre a configuração. As respostas obrigatórias, as referências e o fluxo de ingestão ativo ainda precisam de passar na validação.

### Exemplo: enviar um pedido de laboratório

Use uma instalação de teste com um paciente existente, terminologia LOINC carregada e o fluxo de ingestão ativo. Precisa de permissão para editar e publicar formulários e enviar respostas.

1. Em Forms, abra o menu ⋯ da página e escolha New. Dê ao formulário o nome Exemplo de pedido.
2. Selecione R4, o tipo ServiceRequest e a página de destino Forms. Abra o editor.
3. Adicione um campo reference ativo e obrigatório, com o rótulo Patient. Em Mapping, abra Advanced e defina Reference Target como Patient e FHIR Path como ServiceRequest.subject.
4. Adicione um campo reference ativo e obrigatório, com o rótulo Tests. Defina Reference Target como o URL do sistema LOINC instalado, http://loinc.org, e FHIR Path como ServiceRequest.code. Selecione códigos na terminologia, sem inventar códigos.
5. Guarde cada campo no respetivo menu ⋯. Confirme a mensagem de configuração. Observation Extract não é necessário neste formulário ServiceRequest.
6. No menu ⋯ do editor, escolha Publish. Resolva eventuais erros. A publicação também guarda o esquema atual.
7. Volte a Forms e escolha View/Run no menu ⋯ do formulário. Selecione um paciente existente e um teste carregado nas listas.
8. Escolha Submit em Form actions. Aguarde Response captured. A resposta e o ServiceRequest derivado passam pelo fluxo de ingestão.
9. Verifique a execução do fluxo e o pedido guardado antes de repetir o envio. Se houver armazenamento parcial, inspecione primeiro a execução: uma repetição pode criar duplicados.

Se uma lista estiver vazia, verifique a fonte e a terminologia carregada. Ative um fluxo desativado antes de repetir. As mensagens de campos obrigatórios usam o rótulo visível.
