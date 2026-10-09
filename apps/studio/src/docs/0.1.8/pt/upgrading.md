# Atualizações planeadas

Reserve uma interrupção para atualizar uma instalação Compose. Alterações do esquema podem impedir escritas seguras entre versões antigas e novas. Este procedimento mantém a versão do motor de base de dados. A atualização desse motor exige um procedimento separado e testado.

## Preparar a versão

Trabalhe no diretório do projeto Compose instalado. Use sempre o mesmo nome de projeto, ficheiro de ambiente e ficheiros Compose complementares. Registe as etiquetas e identificadores das imagens com `docker compose images`. Guarde as imagens anteriores e os ficheiros Compose. Leia as notas da versão pretendida e os requisitos de migração.

Guarde os ficheiros `.env` e de configuração atuais num local privado antes de os alterar. Defina `OPENLDR_VERSION` com a versão escolhida em `.env`. Descarregue apenas as imagens aplicacionais necessárias antes da interrupção. Não atualize todas as imagens sem análise. Os serviços de armazenamento têm versões próprias. Mantenha as versões atuais de PostgreSQL, do serviço de armazenamento e das bases externas.

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

Pare o Keycloak e o serviço de armazenamento após a API, assim como outros processos que escrevam nos seus armazenamentos. Mantenha o PostgreSQL ativo para cópias lógicas. Mantenha todas as escritas paradas durante a verificação das cópias e as migrações. Podem ficar recibos webhook em fila para o novo processo. Registe os identificadores. Investigue trabalhos ativos ou interrompidos antes de retomar os envios.

## Copiar um mesmo estado sem escritas

Guarde a cópia num local privado, fora dos volumes do sistema. Copie todos estes elementos durante o mesmo período sem escritas:

- A base interna, a base de destino configurada e a base Keycloak, com os papéis necessários.
- Todos os buckets ou volumes de ficheiros, incluindo ficheiros referenciados pelos recibos webhook.
- `.env`, ficheiros Compose complementares, configuração montada, chaves de cifra e assinatura, certificados e ficheiros locais de `data`.
- O inventário de imagens e a versão aplicacional anterior exata.

Para PostgreSQL, identifique primeiro os nomes reais das bases e a conta. Execute `pg_dump -Fc -f /tmp/DB.dump -U USER DB` dentro do contentor PostgreSQL com `docker compose exec -T postgres`. Substitua `DB` e `USER` pelos valores da instalação. Copie cada ficheiro concluído com `docker compose cp postgres:/tmp/DB.dump ./PRIVATE_BACKUP/DB.dump`. Crie primeiro o diretório de destino. Repita para cada base. Verifique todos os códigos de saída.

Guarde os papéis com `pg_dumpall --globals-only -f /tmp/globals.sql -U USER` e copie o ficheiro. Use o mesmo modo de execução no contentor. Proteja estes ficheiros porque podem conter credenciais. Usar `-f` e `compose cp` evita redirecionamento binário no Windows PowerShell.

Para MySQL, SQL Server ou armazenamento externo, siga o procedimento nativo de cópia e restauro do administrador. As cópias PostgreSQL não incluem essas bases. Para o serviço de armazenamento, use uma cópia de buckets testada ou copie o volume enquanto o serviço está parado. Não copie um volume PostgreSQL ativo como cópia lógica. Nunca execute `docker compose down -v` durante uma atualização.

## Verificar o restauro

Restaure para bases e armazenamento separados, sem acesso aos serviços de produção ou emissores. Restaure papéis e todas as bases, tratando qualquer erro como falha. Resolva explicitamente conflitos com papéis iniciais. Compare contagens de linhas e registos representativos. Restaure ficheiros e compare as somas de verificação com a cópia.

Use as chaves preservadas para decifrar segredos guardados representativos no ambiente isolado. Confirme que os registos restaurados encontram os seus ficheiros. Uma cópia concluída, uma listagem do arquivo ou uma resposta de saúde não prova a recuperação. Não migre a produção antes de este restauro passar.

## Migrar antes de iniciar a nova API

Uma instalação anterior à 0.1.10 deve primeiro fazer os passos 1 a 4 da secção "Passar do MinIO para o Garage" mais abaixo. O novo ficheiro Compose recusa-se a correr sem `GARAGE_RPC_SECRET` e `GARAGE_ADMIN_TOKEN`.

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

## Passar do MinIO para o Garage (instalações anteriores à 0.1.10)

O MinIO retirou as suas imagens do Docker Hub em 2026-09-11. A partir da 0.1.10, o serviço `storage` executa o Garage. Uma instalação que já tem ficheiros tem de os copiar uma vez. Uma instalação nova não precisa disto.

