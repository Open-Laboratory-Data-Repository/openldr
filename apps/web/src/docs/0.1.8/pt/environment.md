# Variáveis de ambiente

<!-- operator-platform -->

Faça a manutenção no anfitrião OpenLDR, na pasta Compose instalada. Os exemplos usam `~/Downloads/openldr_ce` no Linux/macOS e `C:\openldr_ce` no PowerShell. Substitua estes caminhos. O terminal já mostra o prompt azul; escreva apenas o comando. Os exemplos de configuração indicam o ficheiro a editar; não são comandos de terminal. As imagens não provam uma operação concluída. Os dados de exemplo são opcionais.

## Alterar um parâmetro API

Este exemplo altera o nível de registo. Planeie interrupção para recriar a API. Valores são lidos ao iniciar. Um simples reinício não substitui o ambiente do contentor. Não altere chaves, emissor nem base neste exemplo.

### 1. Encontrar a instalação e o ficheiro oculto

Use a pasta real no anfitrião, não no dispositivo que lê o guia. Preserve sobreposições Compose.

```sh
{{operator:env-folder}}
```

![Encontrar a instalação e o ficheiro oculto.](guide:operator-env-folder)

### 2. Guardar uma cópia privada

A cópia também contém segredos. Restrinja acesso e não publique nenhum ficheiro. Não substitua uma cópia ainda necessária.

```sh
{{operator:env-backup}}
```

![Guardar uma cópia privada.](guide:operator-env-backup)

### 3. Editar a linha LOG_LEVEL existente

Abra .env no editor. Altere só este valor sem substituir o ficheiro nem duplicar a chave. Volte a info depois. Não mude SECRETS_ENCRYPTION_KEY sem procedimento; as credenciais cifradas dependem dela.

```text
{{operator:env-loglevel}}
```

![Editar a linha LOG_LEVEL existente.](guide:operator-env-loglevel)

### 4. Verificar Compose sem mostrar segredos

Exija código 0. Verifica Compose, não todos os valores da aplicação. Não partilhe a saída completa de docker compose config, que pode revelar credenciais.

```sh
{{operator:env-check}}
```

![Verificar Compose sem mostrar segredos.](guide:operator-env-check)

### 5. Recriar o serviço afetado

Para LOG_LEVEL, recrie api e leia o registo. Gateway ou Keycloak exigem recriar os serviços respetivos. Endereço público e certificados precisam dos procedimentos de Instalação; uma variável não basta.

```sh
{{operator:env-recreate}}
```

![Recriar o serviço afetado.](guide:operator-env-recreate)

### 6. Ler o valor aplicado e a saúde

Espere debug neste exemplo e examine a saúde real. Isto não prova uma integração alterada. Volte a info com os mesmos passos.

```sh
{{operator:env-verify}}
```

![Ler o valor aplicado e a saúde.](guide:operator-env-verify)

A referência descreve a instalação fornecida quando indicado. Valores no código diferem: MIGRATE_ON_START e SEED_ON_START ausentes são false. O instalador ativa migrações e escolhe exemplos pelas opções. Definições essenciais continuam instaladas sem exemplos. TLS_MODE e LETSENCRYPT_EMAIL registam escolhas; alterá-los não emite certificado. Use a tarefa em Instalação.

