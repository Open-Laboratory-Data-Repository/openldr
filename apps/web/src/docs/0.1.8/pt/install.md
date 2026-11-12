# Instalar

Instale o OpenLDR no anfitrião escolhido. O percurso de início de sessão fica adiado até à captura de uma instalação nova. Este percurso usa a base analítica PostgreSQL incluída e um endereço local. Não precisa de carregar dados de exemplo.

<!-- install-platform -->

Escolha acima a plataforma do **computador que aloja o OpenLDR**. Pode ser diferente do dispositivo onde lê este guia. Os comandos, caminhos e ilustrações mudam em conjunto.

Leia primeiro os [Requisitos](/docs/requirements). No Windows Server, prepare o ambiente Linux descrito em [Windows Server](/docs/windows-server) e siga os comandos Linux aqui. Para uma instalação existente, use [Atualizações planeadas](/docs/upgrading).

A pasta de exemplo é `~/Downloads/openldr_ce`. Escolha uma pasta onde possa escrever. Se escolher outra localização, altere o comando de instalação e os caminhos seguintes. As imagens de terminal e ficheiros são ilustrações. Selecione uma imagem para a ampliar.

O texto azul terminado em `$` ou `>` é o **prompt**. O terminal mostra-o; não o escreva. Escreva o comando a seguir e prima **Enter**. As linhas mais discretas abaixo são o **resultado** do programa; leia-as sem as escrever. Por exemplo, `docker --version` é um comando e `Docker version 29.5.2, build 79eb04c` é a resposta. Os blocos para copiar contêm apenas comandos. Os nomes, caminhos e versões podem ser diferentes. Algumas ilustrações mostram comandos sem o resultado; espere que cada comando termine antes do seguinte.

## Preparar o anfitrião

Vai abrir um terminal, verificar o Docker e descarregar o instalador. Execute os comandos no computador que vai alojar o OpenLDR.

### 1. Abrir um terminal

<!-- install:unix -->
No Linux, abra **Terminal** no menu de aplicações. No macOS, abra o Spotlight, escreva **Terminal** e abra-o.
<!-- /install -->
<!-- install:windows -->
Abra Iniciar, escreva **PowerShell** e abra **Windows PowerShell**. Mantenha esta janela aberta para os passos seguintes.
<!-- /install -->

![Ilustração de um terminal pronto para receber um comando.](guide:install-terminal)

### 2. Verificar o Docker

Introduza cada comando e prima **Enter** depois de cada um.

```
{{install:check}}
```

Os primeiros dois mostram versões. `docker info` deve apresentar uma secção **Server** sem erro de ligação. As versões e os detalhes serão diferentes dos da ilustração. Se o Docker não estiver instalado ou não ligar, resolva isso antes de continuar.

![Ilustração das verificações Docker. As versões e os detalhes do servidor podem variar.](guide:install-check)

### 3. Descarregar o instalador

Copie estes comandos para o mesmo terminal e prima **Enter**.

```
{{install:download}}
```

<!-- install:unix -->
Isto cria a pasta Downloads se necessário e guarda `~/Downloads/openldr-install.sh`. Um descarregamento bem-sucedido com estas opções normalmente não mostra nada.
<!-- /install -->
<!-- install:windows -->
O comando guarda o script na variável `$installer`. Inclua `$installer` exatamente como aparece. Faz parte do comando PowerShell, não da linha de entrada do terminal. Mantenha a janela aberta; o passo seguinte usa a mesma variável.
<!-- /install -->

![Ilustração do descarregamento. Use o comando copiável correspondente acima.](guide:install-download)

**Resultado esperado:** O descarregamento termina sem erro. Ainda não foi instalado nada.

## Instalar e encontrar os ficheiros

O próximo comando cria a pasta de instalação, gera palavras-passe, descarrega imagens de contentores e inicia os serviços. O primeiro descarregamento pode demorar.

### 1. Executar o instalador

Introduza este comando e prima **Enter**.

```
{{install:run}}
```

A opção sem exemplos é intencional. Para incluir o painel inicial e os dados de demonstração numa instalação nova, retire `--seedless` no Linux/macOS ou `-Seedless` no Windows. Os seus próprios dados funcionam em ambos os casos.

![Ilustração do comando com a pasta de exemplo e a opção sem dados iniciais.](guide:install-run)

### 2. Aguardar os serviços e guardar as credenciais

