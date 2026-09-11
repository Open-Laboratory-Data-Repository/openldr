# Atualizações planeadas

Reserve uma interrupção para atualizar uma instalação Compose. Alterações do esquema podem impedir escritas seguras entre versões antigas e novas. Este procedimento mantém a versão do motor de base de dados. A atualização desse motor exige um procedimento separado e testado.

## Preparar a versão

Trabalhe no diretório do projeto Compose instalado. Use sempre o mesmo nome de projeto, ficheiro de ambiente e ficheiros Compose complementares. Registe as etiquetas e identificadores das imagens com `docker compose images`. Guarde as imagens anteriores e os ficheiros Compose. Leia as notas da versão pretendida e os requisitos de migração.

Guarde os ficheiros `.env` e de configuração atuais num local privado antes de os alterar. Defina `OPENLDR_VERSION` com a versão escolhida em `.env`. Descarregue apenas as imagens aplicacionais necessárias antes da interrupção. Não atualize todas as imagens sem análise. Os serviços de armazenamento têm versões próprias e o MinIO pode usar `latest`. Mantenha as versões atuais de PostgreSQL, MinIO e bases externas.

Guarde este guia fora do Studio antes de parar os serviços. Confirme quem pode restaurar as cópias de segurança. Verifique como os emissores guardam envios pendentes ou repetem pedidos durante a interrupção.

## Parar as escritas e aguardar

Suspenda emissores webhook, escritas externas agendadas, parceiros de sincronização e escritas dos operadores. Bloqueie novos pedidos. Pare todas as réplicas API antigas, incluindo as que estão fora deste projeto Compose. Pare tarefas CLI separadas e outros processos que escrevam nas mesmas bases ou armazenamento.

Os novos ficheiros Compose do instalador definem esta propriedade no serviço API:

```yaml
stop_grace_period: ${OPENLDR_STOP_GRACE_PERIOD:-5m}
```

As instalações existentes devem adicioná-la em `services.api` no ficheiro Compose local. Ajuste `OPENLDR_STOP_GRACE_PERIOD` ao trabalho mais demorado. Um prazo explícito na paragem tem prioridade:

```sh
docker compose stop -t 300 api
```

O exemplo permite 300 segundos. Aumente o prazo quando necessário. O OpenLDR aguarda pedidos e tarefas ativos durante a paragem. Consulte o estado do contentor e os registos. Uma terminação forçada, prazo excedido ou código 137 não prova que o trabalho terminou. Investigue antes de continuar, incluindo possíveis efeitos externos parciais.

Pare o Keycloak e o MinIO após a API, assim como outros processos que escrevam nos seus armazenamentos. Mantenha o PostgreSQL ativo para cópias lógicas. Mantenha todas as escritas paradas durante a verificação das cópias e as migrações. Podem ficar recibos webhook em fila para o novo processo. Registe os identificadores. Investigue trabalhos ativos ou interrompidos antes de retomar os envios.

## Copiar um mesmo estado sem escritas

Guarde a cópia num local privado, fora dos volumes do sistema. Copie todos estes elementos durante o mesmo período sem escritas:

- A base interna, a base de destino configurada e a base Keycloak, com os papéis necessários.
- Todos os buckets ou volumes de ficheiros, incluindo ficheiros referenciados pelos recibos webhook.
- `.env`, ficheiros Compose complementares, configuração montada, chaves de cifra e assinatura, certificados e ficheiros locais de `data`.
- O inventário de imagens e a versão aplicacional anterior exata.

Para PostgreSQL, identifique primeiro os nomes reais das bases e a conta. Execute `pg_dump -Fc -f /tmp/DB.dump -U USER DB` dentro do contentor PostgreSQL com `docker compose exec -T postgres`. Substitua `DB` e `USER` pelos valores da instalação. Copie cada ficheiro concluído com `docker compose cp postgres:/tmp/DB.dump ./PRIVATE_BACKUP/DB.dump`. Crie primeiro o diretório de destino. Repita para cada base. Verifique todos os códigos de saída.

Guarde os papéis com `pg_dumpall --globals-only -f /tmp/globals.sql -U USER` e copie o ficheiro. Use o mesmo modo de execução no contentor. Proteja estes ficheiros porque podem conter credenciais. Usar `-f` e `compose cp` evita redirecionamento binário no Windows PowerShell.

Para MySQL, SQL Server ou armazenamento externo, siga o procedimento nativo de cópia e restauro do administrador. As cópias PostgreSQL não incluem essas bases. Para MinIO, use uma cópia de buckets testada ou copie o volume enquanto o serviço está parado. Não copie um volume PostgreSQL ativo como cópia lógica. Nunca execute `docker compose down -v` durante uma atualização.

## Verificar o restauro

Restaure para bases e armazenamento separados, sem acesso aos serviços de produção ou emissores. Restaure papéis e todas as bases, tratando qualquer erro como falha. Resolva explicitamente conflitos com papéis iniciais. Compare contagens de linhas e registos representativos. Restaure ficheiros e compare as somas de verificação com a cópia.

Use as chaves preservadas para decifrar segredos guardados representativos no ambiente isolado. Confirme que os registos restaurados encontram os seus ficheiros. Uma cópia concluída, uma listagem do arquivo ou uma resposta de saúde não prova a recuperação. Não migre a produção antes de este restauro passar.

## Migrar antes de iniciar a nova API

Mantenha as bases disponíveis e todos os processos antigos de escrita parados. Confirme que a imagem API corresponde à versão escolhida. Execute uma vez a CLI incluída:

```sh
docker compose run --rm --no-deps api node /app/cli/dist/index.js db migrate
```

Este comando substitui o arranque da API. Não inicia dependências nem atende pedidos. Exija código de saída 0 e migrações interna e de destino concluídas antes de iniciar os novos serviços.

Se a migração falhar, pare aqui. Algumas alterações do esquema podem já estar gravadas. Não inicie binários antigos nesse esquema. Investigue a falha ou restaure em conjunto bases, ficheiros, configuração, chaves e imagens da mesma cópia. Se o tráfego já retomou, reconcilie os envios e efeitos externos antes de restaurar um estado anterior.

## Verificar antes de retomar o tráfego

Inicie primeiro os serviços existentes de armazenamento e identidade, depois os serviços aplicacionais da versão escolhida. Preserve as versões dos motores de bases. Verifique `docker compose ps`, a saúde da API e os registos. Leia dados representativos no Studio ou na CLI. Verifique os recibos webhook e as execuções associadas antes de reabrir o tráfego.

HTTP 202 significa que o webhook foi aceite, não concluído. Consulte os recibos pendentes. Investigue recibos interrompidos e efeitos externos antes de decidir submeter trabalho de substituição. Repita o mesmo pedido lógico com o `Idempotency-Key` e conteúdo originais. Não repita em massa pedidos interrompidos com novas chaves.

Retome os emissores apenas após estas verificações. Guarde a cópia verificada e imagens anteriores conforme a política de retenção local.

## Referências

- [Prazo de paragem de serviços Docker Compose](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)
- [Comandos pontuais Docker Compose](https://docs.docker.com/reference/cli/docker/compose/run/)
- [Cópia e restauro PostgreSQL 16](https://www.postgresql.org/docs/16/backup-dump.html)
