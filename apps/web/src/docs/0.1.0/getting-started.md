# Getting started

## 1. Install

If you have not installed yet, run the one-line installer on a host with Docker. It
generates every secret, brings the stack up on `https://localhost` with a self-signed
certificate, and prints the URL and admin credentials. Full options are on the
[Install](/docs/install) page.

Linux / macOS:

```bash
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex
```

## 2. Sign in

After installing, open the printed URL in your browser and sign in with the
generated admin credentials. From there you can install plugins, build
workflows, configure connectors, and [load your first data](/docs/load-data).

To stop or start the stack later, run `docker compose down` / `docker compose up -d`
from inside the `openldr/` directory the installer created.

## Going further

- [Report publishing](#report-publishing) distinguishes template revisions from library reports in English, French, and Portuguese.

- [User role assignment](#user-role-assignment) explains Studio's single-role selector in English, French, and Portuguese.

- [Connector setup](#connector-setup) explains category selection and the initial enabled state in English, French, and Portuguese.

- [Marketplace permission checks](/docs/marketplace-permissions) explain loading, unavailable, and confirmed permission lists in English, French, and Portuguese.
- [Development](/docs/development) — run OpenLDR from source with hot reload.
- [Command-line interface (CLI)](/docs/cli) — the `openldr` operator command line.
- [Environment variables](/docs/environment) — configure a deployment.

## Connector setup

### English

In Studio, open **Settings → Connectors**. From the page's **⋯** menu, choose **Add connector** and enter a name.

**Category** defaults to **Plugin**, which requires an installed output plugin. Choose **Host** for built-in database, email, or file services, then select the service under **Database type**. This selector includes more than databases. Complete the connection fields and choose **Save** from the sheet's **⋯** menu.

The saved-name notification confirms storage. New connectors start enabled; creation has no Enabled control. To disable one, use its **Enabled** switch in the list or edit the saved connector. Use the row menu's **Test** action to check connectivity from the OpenLDR server. Then select the enabled connector in a compatible workflow node. Studio's **Docs → Connectors** guide has the full setup procedure.

### Français

Dans Studio, ouvrez **Paramètres → Connecteurs**. Dans le menu **⋯** de la page, choisissez **Ajouter un connecteur** et saisissez un nom.

La **Catégorie** initiale est **Extension**, qui nécessite une extension de sortie installée. Choisissez **Hôte** pour les services intégrés de base de données, de messagerie ou de fichiers. Sélectionnez ensuite le service sous **Type de base de données**, qui comprend aussi ces autres services. Renseignez les champs de connexion et choisissez **Enregistrer** dans le menu **⋯** du formulaire.

La notification contenant le nom confirme la sauvegarde. Le connecteur commence activé ; le formulaire de création ne propose pas de choix Activé. Pour le désactiver, coupez **Activé** dans la liste ou modifiez le connecteur enregistré. Choisissez **Tester** dans le menu de la ligne pour vérifier la connexion depuis le serveur OpenLDR. Sélectionnez ensuite le connecteur activé dans un nœud compatible. Le guide **Connecteurs** de la documentation Studio détaille la procédure.

### Português

No Studio, abra **Definições → Conectores**. No menu **⋯** da página, escolha **Adicionar conector** e introduza um nome.

A **Categoria** inicial é **Plugin**, que exige um plugin de saída instalado. Escolha **Anfitrião** para serviços integrados de base de dados, correio ou ficheiros. Selecione o serviço em **Tipo de base de dados**, que também inclui esses outros serviços. Preencha os campos de ligação e escolha **Salvar** no menu **⋯** do formulário.

A notificação com o nome confirma a gravação. O conector começa ativado; o formulário de criação não permite escolher esse estado. Para o desativar, desligue **Ativado** na lista ou edite o conector guardado. Escolha **Testar** no menu da linha para verificar a ligação a partir do servidor OpenLDR. Depois, selecione o conector ativado num nó compatível. O guia **Conectores** da documentação Studio apresenta o procedimento completo.

## User role assignment

### English

In Studio, open **Users**, find the account, then choose **Edit** from its row's **⋯** menu. Wait for **Role** to load and select one role. Choosing another role replaces the selection; it does not add a second role. Save, check the success notification, and reopen the account to verify the saved selection.

Editing the account requires Manage users; assigning its role also requires Manage roles. If assignment fails, the editor stays open with an error. Resolve it before treating the update as complete. Configure a role with the required capabilities in **Settings → Roles** if none fits. Changing a shared role affects all its members. Studio's Users and Roles guides explain this procedure.

### Français

Dans Studio, ouvrez **Utilisateurs**, recherchez le compte et choisissez **Modifier** dans le menu **⋯** de sa ligne. Attendez le chargement de **Rôle** et sélectionnez un seul rôle. Un autre choix remplace la sélection ; il n'ajoute pas un second rôle. Enregistrez, vérifiez la notification de réussite et rouvrez le compte pour vérifier le rôle enregistré.

La modification du compte nécessite la permission de gérer les utilisateurs. L'attribution nécessite aussi celle de gérer les rôles. En cas d'échec, l'éditeur reste ouvert avec une erreur à corriger. Si aucun rôle ne convient, configurez-en un dans **Paramètres → Rôles**. Modifier un rôle partagé affecte tous ses membres. Les guides Utilisateurs et Rôles de Studio détaillent la procédure.

### Português

No Studio, abra **Utilizadores**, procure a conta e escolha **Editar** no menu **⋯** da linha. Aguarde o carregamento de **Função** e selecione uma única função. Outra escolha substitui a seleção; não acrescenta uma segunda função. Guarde, confirme a notificação de sucesso e volte a abrir a conta para verificar a função guardada.

Editar a conta exige permissão para gerir utilizadores. A atribuição também exige permissão para gerir funções. Se falhar, o editor permanece aberto com um erro que deve resolver. Se nenhuma função for adequada, configure uma em **Definições → Funções**. Alterar uma função partilhada afeta todos os seus membros. Os guias Utilizadores e Funções do Studio apresentam o procedimento.

## Report publishing

### English

In Studio's Report Designer, save the template and wait for Saved. **⋯ → Publish revision** publishes a template version and confirms the template name. It does not create a Reports library entry.

Choose **⋯ → Create report from this design** to add a library report. Set Name, Category, Template, and Primary query; Description is optional. Check any preselected query. From the sheet's **⋯** menu, choose **Create report** and check the confirmation naming the new report. This action does not publish a template revision.

Open Reports, select the new report in its category, fill required parameters, and run it. The primary query supplies Spreadsheet rows; the template supplies the Document layout. Publishing later revisions of that template does not require creating another library entry. Studio's Report Designer guide includes the full sequence.

### Français

Dans le Concepteur de rapports de Studio, enregistrez le modèle et attendez la confirmation. **⋯ → Publier une révision** publie une version du modèle et confirme son nom. Cette action ne crée pas d'entrée dans Rapports.

Choisissez **⋯ → Créer un rapport à partir de ce modèle**. Renseignez Nom, Catégorie, Modèle et Requête principale ; la Description est facultative. Vérifiez toute requête présélectionnée. Dans le menu **⋯** du formulaire, choisissez **Créer le rapport** et vérifiez la confirmation contenant son nom. Cette action ne publie pas de révision du modèle.

Ouvrez Rapports, sélectionnez le rapport dans sa catégorie, renseignez les paramètres requis et lancez-le. La requête principale fournit les lignes du tableur ; le modèle définit le document. Publier une révision ultérieure ne nécessite pas une nouvelle entrée dans la bibliothèque. Le guide du concepteur dans Studio détaille la procédure.

### Português

No Designer de relatórios do Studio, guarde o modelo e aguarde a confirmação. **⋯ → Publicar revisão** publica uma versão do modelo e confirma o seu nome. Esta ação não cria uma entrada em Relatórios.

Escolha **⋯ → Criar relatório a partir deste modelo**. Preencha Nome, Categoria, Modelo e Consulta principal; a Descrição é opcional. Verifique qualquer consulta pré-selecionada. No menu **⋯** do formulário, escolha **Criar relatório** e confirme a mensagem com o nome. Esta ação não publica uma revisão do modelo.

Abra Relatórios, selecione o relatório na categoria, preencha os parâmetros obrigatórios e execute-o. A consulta principal fornece as linhas da folha de cálculo; o modelo define o documento. Publicar revisões posteriores não exige uma nova entrada na biblioteca. O guia do designer no Studio apresenta o procedimento completo.

## First steps in Studio

### English

The numbered screenshots show the English interface with synthetic examples. They contain no patient data.
On a phone, open the navigation menu first. In Studio, select an image to enlarge it.

1. Open **Dashboard** to see dashboards shared with your account.
2. Open **Reports** to browse the report library.
3. Open **Docs** and use **Search documentation** to find a task.
4. Return to **Reports**, select a report, open its **⋯** menu, and choose **Parameters**.
5. Complete its required fields. Reports define their own parameters; the image shows an example text field.
6. Select **Run** when the required values are complete.

**Facilities** appears when your account has permission to view facilities. Other pages also depend on permissions.
The capture stops before Run. The report's output depends on its definition and available data.
Find the full **Start here** guide inside Studio's **Docs**.

### Français

Les images numérotées montrent l'interface anglaise avec des exemples fictifs, sans données de patients.
Sur téléphone, ouvrez d'abord le menu de navigation. Dans Studio, sélectionnez une image pour l'agrandir.

1. Ouvrez **Tableau de bord** pour consulter les tableaux partagés avec votre compte.
2. Ouvrez **Rapports** pour parcourir la bibliothèque.
3. Ouvrez **Documentation** et cherchez une tâche.
4. Revenez aux **Rapports**, sélectionnez un rapport, ouvrez son menu **⋯**, puis **Paramètres**.
5. Renseignez les champs obligatoires. Chaque rapport définit ses paramètres ; l'image montre un champ texte d'exemple.
6. Sélectionnez **Exécuter** quand les valeurs obligatoires sont complètes.

**Établissements** apparaît si votre compte peut les consulter. Les autres pages dépendent aussi des permissions.
La capture s'arrête avant l'exécution. Le résultat dépend du rapport et des données disponibles.
Le guide **Commencer ici** est disponible dans la documentation Studio.

### Português

As imagens numeradas mostram a interface inglesa com exemplos fictícios, sem dados de pacientes.
No telefone, abra primeiro o menu de navegação. No Studio, selecione uma imagem para a ampliar.

1. Abra **Painel** para consultar os painéis partilhados com a sua conta.
2. Abra **Relatórios** para percorrer a biblioteca.
3. Abra **Documentação** e procure uma tarefa.
4. Volte a **Relatórios**, selecione um relatório, abra o menu **⋯** e escolha **Parâmetros**.
5. Preencha os campos obrigatórios. Cada relatório define os parâmetros; a imagem mostra um campo de texto de exemplo.
6. Selecione **Executar** quando os valores obrigatórios estiverem preenchidos.

**Unidades** aparece quando a sua conta pode consultá-las. As outras páginas também dependem das permissões.
A captura termina antes da execução. O resultado depende do relatório e dos dados disponíveis.
O guia **Começar aqui** está disponível na documentação do Studio.

![1 Dashboard / Tableau de bord / Painel. 2 Reports / Rapports / Relatórios. 3 Docs / Documentation / Documentação.](/docs-images/start-here-navigation.png)

![4 Parameters / Paramètres / Parâmetros, in the report actions menu.](/docs-images/start-here-report-menu.png)

![5 Example field / Champ d'exemple / Campo de exemplo. 6 Run / Exécuter / Executar.](/docs-images/start-here-parameters.png)

## Connector configuration readback


## Edit stored host settings

Choose **Edit** from the connector row's **⋯** menu. Host connectors show stored ordinary fields, including host, port, database, and user where applicable. A secret marked as set stays blank. Leave it blank to keep its stored value, including when changing the host. Enter a replacement secret only when needed. Choose **Save** from the sheet's **⋯** menu, then use the row's **Test** action.

URLs, unknown configuration fields, and plugin configuration are not shown. Plugin editing keeps its existing requirement to enter base URL, username, and password together.

For headless inspection, run `openldr connectors inspect <id>`. The JSON contains ordinary `config` and boolean `secretsSet` fields. To update a host connector, run `openldr connectors update <id> --file patch.json`. Example file: `{"config":{"host":"db.internal","port":"5432"}}`. Omitted fields remain stored. Blank secret fields keep existing secrets. A rename-only patch is `{"name":"Lab database"}`. Output and audit records exclude credential values. Protect files containing replacement secrets.

## Modifier les paramètres enregistrés

Choisissez **Modifier** dans le menu **⋯** de la ligne. Les connecteurs Hôte affichent les champs ordinaires enregistrés : hôte, port, base de données et utilisateur selon le service. Un secret indiqué comme défini reste vide. Laissez-le vide pour conserver sa valeur, même en changeant l'hôte. Saisissez un secret uniquement pour le remplacer. Choisissez **Enregistrer** dans le menu **⋯** du formulaire, puis **Tester** dans le menu de la ligne.

Les URL, champs inconnus et configurations des extensions ne sont pas affichés. Pour une extension, saisissez toujours ensemble l'URL de base, l'utilisateur et le mot de passe.

En ligne de commande, utilisez `openldr connectors inspect <id>`. Le JSON contient les champs ordinaires dans `config` et la présence des secrets dans `secretsSet`. Pour modifier un connecteur Hôte : `openldr connectors update <id> --file patch.json`. Exemple : `{"config":{"host":"db.internal","port":"5432"}}`. Les champs omis et les secrets vides conservent leur valeur. Pour renommer : `{"name":"Base du laboratoire"}`. La sortie et l'audit ne contiennent pas les secrets. Protégez les fichiers contenant des secrets de remplacement.

## Editar configurações guardadas

Escolha **Editar** no menu **⋯** da linha. Os conectores Anfitrião mostram os campos comuns guardados: anfitrião, porta, base de dados e utilizador, conforme o serviço. Um segredo indicado como definido permanece vazio. Deixe-o vazio para manter o valor, mesmo ao alterar o anfitrião. Introduza um segredo apenas para o substituir. Escolha **Salvar** no menu **⋯** do formulário e depois **Testar** no menu da linha.

Os URL, campos desconhecidos e configurações de plugins não são apresentados. Para plugins, continue a preencher o URL base, utilizador e palavra-passe em conjunto.

Na linha de comandos, use `openldr connectors inspect <id>`. O JSON contém os campos comuns em `config` e a presença de segredos em `secretsSet`. Para alterar um conector Anfitrião: `openldr connectors update <id> --file patch.json`. Exemplo: `{"config":{"host":"db.internal","port":"5432"}}`. Campos omitidos e segredos vazios mantêm o valor. Para mudar o nome: `{"name":"Base do laboratório"}`. A saída e a auditoria excluem segredos. Proteja ficheiros com segredos de substituição.
