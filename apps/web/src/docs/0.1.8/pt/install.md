# Instalar

O instalador de uma linha cria um diretório `openldr/`, gera os segredos, descarrega as
imagens e arranca a pilha. No fim, mostra o URL e as credenciais de administrador
geradas.

## Início rápido (local / autoassinado)

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.ps1 | iex
```

Isto arranca a pilha em `https://localhost` com um certificado autoassinado. O navegador
mostra um aviso uma vez. Aceite-o para continuar.

## Domínio público + TLS reconhecido (Let's Encrypt)

Para servir um domínio real com um certificado reconhecido pelo navegador num só passo,
indique o nome de anfitrião e um email. O instalador arranca a pilha, pede um certificado
Let's Encrypt por HTTP-01, instala-o no gateway e configura a **renovação automática**
(uma tarefa cron que renova o certificado e recarrega o gateway).

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --server-name your.domain.com --letsencrypt you@email.com
```

Primeiro, aponte `your.domain.com` para o anfitrião e abra as portas de entrada **TCP 80 e
443**. O Let's Encrypt valida pela porta 80. Se a emissão falhar, a pilha continua ativa
com o certificado autoassinado. Execute de novo o mesmo comando quando o DNS e as portas
estiverem prontos.

> **Dica:** acrescente `--staging` na primeira vez para usar a AC de testes do Let's
> Encrypt. Assim evita os limites de pedidos de produção enquanto confirma que o DNS e a
> firewall estão corretos. Depois execute de novo sem `--staging` para obter o certificado
> real.

> A emissão e a renovação automática do Let's Encrypt só funcionam em Linux. No Windows, o
> instalador configura um certificado autoassinado. Coloque à frente o seu próprio proxy
> inverso ou certificado se precisar de TLS reconhecido.

## Usar o seu próprio certificado

Já tem um certificado? Por exemplo, um `fullchain.pem` + `privkey.pem` de outra origem, um
certificado wildcard ou uma AC interna. Prepare a instalação sem a arrancar, copie os
ficheiros e depois arranque:

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --server-name your.domain.com --no-start
cp /path/to/fullchain.pem openldr/config/nginx/certs/fullchain.pem
cp /path/to/privkey.pem   openldr/config/nginx/certs/privkey.pem
cd openldr && docker compose up -d
```

`--server-name` define o domínio no `.env` gerado e no redirecionamento OIDC. No Windows,
use `install.ps1 -ServerName your.domain.com -NoStart`, copie os dois ficheiros para
`openldr\config\nginx\certs\` e depois execute `docker compose up -d`. A pilha já está a
correr com o certificado autoassinado? Substitua os dois ficheiros e execute
`docker compose restart gateway`.

## SQL Server como base de dados analítica

O OpenLDR guarda os dados operacionais numa base de dados **PostgreSQL** interna (sempre) e
escreve dados analíticos e de relatórios, em formato plano, numa base de dados **externa**
separada. Essa base externa é **PostgreSQL por omissão**, ou um **Microsoft SQL Server
alojado por si**, escolhido na instalação. Os painéis, os relatórios, as consultas
personalizadas e o editor de relatórios leem dessa base, e as consultas reconhecem o
SQL Server.

**Versões do SQL Server suportadas:** 2017, 2019 e 2022, apenas alojadas por si. A 2017 é
a versão mínima (a atualização mais próxima para locais que ainda usam a 2014).

> **Nunca bases de dados na nuvem.** Azure SQL, Managed Instance, AWS RDS e qualquer SQL
> alojado **não são suportados**, em nenhuma das duas bases. Os dados do Ministério da Saúde
> e dos laboratórios têm de ficar em infraestrutura controlada pelo operador. É uma regra
> permanente de soberania dos dados. O SQL Server 2016 e versões anteriores não são
> suportados (fim de vida, sem contentor Linux oficial). Atualize para a 2017.

Escolha o destino com `--target-db` (por omissão `postgres`). Há dois caminhos para o SQL
Server.

### Demonstração / avaliação

Arranque um contentor SQL Server 2022 incluído, ao lado da pilha. O instalador gera a
palavra-passe SA e cria automaticamente a base de dados `openldr_target`.

```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --mssql-demo
```

No Windows: `install.ps1 -MssqlDemo`.

> As edições Developer e Express do SQL Server **não têm licença para produção**. Por isso,
> o contentor incluído serve apenas para avaliação e nunca deve suportar uma instalação de
> produção.

### Produção (o seu próprio SQL Server)

Ligue o OpenLDR ao seu próprio SQL Server, alojado por si. **A base de dados de destino já
tem de existir.**

```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --target-db mssql \
      --mssql-host sql.internal --mssql-user openldr --mssql-password 'YourStrongPassword1'
