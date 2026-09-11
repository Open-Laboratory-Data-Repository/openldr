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

- [Connector setup](#connector-setup) explains category selection and the initial enabled state in English, French, and Portuguese.

- [Marketplace permission checks](/docs/marketplace-permissions) explain loading, unavailable, and confirmed permission lists in English, French, and Portuguese.
- [Development](/docs/development) — run OpenLDR from source with hot reload.
- [Command-line interface (CLI)](/docs/cli) — the `openldr` operator command line.
- [Environment variables](/docs/environment) — configure a deployment.

## Connector setup

### English

In Studio, open **Settings → Connectors**. From the page's **⋯** menu, choose **Add connector** and enter a name.

**Category** defaults to **Plugin**, which requires an installed output plugin. Choose **Host** for built-in database, email, or file services, then select the service under **Database type**. This selector includes more than databases. Complete the connection fields and choose **Save**.

The saved-name notification confirms storage. New connectors start enabled; creation has no Enabled control. To disable one, use its **Enabled** switch in the list or edit the saved connector. Use the row menu's **Test** action to check connectivity from the OpenLDR server. Then select the enabled connector in a compatible workflow node. Studio's **Docs → Connectors** guide has the full setup procedure.

### Français

Dans Studio, ouvrez **Paramètres → Connecteurs**. Dans le menu **⋯** de la page, choisissez **Ajouter un connecteur** et saisissez un nom.

La **Catégorie** initiale est **Extension**, qui nécessite une extension de sortie installée. Choisissez **Hôte** pour les services intégrés de base de données, de messagerie ou de fichiers. Sélectionnez ensuite le service sous **Type de base de données**, qui comprend aussi ces autres services. Renseignez les champs de connexion et choisissez **Enregistrer**.

La notification contenant le nom confirme la sauvegarde. Le connecteur commence activé ; le formulaire de création ne propose pas de choix Activé. Pour le désactiver, coupez **Activé** dans la liste ou modifiez le connecteur enregistré. Choisissez **Tester** dans le menu de la ligne pour vérifier la connexion depuis le serveur OpenLDR. Sélectionnez ensuite le connecteur activé dans un nœud compatible. Le guide **Connecteurs** de la documentation Studio détaille la procédure.

### Português

No Studio, abra **Definições → Conectores**. No menu **⋯** da página, escolha **Adicionar conector** e introduza um nome.

A **Categoria** inicial é **Plugin**, que exige um plugin de saída instalado. Escolha **Anfitrião** para serviços integrados de base de dados, correio ou ficheiros. Selecione o serviço em **Tipo de base de dados**, que também inclui esses outros serviços. Preencha os campos de ligação e escolha **Salvar**.

A notificação com o nome confirma a gravação. O conector começa ativado; o formulário de criação não permite escolher esse estado. Para o desativar, desligue **Ativado** na lista ou edite o conector guardado. Escolha **Testar** no menu da linha para verificar a ligação a partir do servidor OpenLDR. Depois, selecione o conector ativado num nó compatível. O guia **Conectores** da documentação Studio apresenta o procedimento completo.
