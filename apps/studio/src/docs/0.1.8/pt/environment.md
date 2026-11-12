# Variáveis de ambiente

O OpenLDR lê as variáveis de ambiente quando o servidor inicia. Numa instalação Docker, edite o `.env` privado junto do ficheiro Compose e recrie os serviços afetados.

Use Settings para valores com controlos na aplicação. Connectors guarda as credenciais dos destinos. Marketplace gere os registos após o primeiro arranque. Distributed sync guarda a configuração da ligação em Settings. Estas definições guardadas não exigem editar o ficheiro de ambiente.

Precisa de acesso ao servidor e do projeto Compose, ficheiro de ambiente e ficheiros complementares exatos da instalação. Mantenha essas opções. As imagens de terminal ilustram comandos a adaptar. Não mostram o seu servidor nem comprovam uma alteração da instalação.

Preserve `SECRETS_ENCRYPTION_KEY`. Substituí-la após guardar credenciais torna-as ilegíveis. Mantenha palavras-passe, chaves de assinatura, certificados privados e cópias de segurança fora das capturas e do controlo de versões.

## Identificar a instalação em execução

Verifique a aplicação antes de escolher um ficheiro de configuração. Um repositório de desenvolvimento e uma instalação Compose usam comandos de arranque diferentes.

### 1. Abrir General

Abra **Settings** e depois **General**.

![Abra Settings e depois General.](environment-guide-general.png)

### 2. Ler About

Anote Version e Environment da aplicação em execução. Esta página identifica a aplicação sem expor o ficheiro de ambiente privado.

![About identifica a versão e o ambiente da aplicação em execução.](environment-guide-about.png)

### 3. Encontrar a pasta Compose

No servidor, abra a pasta com o ficheiro Compose e o .env desta instalação. O caminho ilustrado `~/openldr_ce` é um exemplo. Use a pasta real da instalação.

![Ilustração. Trabalhe na pasta do projeto Compose instalado.](environment-guide-folder.png)

**Resultado esperado:** sabe qual a instalação em execução e os ficheiros de configuração afetados.

## Alterar um valor de arranque

Acorde a paragem necessária para o valor escolhido. Use um editor privado e preserve as credenciais existentes.

### 1. Guardar uma cópia da configuração

Guarde uma cópia privada do .env atual antes de o editar. Mantenha-a com a cópia de segurança da instalação e restrinja o acesso.

![Ilustração. Guarde uma cópia privada da configuração antes de editar.](environment-guide-backup.png)

### 2. Editar apenas o valor pretendido

Altere o valor escolhido. A ilustração usa LOG_LEVEL. Não substitua o ficheiro completo pelo exemplo.

![Ilustração. Altere apenas o valor de ambiente pretendido.](environment-guide-edit.png)

### 3. Validar a configuração Compose

Execute `docker compose config --quiet` com as opções habituais de projeto, env-file e ficheiros complementares. Exija o código de saída 0. Evite imprimir a configuração expandida em registos partilhados.

![Ilustração. Valide a configuração Compose sem imprimir segredos.](environment-guide-validate.png)

### 4. Recriar os serviços afetados

Use `docker compose up -d` nos serviços afetados. Um reinício mantém o ambiente do contentor existente. Alterações da origem pública ou identidade podem afetar vários serviços.

![Ilustração. Recrie os serviços afetados para aplicar as definições de arranque.](environment-guide-apply.png)

### 5. Verificar o resultado

Confira os contentores, a saúde da aplicação, os registos e o comportamento alterado. Uma API saudável não prova que funcionam as bases externas, os retornos de autenticação ou os destinos de ficheiros.

![Ilustração. Confira o estado dos serviços e a saúde da aplicação.](environment-guide-health.png)

**Resultado esperado:** o novo processo lê o valor pretendido. Preserve a configuração anterior até verificar o comportamento.

## Execução e endereço da instalação

O analisador da aplicação e o instalador têm predefinições diferentes. O analisador usa development para NODE_ENV. Uma instalação deve definir production explicitamente. Os valores exclusivos do Compose configuram a gateway e as etiquetas das imagens.

| Variável | Predefinição ou origem | Significado |
| --- | --- | --- |
| `NODE_ENV` | Analisador: development | Defina production nos serviços instalados. |
| `PORT` | 3000 | Porta de escuta interna da API. |
| `LOG_LEVEL` | info | Nível dos registos do servidor. |
| `TRUST_PROXY` | Não definido | Proxies de confiança para atribuir o IP do cliente. Use apenas a cadeia real de proxies de confiança. |
| `OPENLDR_VERSION` | Etiqueta da imagem instalada | Fixe a versão aprovada para as atualizações. |
| `SERVER_NAME`, `PUBLIC_ORIGIN` | Valores da instalação | Nome público do servidor e origem externa completa. |
| `GATEWAY_HTTP_PORT`, `GATEWAY_HTTPS_PORT` | 80, 443 | Portas publicadas da gateway. |
| `TLS_MODE`, `LETSENCRYPT_EMAIL` | Valores do instalador | Modo do certificado da gateway e contacto do certificado. |
| `MIGRATE_ON_START`, `SEED_ON_START` | Analisador: false, false | Migrações no arranque e carga opcional de exemplos. A atualização usa um passo de migração separado. |