1. Anote a chave e o segredo atuais do MinIO em `.env` (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`). O passo 4 substitui-os.
2. Faça cópia de segurança de `.env` e `docker-compose.yml`.
3. Descarregue os ficheiros da versão 0.1.10:
   - `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/v0.1.10/deploy/install/docker-compose.yml`, guardado como `docker-compose.yml`
   - `https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/v0.1.10/deploy/install/garage.toml`, guardado como `config/garage.toml`

   Depois volte a juntar o antigo serviço `minio` ao `docker-compose.yml` a partir da sua cópia. Assim o MinIO continua ativo ao lado do Garage. Indique a chave e o segredo antigos como valores literais, não como `${S3_...}`. O passo 4 altera essas variáveis, e o MinIO passaria a recusar o login antigo.

   ```yaml
     minio:
       image: minio/minio:latest
       command: server /data --console-address ':9001'
       environment:
         MINIO_ROOT_USER: <chave antiga>
         MINIO_ROOT_PASSWORD: <segredo antigo>
       volumes:
         - miniodata:/data
   ```

   Junte também `miniodata:` sob o bloco `volumes:` de nível superior. A imagem do MinIO ainda está na máquina desde a instalação antiga, por isso isto funciona sem o Docker Hub.
4. Gere novos valores e escreva-os em `.env`:
   - `S3_ACCESS_KEY_ID`: `GK` seguido de 24 carateres hexadecimais (`echo GK$(openssl rand -hex 12)`)
   - `S3_SECRET_ACCESS_KEY`, `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN`: 64 carateres hexadecimais cada (`openssl rand -hex 32`)
   - `S3_ENDPOINT=http://storage:3900`
5. Inicie o MinIO e os novos serviços: `docker compose up -d minio storage api`.
6. Copie os ficheiros:
   `./openldr storage copy --from-endpoint http://minio:9000 --from-key <chave antiga> --from-secret <segredo antigo> --from-bucket openldr`
   O comando mostra o número de objetos e de bytes dos dois lados e termina com código diferente de zero se forem diferentes. Execute-o de novo para retomar após uma falha. Ignora os objetos que já estão no Garage com o mesmo tamanho. Não substitui um objeto com o mesmo tamanho mas conteúdo diferente. Nunca altera o MinIO.
7. Quando mostrar `totals match`, abra alguns ficheiros carregados no studio.
8. Retire o serviço `minio` do `docker-compose.yml` e execute `docker compose up -d --remove-orphans`. Mantenha o volume `miniodata` até ter a certeza. Depois elimine-o com `docker volume rm <projeto>_miniodata`.

Sem o script `./openldr`, execute `docker compose run --rm --no-deps api node /app/cli/dist/index.js storage copy` com as mesmas opções.

O valor de `--from-secret` fica visível no histórico da shell e na lista de processos enquanto o comando corre. Apague depois essa linha do histórico, ou execute o comando numa shell descartável.

Se executa a partir do código-fonte, o ficheiro Compose (`docker-compose.prod.yml`) e o `deploy/install/garage.toml` chegam com a nova cópia do repositório. Dispense por isso os descarregamentos do passo 3, mas volte a juntar o antigo serviço `minio` com o seu login antigo. O seu `.env.prod` vem de um `pnpm run init` anterior. O `S3_ACCESS_KEY_ID` e o `S3_SECRET_ACCESS_KEY` não têm o formato do Garage. Substitua ambos como no passo 4 (`GK` mais `openssl rand -hex 12`, e `openssl rand -hex 32`). Depois adicione `GARAGE_RPC_SECRET` e `GARAGE_ADMIN_TOKEN`. O Compose recusa-se a correr até existirem os dois.

## Quando uma imagem de terceiros desaparece

Cada imagem de terceiros que uma instalação descarrega vem da cópia do OpenLDR no GHCR, fixada pelo digest. A lista está em `deploy/third-party-images.json`. Se um fornecedor retirar uma imagem, as instalações existentes e as novas continuam a funcionar, porque a cópia fica. A única exceção é o SQL Server, cuja imagem fica no registo da Microsoft.

Para substituir um fornecedor:

1. Escolha um substituto que fale o mesmo protocolo.
2. Adicione-o a `deploy/third-party-images.json` e execute `pnpm images:mirror <nome>`. O comando copia apenas linux/amd64 e linux/arm64.
3. Torne público o novo pacote GHCR na página de definições do pacote.
4. Ligue-o com o mesmo nome de serviço Compose.
5. Se o formato dos dados for diferente, mova os dados. A secção sobre a passagem do MinIO para o Garage, acima, é o exemplo concreto.

## Referências

- [Prazo de paragem de serviços Docker Compose](https://docs.docker.com/reference/compose-file/services/#stop_grace_period)
- [Comandos pontuais Docker Compose](https://docs.docker.com/reference/cli/docker/compose/run/)
- [Cópia e restauro PostgreSQL 16](https://www.postgresql.org/docs/16/backup-dump.html)