Aguarde **OpenLDR is ready**. Guarde o endereço e as credenciais **App sign-in**. Servem para o Studio. A palavra-passe de administrador do Keycloak serve separadamente para gerir a autenticação.

Se aparecer **OpenLDR is starting**, siga **Verificar uma instalação ainda a iniciar** abaixo. Um código de saída zero não prova que todos os serviços estejam prontos.

![Ilustração da saída final. As palavras-passe são marcadores; use as apresentadas no seu anfitrião.](guide:install-ready)

### 3. Encontrar a pasta de instalação

Abra `~/Downloads/openldr_ce` no gestor de ficheiros. Contém `config`, `data`, `docker-compose.yml` e o lançador OpenLDR.

<!-- install:unix -->
O lançador é `openldr`.
<!-- /install -->
<!-- install:windows -->
O lançador é `openldr.ps1`.
<!-- /install -->

O ficheiro oculto `.env` contém definições e palavras-passe geradas. Guarde-o com a instalação e mantenha-o privado.

![Ilustração do gestor de ficheiros com a pasta de exemplo e os ficheiros gerados.](guide:install-folder)

**Resultado esperado:** Os serviços estão prontos, tem as credenciais do Studio e encontra os ficheiros da instalação.

## Verificar uma instalação ainda a iniciar

Use esta tarefa quando o instalador indicar um serviço ainda a iniciar. Execute no anfitrião OpenLDR. Não apague a base de dados para diagnosticar um erro de arranque.

### 1. Ler o estado dos contentores

```
{{install:status}}
```

A coluna STATUS indica serviços em execução, saudáveis ou a reiniciar. Consulte o seu resultado real, não um exemplo de sucesso.

![Terminal ilustrado: Ler o estado dos contentores.](guide:install-status)

### 2. Ler os registos recentes e resolver o erro

```
{{install:logs}}
```

Leia o erro antes de repetir. Corrija a causa indicada e repita a verificação de estado. Um código de saída bem-sucedido não prova disponibilidade.

| Erro | Ação seguinte |
| --- | --- |
| Docker não instalado | Instale segundo [Requisitos](/docs/requirements) e repita as verificações Docker. |
| Serviço Docker inacessível | Inicie Docker Desktop no Windows/macOS ou o serviço Docker no Linux e repita `docker info`. |
| Módulo Compose em falta | Instale o módulo ou atualize Docker Desktop e repita `docker compose version`. |
| Porta 80 ou 443 ocupada | Identifique o serviço. Numa instalação nova, escolha portas livres com `--http-port 8080 --https-port 8443` ou `-HttpPort 8080 -HttpsPort 8443`. Inclua `:8443` no URL. |
| Transferência falhou | Verifique a rede e repita a transferência. Não execute um script vazio ou incompleto. |

![Terminal ilustrado: Ler os registos recentes e resolver o erro.](guide:install-logs)

## Escolher um endereço para outros computadores

Escolha antes da primeira instalação. O endereço deve alcançar o anfitrião a partir dos computadores ou telefones previstos. Pode ser privado ou Tailscale. Substitua `openldr.example.org` nos dois passos. Configure DNS, encaminhamento e firewall para a sua rede.

### 1. Instalar com o nome escolhido

```
{{install:remote}}
```

O instalador usa este nome para a gateway e redirecionamentos de início de sessão. O exemplo usa um certificado autoassinado e exclui dados de demonstração. Use este comando em vez do comando local anterior.

![Terminal ilustrado: Instalar com o nome escolhido.](guide:install-remote)

### 2. Verificar noutro computador

```
{{install:remote-check}}
```

Execute noutro computador da rede prevista. No Linux/macOS, verifica a API remota e usa `-k` apenas para o certificado autoassinado. No Windows, `TcpTestSucceeded: True` prova acesso TCP à porta 443. Nenhum teste prova início de sessão Studio. Abra também o endereço HTTPS num navegador. Se escolheu outra porta, adapte o teste e o URL.

![Terminal ilustrado: Verificar noutro computador.](guide:install-remote-check)

**Resultado esperado:** Outro computador alcança a gateway pelo endereço escolhido. Se a instalação já usava outro nome, leia o aviso de mudança do anfitrião. Clientes Keycloak existentes mantêm os redirecionamentos antigos e podem precisar de atualização. Alterar só o URL do navegador não muda essa configuração.

## Usar um domínio público com um certificado reconhecido

Esta tarefa opcional destina-se a um **anfitrião Linux**. Primeiro aponte o domínio para o anfitrião e permita entrada TCP 80 e 443. Substitua `openldr.example.org` e `you@example.org` pelos seus valores. Use o instalador descarregado acima.