```

No Windows: `install.ps1 -TargetDb mssql -MssqlHost sql.internal -MssqlUser openldr -MssqlPassword '...'`.
Opcional: `--mssql-port` (por omissão `1433`), `--mssql-database` (`openldr_target`),
`--mssql-encrypt` (`false`), `--mssql-trust-cert` (`true`).

> Não use `#`, espaços nem aspas na palavra-passe do SQL Server. Estes carateres confundem o
> leitor de `.env` do Docker Compose.

Estas opções correspondem a `TARGET_STORE_ADAPTER=mssql` e às
[variáveis de ambiente](/docs/environment) `MSSQL_*`. Também as pode definir diretamente no
`.env`.

## MySQL/MariaDB como base de dados analítica

O OpenLDR também pode escrever dados analíticos e de relatórios numa base de dados **MySQL**
ou **MariaDB** **alojada por si**, escolhida na instalação. Os painéis, os relatórios, as
consultas personalizadas e o editor de relatórios leem dessa base.

**Versões suportadas:** MySQL 8.4 LTS e MariaDB 11.4 LTS, apenas alojadas por si.

> **Nunca bases de dados na nuvem.** Azure Database for MySQL, AWS RDS e qualquer
> MySQL/MariaDB alojado **não são suportados**. Os dados do Ministério da Saúde e dos
> laboratórios têm de ficar em infraestrutura controlada pelo operador. É uma regra
> permanente de soberania dos dados.

Escolha o destino com `--target-db` (por omissão `postgres`). Há dois caminhos para o
MySQL/MariaDB.

### Demonstração / avaliação

Arranque um contentor MySQL 8.4 incluído, ao lado da pilha. O instalador gera a
palavra-passe e cria automaticamente a base de dados `openldr_target`.

```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --mysql-demo
```

No Windows: `install.ps1 -MysqlDemo`.

> O contentor MySQL incluído serve apenas para avaliação e nunca deve suportar uma
> instalação de produção.

### Produção (o seu próprio MySQL/MariaDB)

Ligue o OpenLDR ao seu próprio MySQL ou MariaDB, alojado por si. **A base de dados de
destino já tem de existir.**

```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/install.sh \
  | bash -s -- --target-db mysql \
      --mysql-host mysql.internal --mysql-user openldr --mysql-password 'YourStrongPassword1'
```

No Windows: `install.ps1 -TargetDb mysql -MysqlHost mysql.internal -MysqlUser openldr -MysqlPassword '...'`.
Opcional: `--mysql-port` (por omissão `3306`), `--mysql-database` (`openldr_target`),
`--mysql-ssl` (`false`).

> Não use `#`, espaços nem aspas na palavra-passe do MySQL/MariaDB. Estes carateres
> confundem o leitor de `.env` do Docker Compose.

Estas opções correspondem a `TARGET_STORE_ADAPTER=mysql` e às
[variáveis de ambiente](/docs/environment) `MYSQL_*`. Também as pode definir diretamente no
`.env`.

## Opções do instalador

