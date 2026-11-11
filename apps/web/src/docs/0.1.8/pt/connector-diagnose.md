# Ligações SQL Server e diagnóstico

Um conector Microsoft SQL aceita uma instância nomeada e uma conta Windows. Escreva o host como `SERVIDOR\INSTANCIA`, ou coloque a instância em **Nome da instância**. O CE pede então a porta da instância ao SQL Server Browser na porta UDP 1434 e ignora o campo **Porta**. Preencha **Domínio Windows** para iniciar sessão com uma conta Windows. Deixe vazio para um início de sessão SQL.

**Encriptar** fica ligado a menos que o desligue. Um SQL Server antigo (2008 ou 2012) pode oferecer só uma versão de TLS que o CE recusa. Desligue Encriptar para esse servidor.

Quando o CE corre em Docker, `localhost` é o contentor do CE. Use o nome ou o endereço IP do servidor de base de dados.

Para saber porque falha uma ligação, abra o menu **⋯** da linha do conector e escolha **Diagnosticar**. O CE verifica, por ordem: as definições, o nome do servidor, o SQL Server Browser (só instâncias nomeadas), a porta TCP, o início de sessão e a versão do servidor. Para na primeira falha e diz o que mudar. Num servidor sem ecrã, execute as mesmas verificações com `openldr connectors diagnose <connector-id>`. Adicione `--json` para uma saída legível por máquina. O comando termina com o código 1 quando um passo falha.