## Bases de dados e armazenamento de objetos

A base interna usa sempre Postgres. Escolha o motor do armazém através de TARGET_STORE_ADAPTER. Estas variáveis configuram o próprio armazém. As ligações adicionais de relatórios e origens pertencem a Connectors.

| Variável | Predefinição ou origem | Significado |
| --- | --- | --- |
| `INTERNAL_DATABASE_URL` | Obrigatório | Base da aplicação, incluindo contas, auditoria e recursos canónicos. |
| `TARGET_STORE_ADAPTER` | pg | Motor do armazém: pg, mssql ou mysql. |
| `TARGET_DATABASE_URL` | Obrigatório para pg | Ligação ao armazém Postgres. |
| `MSSQL_HOST`, `MSSQL_DATABASE`, `MSSQL_USER`, `MSSQL_PASSWORD` | Obrigatórios para mssql | Ligação ao armazém SQL Server. |
| `MSSQL_PORT` | 1433 | Porta do armazém SQL Server. |
| `MSSQL_ENCRYPT`, `MSSQL_TRUST_SERVER_CERT` | false, true | Opções de transporte do armazém. Confira os requisitos reais do certificado do servidor. |
| `MYSQL_HOST`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | Obrigatórios para mysql | Ligação ao armazém MySQL ou MariaDB. |
| `MYSQL_PORT` | 3306 | Porta do armazém MySQL. |
| `MYSQL_SSL`, `MYSQL_SSL_REJECT_UNAUTHORIZED` | false, false | Opções de TLS e verificação de certificados do armazém. |
| `BLOB_ADAPTER` | minio | Armazenamento de ficheiros: minio ou fs. minio usa um serviço S3, como o Garage incluído. fs guarda os ficheiros na pasta indicada por `BLOB_DIR`. |
| `BLOB_DIR` | Obrigatório para fs | Pasta que guarda os ficheiros armazenados. |
| `S3_ENDPOINT`, `S3_BUCKET` | Obrigatórios para minio | Endereço do serviço de objetos e bucket. |
| `S3_REGION`, `S3_FORCE_PATH_STYLE` | us-east-1, true | Região S3 e endereçamento por caminho. |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Credenciais privadas, obrigatórias para minio | Acesso ao armazenamento de objetos. O Garage exige o formato de chave suportado. |
| `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN` | Gerados pelo instalador | Segredos do serviço Garage. Preserve-os com a configuração. |
| `EVENTING_ADAPTER` | pg | Implementação do armazenamento de eventos da aplicação. |

## Autenticação e segredos

Consulte [Fornecedores de autenticação](/docs/auth-providers) antes de alterar um emissor. A base da aplicação está ligada ao seu espaço de identidade. O OIDC genérico não administra utilizadores Keycloak ou clientes de sincronização.

| Variável | Predefinição ou origem | Significado |
| --- | --- | --- |
| `AUTH_ADAPTER` | keycloak | Autenticação local, keycloak ou oidc genérico. As novas instalações usam local. |
| `IDENTITY_ADMIN_ADAPTER` | Depende de AUTH_ADAPTER | keycloak, local ou none. O início de sessão local usa local. O oidc genérico exige none. |
| `OIDC_ISSUER_URL` | Obrigatório para keycloak e oidc | Emissor esperado dos tokens. O início de sessão local não o usa. Preserve-o num espaço de identidade existente. |
| `OIDC_WEB_CLIENT_ID` | openldr-web | Identificador do cliente público do navegador. |
| `OIDC_AUDIENCE` | Opcional | Audiência exigida do token de acesso à API quando configurada. |
| `OIDC_SCOPES` | openid profile email | Âmbitos pedidos pelo navegador. Deve incluir openid. |
| `OIDC_RESOURCE` | Opcional | Indicador de recurso do fornecedor quando necessário. |
| `OIDC_INTERNAL_JWKS_URL` | Opcional | Endereço explícito das chaves de assinatura no servidor. O emissor esperado não muda. |
| `OIDC_INTERNAL_ISSUER_URL` | Opcional | Endereço do realm Keycloak no servidor. O OIDC genérico não deriva os endereços deste valor. |
| `KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET` | Valores privados da instalação | Conta de serviço para administrar o fornecedor. |
| `TLS_CERT_PATH` | Opcional | Certificado público do servidor disponível na descarga do certificado central. |
| `SECRETS_ENCRYPTION_KEY` | Base64, 32 bytes descodificados | Chave de encriptação das credenciais guardadas. Preserve o valor existente. |
| `AUTH_DEV_BYPASS` | false | Desvio explícito da autenticação em desenvolvimento. Em produção recusa true. |
| `AUTH_DEV_USERNAME`, `AUTH_DEV_ROLES` | dev-admin, lab_admin | Autor para o desvio de desenvolvimento explicitamente ativado. |

