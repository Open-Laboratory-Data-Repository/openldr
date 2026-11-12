# Diagnosticar ligações

Use Diagnose quando um conector de anfitrião guardado não consegue ligar. Verifica as definições, o nome do servidor, a porta, a autenticação e a versão do servidor, por ordem.

Precisa de **Manage connectors**. O diagnóstico parte do servidor OpenLDR com as credenciais guardadas. Abre uma ligação de teste sem importar dados.

Use a sua ligação guardada. As imagens mostram uma ligação Postgres real e isolada e uma instância SQL Server ausente de propósito. Um exemplo de falha não prova uma autenticação SQL Server válida.

## Diagnosticar uma ligação guardada

Comece por uma ligação que já usa, ou pelo conector do armazém numa instalação nova.

### 1. Abrir Connectors

Abra **Settings** e depois **Connectors**.

![Abra Settings e depois Connectors.](connector-diagnose-guide-open.png)

### 2. Escolher Diagnose

Abra os pontos da linha do conector de anfitrião e selecione **Diagnose**. As verificações começam quando o painel abre.

![Escolha Diagnose na linha de um conector de anfitrião.](connector-diagnose-guide-diagnose.png)

### 3. Ler o resultado das definições

Leia o estado e a mensagem de cada passo. Um aviso dá orientação sem parar as verificações seguintes.

![Leia o estado real de cada passo do diagnóstico.](connector-diagnose-guide-passed.png)

### 4. Ler os resultados da ligação

Verifique **Port**, **Login** e **Server version**. O exemplo Postgres local passa todas as verificações.

![Port, Login e Server version confirmam a ligação testada.](connector-diagnose-guide-login.png)

### 5. Repetir quando necessário

Abra os pontos do painel de diagnóstico e selecione **Run again**. Usa as definições atualmente guardadas.

![Run again repete as verificações com as definições guardadas.](connector-diagnose-guide-again.png)

**Resultado esperado:** uma execução bem-sucedida termina com All checks passed. Prova a ligação testada. Não prova uma consulta específica de relatório, o esquema de origem ou uma permissão da conta.

## Introduzir as definições SQL Server

Pergunte ao operador da base de dados se tem uma instância com nome, uma porta TCP fixa, uma conta SQL ou uma conta de domínio Windows. Crie a ligação fictícia apenas se quiser um exemplo isolado de falha.

### 1. Adicionar um conector de anfitrião

Feche o diagnóstico. Abra os pontos de Connectors e escolha **Add connector**. Introduza um nome útil e defina Category como **Host**.

![Escolha Add connector para uma ligação SQL Server.](connector-diagnose-guide-add.png)

### 2. Escolher Microsoft SQL

Defina **Database type** como **Microsoft SQL**.

![Escolha Microsoft SQL.](connector-diagnose-guide-sql-type.png)

### 3. Introduzir o servidor e a instância

Introduza **Host**. Um valor colado `SERVER\INSTANCE` divide-se entre Host e Instance name quando sai do campo. Use uma Port fixa apenas quando Instance name está vazio.

![O servidor e a instância colados ficam em campos separados.](connector-diagnose-guide-split.png)

### 4. Introduzir a base de dados e a conta

Preencha **Database**, **User** e **Password**. Para uma conta Windows, preencha Windows domain e use o nome de utilizador sem domínio. Deixe o domínio vazio para uma conta SQL.

![Introduza a base e a conta. Windows domain aplica-se apenas a contas Windows.](connector-diagnose-guide-login-fields.png)

### 5. Verificar a encriptação

**Encrypt** começa ligado. Siga os requisitos de encriptação e certificado do operador do servidor. Trust server certificate aceita um certificado sem a validação habitual.

![Encrypt começa ligado. Adapte a encriptação e o certificado ao servidor.](connector-diagnose-guide-encryption.png)

### 6. Guardar o conector

Abra os pontos do painel e escolha **Save**.

![Save guarda as definições antes do diagnóstico.](connector-diagnose-guide-save.png)

**Resultado esperado:** pode agora diagnosticar o conector guardado. O exemplo indica de propósito uma instância inexistente.

## Ler e corrigir um diagnóstico com falha

O diagnóstico para na primeira verificação com falha. Os passos seguintes ficam ignorados, sem resultado.

### 1. Diagnosticar a linha guardada