## Execução

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `NODE_ENV` | `production` | Modo de execução. Mantenha `production` numa instalação. |
| `PORT` | `3000` | Porta interna da API atrás do gateway. |
| `LOG_LEVEL` | `info` | Nível de detalhe dos registos (`debug`, `info`, `warn`, `error`). |
| `LISTEN_HOST` | `0.0.0.0` | Endereço em que a API escuta. `0.0.0.0` significa todas as interfaces de rede. `127.0.0.1` aceita apenas ligações desta máquina. |
| `ROOT_REDIRECT_TO_STUDIO` | `false` | Se `true`, o servidor responde a `/` com um redirecionamento para `/studio/`. Deixe `false` quando o site de apresentação serve `/`. |
| `LOG_FILE` | não definido | Ficheiro onde o servidor escreve os registos, em vez da saída padrão. As linhas são acrescentadas no fim, e uma pasta em falta é criada. Se o ficheiro não puder ser aberto, o servidor não arranca. |
| `OPENLDR_SKIP_ENV_FILE` | não definido | Defina `true` para que o servidor e a CLI não leiam um ficheiro `.env`. Todas as definições têm então de vir do ambiente. |
| `OPENLDR_VERSION` | `latest` | Etiqueta da imagem que a pilha descarrega e executa. |
| `TRUST_PROXY` | não definido | Quantos proxies à frente da API são de confiança para obter o IP do cliente. Use `1` atrás do gateway incluído, para que a auditoria mostre o endereço real do cliente. Defina-o apenas quando um proxy de confiança estiver mesmo à frente da API. Caso contrário, um cliente pode falsificar o próprio IP. |

## Endereço público e TLS

