# Variáveis de ambiente

O OpenLDR é configurado por variáveis de ambiente lidas no arranque. Numa instalação
Docker, ficam no ficheiro `.env` ao lado de `docker-compose.yml` (o ficheiro gerado pelo
instalador). Altere um valor e recrie a stack para o aplicar:

```
docker compose up -d
```

A maioria dos operadores nunca edita estes valores à mão. O instalador escreve valores
por omissão adequados e gera todos os segredos. Esta página é uma referência para os
valores que importam além de uma instalação num único anfitrião: um domínio público, uma
base de dados externa, ou o SQL Server como armazém analítico.

> Os segredos (`*_PASSWORD`, `*_SECRET_*`, `SECRETS_ENCRYPTION_KEY`) são gerados na
> primeira instalação. Nunca os partilhe nem os coloque no controlo de versões. Alterar
> `SECRETS_ENCRYPTION_KEY` depois de existirem conectores torna ilegíveis as credenciais
> guardadas. Considere esta chave definitiva quando a stack estiver em produção.

## Execução

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `NODE_ENV` | `production` | Modo de execução. Mantenha `production` numa instalação. |
| `PORT` | `3000` | Porta interna da API atrás do gateway. |
| `LOG_LEVEL` | `info` | Nível de detalhe dos registos (`debug`, `info`, `warn`, `error`). |
| `OPENLDR_VERSION` | `latest` | Etiqueta da imagem que a stack descarrega e executa. |
| `TRUST_PROXY` | não definido | Quantos proxies à frente da API são de confiança para o IP do cliente. Use `1` atrás do gateway incluído, para que a auditoria mostre o endereço real do cliente. Defina-o apenas quando um proxy de confiança estiver mesmo à frente da API. Caso contrário, um cliente pode falsificar o próprio IP. |

## Endereço público e TLS

