# Atualizações planeadas

Agende uma interrupção para atualizar a aplicação. Alterações do esquema podem tornar insegura a escrita simultânea por versões antigas e novas. Este procedimento preserva as versões dos motores de base de dados e armazenamento. Atualizar um motor exige um procedimento testado separado.

Use o diretório real do projeto Compose instalado. Mantenha o nome do projeto, o ficheiro de ambiente e as sobreposições em todos os comandos. Precisa de um operador capaz de restaurar todo o ambiente.

As imagens do terminal estão identificadas como ilustrações. Substitua os marcadores pelos valores da instalação. Não afirmam mostrar uma atualização em produção. A cópia de segurança e o restauro foram ensaiados separadamente em destinos Postgres e S3 temporários.

Guarde estas instruções fora do Studio antes da interrupção. Combine como os emissores colocam envios em espera e repetem tentativas durante a paragem.

## Registar a versão atual e preparar a versão pretendida

Leia as notas da versão pretendida e os requisitos de migração antes de parar a aplicação.

### 1. Abrir General

Abra **Settings** e depois **General**.

![Abra Settings e depois General para ler a versão em execução.](upgrading-guide-general.png)

### 2. Registar a versão em execução

Leia About. Registe a versão atual da aplicação e o ambiente da instalação.

![Registe a versão atual antes de escolher a pretendida.](upgrading-guide-version.png)

### 3. Guardar o inventário da instalação atual

No diretório da instalação, registe `docker compose images`. Preserve as etiquetas e os identificadores das imagens anteriores, os ficheiros Compose, as sobreposições e o .env privado. Mantenha as imagens antigas disponíveis.

![Ilustração. Registe as imagens e a configuração atuais exatas.](upgrading-guide-inventory.png)

### 4. Fixar a versão escolhida da aplicação

Defina OPENLDR_VERSION com a etiqueta aprovada no .env. Transfira apenas as imagens de aplicação necessárias antes da interrupção. Preserve as versões de PostgreSQL, identidade e armazenamento de objetos.

![Ilustração. Fixe a versão aprovada da aplicação antes da interrupção.](upgrading-guide-pin.png)

**Resultado esperado:** a imagem pretendida e o inventário completo da versão anterior estão disponíveis. Não transfira todas as imagens de infraestrutura sem as verificar.

## Parar as escritas e confirmar a conclusão

Suspenda os emissores webhook, os pares de sincronização, as escritas agendadas e as alterações dos operadores. Bloqueie o tráfego de entrada. Inclua réplicas da API e tarefas CLI fora deste projeto Compose.

### 1. Parar todos os serviços de escrita da aplicação

Pare todas as réplicas da API com tempo suficiente para os trabalhos mais longos. A ilustração permite 300 segundos. Verifique os registos de paragem e o estado dos contentores. Uma paragem forçada, uma expiração ou o código 137 não prova que o trabalho terminou.

![Ilustração. Suspenda as escritas externas, pare todas as réplicas da API e confirme a paragem.](upgrading-guide-drain.png)

### 2. Parar as escritas de identidade e armazenamento

Depois da API, pare Keycloak e o armazenamento de objetos. Pare todos os outros serviços que escrevem nesses destinos. Mantenha PostgreSQL disponível para cópias lógicas. Mantenha as escritas paradas durante as verificações das cópias e a migração.

![Ilustração. Pare a identidade e o armazenamento de objetos depois da API.](upgrading-guide-stores.png)

**Resultado esperado:** a cópia pode captar um estado comum sem escritas. Registe os recibos webhook pendentes e investigue trabalhos interrompidos antes de os repetir.

## Criar cópias de segurança e provar o restauro

Guarde as cópias em privado, fora dos volumes da instalação. Um ficheiro de cópia ou uma API saudável não prova, por si só, a possibilidade de restauro.

### 1. Copiar cada base de dados