Estes valores definem o URL a que os utilizadores acedem e a forma como o gateway termina
o HTTPS. `SERVER_NAME` é o nome de anfitrião público. `PUBLIC_ORIGIN` é a origem completa
usada em ligações e redirecionamentos OIDC. O [instalador](/docs/install) define-os a
partir de `--server-name` e `--letsencrypt`.

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `SERVER_NAME` | `localhost` | Nome de anfitrião ou domínio público desta instalação. |
| `PUBLIC_ORIGIN` | `https://localhost` | Origem externa completa (`https://your.domain`). |
| `GATEWAY_HTTP_PORT` | `80` | Porta do anfitrião onde o gateway serve HTTP. |
| `GATEWAY_HTTPS_PORT` | `443` | Porta do anfitrião onde o gateway serve HTTPS. |
| `TLS_MODE` | `self-signed` | `self-signed` ou um certificado reconhecido (Let's Encrypt). |
| `LETSENCRYPT_EMAIL` | não definido | Email de contacto usado ao emitir um certificado reconhecido. |

## Base de dados

O OpenLDR usa sempre uma base de dados Postgres interna para a aplicação. O **armazém de
destino (analítico)** pode ser Postgres (por omissão), SQL Server ou MySQL/MariaDB,
escolhido com `TARGET_STORE_ADAPTER` (consulte [Adaptadores](#adaptadores)).
`TARGET_DATABASE_URL` aplica-se ao destino Postgres. O SQL Server e o MySQL usam as suas
próprias variáveis `MSSQL_*` e `MYSQL_*`, descritas abaixo.

| Variável | Finalidade |
| --- | --- |
| `INTERNAL_DATABASE_URL` | Base de dados da aplicação (utilizadores, formulários, fluxos de trabalho, auditoria). Sempre Postgres. |
| `TARGET_DATABASE_URL` | Armazém analítico onde os pipelines escrevem, quando `TARGET_STORE_ADAPTER=pg`. |
| `POSTGRES_PASSWORD` | Palavra-passe do contentor Postgres incluído. |

## Adaptadores

Os adaptadores escolhem a implementação de cada subsistema. Os valores por omissão
correspondem aos contentores incluídos. Altere-os apenas para usar infraestrutura externa.

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `AUTH_ADAPTER` | `keycloak` | Modo de início de sessão: `local`, `keycloak` ou `oidc`. Consulte [Fornecedores de autenticação](/docs/auth-providers). |
| `BLOB_ADAPTER` | `minio` | Armazenamento de objetos para ficheiros carregados e artefactos. `minio` seleciona o adaptador S3, que também funciona com o Garage. `fs` guarda os ficheiros numa pasta desta máquina, indicada por `BLOB_DIR`. |
| `BLOB_DIR` | não definido | Pasta que guarda os ficheiros armazenados. Obrigatório quando `BLOB_ADAPTER` é `fs`. |
| `EVENTING_ADAPTER` | `pg` | Armazém de eventos usado pelos gatilhos dos fluxos de trabalho. |
| `TARGET_STORE_ADAPTER` | `pg` | Motor do armazém analítico: `pg`, `mssql` ou `mysql`. |

## Armazenamento de objetos (S3)

O serviço `storage` incluído executa o Garage, um servidor compatível com S3. Aponte estas
variáveis para qualquer endpoint S3 para usar outro.

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `S3_ENDPOINT` | `http://storage:3900` | URL do endpoint S3. |
| `S3_REGION` | `us-east-1` | Região S3. |
| `S3_ACCESS_KEY_ID` | gerada | Chave de acesso. |
| `S3_SECRET_ACCESS_KEY` | gerada | Chave secreta. |
| `S3_BUCKET` | `openldr` | Bucket que guarda os ficheiros carregados e os artefactos. |
| `S3_FORCE_PATH_STYLE` | `true` | Endereçamento por caminho (exigido pelo armazenamento incluído). |
| `GARAGE_RPC_SECRET` | gerado | Segredo interno do Garage, 64 carateres hexadecimais. |
| `GARAGE_ADMIN_TOKEN` | gerado | Token da API de administração do Garage, 64 carateres hexadecimais. |

O Garage só aceita um identificador de chave de acesso formado por `GK` seguido de 24
carateres hexadecimais, e um segredo hexadecimal de 64 carateres. O instalador gera ambos.

## Autenticação (Keycloak / OIDC)

O Keycloak é o modo por omissão. O OIDC genérico usa descoberta e tokens de acesso JWT. Consulte [Fornecedores de autenticação](/docs/auth-providers) para a configuração, os limites de administração e a proteção do emissor.

| Variável | Finalidade |
| --- | --- |
| `IDENTITY_ADMIN_ADAPTER` | `keycloak`, `local` ou `none`. Por omissão, `keycloak` com autenticação Keycloak, `local` com início de sessão local e `none` com OIDC genérico. |
| `OIDC_ISSUER_URL` | URL público do emissor. Obrigatório para `keycloak` e `oidc`, não usado por `local`. Mantenha o valor existente numa atualização. Uma alteração posterior impede o arranque. |
| `OIDC_INTERNAL_ISSUER_URL` | URL interno base do realm, apenas para Keycloak. O OIDC genérico ignora este valor. |
| `OIDC_INTERNAL_JWKS_URL` | Substitui explicitamente o endereço interno das chaves de assinatura. Não altera o emissor esperado. |
| `TLS_CERT_PATH` | Caminho do certificado TLS público deste servidor (PEM). Quando definido, a página Sites permite transferi-lo, para que um laboratório remoto confie num servidor central autoassinado. O instalador monta o certificado e define esta variável automaticamente. |
| `OIDC_AUDIENCE` | Audiência esperada do token. |
| `OIDC_WEB_CLIENT_ID` | ID do cliente público com que o Studio se autentica. |
| `OIDC_SCOPES` | Scopes pedidos pelo Studio. Usa `openid profile email` por omissão. Tem de incluir `openid`. |
| `OIDC_RESOURCE` | URL de recurso a pedir, para fornecedores que o exigem para emitir o token de acesso à API. |
| `KC_HOSTNAME` | URL público base anunciado pelo Keycloak. |
| `KEYCLOAK_ADMIN` | Nome de utilizador do administrador do Keycloak. |
| `KEYCLOAK_ADMIN_PASSWORD` | Palavra-passe do administrador do Keycloak (gerada). |
| `KEYCLOAK_ADMIN_CLIENT_ID` | ID do cliente usado nas chamadas à API de administração. |
| `KEYCLOAK_ADMIN_CLIENT_SECRET` | Segredo do cliente usado nas chamadas à API de administração. |

## Definições apenas para desenvolvimento

Estas variáveis existem para que o desenvolvimento local e os testes de ponta a ponta
funcionem sem um Keycloak configurado nem pacotes assinados. Nunca as defina numa
instalação.

`AUTH_DEV_BYPASS` **desliga a autenticação**. Qualquer pedido à API sem token bearer é
tratado como vindo de um administrador de desenvolvimento. Fica **desligada até a definir
explicitamente**, e o servidor recusa arrancar com ela ligada em `NODE_ENV=production`.
Quando está ligada, o Studio mostra a faixa "Authentication bypass active" e o servidor
regista um aviso no arranque.

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

## Comportamento no primeiro arranque

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `MIGRATE_ON_START` | `true` | Executar as migrações da base de dados quando a API arranca. |
| `SEED_ON_START` | `true` | Criar os formulários, fluxos de trabalho e terminologias por omissão no primeiro arranque. |

## Importações de terminologia

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `TERMINOLOGY_WORK_DIR` | pasta temporária do sistema | Pasta onde uma versão de terminologia carregada é descomprimida durante a importação. Uma versão completa do SNOMED CT precisa de espaço para o zip e para os ficheiros descomprimidos ao mesmo tempo. Aponte-a para um disco maior quando a pasta temporária do contentor for pequena. |

## Armazém de destino SQL Server

Defina apenas quando `TARGET_STORE_ADAPTER=mssql`. Numa pilha instalada, o
[instalador](/docs/install) prepara-o a partir das opções `--mssql-demo` e `--mssql-*`. O
perfil compose `--profile mssql` simples existe apenas no ficheiro compose de
desenvolvimento.

| Variável | Finalidade |
| --- | --- |
| `MSSQL_HOST` | Anfitrião do SQL Server. |
| `MSSQL_PORT` | Porta do SQL Server (por omissão `1433`). |
| `MSSQL_DATABASE` | Nome da base de dados de destino. |
| `MSSQL_USER` | Início de sessão. |
| `MSSQL_PASSWORD` | Palavra-passe. |
| `MSSQL_ENCRYPT` | `true`/`false`: cifrar a ligação. |
| `MSSQL_TRUST_SERVER_CERT` | `true`/`false`: confiar num certificado de servidor autoassinado. |

## Armazém de destino MySQL / MariaDB

Defina apenas quando `TARGET_STORE_ADAPTER=mysql`. Funciona com MySQL 8.4+ e MariaDB 11.4+.
Numa pilha instalada, o [instalador](/docs/install) prepara-o a partir das opções
`--mysql-demo` e `--mysql-*`.

| Variável | Finalidade |
| --- | --- |
| `MYSQL_HOST` | Anfitrião MySQL/MariaDB. |
| `MYSQL_PORT` | Porta do servidor (por omissão `3306`). |
| `MYSQL_DATABASE` | Nome da base de dados de destino. |
| `MYSQL_USER` | Início de sessão. |
| `MYSQL_PASSWORD` | Palavra-passe. |
| `MYSQL_SSL` | `true`/`false`: ligar por TLS. |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | `true`/`false`: recusar um certificado de servidor que não seja de confiança. |

## Fluxos de trabalho

> `WORKFLOW_CODE_ENABLED` permite aos autores de fluxos de trabalho executar JavaScript com
> os mesmos acessos do próprio servidor: os seus ficheiros, rede, ambiente e segredos. O
> executor de código não é uma sandbox. Ligue-o apenas se confiar em todas as pessoas que
> podem editar fluxos de trabalho.

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `WORKFLOW_CODE_ENABLED` | `false` | Permitir a execução de nós Code. Desligado, um nó Code recusa executar. |
| `WORKFLOW_CODE_TIMEOUT_MS` | `5000` | Tempo máximo de uma execução de um nó Code, em milissegundos. |
| `WORKFLOW_CODE_MEMORY_MB` | `128` | Memória máxima de uma execução de um nó Code, em MB. |
| `WORKFLOW_HTTP_ALLOWLIST` | vazio | Nomes de anfitrião, separados por vírgulas, que o nó HTTP Request pode chamar. Vazio, todos os anfitriões são recusados. |
| `WORKFLOW_FILE_MAX_BYTES` | `52428800` (50 MB) | Tamanho máximo de um ficheiro enviado a uma execução de fluxo de trabalho ou de um corpo de webhook. |
| `WORKFLOW_LOOP_MAX_ITEMS` | `100000` | Número máximo de itens que um único nó de ciclo pode recolher. |
| `WORKFLOW_FILE_ACCESS_ENABLED` | `false` | Permitir que o nó Read/Write File aceda a ficheiros no servidor. |
| `WORKFLOW_FILE_ACCESS_ROOT` | vazio | A única pasta a que o nó Read/Write File está limitado. Enquanto estiver vazia, o nó falha. |
| `WORKFLOW_EMAIL_POLL_MIN_SECONDS` | `30` | Intervalo mínimo de consulta que um gatilho de email pode usar, em segundos. |
| `WORKFLOW_EMAIL_MAX_PER_POLL` | `50` | Número máximo de mensagens não lidas que um gatilho de email trata em cada consulta. |

## Importação do registo de unidades

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `FACILITY_IMPORT_MAX_UPLOAD_BYTES` | `67108864` (64 MB) | Tamanho máximo de um ficheiro de registo de unidades que pode carregar. Um envio maior é interrompido a meio da transferência. 64 MB equivalem a cerca de 20 vezes um registo nacional de 13 000 linhas. Valores acima de cerca de 512 MB não funcionam. |

## Plugins

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `PLUGIN_UI_ENABLED` | `true` | Mostrar os ecrãs dos plugins. Com `false`, não aparece nenhum item de menu nem ecrã de plugin. |
| `PLUGIN_EGRESS_ENABLED` | `true` | Permitir que os plugins acedam à rede. Com `false`, todas as chamadas de rede de um plugin são recusadas, sejam quais forem as permissões que recebeu. |
| `PLUGIN_DATA_MAX_DOC_BYTES` | `8388608` (8 MB) | Tamanho máximo de um documento que um plugin pode guardar ou enviar numa chamada. |
| `PLUGIN_CRASH_LOG_DIR` | `.openldr/crash` | Pasta dos registos de falhas dos plugins. O arranque seguinte copia-os para o registo de auditoria. |

## Proteção contra ciclos de falhas

Se o servidor falhar `CRASH_LOOP_THRESHOLD` vezes dentro de `CRASH_LOOP_WINDOW_SEC`, o
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

| Variável | Omissão | Finalidade |
| --- | --- | --- |
| `OPENLDR_SITE_ID` | não definido | ID de site gravado nos registos que este servidor escreve, usado quando o ID de site do separador **Configurações** da sincronização está vazio. O valor guardado prevalece. |
| `SYNC_ALLOW_INSECURE_TRANSPORT` | `false` | Permitir a sincronização com um servidor central por `http://` simples. A sincronização envia um segredo de cliente e dados relacionados com doentes, por isso use-o apenas numa rede local de confiança, durante a configuração. `localhost` funciona sem ele. |

## Paragem do servidor

Ao receber SIGTERM ou SIGINT, a API deixa de aceitar pedidos e deixa de consultar a fila.
Espera pelos pedidos ativos, pelo lote da fila já reclamado e pelo ciclo de projeção ativo antes de fechar as respetivas bases de dados.
Sinais repetidos não iniciam outra paragem.
Um handler que nunca devolve pode deixar a paragem à espera indefinidamente.
Dê tempo suficiente às importações ativas antes de o gestor de serviços forçar a terminação.
A paragem do worker ainda permite esvaziamentos manuais posteriores. Fechar o contexto termina esse acesso.
