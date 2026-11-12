# Conectores

Guarde uma ligação uma vez e selecione-a nos workflows, Custom Queries e relatórios. Um conector guarda as definições da ligação e as credenciais cifradas.

Precisa de **Manage connectors**. Use a sua base de dados ou conta de serviço. As capturas usam uma conta fictícia de relatórios só de leitura numa base Postgres isolada.

Uma instalação nova cria um conector para o armazém de dados com o motor configurado. As capturas usam **Target Warehouse (Postgres)**. As consultas e relatórios integrados usam esse conector. Verifique as dependências antes de o alterar.

O endereço e a porta têm de estar acessíveis a partir do servidor OpenLDR. No Docker, `localhost` designa esse contentor. Use o nome do serviço da base e a porta interna quando ambos partilham uma rede Docker.

Criar um conector não importa registos nem executa um workflow. A [prática opcional](#pratica-opcional) encontra-se no fim.

## Escolher o tipo de ligação

Use as definições e a conta preparadas para o serviço pretendido. Escolha o tipo de ligação antes de preencher os campos.

### 1. Abrir o menu de utilizador

Selecione o menu da sua conta no fundo da barra lateral principal.

![Abrir o menu de utilizador no canto inferior esquerdo.](connectors-guide-open-user-menu.png)

### 2. Abrir Settings

Escolha **Settings** no menu da conta.

![Escolher Settings no menu de utilizador.](connectors-guide-settings-menu.png)

### 3. Abrir Connectors

Selecione **Connectors** em Settings.

![Abrir Settings e depois Connectors.](connectors-guide-open.png)

### 4. Abrir as ações da página

Selecione os pontos acima da tabela.

![O menu de pontos da página contém Add connector.](connectors-guide-actions.png)

### 5. Escolher Add connector

Selecione **Add connector**.

![Escolher Add connector.](connectors-guide-add.png)

### 6. Dar um nome à ligação

Introduza um nome reconhecível ao escolher um conector. O exemplo usa `Example reporting database`. Não inclua palavras-passe no nome.

![Usar um nome que identifique a base e a finalidade.](connectors-guide-name.png)

### 7. Escolher Host

Defina **Category** como **Host** para uma ligação integrada de base de dados, correio ou ficheiros.

![Escolher Host para ligações integradas de base de dados, correio ou ficheiros.](connectors-guide-host-option.png)

### 8. Escolher o tipo de serviço

Defina **Database type** como o serviço real. O exemplo usa **Postgres**. A lista também contém serviços de correio e ficheiros.

![Escolher o tipo real de serviço. O exemplo usa Postgres.](connectors-guide-type.png)

## Introduzir os detalhes e guardar

Continue no painel aberto. Os campos dependem do tipo de serviço escolhido. Este exemplo usa Postgres.

### 1. Introduzir o endereço da base

Preencha **Host**, **Port** e **Database**. O endereço mostrado pertence a esta instalação de teste. Use o endereço do seu servidor.

![Introduzir o endereço, a porta e a base acessíveis a partir do servidor OpenLDR.](connectors-guide-address.png)

### 2. Introduzir a conta

Preencha **User** e **Password** com a conta da base. Um teste de ligação não determina que tabelas essa conta pode ler.

![Usar a conta autorizada a ler os dados necessários.](connectors-guide-account.png)

### 3. Verificar a cifragem do transporte

Ajuste **Use SSL** aos requisitos da base. O exemplo local mantém desligado. Outros tipos têm as suas definições de transporte.

![Ajustar Use SSL à base. O exemplo isolado não usa SSL.](connectors-guide-ssl.png)

### 4. Abrir as ações do painel

Selecione os pontos no cabeçalho do painel.

![Abrir o menu de pontos do painel do conector.](connectors-guide-sheet-actions.png)

### 5. Guardar o conector

Selecione **Save**.

![Save guarda o conector e as credenciais cifradas.](connectors-guide-save.png)

**Resultado esperado:** o conector aparece na lista e começa ativo. Allowed plugin host é uma restrição de rede dos plugins. A coluna não indica o endereço guardado da base.

![A linha mostra o nome, o tipo, o endereço permitido aos plugins e o estado ativo.](connectors-guide-created.png)

## Testar a ligação guardada

Faça um teste após criar o conector ou alterar as credenciais.

### 1. Escolher Test

Abra os pontos da linha e escolha **Test**.

![Test connection verifica as credenciais guardadas.](connectors-guide-test.png)

### 2. Ler o resultado

Aguarde **Connection OK** ou uma falha por baixo do menu da linha. Uma ligação bem-sucedida não prova que uma consulta ou envio de correio tem sucesso.

![Connection OK confirma que este servidor consegue ligar com a conta guardada.](connectors-guide-test-result.png)

**Resultado esperado:** o servidor OpenLDR testa as credenciais guardadas. Os resultados aparecem em Audit.

## Alterar definições ou credenciais

Edite diretamente as definições normais. As palavras-passe ficam vazias após guardar. Deixe uma palavra-passe vazia para a manter.

### 1. Abrir Edit

Na linha correta, abra os pontos e escolha **Edit**.

![Edit abre as definições normais guardadas.](connectors-guide-edit.png)

### 2. Verificar os campos guardados

Verifique o endereço, a porta, a base e o utilizador. Uma palavra-passe definida mostra uma indicação no campo. Introduza outra apenas para a substituir.

![Os campos normais estão visíveis. A palavra-passe guardada permanece vazia.](connectors-guide-stored.png)

### 3. Guardar as alterações

Abra os pontos do painel e escolha **Save**. O exemplo deixa a palavra-passe vazia e mantém-na. Teste novamente o conector depois.

![Guardar com a palavra-passe vazia mantém a que está guardada.](connectors-guide-save-kept.png)

**Resultado esperado:** o mesmo conector continua disponível aos seus consumidores existentes. Usam as definições atualizadas na próxima execução.

## Encontrar e desativar temporariamente uma ligação

Desative um conector para suspender o uso sem eliminar as definições guardadas.

### 1. Pesquisar na lista

Pesquise pelo nome, tipo ou endereço permitido aos plugins.

![A pesquisa encontra o nome, o tipo e o endereço do conector.](connectors-guide-search.png)

### 2. Desligar Enabled

Desligue **Enabled** na linha correta. As consultas e workflows que dependem dele podem falhar enquanto estiver desativado.

![Enabled pode impedir temporariamente o uso do conector.](connectors-guide-toggle.png)

### 3. Verificar o interruptor

Um interruptor desligado indica que está desativado. Ligue quando puder ser usado.

![Um interruptor desligado indica um conector desativado.](connectors-guide-disabled.png)

**Resultado esperado:** desativar mantém o conector e as credenciais. Não remove as dependências.

## Remover uma ligação desnecessária

Verifique os workflows, consultas e relatórios dependentes antes de remover. Não remova o conector do armazém de dados apenas para limpar a lista.

### 1. Escolher Remove

Abra os pontos da linha e escolha **Remove**.

![Remove elimina o conector e as credenciais guardadas.](connectors-guide-remove.png)

### 2. Verificar a confirmação

Confirme o nome. Escolha **Remove** para eliminar ou **Cancel** para manter. A captura mantém o exemplo para as tarefas seguintes.

![Verificar o nome do conector antes de confirmar a remoção.](connectors-guide-remove-confirm.png)

**Resultado esperado:** confirmar Remove elimina o conector e as credenciais. As referências restantes falham até serem reconfiguradas.

## Usar Connectors num telemóvel

A coluna Host fica oculta no telemóvel. Abra Edit para ler o endereço da ligação.

### 1. Encontrar a linha

Use a pesquisa e depois os pontos da linha ou Enabled.

![No telemóvel, o nome, o tipo, o interruptor e os pontos cabem na largura.](connectors-guide-phone-list.png)

### 2. Ler ou alterar as definições

Escolha **Edit** nos pontos da linha. O painel preenche o ecrã. Desloque dentro dele nos formulários longos.

![O painel de edição preenche o ecrã do telemóvel.](connectors-guide-phone-edit.png)

## Escolher o tipo correto

**Bases SQL.** Postgres, MySQL / MariaDB e Microsoft SQL têm definições diferentes. O conector escolhido determina o dialeto da consulta. Para instâncias SQL Server e contas de domínio Windows, leia [Diagnosticar ligações](/docs/connector-diagnose).

**Outros serviços.** MongoDB, Redis, SMTP Email, IMAP Email, Gmail, Microsoft Outlook e SFTP mostram os campos do respetivo tipo. Use as credenciais fornecidas pelo operador. Gmail e Outlook exigem um registo de aplicação existente e um token de renovação. SMTP usa a conta de envio e as definições do retransmissor.

**Destinos de plugin.** Escolha Category **Plugin**, selecione um plugin de destino instalado e preencha Base URL, Username e Password em conjunto. Ao editar, deixe os três vazios para os manter ou substitua os três. Instale um plugin de destino em [Mercado](/docs/marketplace) se a lista estiver vazia.

Um nó oferece conectores ativos do tipo exigido. Um conector em falta pode estar desativado ou ter outro tipo. Não coloque palavras-passe nos nomes dos workflows ou no texto SQL.

## Usar a linha de comandos

Leia [Começar aqui](/docs/start-here) para configurar a CLI. A partir de `openldr_ce`, use os comandos seguintes. Obtenha o identificador na lista. As operações de adicionar, inspecionar, atualizar, testar e remover suportam conectores Host. Os destinos de plugin usam Studio.

Um ficheiro de adição contém `name`, `type` e `config`. Um ficheiro de atualização contém apenas os campos a alterar. Os campos omitidos mantêm-se guardados. Os segredos vazios mantêm os valores existentes. Proteja os ficheiros de credenciais e remova-os após usar.

```shell
pnpm openldr connectors list
pnpm openldr connectors inspect <id>
pnpm openldr connectors add --file new-connector.json
pnpm openldr connectors update <id> --file connector-patch.json
pnpm openldr connectors test <id>
pnpm openldr connectors remove <id> --force
```

## Prática opcional

As tarefas usam a sua conta de serviço. Numa instalação descartável, peça ao operador uma pequena tabela de teste e um papel só de leitura. As capturas usam duas linhas fictícias em `guide_orders` e `guide_reader`.

Não copie o endereço ou a palavra-passe das capturas para um conector real. Dê à conta de relatórios SELECT apenas nas tabelas aprovadas. Confirme as consultas permitidas e recusadas na sua base. O teste ilustrado verificou a ligação Postgres local. Não testou o envio de correio, a autorização cloud ou a transferência de ficheiros.

## Resolução de problemas

**Ligação recusada ou tempo esgotado.** Verifique o endereço a partir do servidor OpenLDR e a firewall da base. Abra os pontos da linha e Diagnose para ligações Host.

**A autenticação falhou.** Verifique a conta e a base. Substitua a palavra-passe em Edit e teste novamente.

**Erro SSL ou de certificado.** Pergunte ao operador que definições de transporte são necessárias. SQL Server mostra Encrypt e Trust server certificate.

**O teste passa mas uma consulta falha.** Leia o erro ou a execução do workflow. A conta pode não ter acesso, o SQL pode usar outro dialeto ou a consulta exceder o prazo. As consultas dos conectores SQL têm um limite de 30 segundos.

**Os resultados antigos continuam visíveis.** Verifique o erro junto do seletor do conector. Uma tabela anterior não prova que a última execução teve sucesso.

## Guias relacionados

[Diagnosticar ligações](/docs/connector-diagnose) explica as verificações. [Começar aqui](/docs/start-here) explica a CLI. Workflows e Custom Queries usam conectores guardados.