Identifique os nomes e as contas reais das bases. Use pg_dump -Fc com um ficheiro de saída dentro do contentor Postgres. Depois use Compose cp para um diretório privado já existente. Repita para as bases interna, de destino e de identidade. Use ferramentas nativas para bases SQL Server ou MySQL externas.

![Ilustração. Copie cada base durante o mesmo período sem escritas.](upgrading-guide-database-backup.png)

### 2. Guardar funções, objetos e configuração

Guarde as funções PostgreSQL separadamente. Copie cada bucket de objetos ou volume de armazenamento parado. Preserve .env, ficheiros Compose, configuração montada, chaves de encriptação e assinatura, certificados, ficheiros locais e inventário das imagens do mesmo período sem escritas.

![Ilustração. Guarde as funções e toda a configuração em privado.](upgrading-guide-roles.png)

### 3. Restaurar para destinos isolados

Restaure funções e bases tratando os erros como falhas. Restaure os objetos e compare somas de verificação. Compare os registos guardados e contagens representativas de linhas. Use as chaves preservadas para desencriptar um segredo guardado sem o mostrar. Confirme que os registos restaurados conseguem ler os objetos restaurados.

![Ilustração. Restaure para destinos separados e isolados.](upgrading-guide-restore.png)

**Resultado esperado:** avance apenas quando as bases, os objetos, a configuração, as chaves e as imagens correspondentes puderem ser restaurados. Os restauros isolados não devem contactar emissores ou destinos reais.

## Migrar antes de iniciar a nova API

Mantenha as versões antigas que escrevem paradas. Confirme que o comando pontual usa a nova imagem de aplicação fixada.

### 1. Executar a migração da nova imagem

Use `docker compose run --rm --no-deps api node /app/cli/dist/index.js db migrate`. Exija código 0 e migrações interna e de destino bem-sucedidas. Isto substitui o comando da API e não serve pedidos.

![Ilustração. Execute a CLI da nova imagem fixada antes de iniciar a sua API.](upgrading-guide-migrate.png)

**Resultado esperado:** se a migração falhar, pare aqui. Algumas alterações podem já estar guardadas. Diagnostique ou restaure o conjunto correspondente. Não inicie os executáveis antigos sobre um esquema parcialmente atualizado.

## Instalações que usam o Keycloak

Faça isto antes de arrancar o novo ficheiro compose. Se o serviço `keycloak` do `docker-compose.yml` para o qual está a passar tiver uma linha `profiles`, acrescente esta linha ao ficheiro `.env` da instalação:

```sh
COMPOSE_PROFILES=keycloak
```

Sem ela, o Keycloak não arranca e ninguém consegue iniciar sessão. Se o `.env` já tiver uma linha `COMPOSE_PROFILES`, acrescente-lhe `keycloak` depois de uma vírgula. Voltar a executar o instalador de uma linha acrescenta a linha por si. Uma instalação com início de sessão local não tem nada a fazer aqui.

## Verificar a nova versão antes de retomar o tráfego

Inicie os serviços pela ordem das dependências. Mantenha o tráfego de entrada e os emissores suspensos até as verificações passarem.

### 1. Iniciar os serviços da aplicação fixada

Inicie primeiro o armazenamento e a identidade existentes, depois os novos serviços de aplicação fixados. Preserve as versões dos motores de infraestrutura.

![Ilustração. Inicie o armazenamento e a identidade, depois os serviços de aplicação fixados.](upgrading-guide-start.png)

### 2. Verificar o estado e o trabalho guardado

Verifique o estado dos contentores, a saúde da aplicação e os registos. Leia dados representativos e ficheiros carregados. Verifique os recibos dos workflows e as execuções ligadas antes de reabrir o tráfego. Retome os emissores apenas depois destas verificações.

![Ilustração. Verifique a nova aplicação antes de retomar o tráfego.](upgrading-guide-verify.png)

**Resultado esperado:** a versão foi verificada antes de chegar novo trabalho. Mantenha as cópias verificadas e as imagens anteriores segundo a política de retenção local.

## Resolver problemas de pedidos interrompidos