### 1. Executar com o domínio e o e-mail

```
{{install:tls}}
```


![Ilustração do comando Linux para um domínio público. Substitua o domínio e o e-mail de exemplo.](guide:install-tls)

### 2. Verificar o certificado

Procure **Trusted cert installed**. Se falhar, o instalador mantém o certificado autoassinado. Corrija o DNS ou as portas e repita com a mesma pasta, domínio e e-mail.

![Ilustração da mensagem de certificado emitido para o domínio público de exemplo.](guide:install-tls-ready)

### 3. Verificar a renovação

Quando executado como root, o instalador cria `/etc/cron.d/openldr-cert`. Sem root, apresenta uma entrada cron completa para adicionar com `crontab -e`. Copie a entrada do seu anfitrião; contém o caminho real da instalação. Guarde e saia do editor com os controlos que ele apresenta.

![Ilustração da abertura do agendamento cron. Use a entrada apresentada pelo seu instalador.](guide:install-renewal)

**Resultado esperado:** O endereço público serve o certificado reconhecido e a renovação está configurada. Não assuma renovação automática quando o instalador pede para adicionar a entrada.

Anfitriões Windows e macOS podem usar o seu próprio certificado ou um proxy inverso existente. Veja a tarefa seguinte.

## Usar o seu próprio certificado

Use esta tarefa se já tem um certificado e a respetiva chave privada. Substitua o domínio de exemplo pelo endereço do anfitrião. Os ficheiros devem chamar-se `fullchain.pem` e `privkey.pem` na pasta gerada.

### 1. Criar a configuração sem iniciar os serviços

```
{{install:scaffold}}
```

![Ilustração da criação dos ficheiros sem iniciar os serviços.](guide:install-scaffold)

### 2. Copiar o certificado e a chave

Substitua os caminhos de origem pelos dos seus ficheiros.

```
{{install:certificates}}
```

![Ilustração dos comandos de cópia de certificados. Adapte os caminhos de origem.](guide:install-certificates)

### 3. Iniciar os serviços e verificar o estado

```
{{install:start}}
```

![Ilustração dos comandos para iniciar e verificar os serviços.](guide:install-start)

### 4. Reiniciar a gateway ao substituir ficheiros numa instalação existente

```
{{install:restart-gateway}}
```

Ignore este passo numa instalação nova iniciada acima. Numa instalação existente, substitua primeiro certificado e chave e reinicie a gateway a partir dessa mesma pasta.

![Terminal ilustrado: Reiniciar a gateway ao substituir ficheiros numa instalação existente.](guide:install-restart-gateway)

### 5. Verificar o certificado no computador cliente

```
{{install:certificate-check}}
```

Substitua o nome de exemplo pelo do certificado. O cliente deve confiar no emissor. Resolva erros de confiança ou nome sem os esconder com `-k`. Este teste verifica HTTPS, não início de sessão Studio.

![Terminal ilustrado: Verificar o certificado no computador cliente.](guide:install-certificate-check)

**Resultado esperado:** O endereço configurado responde por HTTPS com o seu certificado. O início de sessão Studio fica adiado até ao percurso de instalação nova.

## Escolher uma base analítica

Escolha uma base analítica antes da primeira instalação. O percurso normal usa PostgreSQL incluído. As alternativas abaixo substituem essa escolha; não as execute em sequência. Um `.env` existente mantém a configuração da base. Repetir o instalador com outras opções não é uma migração. Os exemplos mantêm dados de demonstração opcionais com `--seedless` ou `-Seedless`.

## Experimentar SQL Server para avaliação