Abra os pontos da linha e escolha **Diagnose**.

![Escolha Diagnose na instância com nome guardada.](connector-diagnose-guide-bad-diagnose.png)

### 2. Ler a primeira falha

Leia o passo com falha e a mensagem de correção. Este exemplo não recebe resposta do SQL Server Browser para a instância ausente.

![Esta instância ausente de propósito falha no SQL Server Browser.](connector-diagnose-guide-browser-failure.png)

### 3. Verificar os passos ignorados

Aqui Port, Login e Server version não foram tentados. Uma autenticação ignorada não significa que a palavra-passe foi aceite.

![Os passos seguintes ficam ignorados após a primeira falha.](connector-diagnose-guide-skipped.png)

### 4. Corrigir as definições guardadas

Feche o diagnóstico, abra os pontos da linha e escolha **Edit**. Verifique Host e Instance name. Se o operador fornecer uma porta TCP fixa, limpe Instance name e introduza essa porta. Guarde a alteração e volte a diagnosticar.

![Verifique o servidor e a instância. Em alternativa, limpe Instance name e introduza a porta TCP fixa real.](connector-diagnose-guide-correction.png)

**Resultado esperado:** siga o passo que falhou. A correção pode exigir alterações do serviço, da firewall ou da resolução de nomes fora do OpenLDR. A instância ausente não foi reparada.

## Ler o diagnóstico num telemóvel

O mesmo menu de linha abre o diagnóstico na largura do telemóvel.

### 1. Ler as mensagens das verificações

Abra Diagnose e desloque dentro do painel para ler cada resultado. As mensagens passam para a linha seguinte abaixo do nome do passo.

![O painel do telemóvel adapta cada mensagem à largura disponível.](connector-diagnose-guide-phone.png)

## Significado das verificações

**Settings.** Existe um anfitrião e a porta é válida. O aviso localhost lembra que os contentores Docker têm o seu próprio endereço de retorno local.

**Server name.** O servidor OpenLDR resolve o nome para um endereço. Uma resolução bem-sucedida não prova que a porta da base responde.

**SQL Server Browser.** Numa instância SQL Server com nome, UDP 1434 indica a porta TCP. Peça ao operador para iniciar Browser e permitir UDP. Em alternativa, use a porta TCP fixa real sem nome de instância.

**Port.** Abre uma ligação TCP. Um serviço incorreto também pode responder nessa porta.

**Login.** A conta guardada abre a base de dados. Se falhar, verifique o utilizador, a palavra-passe, o domínio e o acesso à base.

**Server version.** O servidor responde a uma pequena consulta. Isto ainda não prova que existem as tabelas e colunas exigidas pelo importador.

## Executar a mesma verificação pela CLI

Siga [Começar aqui](/docs/start-here) para configurar a CLI. Em `openldr_ce`, liste os conectores para obter o identificador. Diagnose termina com código 1 quando um passo falha. Adicione `--json` para resultados estruturados.

```shell
pnpm openldr connectors list
pnpm openldr connectors diagnose <id>
pnpm openldr connectors diagnose <id> --json
```

## Prática opcional e limites

Não precisa de dados de exemplo. Teste primeiro o conector do armazém existente. Um conector Microsoft SQL temporário com uma instância inexistente pode demonstrar a falha de Browser. Depois remova-o pelos pontos da linha e pela confirmação.

As verificações documentadas testaram uma ligação Postgres real com sucesso e uma expiração UDP real para uma instância com nome ausente. Não testaram autenticação Windows, uma instância SQL Server com nome funcional, substituição de certificados ou um servidor TLS antigo.

## Resolução de problemas

**A primeira verificação falha.** Leia-a antes dos resultados ignorados. Corrija as definições guardadas em Edit e execute Diagnose novamente.

**Browser expira numa instância SQL Server com nome.** Verifique os nomes do servidor e da instância e o acesso ao SQL Server Browser. Os passos seguintes ficam ignorados até a descoberta ter sucesso.

**Todas as verificações passam, mas o importador falha.** O diagnóstico verifica a ligação e a resposta do servidor. Não prova que a conta consegue ler cada tabela de origem necessária.

## Guias relacionados

[Conectores](/docs/connectors) explica a criação, os testes e a alteração de segredos. [Importar do OpenLDR v1](/docs/v1-import) usa um conector de base de dados.