Um HTTP 202 significa que um webhook foi aceite. Não prova a conclusão. Consulte os recibos pendentes e inspecione as execuções ligadas. Investigue efeitos externos parciais antes de substituir trabalho.

Ao repetir o mesmo pedido lógico, mantenha o Idempotency-Key e a entrada originais. Não repita todos os pedidos interrompidos com novas chaves. Se o tráfego já tinha reaberto antes de um restauro, reconcilie entregas e efeitos externos com o ponto restaurado.

## Tempo de paragem e instalações existentes

Os novos ficheiros Compose do instalador definem `stop_grace_period: ${OPENLDR_STOP_GRACE_PERIOD:-5m}` em services.api. Adicione a propriedade ao ficheiro Compose local antigo se faltar. Permita tempo para o trabalho mais longo. Um tempo de paragem explícito tem prioridade.

O OpenLDR espera pelos pedidos e processamentos ativos durante a paragem. Um processamento que nunca termina pode exceder esse tempo. Os registos e o estado dos processos devem confirmar se o trabalho acabou. Nunca execute `docker compose down -v` durante uma atualização.

Se um armazém antigo não tiver estados de resultados, as notas de versão podem exigir `openldr db reproject --force` após atualizar. Isto reconstrói os dados projetados a partir dos recursos canónicos. Faça-o apenas quando a versão pretendida o exigir.

## Instalações MinIO antigas a passar para Garage

Uma instalação anterior a 0.1.11 precisa da migração de armazenamento correspondente antes de iniciar a nova configuração Compose. Uma instalação nova não precisa. Preserve em privado a imagem MinIO antiga, o volume de dados, o endereço e as credenciais antes de alterar algo.

Mantenha o serviço MinIO antigo disponível juntamente com Garage durante a cópia. O seu ambiente deve manter as credenciais literais antigas. As novas variáveis S3 pertencem a Garage. Gere a chave de acesso, o segredo, o segredo RPC e o token de administrador Garage segundo as instruções da versão. Não mostre esses valores nas capturas.

Use o comando CLI de cópia do armazenamento com o endereço, a chave, o segredo e o bucket antigos. Copia para o destino atualmente configurado. Leia as contagens de objetos e bytes e exija a verificação de conclusão. Ignora objetos existentes do mesmo tamanho, sem provar que o conteúdo é igual. Compare também somas representativas e abra ficheiros carregados.

Mantenha o volume antigo até verificar os ficheiros copiados e a aplicação. Remover um volume antigo é uma decisão destrutiva separada. As opções de cópia podem expor credenciais da origem no histórico da shell e nos argumentos dos processos. Use uma sessão de administração privada.

Siga as instruções de migração de armazenamento das versões exatas de origem e destino. O ensaio não migrou uma instalação MinIO histórica. O exercício S3 separado comparou as somas completas de todos os objetos entre dois buckets temporários.

## O que o ensaio isolado demonstrou

O ensaio parou apenas a API da instalação de teste isolada. Copiou e restaurou as duas bases Postgres temporárias para destinos separados. A contagem canónica restaurada correspondeu a 27 registos e a contagem de pedidos de destino a 1. Oito objetos foram restaurados para um bucket separado com somas SHA-256 iguais.

Um segredo de conector guardado foi desencriptado com o mesmo valor usando a chave preservada. Nenhum segredo foi mostrado. Um comando de migração do esquema atual terminou com código 0 nas bases restauradas.

Estas verificações demonstram um pequeno ensaio de cópia na mesma versão. Não demonstram uma atualização histórica, recuperação da base de identidade ou de bases externas, migração do motor de armazenamento, conclusão de tarefas longas ou capacidade em produção. Os comandos Compose ilustrados não foram executados numa instalação de produção.

## Guias relacionados

[Variáveis de ambiente](/docs/environment), [Definições](/docs/settings), [Workflows](/docs/workflows) e [Documentação de instalação e desenvolvimento](/docs/advanced-docs).
