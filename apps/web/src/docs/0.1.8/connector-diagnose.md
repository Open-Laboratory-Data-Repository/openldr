# SQL Server connections and diagnosis

## English

A Microsoft SQL connector accepts a named instance and a Windows account. Type the host as `SERVER\INSTANCE`, or put the instance in **Instance name**. CE then asks SQL Server Browser on UDP port 1434 for the instance's port and ignores the **Port** field. Fill in **Windows domain** to log in with a Windows account. Leave it empty for a SQL login.

**Encrypt** is on unless you turn it off. An old SQL Server (2008 or 2012) may only offer a TLS version that CE refuses. Turn Encrypt off for that server.

When CE runs in Docker, `localhost` is the CE container. Use the database server's name or IP address.

To find out why a connection fails, open the connector row's **⋯** menu and choose **Diagnose**. CE checks, in order: the settings, the server name, SQL Server Browser (named instances only), the TCP port, the login, and the server version. It stops at the first failure and says what to change. Headless servers run the same checks with `openldr connectors diagnose <connector-id>`. Add `--json` for machine-readable output. The command exits with code 1 when a step fails.

## Français

Un connecteur Microsoft SQL accepte une instance nommée et un compte Windows. Saisissez l'hôte sous la forme `SERVEUR\INSTANCE`, ou mettez l'instance dans **Nom d'instance**. CE demande alors le port de l'instance à SQL Server Browser sur le port UDP 1434 et ignore le champ **Port**. Remplissez **Domaine Windows** pour vous connecter avec un compte Windows. Laissez-le vide pour une connexion SQL.

**Chiffrer** reste activé sauf si vous le désactivez. Un ancien SQL Server (2008 ou 2012) peut ne proposer qu'une version de TLS que CE refuse. Désactivez Chiffrer pour ce serveur.

Quand CE tourne dans Docker, `localhost` est le conteneur CE. Utilisez le nom ou l'adresse IP du serveur de base de données.

Pour savoir pourquoi une connexion échoue, ouvrez le menu **⋯** de la ligne du connecteur et choisissez **Diagnostiquer**. CE vérifie dans l'ordre : les paramètres, le nom du serveur, SQL Server Browser (instances nommées seulement), le port TCP, la connexion et la version du serveur. Il s'arrête au premier échec et indique quoi changer. Sur un serveur sans écran, lancez les mêmes vérifications avec `openldr connectors diagnose <connector-id>`. Ajoutez `--json` pour une sortie lisible par une machine. La commande renvoie le code 1 quand une étape échoue.

## Português

Um conector Microsoft SQL aceita uma instância nomeada e uma conta Windows. Escreva o host como `SERVIDOR\INSTANCIA`, ou coloque a instância em **Nome da instância**. O CE pede então a porta da instância ao SQL Server Browser na porta UDP 1434 e ignora o campo **Porta**. Preencha **Domínio Windows** para iniciar sessão com uma conta Windows. Deixe vazio para um início de sessão SQL.

**Encriptar** fica ligado a menos que o desligue. Um SQL Server antigo (2008 ou 2012) pode oferecer só uma versão de TLS que o CE recusa. Desligue Encriptar para esse servidor.

Quando o CE corre em Docker, `localhost` é o contentor do CE. Use o nome ou o endereço IP do servidor de base de dados.

Para saber porque falha uma ligação, abra o menu **⋯** da linha do conector e escolha **Diagnosticar**. O CE verifica, por ordem: as definições, o nome do servidor, o SQL Server Browser (só instâncias nomeadas), a porta TCP, o início de sessão e a versão do servidor. Para na primeira falha e diz o que mudar. Num servidor sem ecrã, execute as mesmas verificações com `openldr connectors diagnose <connector-id>`. Adicione `--json` para uma saída legível por máquina. O comando termina com o código 1 quando um passo falha.
