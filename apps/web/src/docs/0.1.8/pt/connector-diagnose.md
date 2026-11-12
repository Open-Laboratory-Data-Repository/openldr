# Diagnosticar ligações

<!-- operator-platform -->

Faça a manutenção no anfitrião OpenLDR, na pasta Compose instalada. Os exemplos usam `~/Downloads/openldr_ce` no Linux/macOS e `C:\openldr_ce` no PowerShell. Substitua estes caminhos. O terminal já mostra o prompt azul; escreva apenas o comando. As ilustrações de ficheiros mostram texto para editar no ficheiro indicado. As imagens não provam uma operação concluída. Os dados de exemplo são opcionais.

Use Diagnose quando um conector de anfitrião guardado não consegue ligar. Verifica as definições, o nome do servidor, a porta, a autenticação e a versão do servidor, por ordem.

Precisa de **Manage connectors**. O diagnóstico parte do servidor OpenLDR com as credenciais guardadas. Abre uma ligação de teste sem importar dados.

Use a sua ligação guardada. As imagens mostram uma ligação Postgres real e isolada e uma instância SQL Server ausente de propósito. Um exemplo de falha não prova uma autenticação SQL Server válida.

## Diagnosticar uma ligação guardada

Comece por uma ligação que já usa, ou pelo conector do armazém numa instalação nova.

### 1. Abrir Connectors

Abra **Settings** e depois **Connectors**.

![Abra Settings e depois Connectors.](/docs-images/operator/connector-diagnose-guide-open.png)

### 2. Escolher Diagnose

Abra os pontos da linha do conector de anfitrião e selecione **Diagnose**. As verificações começam quando o painel abre.

![Escolha Diagnose na linha de um conector de anfitrião.](/docs-images/operator/connector-diagnose-guide-diagnose.png)

### 3. Ler o resultado das definições

Leia o estado e a mensagem de cada passo. Um aviso dá orientação sem parar as verificações seguintes.

![Leia o estado real de cada passo do diagnóstico.](/docs-images/operator/connector-diagnose-guide-passed.png)

### 4. Ler os resultados da ligação

Verifique **Port**, **Login** e **Server version**. O exemplo Postgres local passa todas as verificações.

![Port, Login e Server version confirmam a ligação testada.](/docs-images/operator/connector-diagnose-guide-login.png)

### 5. Repetir quando necessário

Abra os pontos do painel de diagnóstico e selecione **Run again**. Usa as definições atualmente guardadas.

![Run again repete as verificações com as definições guardadas.](/docs-images/operator/connector-diagnose-guide-again.png)

**Resultado esperado:** uma execução bem-sucedida termina com All checks passed. Prova a ligação testada. Não prova uma consulta específica de relatório, o esquema de origem ou uma permissão da conta.

## Introduzir as definições SQL Server

Pergunte ao operador da base de dados se tem uma instância com nome, uma porta TCP fixa, uma conta SQL ou uma conta de domínio Windows. Crie a ligação fictícia apenas se quiser um exemplo isolado de falha.

### 1. Adicionar um conector de anfitrião

Feche o diagnóstico. Abra os pontos de Connectors e escolha **Add connector**. Introduza um nome útil e defina Category como **Host**.

![Escolha Add connector para uma ligação SQL Server.](/docs-images/operator/connector-diagnose-guide-add.png)

### 2. Escolher Microsoft SQL

Defina **Database type** como **Microsoft SQL**.

![Escolha Microsoft SQL.](/docs-images/operator/connector-diagnose-guide-sql-type.png)

### 3. Introduzir o servidor e a instância

Introduza **Host**. Um valor colado `SERVER\INSTANCE` divide-se entre Host e Instance name quando sai do campo. Use uma Port fixa apenas quando Instance name está vazio.

![O servidor e a instância colados ficam em campos separados.](/docs-images/operator/connector-diagnose-guide-split.png)

### 4. Introduzir a base de dados e a conta

Preencha **Database**, **User** e **Password**. Para uma conta Windows, preencha Windows domain e use o nome de utilizador sem domínio. Deixe o domínio vazio para uma conta SQL.

![Introduza a base e a conta. Windows domain aplica-se apenas a contas Windows.](/docs-images/operator/connector-diagnose-guide-login-fields.png)

### 5. Verificar a encriptação

**Encrypt** começa ligado. Siga os requisitos de encriptação e certificado do operador do servidor. Trust server certificate aceita um certificado sem a validação habitual.

![Encrypt começa ligado. Adapte a encriptação e o certificado ao servidor.](/docs-images/operator/connector-diagnose-guide-encryption.png)

### 6. Guardar o conector

Abra os pontos do painel e escolha **Save**.

![Save guarda as definições antes do diagnóstico.](/docs-images/operator/connector-diagnose-guide-save.png)

**Resultado esperado:** pode agora diagnosticar o conector guardado. O exemplo indica de propósito uma instância inexistente.