## Limites de workflows, plugins e importações

Ative as capacidades do anfitrião apenas para utilizadores e instalações que precisem delas. WORKFLOW_CODE_ENABLED permite JavaScript com acesso ao anfitrião. Não é um ambiente isolado de segurança. Os limites SQL dos painéis, os recetores de workflow e a publicação de conjuntos de dados têm controlos em Settings.

| Variável | Predefinição do analisador | Significado |
| --- | --- | --- |
| `WORKFLOW_CODE_ENABLED` | false | Permite executar o nó Code com acesso ao anfitrião. |
| `WORKFLOW_CODE_TIMEOUT_MS`, `WORKFLOW_CODE_MEMORY_MB` | 5000, 128 | Limites de tempo e memória do nó Code. |
| `WORKFLOW_HTTP_ALLOWLIST` | Vazio | Nomes de servidor permitidos para pedidos HTTP dos workflows. |
| `WORKFLOW_FILE_MAX_BYTES` | 52428800 | Limite de ficheiro enviado ao workflow ou webhook. |
| `WORKFLOW_LOOP_MAX_ITEMS` | 100000 | Máximo de elementos acumulados na saída de um ciclo. |
| `WORKFLOW_FILE_ACCESS_ENABLED`, `WORKFLOW_FILE_ACCESS_ROOT` | false, vazio | Acesso a ficheiros do anfitrião e pasta raiz obrigatória. |
| `WORKFLOW_EMAIL_POLL_MIN_SECONDS`, `WORKFLOW_EMAIL_MAX_PER_POLL` | 30, 50 | Intervalo mínimo dos acionadores de email e limite de mensagens por consulta. |
| `FACILITY_IMPORT_MAX_UPLOAD_BYTES` | 67108864 | Tamanho máximo de envio do registo de unidades. Aumentá-lo também exige memória suficiente para o processamento. |
| `TERMINOLOGY_WORK_DIR` | Opcional | Pasta de descarga e extração de terminologia. |
| `PLUGIN_UI_ENABLED`, `PLUGIN_EGRESS_ENABLED` | true, true | Interruptores gerais das páginas e do intermediário de plugins, e do acesso à rede. |
| `PLUGIN_DATA_MAX_DOC_BYTES` | 8388608 | Tamanho máximo de documento do intermediário. |
| `PLUGIN_CRASH_LOG_DIR` | .openldr/crash | Pasta persistente dos marcadores de falha dos plugins. |
| `CRASH_LOOP_THRESHOLD`, `CRASH_LOOP_WINDOW_SEC` | 5, 60 | Número de falhas e janela de medição. |
| `CRASH_LOOP_BACKOFF_MS`, `CRASH_LOOP_BACKOFF_CAP_MS` | 2000, 60000 | Espera inicial e máxima entre repetições após falhas. |

## Configuração do Marketplace e da sincronização

MARKETPLACE_REGISTRY_URL ou MARKETPLACE_REGISTRY_DIR inicia o primeiro registo apenas quando nenhum existe. Depois, use Marketplace, Registries. A publicação exige o token, o repositório e a pasta local de preparação em conjunto.

`OPENLDR_SITE_ID` fornece um identificador de site alternativo quando não existe Site ID guardado. As definições de sincronização guardadas têm prioridade. `SYNC_ALLOW_INSECURE_TRANSPORT` é false por predefinição. Use HTTPS para um central em serviço.

| Variável | Predefinição ou origem | Significado |
| --- | --- | --- |
| `MARKETPLACE_REGISTRY_URL`, `MARKETPLACE_REGISTRY_DIR` | Origem inicial | Registo remoto ou pasta local de pacotes usada na primeira configuração. |
| `MARKETPLACE_LOCAL_REGISTRY_ROOT` | Vazio | Raiz permitida opcional para pastas de registos locais. |
| `MARKETPLACE_PUBLISH_TOKEN`, `MARKETPLACE_PUBLISH_REPO` | Configuração privada | Credenciais e destino da publicação no GitHub. |
| `MARKETPLACE_PUBLISH_BRANCH` | main | Ramo de destino das propostas de publicação. |
| `MARKETPLACE_DEV_ALLOW_UNSIGNED` | false | Permissão de pacotes sem assinatura apenas em desenvolvimento. |

## Resolução de problemas

**Um valor de arranque não mudou.** Reinicie os processos afetados após alterar o ambiente. No Docker, recrie os serviços afetados porque um reinício mantém o ambiente do contentor.

**Um comando da CLI falha.** Siga [Começar aqui](/docs/start-here) para configurar a CLI instalada ou de desenvolvimento.

## Guias relacionados

[Definições](/docs/settings), [Conectores](/docs/connectors), [Sincronização distribuída](/docs/sync), [Fornecedores de autenticação](/docs/auth-providers) e [Atualizações planeadas](/docs/upgrading).