| Opção | Omissão | Finalidade |
| --- | --- | --- |
| `--dir <path>` | `./openldr` | Diretório onde a pilha é criada. |
| `--version <tag>` | `latest` | Etiqueta da imagem a descarregar e executar. |
| `--server-name <host>` | `localhost` | Nome de anfitrião ou domínio público desta instalação. |
| `--letsencrypt <email>` | nenhuma | Emitir um certificado Let's Encrypt reconhecido para `--server-name`. |
| `--staging` | desligada | Usar a AC de testes do Let's Encrypt (para testes, evita os limites de pedidos). |
| `--no-start` | desligada | Apenas criar e configurar, sem arrancar a pilha. |
| `--no-pull` | desligada | Não descarregar imagens (usa as que já existem localmente). |
| `--seedless` | desligada (com dados) | Primeiro arranque vazio: não cria o painel de exemplo nem os dados de demonstração (por omissão, são criados). Windows: `-Seedless`. Apenas numa instalação nova. |
| `--target-db <db>` | `postgres` | Base de dados analítica externa: `postgres`, `mssql` ou `mysql`. |
| `--mssql-demo` | desligada | Incluir um contentor SQL Server 2022 (apenas para avaliação). Implica `--target-db mssql`. |
| `--mssql-host <host>` | nenhuma | Anfitrião do seu SQL Server (obrigatório com `--target-db mssql` sem `--mssql-demo`). |
| `--mssql-port <n>` | `1433` | Porta do seu SQL Server. |
| `--mssql-database <name>` | `openldr_target` | Nome da base de dados de destino (com o seu próprio servidor, já tem de existir). |
| `--mssql-user <user>` | nenhuma | Início de sessão do seu SQL Server. |
| `--mssql-password <pw>` | nenhuma | Palavra-passe do seu SQL Server (evite `#`, espaços e aspas). |
| `--mssql-encrypt <bool>` | `false` | Cifrar a ligação ao SQL Server. |
| `--mssql-trust-cert <bool>` | `true` | Confiar no certificado TLS do servidor (autoassinado, no local). |
| `--mysql-demo` | desligada | Incluir um contentor MySQL 8.4 (apenas para avaliação). Implica `--target-db mysql`. |
| `--mysql-host <host>` | nenhuma | Anfitrião do seu MySQL/MariaDB (obrigatório com `--target-db mysql` sem `--mysql-demo`). |
| `--mysql-port <n>` | `3306` | Porta do seu MySQL/MariaDB. |
| `--mysql-database <name>` | `openldr_target` | Nome da base de dados de destino (com o seu próprio servidor, já tem de existir). |
| `--mysql-user <user>` | nenhuma | Início de sessão do seu MySQL/MariaDB. |
| `--mysql-password <pw>` | nenhuma | Palavra-passe do seu MySQL/MariaDB (evite `#`, espaços e aspas). |
| `--mysql-ssl <bool>` | `false` | Ativar SSL/TLS na ligação ao MySQL/MariaDB. |

No fim, faça a gestão da pilha a partir do diretório `openldr/`:

```
docker compose ps            # status
docker compose logs -f       # follow logs
docker compose down          # stop
docker compose up -d         # start
```

O instalador também coloca um script `openldr` no diretório de instalação, ao lado de
`docker-compose.yml`. Executa a CLI do operador dentro do contentor `api`:

```
./openldr --help
```

No Windows, use `.\openldr.ps1`. O script só vê ficheiros em `./data`, uma pasta também
criada ao lado dele. Coloque lá um ficheiro e indique-o com o prefixo `data/`, por exemplo
`./openldr ingest data/bundle.json`. Consulte a [referência da CLI](/docs/cli) para a lista
completa de comandos.

Consulte [Variáveis de ambiente](/docs/environment) para os valores do `.env` gerado, ou
[Windows Server (WSL2)](/docs/windows-server) para instalar no Windows Server.

## Instalar a partir do código-fonte (para desenvolvimento)

Execute o OpenLDR a partir do código-fonte com o script de arranque para programadores. Ele
clona o repositório, instala as dependências, arranca os serviços de suporte, inicializa a
base de dados e mostra como lançar os servidores de desenvolvimento.

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.ps1 | iex
```

Exige git, Node.js 20+, pnpm (ou Corepack) e Docker. Depois arranque a aplicação em dois
terminais: `pnpm -C apps/server dev` e `pnpm -C apps/studio dev` (interface do Studio em
http://localhost:5173).