## Ler e corrigir um diagnóstico com falha

O diagnóstico para na primeira verificação com falha. Os passos seguintes ficam ignorados, sem resultado.

### 1. Diagnosticar a linha guardada

Abra os pontos da linha e escolha **Diagnose**.

![Escolha Diagnose na instância com nome guardada.](/docs-images/operator/connector-diagnose-guide-bad-diagnose.png)

### 2. Ler a primeira falha

Leia o passo com falha e a mensagem de correção. Este exemplo não recebe resposta do SQL Server Browser para a instância ausente.

![Esta instância ausente de propósito falha no SQL Server Browser.](/docs-images/operator/connector-diagnose-guide-browser-failure.png)

### 3. Verificar os passos ignorados

Aqui Port, Login e Server version não foram tentados. Uma autenticação ignorada não significa que a palavra-passe foi aceite.

![Os passos seguintes ficam ignorados após a primeira falha.](/docs-images/operator/connector-diagnose-guide-skipped.png)

### 4. Corrigir as definições guardadas

Feche o diagnóstico, abra os pontos da linha e escolha **Edit**. Verifique Host e Instance name. Se o operador fornecer uma porta TCP fixa, limpe Instance name e introduza essa porta. Guarde a alteração e volte a diagnosticar.

![Verifique o servidor e a instância. Em alternativa, limpe Instance name e introduza a porta TCP fixa real.](/docs-images/operator/connector-diagnose-guide-correction.png)

**Resultado esperado:** siga o passo que falhou. A correção pode exigir alterações do serviço, da firewall ou da resolução de nomes fora do OpenLDR. A instância ausente não foi reparada.

## Ler o diagnóstico num telemóvel

O mesmo menu de linha abre o diagnóstico na largura do telemóvel.

### 1. Ler as mensagens das verificações

Abra Diagnose e desloque dentro do painel para ler cada resultado. As mensagens passam para a linha seguinte abaixo do nome do passo.

![O painel do telemóvel adapta cada mensagem à largura disponível.](/docs-images/operator/connector-diagnose-guide-phone.png)

## Significado das verificações

**Settings.** Existe um anfitrião e a porta é válida. O aviso localhost lembra que os contentores Docker têm o seu próprio endereço de retorno local.

**Server name.** O servidor OpenLDR resolve o nome para um endereço. Uma resolução bem-sucedida não prova que a porta da base responde.

**SQL Server Browser.** Numa instância SQL Server com nome, UDP 1434 indica a porta TCP. Peça ao operador para iniciar Browser e permitir UDP. Em alternativa, use a porta TCP fixa real sem nome de instância.

**Port.** Abre uma ligação TCP. Um serviço incorreto também pode responder nessa porta.

**Login.** A conta guardada abre a base de dados. Se falhar, verifique o utilizador, a palavra-passe, o domínio e o acesso à base.

**Server version.** O servidor responde a uma pequena consulta. Isto ainda não prova que existem as tabelas e colunas exigidas pelo importador.

## Diagnosticar pelo CLI

Substitua CONNECTOR_ID pelo conector guardado. Estes testes abrem uma ligação à base, sem importar registos.

### 1. Encontrar o identificador do conector

```sh
{{operator:diagnose-list}}
```

![Encontrar o identificador do conector.](guide:operator-diagnose-list)

### 2. Executar diagnóstico no anfitrião

```sh
{{operator:diagnose-cli}}
```

![Executar diagnóstico no anfitrião.](guide:operator-diagnose-cli)

### 3. Examinar parâmetros sem revelar segredos

```sh
{{operator:diagnose-inspect}}
```

![Examinar parâmetros sem revelar segredos.](guide:operator-diagnose-inspect)

## Prática opcional e limites

Não precisa de dados de exemplo. Teste primeiro o conector do armazém existente. Um conector Microsoft SQL temporário com uma instância inexistente pode demonstrar a falha de Browser. Depois remova-o pelos pontos da linha e pela confirmação.

As verificações documentadas testaram uma ligação Postgres real com sucesso e uma expiração UDP real para uma instância com nome ausente. Não testaram autenticação Windows, uma instância SQL Server com nome funcional, substituição de certificados ou um servidor TLS antigo.

## Resolução de problemas

**A primeira verificação falha.** Leia-a antes dos resultados ignorados. Corrija as definições guardadas em Edit e execute Diagnose novamente.

**Browser expira numa instância SQL Server com nome.** Verifique os nomes do servidor e da instância e o acesso ao SQL Server Browser. Os passos seguintes ficam ignorados até a descoberta ter sucesso.

**Todas as verificações passam, mas o importador falha.** O diagnóstico verifica a ligação e a resposta do servidor. Não prova que a conta consegue ler cada tabela de origem necessária.

## Guias relacionados

[Conectores](/docs/connectors) explica a criação, os testes e a alteração de segredos. [Importar do OpenLDR v1](/docs/v1-import) usa um conector de base de dados.