O OpenLDR mantém dados operacionais em PostgreSQL interno e escreve dados analíticos na base escolhida. Esta tarefa opcional acrescenta SQL Server 2022 Developer para avaliação. A edição Developer não é licenciada para produção. Consulte as [edições Microsoft](https://www.microsoft.com/en-us/sql-server/sql-server-downloads).

### 1. Instalar a variante SQL Server de avaliação

```
{{install:mssql-demo}}
```

Use o instalador já descarregado. Gera a palavra-passe e cria a base de demonstração.

![Terminal ilustrado: Instalar a variante SQL Server de avaliação.](guide:install-mssql-demo)

### 2. Verificar os contentores e o adaptador escolhido

```
{{install:mssql-status}}
```

Espere um serviço `mssql` adicional e o valor de adaptador `mssql`. Leia o estado real. Para registos, mantenha os dois ficheiros `-f` e substitua `ps` por `logs --tail 100`.

![Terminal ilustrado: Verificar os contentores e o adaptador escolhido.](guide:install-mssql-status)

### 3. Guardar a credencial de base gerada

Leia a linha de palavra-passe MSSQL de demonstração no resultado real. A imagem usa um marcador. Esta palavra-passe SA é distinta da credencial Studio. Mantenha-a privada.

![Terminal ilustrado: Guardar a credencial de base gerada.](guide:install-mssql-ready)

## Ligar a sua base analítica SQL Server

Use SQL Server 2017, 2019 ou 2022 alojado na sua infraestrutura. Versões anteriores e bases geridas na nuvem como Azure SQL ou AWS RDS não são suportadas. A base alvo e a conta devem existir e estar acessíveis a partir da rede Docker. Esta tarefa não cria a base externa.

### 1. Instalar com os seus dados de ligação

```
{{install:mssql-existing}}
```

Substitua `sql.internal`, `openldr_target`, `openldr` e `REPLACE_WITH_DATABASE_PASSWORD` pelo anfitrião, base, conta e palavra-passe. O instalador escreve os dados em `.env`. Evite `#`, espaços e aspas nessa palavra-passe. As opções estão abaixo. Não partilhe capturas com palavras-passe reais.

![Terminal ilustrado: Instalar com os seus dados de ligação.](guide:install-mssql-existing)

### 2. Verificar o adaptador e os serviços

```
{{install:target-status}}
```

Espere `mssql`. Consulte os registos se a API não estiver pronta. O valor do adaptador confirma configuração, não uma importação bem-sucedida. Os valores correspondem a `TARGET_STORE_ADAPTER=mssql` e `MSSQL_*` em [Variáveis de ambiente](/docs/environment).

![Terminal ilustrado: Verificar o adaptador e os serviços.](guide:install-target-status)

## Experimentar MySQL para avaliação

Esta tarefa opcional acrescenta um contentor MySQL 8.4. PostgreSQL interno continua necessário. O contentor MySQL incluído destina-se a avaliação, não a produção.

### 1. Instalar a variante MySQL de avaliação

```
{{install:mysql-demo}}
```

Use o instalador já descarregado. Gera a palavra-passe e cria a base de demonstração.

![Terminal ilustrado: Instalar a variante MySQL de avaliação.](guide:install-mysql-demo)

### 2. Verificar os contentores e o adaptador escolhido

```
{{install:mysql-status}}
```

Espere um serviço `mysql` adicional e o adaptador `mysql`. Consulte o estado real. Para registos, mantenha os dois ficheiros `-f` e substitua `ps` por `logs --tail 100`.

![Terminal ilustrado: Verificar os contentores e o adaptador escolhido.](guide:install-mysql-status)

### 3. Guardar a credencial de base gerada

Leia a linha da palavra-passe root MySQL de demonstração no resultado real. A ilustração usa um marcador. Esta credencial é distinta da do Studio. Mantenha-a privada.

![Terminal ilustrado: Guardar a credencial de base gerada.](guide:install-mysql-ready)

## Ligar a sua base analítica MySQL ou MariaDB

Use MySQL 8.4 LTS ou MariaDB 11.4 LTS alojado na sua infraestrutura. Azure Database for MySQL e AWS RDS não são suportados. A base alvo e a conta devem existir e estar acessíveis a partir da rede Docker. PostgreSQL interno continua necessário.

### 1. Instalar com os seus dados de ligação

```
{{install:mysql-existing}}
```

Substitua `mysql.internal`, `openldr_target`, `openldr` e `REPLACE_WITH_DATABASE_PASSWORD`. Evite `#`, espaços e aspas na palavra-passe escrita em `.env`. Consulte as opções abaixo. Não partilhe palavras-passe reais em capturas.

![Terminal ilustrado: Instalar com os seus dados de ligação.](guide:install-mysql-existing)

### 2. Verificar o adaptador e os serviços

```
{{install:target-status}}
```

Espere `mysql`, também para MariaDB. Verifique estado real e registos. Isto confirma configuração, não uma importação bem-sucedida. Os valores correspondem a `TARGET_STORE_ADAPTER=mysql` e `MYSQL_*` em [Variáveis de ambiente](/docs/environment).

![Terminal ilustrado: Verificar o adaptador e os serviços.](guide:install-target-status)

## Opções do instalador

| Linux / macOS | Windows | Omissão | Finalidade |
| --- | --- | --- | --- |
| `--http-port <n>` / `--https-port <n>` | `-HttpPort / -HttpsPort` | `80` / `443` | Portas da entrada. Windows: `-HttpPort` / `-HttpsPort`. |
| `--ready-timeout <seconds>` | `-ReadyTimeout` | `180` | Espera pelos serviços. Windows: `-ReadyTimeout`. Zero desativa a espera. |
| `--require-ready` | Indisponível | desligado | Apenas Linux/macOS. Falha se o prazo terminar. Incompatível com `--no-start` ou prazo zero. |
| `--dir <path>` | `-Dir` | `./openldr` | Diretório onde a pilha é criada. |
| `--version <tag>` | `-Version` | `latest` | Etiqueta da imagem a descarregar e executar. |
| `--server-name <host>` | `-ServerName` | `localhost` | Nome de anfitrião ou domínio público desta instalação. |
| `--letsencrypt <email>` | Não automatizado | nenhuma | Emitir um certificado Let's Encrypt reconhecido para `--server-name`. |
| `--staging` | Indisponível | desligada | Usar a AC de testes do Let's Encrypt (para testes, evita os limites de pedidos). |
| `--no-start` | `-NoStart` | desligada | Apenas criar e configurar, sem arrancar a pilha. |
| `--no-pull` | `-NoPull` | desligada | Não descarregar imagens (usa as que já existem localmente). |
| `--seedless` | `-Seedless` | desligada (com dados) | Primeiro arranque vazio: não cria o painel de exemplo nem os dados de demonstração (por omissão, são criados). Windows: `-Seedless`. Apenas numa instalação nova. |
| `--target-db <db>` | `-TargetDb` | `postgres` | Base de dados analítica externa: `postgres`, `mssql` ou `mysql`. |
| `--mssql-demo` | `-MssqlDemo` | desligada | Incluir um contentor SQL Server 2022 (apenas para avaliação). Implica `--target-db mssql`. |
| `--mssql-host <host>` | `-MssqlHost` | nenhuma | Anfitrião do seu SQL Server (obrigatório com `--target-db mssql` sem `--mssql-demo`). |
| `--mssql-port <n>` | `-MssqlPort` | `1433` | Porta do seu SQL Server. |
| `--mssql-database <name>` | `-MssqlDatabase` | `openldr_target` | Nome da base de dados de destino (com o seu próprio servidor, já tem de existir). |
| `--mssql-user <user>` | `-MssqlUser` | nenhuma | Início de sessão do seu SQL Server. |
| `--mssql-password <pw>` | `-MssqlPassword` | nenhuma | Palavra-passe do seu SQL Server (evite `#`, espaços e aspas). |
| `--mssql-encrypt <bool>` | `-MssqlEncrypt` | `false` | Cifrar a ligação ao SQL Server. |
| `--mssql-trust-cert <bool>` | `-MssqlTrustCert` | `true` | Confiar no certificado TLS do servidor (autoassinado, no local). |
| `--mysql-demo` | `-MysqlDemo` | desligada | Incluir um contentor MySQL 8.4 (apenas para avaliação). Implica `--target-db mysql`. |
| `--mysql-host <host>` | `-MysqlHost` | nenhuma | Anfitrião do seu MySQL/MariaDB (obrigatório com `--target-db mysql` sem `--mysql-demo`). |
| `--mysql-port <n>` | `-MysqlPort` | `3306` | Porta do seu MySQL/MariaDB. |
| `--mysql-database <name>` | `-MysqlDatabase` | `openldr_target` | Nome da base de dados de destino (com o seu próprio servidor, já tem de existir). |
| `--mysql-user <user>` | `-MysqlUser` | nenhuma | Início de sessão do seu MySQL/MariaDB. |
| `--mysql-password <pw>` | `-MysqlPassword` | nenhuma | Palavra-passe do seu MySQL/MariaDB (evite `#`, espaços e aspas). |
| `--mysql-ssl <bool>` | `-MysqlSsl` | `false` | Ativar SSL/TLS na ligação ao MySQL/MariaDB. |

## Guias relacionados

- [Requisitos](/docs/requirements)
- [Referência CLI](/docs/cli)
- [Variáveis de ambiente](/docs/environment)
- [Desenvolvimento a partir do código-fonte](/docs/development)
- [Atualizações planeadas](/docs/upgrading)