Estes valores definem o URL que os utilizadores alcançam e a forma como o gateway termina
o HTTPS. `SERVER_NAME` é o nome de anfitrião público. `PUBLIC_ORIGIN` é a origem completa
usada em ligações e redirecionamentos OIDC.

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `SERVER_NAME` | `localhost` | Nome de anfitrião ou domínio público da instalação. |
| `PUBLIC_ORIGIN` | `https://localhost` | Origem externa completa (`https://seu.dominio`). |
| `GATEWAY_HTTP_PORT` | `80` | Porta do anfitrião onde o gateway serve HTTP. |
| `GATEWAY_HTTPS_PORT` | `443` | Porta do anfitrião onde o gateway serve HTTPS. |
| `TLS_MODE` | `self-signed` | `self-signed` ou um certificado reconhecido (Let's Encrypt). |
| `LETSENCRYPT_EMAIL` | não definido | Email de contacto usado ao emitir um certificado reconhecido. |

## Base de dados

O OpenLDR usa sempre uma base de dados Postgres interna para a aplicação. O armazém
destino (analítico) pode ser Postgres, SQL Server ou MySQL/MariaDB, escolhido com
`TARGET_STORE_ADAPTER`. `TARGET_DATABASE_URL` aplica-se a um destino Postgres. SQL Server e
MySQL usam as suas próprias variáveis, descritas mais abaixo.

| Variável | Finalidade |
| --- | --- |
| `INTERNAL_DATABASE_URL` | Base de dados da aplicação (utilizadores, formulários, workflows, auditoria). Sempre Postgres. |
| `TARGET_DATABASE_URL` | Armazém analítico onde os pipelines escrevem, quando `TARGET_STORE_ADAPTER=pg`. |
| `POSTGRES_PASSWORD` | Palavra-passe do contentor Postgres incluído. |

## Adaptadores

Os adaptadores escolhem a implementação de cada subsistema. Os valores por omissão
correspondem aos contentores incluídos. Altere-os apenas para usar infraestrutura externa.

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `AUTH_ADAPTER` | `keycloak` | Modo de início de sessão: `keycloak` ou `oidc`. Consulte [Fornecedores de autenticação](/docs/auth-providers). |
| `BLOB_ADAPTER` | `minio` | Armazenamento de objetos para carregamentos e artefactos. |
| `EVENTING_ADAPTER` | `pg` | Armazém de eventos usado pelos acionadores de workflow. |
| `TARGET_STORE_ADAPTER` | `pg` | Motor do armazém analítico: `pg`, `mssql` ou `mysql`. |

Um destino de relatórios externo já não se escolhe aqui por adaptador. Crie antes um
conector em **Definições > Conectores**. O plugin de destino é determinado a partir desse
conector.

## Armazenamento de objetos (S3 / MinIO)

O contentor MinIO incluído é compatível com S3. Aponte estas variáveis para qualquer
endpoint S3 para usar armazenamento externo.

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://minio:9000` | URL do endpoint S3. |
| `S3_REGION` | `us-east-1` | Região S3. |
| `S3_ACCESS_KEY_ID` | gerada | Chave de acesso. |
| `S3_SECRET_ACCESS_KEY` | gerada | Chave secreta. |
| `S3_BUCKET` | `openldr` | Bucket que guarda carregamentos e artefactos. |
| `S3_FORCE_PATH_STYLE` | `true` | Endereçamento por caminho (exigido pelo MinIO). |

## Autenticação (Keycloak / OIDC)

O Keycloak é o modo por omissão. O OIDC genérico usa descoberta e tokens de acesso JWT.
Consulte [Fornecedores de autenticação](/docs/auth-providers) para a configuração, os
limites de administração e a proteção do emissor.

| Variável | Finalidade |
| --- | --- |
| `IDENTITY_ADMIN_ADAPTER` | `keycloak` ou `none`. Por omissão, `keycloak` com Keycloak e `none` com OIDC genérico. |
| `OIDC_ISSUER_URL` | URL público do emissor. Mantenha o valor existente numa atualização. Uma alteração posterior impede o arranque. |
| `OIDC_INTERNAL_ISSUER_URL` | URL interno base do realm, apenas para Keycloak. O OIDC genérico ignora este valor. |
| `OIDC_INTERNAL_JWKS_URL` | Substitui o endereço interno das chaves de assinatura. Não altera o emissor esperado. |
| `OIDC_AUDIENCE` | Audiência esperada do token. |
| `OIDC_WEB_CLIENT_ID` | ID do cliente público com que o Studio se autentica. |
| `OIDC_SCOPES` | Scopes pedidos pelo Studio. Usa `openid profile email` por omissão. Tem de incluir `openid`. |
| `OIDC_RESOURCE` | URL de recurso a pedir, para fornecedores que o exigem para emitir o token de acesso API. |
| `TLS_CERT_PATH` | Caminho do certificado TLS público deste servidor (PEM). Quando definido, a página Sites permite descarregá-lo, para que um laboratório remoto confie num servidor central autoassinado. O instalador define-o por si. |
| `KC_HOSTNAME` | URL público base anunciado pelo Keycloak. |
| `KEYCLOAK_ADMIN` | Nome de utilizador do administrador do Keycloak. |
| `KEYCLOAK_ADMIN_PASSWORD` | Palavra-passe do administrador do Keycloak (gerada). |
| `KEYCLOAK_ADMIN_CLIENT_ID` | ID do cliente usado nas chamadas à API de administração. |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Segredo do cliente usado nas chamadas à API de administração. |

## Definições apenas para desenvolvimento

Estas variáveis existem para o desenvolvimento local e os testes automáticos. Nunca as
defina numa instalação.

`AUTH_DEV_BYPASS` **desliga a autenticação**. Qualquer pedido à API sem token é tratado
como vindo de um administrador de desenvolvimento. Fica desligada até a definir, e o
servidor recusa arrancar com ela ligada em `NODE_ENV=production`. Quando está ligada, o
Studio mostra uma faixa de autenticação ignorada e o servidor regista um aviso no arranque.

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `AUTH_DEV_BYPASS` | `false` | Tratar pedidos à API sem autenticação como vindos de um administrador de desenvolvimento. |
| `AUTH_DEV_USERNAME` | `dev-admin` | Nome de utilizador do ator de desenvolvimento injetado. |
| `AUTH_DEV_ROLES` | `lab_admin` | Funções atribuídas ao ator de desenvolvimento injetado. |
| `MARKETPLACE_DEV_ALLOW_UNSIGNED` | `false` | Instalar pacotes do Marketplace sem assinatura. |

## Segredos

| Variável | Finalidade |
| --- | --- |
| `SECRETS_ENCRYPTION_KEY` | Chave de 32 bytes em base64 que cifra as credenciais dos conectores em repouso. Gere-a com `openssl rand -base64 32`. |

## Primeiro arranque

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `MIGRATE_ON_START` | `true` | Executar as migrações da base de dados quando a API arranca. |
| `SEED_ON_START` | `true` | Carregar os formulários, workflows e terminologias por omissão no primeiro arranque. |

## Importações de terminologia

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `TERMINOLOGY_WORK_DIR` | pasta temporária do sistema | Pasta onde uma versão de terminologia carregada é descomprimida durante a importação. Uma versão completa do SNOMED CT precisa de espaço para o zip e para os ficheiros descomprimidos ao mesmo tempo. Aponte-a para um disco maior quando a pasta temporária do contentor for pequena. |

## Armazém destino SQL Server

Defina apenas quando `TARGET_STORE_ADAPTER=mssql`. Inicie o perfil SQL Server com
`docker compose --profile mssql up -d`.

| Variável | Finalidade |
| --- | --- |
| `MSSQL_HOST` | Anfitrião do SQL Server. |
| `MSSQL_PORT` | Porta do SQL Server (por omissão `1433`). |
| `MSSQL_DATABASE` | Nome da base de dados destino. |
| `MSSQL_USER` | Início de sessão. |
| `MSSQL_PASSWORD` | Palavra-passe. |
| `MSSQL_ENCRYPT` | `true`/`false`: cifrar a ligação. |
| `MSSQL_TRUST_SERVER_CERT` | `true`/`false`: confiar num certificado de servidor autoassinado. |

## Armazém destino MySQL / MariaDB

Defina apenas quando `TARGET_STORE_ADAPTER=mysql`. Funciona com MySQL 8.4+ e MariaDB 11.4+.

| Variável | Finalidade |
| --- | --- |
| `MYSQL_HOST` | Anfitrião MySQL/MariaDB. |
| `MYSQL_PORT` | Porta do servidor (por omissão `3306`). |
| `MYSQL_DATABASE` | Nome da base de dados destino. |
| `MYSQL_USER` | Início de sessão. |
| `MYSQL_PASSWORD` | Palavra-passe. |
| `MYSQL_SSL` | `true`/`false`: ligar por TLS. |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | `true`/`false`: recusar um certificado de servidor não reconhecido. |

## Workflows

Consulte [Workflows](/docs/workflows) para os nós controlados por estas definições.

> `WORKFLOW_CODE_ENABLED` permite aos autores de workflows executar JavaScript com os
> mesmos acessos do servidor: os seus ficheiros, rede, ambiente e segredos. O executor de
> código não é uma sandbox. Ligue-o apenas se confiar em todas as pessoas que podem editar
> workflows.

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `WORKFLOW_CODE_ENABLED` | `false` | Permitir a execução de nós Code. Desligado, um nó Code recusa executar. |
| `WORKFLOW_CODE_TIMEOUT_MS` | `5000` | Tempo máximo de uma execução de nó Code, em milissegundos. |
| `WORKFLOW_CODE_MEMORY_MB` | `128` | Memória máxima de uma execução de nó Code, em MB. |
| `WORKFLOW_HTTP_ALLOWLIST` | vazio | Nomes de anfitrião, separados por vírgulas, que o nó HTTP Request pode chamar. Vazio, todos os anfitriões são recusados. |
| `WORKFLOW_FILE_MAX_BYTES` | `52428800` (50 MB) | Tamanho máximo de um ficheiro enviado a uma execução de workflow ou de um corpo de webhook. |
| `WORKFLOW_LOOP_MAX_ITEMS` | `100000` | Número máximo de itens que um nó de ciclo pode recolher. |
| `WORKFLOW_FILE_ACCESS_ENABLED` | `false` | Permitir que o nó Read/Write File aceda a ficheiros do servidor. |
| `WORKFLOW_FILE_ACCESS_ROOT` | vazio | A única pasta a que o nó Read/Write File está limitado. Enquanto estiver vazia, o nó falha. |
| `WORKFLOW_EMAIL_POLL_MIN_SECONDS` | `30` | Intervalo mínimo de consulta de um acionador de email, em segundos. |
| `WORKFLOW_EMAIL_MAX_PER_POLL` | `50` | Número máximo de mensagens não lidas tratadas por consulta. |

## Importação do registo de estabelecimentos

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `FACILITY_IMPORT_MAX_UPLOAD_BYTES` | `67108864` (64 MB) | Tamanho máximo de um ficheiro de registo de estabelecimentos a carregar. Um envio maior é interrompido a meio da transferência. 64 MB equivalem a cerca de 20 vezes um registo nacional de 13 000 linhas. Valores acima de cerca de 512 MB não funcionam. |

## Plugins

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `PLUGIN_UI_ENABLED` | `true` | Mostrar os ecrãs dos plugins. Com `false`, não aparece nenhum menu nem ecrã de plugin. |
| `PLUGIN_EGRESS_ENABLED` | `true` | Permitir que os plugins acedam à rede. Com `false`, todas as chamadas de rede de um plugin são recusadas, sejam quais forem as suas permissões. |
| `PLUGIN_DATA_MAX_DOC_BYTES` | `8388608` (8 MB) | Tamanho máximo de um documento que um plugin pode guardar ou enviar numa chamada. |
| `PLUGIN_CRASH_LOG_DIR` | `.openldr/crash` | Pasta dos registos de falhas dos plugins. O arranque seguinte copia-os para o registo de auditoria. |

## Proteção contra ciclos de falhas

Se o servidor falhar `CRASH_LOOP_THRESHOLD` vezes em `CRASH_LOOP_WINDOW_SEC` segundos, o
arranque seguinte escreve uma entrada de auditoria `system.crash_loop` e espera antes de
terminar. A espera aumenta a cada reinício, o que abranda um ciclo de reinícios em vez de
o deixar girar.

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `CRASH_LOOP_THRESHOLD` | `5` | Falhas dentro da janela antes de a proteção atuar. |
| `CRASH_LOOP_WINDOW_SEC` | `60` | Duração da janela, em segundos. |
| `CRASH_LOOP_BACKOFF_MS` | `2000` | Primeira espera antes de terminar, em milissegundos. |
| `CRASH_LOOP_BACKOFF_CAP_MS` | `60000` | Espera mais longa, em milissegundos. |

## Marketplace

As duas variáveis de registo apenas criam o primeiro registo, num primeiro arranque sem
nenhum. Depois disso, faça a gestão na vista **Registos** de **Definições > Marketplace**.
Consulte [Marketplace](/docs/marketplace).

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `MARKETPLACE_REGISTRY_URL` | registo incluído | Registo remoto criado no primeiro arranque quando não existe nenhum registo. |
| `MARKETPLACE_REGISTRY_DIR` | não definido | Pasta de registo local criada no primeiro arranque quando `MARKETPLACE_REGISTRY_URL` não está definido. A publicação também prepara aqui os pacotes. |
| `MARKETPLACE_LOCAL_REGISTRY_ROOT` | vazio | Quando definido, um registo local adicionado nas Definições tem de ser uma pasta dentro desta. |
| `MARKETPLACE_PUBLISH_TOKEN` | não definido | Token do GitHub com permissão de escrita no repositório de publicação. Mantenha-o secreto. |
| `MARKETPLACE_PUBLISH_REPO` | não definido | Repositório que recebe os pull requests de publicação, no formato `owner/repo`. |
| `MARKETPLACE_PUBLISH_BRANCH` | `main` | Ramo de destino dos pull requests de publicação. |

A publicação só fica ativa quando `MARKETPLACE_PUBLISH_TOKEN`, `MARKETPLACE_PUBLISH_REPO` e
`MARKETPLACE_REGISTRY_DIR` estão todos definidos.

## Sincronização distribuída

Consulte [Sincronização distribuída](/docs/sync) para inscrever um laboratório.

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `OPENLDR_SITE_ID` | não definido | ID de site gravado nos registos que este servidor escreve, usado quando o ID de site do separador **Configurações** da sincronização está vazio. O valor guardado prevalece. |
| `SYNC_ALLOW_INSECURE_TRANSPORT` | `false` | Permitir a sincronização com um servidor central por `http://` simples. A sincronização envia um segredo de cliente e dados relacionados com doentes. Use-o apenas numa rede local de confiança, durante a configuração. `localhost` funciona sem ele. |

## Guias relacionados

- [Definições](/docs/settings)
- [Conectores](/docs/connectors)
