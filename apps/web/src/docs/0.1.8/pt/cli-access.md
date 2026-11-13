# Início de sessão do CLI e chaves de acesso

A maioria dos comandos `openldr` passa agora pelo servidor OpenLDR em execução, tal como o Studio. Primeiro inicia sessão, como pessoa com `openldr login` ou como programa com uma chave de acesso. O servidor verifica se a sua conta pode correr o comando, corre-o, e regista-o no registo de auditoria em nome da sua conta.

Esta página mostra como iniciar sessão, como criar e revogar chaves de acesso, e como dar a um agente de IA ou a um script um acesso próprio e restrito. A [referência do CLI](/docs/cli) lista os comandos em si.

Os exemplos desta página foram corridos em Linux numa instalação autónoma. O Windows e o macOS não foram testados. Uma linha marcada "Não corrido" vem da leitura do código. Ninguém a correu à mão.

## Três tipos de comando

Cada comando tem um tipo (`kind`).

| Tipo | Onde corre | Início de sessão |
| --- | --- | --- |
| `app` | No servidor em execução. Quase todos os comandos. | Necessário. |
| `recovery` | Na máquina que corre o OpenLDR, diretamente na base de dados. | Nenhum. As definições de base de dados da máquina servem de permissão. |
| `local` | Na sua própria máquina. Não toca em nenhuma base de dados nem em nenhum servidor. | Nenhum. `login`, `logout` e `whoami` falam apenas com o início de sessão do servidor. |

Para ver o tipo de cada comando, corra:

```sh
openldr commands
```

As primeiras linhas da saída:

```text
artifact build                     local
artifact keygen                    local
artifact new                       local                  scaffold plugin|form|report
artifact pack                      local
artifact publish                   app       destructive
artifact sign                      local
artifact test                      local
audit list                         app
```

`openldr commands --json` mostra a mesma lista em JSON, para um programa ler. Cada entrada tem `path`, `description`, `arguments`, `options`, `kind`, `capability`, `alsoRequires` e `destructive`. Esta é uma entrada, sem a descrição, os argumentos e as opções:

```json
{
  "path": "user key create",
  "kind": "app",
  "capability": "users.manage",
  "alsoRequires": [],
  "destructive": false
}
```

`capability` é a permissão de que a conta precisa. `alsoRequires` lista outras permissões de que também precisa. `destructive` é true quando o comando apaga dados guardados, os substitui sem volta atrás, ou corta um acesso, como uma revogação. Diz respeito aos dados guardados no OpenLDR, não aos ficheiros do seu próprio disco.

## Comandos de recuperação

Dez comandos trabalham na própria base de dados e não pedem início de sessão. Servem para preparar uma instalação e para recuperar o acesso quando já ninguém consegue iniciar sessão.

| Comando | Para que serve |
| --- | --- |
| `auth rebind-issuer` | Ligar a base de dados ao endereço mudado de um fornecedor de identidade. |
| `auth setup-code` | Mostrar um código para criar o primeiro administrador. |
| `db migrate` | Atualizar o esquema da base de dados. |
| `db reset` | Apagar e voltar a criar o esquema. |
| `db seed` | Acrescentar as definições predefinidas. |
| `doctor` | Correr as verificações de configuração. |
| `health` | Verificar os serviços. |
| `storage copy` | Copiar ficheiros de outro armazenamento S3. |
| `target-store test` | Verificar a ligação à base de dados de análise. |
| `user reset-password` | Definir uma palavra-passe temporária, para um administrador bloqueado. |

Corra-os na máquina que corre o OpenLDR, onde estão as definições de base de dados:

- Instalação Docker: `./openldr` na pasta de instalação. Corre-os dentro do contentor `api`.
- Instalação autónoma: `openldr-standalone cli`. Ver [Executar sem Docker](/docs/standalone).
- Cópia do código-fonte: `pnpm openldr`, que lê o `.env` da cópia.

Noutro sítio, um comando de recuperação para antes de fazer seja o que for:

```text
This command works on the database itself. Run it on the machine that runs OpenLDR.
```

## Iniciar sessão como pessoa

Isto funciona nas instalações que usam o início de sessão próprio do OpenLDR (`AUTH_ADAPTER=local`). Numa instalação Keycloak ou OIDC, use antes uma chave de acesso. Aí, `openldr login` responde `This install signs in through another service. Use an access key: set OPENLDR_KEY.`

```sh
openldr login
```

O CLI pede o seu nome de utilizador e depois a palavra-passe. Não mostra a palavra-passe enquanto a escreve. Depois mostra:

```text
Signed in to http://localhost:3991 as admin.
```

Verifique com que conta tem sessão iniciada:

```sh
openldr whoami
```

```text
Username: admin
Roles: lab_admin
Signed in with: session
```

`openldr whoami --json` mostra o mesmo numa linha JSON.

Um script não consegue escrever num pedido interativo. Passa a palavra-passe pela entrada padrão com `--password-stdin`, que precisa de `--username`:

```sh
openldr login --username admin --password-stdin < password.txt
```

Não existe a opção `--password`, porque os outros utilizadores da máquina conseguem ler as linhas de comando.

`openldr logout` termina a sessão no servidor e retira-a da sua máquina.

`login`, `whoami` e `logout` desistem quando o servidor aceita a ligação e não responde durante 30 segundos. Mostram então `Cannot reach OpenLDR at <address>: ETIMEDOUT.` `logout` acrescenta uma frase depois.

A sessão fica guardada num ficheiro que só você pode ler:

| Computador | Ficheiro de sessão |
| --- | --- |
| Linux | `~/.config/openldr/session.json`, ou `$XDG_CONFIG_HOME/openldr/session.json` |
| macOS, não testado | `~/Library/Application Support/OpenLDR/session.json` |
| Windows, não testado | `%APPDATA%\OpenLDR\session.json` |

Em Linux, a pasta tem o modo 700 e o ficheiro o modo 600. O CLI recusa um ficheiro de sessão que outros utilizadores possam ler. O ficheiro nunca guarda a sua palavra-passe.

Uma sessão termina após 12 horas sem uso, ou 7 dias depois de ter iniciado sessão. Nessa altura, inicie sessão outra vez.

Uma sessão pertence a um único endereço de servidor. `http://localhost:3000` e `http://127.0.0.1:3000` são dois endereços, por isso uma sessão aberta num não serve para o outro.

## Chaves de acesso

Uma chave de acesso permite que um programa aja como uma conta, sem uma pessoa presente. Começa por `oldr_`. Guarde-a como guardaria uma palavra-passe.

Precisa da permissão `users.manage` para criar, listar ou revogar chaves. Pode fazê-lo no Studio, em **Utilizadores**, no menu da linha da conta. Ver **Utilizadores** na documentação do Studio. Também o pode fazer com o CLI:

```sh
openldr user key create ai-reader --name claude-test --expires 2026-12-31
```

A chave é mostrada uma só vez, sozinha na saída padrão. Um aviso vai para a saída de erro:

```text
oldr_<the new key>
made key 6afa1ead-1382-4cd1-a07e-d233c907fa2b (claude-test) for ai-reader. It cannot be shown again, so store it now.
```

Assim, um script pode guardar a chave num ficheiro sem nunca a mostrar no ecrã. O `umask` torna o ficheiro legível só por si desde o momento em que é criado:

```sh
(umask 077; openldr user key create ai-reader --name claude-test --expires 2026-12-31 > ai-reader.key)
```

Apague primeiro um `ai-reader.key` antigo. O `umask` não muda um ficheiro que já existe.

`--expires` aceita uma data, ou uma data e hora ISO que termina em `Z` ou num desvio horário. Uma data simples, como `2026-12-31`, significa o fim desse dia em UTC. No Studio, uma data escolhida significa o fim desse dia no fuso horário do seu navegador. Sem expiração, a chave funciona até a revogar.

Liste as chaves de uma conta. A chave em si nunca volta a ser mostrada, apenas os primeiros caracteres:

```sh
openldr user key list ai-reader
```

```text
6afa1ead-1382-4cd1-a07e-d233c907fa2b	claude-test	oldr_rutK97w	2026-11-13T09:16:46.097Z	2026-12-31T23:59:59.999Z	2026-11-13T09:16:49.894Z	-
```

As colunas são o identificador da chave, o nome, os primeiros caracteres, quando foi criada, quando expira, quando foi usada pela última vez e quando foi revogada.

A "última utilização" muda quando um programa apresenta a chave, no máximo uma vez por minuto. Muda mesmo quando o servidor depois recusa a chamada porque a conta está desativada.

Revogue uma chave pelo identificador. Sem `--force`, o comando recusa e diz o que aconteceria:

```sh
openldr user key revoke ai-reader 6afa1ead-1382-4cd1-a07e-d233c907fa2b --force
```

```text
revoked key 6afa1ead-1382-4cd1-a07e-d233c907fa2b for ai-reader
```

Um programa que use a chave é recusado a partir da chamada seguinte. Um comando que já esteja a correr continua até ao fim. O mesmo acontece quando desativa a conta. Não corrido. Uma revogação não pode ser anulada. Crie antes uma chave nova.

`user key revoke` recebe o identificador da chave, nunca a chave. Um valor que não seja um identificador de chave é recusado, e não volta a ser mostrado:

```text
user key revoke refused: that is not a key ID. Find the ID with "openldr user key list".
```

Uma chave colada no lugar do identificador recebe `user key revoke refused: that is a key, not a key ID. Find the ID with "openldr user key list".`

Um nome de utilizador que contenha `oldr_` é recusado da mesma forma por `user key list`, `create` e `revoke`, por exemplo `user key list refused: that looks like a key, not a username. Give the account's username.`

O nome de uma chave não pode ter uma tabulação, uma quebra de linha nem outro carácter de controlo: `user key create refused: name holds a control character, such as a tab or a line break`.

## Dar acesso a um agente de IA

Dê a um agente de IA, ou a qualquer script, uma conta e uma chave próprias. Assim vê o que ele fez, e pode cortar-lhe o acesso sem mexer em mais ninguém.

1. Crie uma conta sem palavra-passe, para que ninguém consiga iniciar sessão no Studio com ela, e dê-lhe a função mais restrita que chega para o trabalho:

   ```sh
   openldr user create --username ai-reader --name "AI reader" --role data_analyst --no-password
   ```

   ```text
   created ai-reader (50b32c3a-13a3-438e-a2f6-4eb0afbaf719)
   ai-reader has no password and cannot sign in to Studio.
   ```

   `--no-password` serve para o início de sessão próprio do OpenLDR. Para Keycloak ou OIDC, ver essa secção mais abaixo. Se nenhuma função servir, crie uma na página **Funções** só com as permissões de que o agente precisa.

2. Crie-lhe uma chave, no Studio ou com `openldr user key create`. Dê-lhe uma data de expiração.

3. Dê ao agente a chave e o endereço do servidor. Ponha a chave num ficheiro que só o utilizador do agente consiga ler, e aponte `OPENLDR_KEY_FILE` para ele. Defina `OPENLDR_URL` quando o servidor não estiver na mesma máquina.

4. Deixe o agente verificar o acesso. Estes comandos são seguros para correr primeiro:

   ```sh
   openldr whoami
   openldr commands --json
   ```

   ```text
   Username: ai-reader
   Roles: data_analyst
   Signed in with: key (claude-test)
   ```

5. Revogue a chave quando o trabalho terminar.

O que o agente pode fazer com a chave:

- Correr os comandos que as permissões da sua função permitem, e mais nenhum. Qualquer outro comando responde `This account lacks the capability <name>.`
- Listar cada comando, o seu tipo e a permissão de que precisa, com `openldr commands --json`.

O que não pode fazer só com a chave:

- Correr um comando de recuperação. Esses precisam das definições de base de dados, não de uma chave. Isto só é verdade enquanto o agente não tiver uma shell na máquina do OpenLDR com Docker ou as definições de base de dados. Ver "O que isto não protege", mais abaixo.
- Registar o trabalho em nome de outra pessoa. `--actor` e `--approved-by` são recusados.
- Esconder o que correu pela aplicação. Cada comando que corre pela aplicação fica no registo de auditoria, com a conta, o nome da chave e o comando. Os argumentos não são registados. Um comando `local`, como `artifact build`, não é auditado.

## Que servidor e que credencial

O CLI envia um comando para este endereço, por esta ordem:

1. `--server-url <address>`, antes ou depois do comando.
2. `OPENLDR_URL`.
3. `http://127.0.0.1:3000`.

Inicia sessão com o primeiro destes que estiver definido:

1. `OPENLDR_KEY`, a própria chave.
2. `OPENLDR_KEY_FILE`, um ficheiro que guarda a chave.
3. A sessão de `openldr login`.
4. Nada. Um comando `app` responde então `Sign in first: openldr login, or set OPENLDR_KEY.`

Não existe a opção `--key`, porque os outros utilizadores conseguem ler as linhas de comando. Uma variável de chave definida mas vazia interrompe o comando. O CLI não recorre à sua sessão:

```text
OPENLDR_KEY is set but empty. Set it, or unset it.
```

O CLI recusa enviar um comando por HTTP simples para outra máquina. O HTTP simples para `localhost`, `127.0.0.1` ou `[::1]` é permitido:

```text
Refusing to send a credential over plain HTTP to 10.0.0.5. Use https, or set OPENLDR_ALLOW_PLAIN_HTTP=true.
```

Use `https`. Defina `OPENLDR_ALLOW_PLAIN_HTTP=true` só numa rede de confiança, como o Tailscale. A recusa também se aplica a um comando sem chave, porque os argumentos e os ficheiros enviados podem conter dados de doentes.

| Definição | O que faz |
| --- | --- |
| `OPENLDR_URL` | O endereço do servidor. |
| `OPENLDR_KEY` | Uma chave de acesso. |
| `OPENLDR_KEY_FILE` | Um ficheiro que guarda uma chave de acesso. O ficheiro é lido na máquina onde escreve o comando. |
| `OPENLDR_ALLOW_PLAIN_HTTP` | `true` ou `1` permite HTTP simples para outra máquina. |

## O que muda ao passar pela aplicação

Estes usos funcionavam antes e agora dão erro. Um script pode encontrá-los.

- `--actor` e `--approved-by` são recusados antes de qualquer envio: `--actor cannot be used through the app. The signed-in account is recorded.` e `--approved-by cannot be used through the app. The signed-in account is recorded.` O registo de auditoria guarda a conta que iniciou sessão.
- `audit list --actor <id>` não pode ser usado. O CLI lê esse `--actor` como o que é recusado. É uma falha conhecida. Filtre antes a saída de `audit list --json` com a sua própria ferramenta.
- `sync export` precisa de `--out <file>`. `report run --format pdf` também.
- O cliente e o servidor têm de ser da mesma versão: `This client is version 0.0.1 and OpenLDR is version 0.1.11. Use the same release on both.`
- Um ficheiro que indica é enviado para o servidor, e um ficheiro que o comando escreve volta para si. Os caminhos são, portanto, caminhos da sua máquina. Numa instalação Docker continuam a ser dentro do contentor. Mantenha-os em `data/`, como antes.
- Uma pasta que indica é enviada com tudo o que tem. Uma ligação para uma pasta lá dentro interrompe o comando: `<path> is a link to a folder. A link to a folder is not sent.` Uma ligação para um ficheiro dentro da pasta é seguida. Uma ligação que aponta para fora da pasta interrompe o comando: `<path> is a link that points outside <folder>.` Uma pasta vazia lá dentro não é enviada. Não corrido para a pasta vazia.
- Um ficheiro que muda durante o envio interrompe o comando. Envie-o outra vez. Não corrido.
- Um programa que corre o CLI e não lê nada da saída durante 5 minutos perde o comando. O servidor interrompe-o. Não corrido.
- Ctrl+C também interrompe o comando no servidor. Um comando que não pare é terminado à força após 10 segundos. Não corrido.
- Se o servidor parar durante um comando, o CLI mostra `OpenLDR stopped while this command was running.` na saída de erro. Na maioria dos comandos, o código de saída é 130, ou 137 quando o comando teve de ser terminado à força. `import start` devolve o seu próprio código. Uma paragem brusca mostra antes `The connection to OpenLDR was lost.` Não corrido.
- `sync status`, `sync now` e `sync quarantine retry` mostram linhas de registo JSON do servidor na saída de erro, por exemplo `"msg":"sync disabled (not configured)"`. Estes comandos iniciam a sincronização para responder. Num local com a sincronização configurada, essas linhas indicam o endereço do servidor central e o identificador do local. Os outros comandos não iniciam a sincronização e não mostram essas linhas. A saída padrão fica limpa, por isso a saída `--json` continua legível. Um script que trate qualquer saída de erro destes três comandos como falha vai falhar.

## Quem pode correr o quê

Um comando precisa da permissão de que a ação correspondente no Studio precisa. `openldr commands --json` mostra-a para cada comando. Três casos surpreendem:

- `patients list`, `patients show` e `patients duplicates list` precisam de `patients.view_identifiers`. Um analista ou auditor que vê doentes mascarados no Studio não consegue listar doentes a partir do CLI, mesmo sem `--identifiers`.
- `import start` e `import resume` precisam de `connectors.manage` e de `ingest.run`. O Studio só deixa correr importações à função de administrador do laboratório, pelo nome. O CLI verifica antes estas duas permissões. Não verifica as funções exigidas pelo próprio plugin.
- `import status` e `import failures` podem mostrar uma chave de linha do sistema de origem. Essa chave pode ser um número de laboratório.

Para mudar o que uma chave ou uma pessoa com sessão iniciada pode fazer, mude as funções da conta com `openldr user assign-role <subject> <role>` e `openldr user unassign-role <subject> <role>`. No início de sessão próprio do OpenLDR, o sujeito é o identificador da conta. A mudança conta a partir do pedido seguinte da conta. `openldr user set-role` não muda o que uma chave ou uma pessoa com sessão iniciada pode fazer, por isso use os dois comandos acima.

## O registo de auditoria

Cada comando corrido pela aplicação deixa uma linha `cli.run`. Guarda a conta, o comando, o código de saída, e que passou pelo CLI. Quando foi usada uma chave, guarda também o nome da chave. Os argumentos do comando nunca são registados.

```sh
openldr audit list --action cli.run --json
```

Uma linha, sem os identificadores nem a hora:

```json
{
  "actorType": "user",
  "actorName": "ai-reader",
  "action": "cli.run",
  "entityType": "cli_command",
  "entityId": "report list",
  "metadata": {
    "origin": { "via": "cli", "keyName": "claude-test" },
    "exitCode": 0,
    "interrupted": false
  }
}
```

Um comando que altera algo, como `user create`, também escreve a sua própria linha de auditoria, como antes. Essa linha nomeia agora a conta com sessão iniciada. Criar e revogar uma chave escrevem `access_key.create` e `access_key.revoke`. A chave em si nunca está no registo de auditoria.

## Limites definidos pelo servidor

| Definição | Predefinição | O que faz |
| --- | --- | --- |
| `CLI_MAX_RUNNING` | `2` | Quantos comandos correm ao mesmo tempo. Os outros esperam até 30 segundos e depois recebem `OpenLDR is running other commands. Try again shortly.` Não corrido. |
| `CLI_MAX_UPLOAD_BYTES` | `2147483648` (2 GiB) | O máximo de bytes de ficheiros que um comando pode enviar. |
| `CLI_ENTRY` | encontrado junto ao servidor | O ficheiro do CLI que o servidor inicia. Defina-o só quando o CLI estiver noutro sítio. |

Quando `CLI_MAX_RUNNING` é maior do que 1, uma conta pode correr no máximo menos um comando do que esse valor ao mesmo tempo. Assim, uma conta não ocupa todos os lugares. Com o valor predefinido de 2, uma conta corre um comando de cada vez, e o segundo comando espera. Não corrido.

O servidor escreve os envios em `TERMINOLOGY_WORK_DIR`, ou na pasta temporária do sistema quando `TERMINOLOGY_WORK_DIR` não está definida. Os envios de um comando são apagados quando ele termina. Se o servidor for morto durante um comando, o que fica é apagado num arranque em que já tenha mais de 24 horas. Não corrido. `terminology ontology build` guarda a sua pasta em `cli-kept`, para que `terminology ontology rebuild` a possa ler outra vez. A limpeza no arranque não toca em `cli-kept`. Cada construção bem-sucedida deixa lá mais uma cópia.

Numa instalação Docker, se usar `terminology ontology build` pela aplicação, aponte `TERMINOLOGY_WORK_DIR` para uma pasta que sobreviva à recriação do contentor. Caso contrário, `terminology ontology rebuild` falha depois de uma atualização. A pasta tem de estar num volume Docker ou numa montagem, e o utilizador do contentor `api` tem de conseguir escrever nela. Isto não foi testado.

Uma instalação Docker põe o gateway, um proxy nginx, à frente do servidor. Um CLI noutra máquina que envia os comandos para o endereço do gateway encontra mais dois limites. O gateway recusa um pedido com mais de 50 MiB (`client_max_body_size 50m`). Os ficheiros viajam codificados em base64 dentro do pedido, por isso o maior ficheiro aceite é mais pequeno do que isso. Também corta um comando que não envia nenhuma saída durante 120 segundos (`proxy_read_timeout 120s`). O script `./openldr` não passa pelo gateway, por isso nenhum destes limites se aplica a ele. Não corrido.

[Variáveis de ambiente](/docs/environment) lista todas as definições.

## Instalações Docker

O script `./openldr` da pasta de instalação corre o CLI dentro do contentor `api`. Aí, o CLI fala com o servidor do mesmo contentor, por isso não define nenhum endereço.

Nada nesta secção foi corrido. Vem da leitura do script que `install/install.sh` escreve.

- `OPENLDR_KEY`, quando está definido, é passado em cada chamada.
- `OPENLDR_KEY_FILE` é lido no anfitrião, não no contentor. Aponte-o para um ficheiro do anfitrião. O script passa a chave como `OPENLDR_KEY`, por isso uma chave recusada vinda de um ficheiro aparece como `OpenLDR refused the access key from OPENLDR_KEY. It is revoked, expired or wrong.`
- `./openldr login` pede a palavra-passe no anfitrião. Guarda a sessão num ficheiro próprio dessa pasta de instalação, em `~/.config/openldr/docker/`. Nada é guardado no contentor.
- Mudar o nome ou o lugar da pasta de instalação termina a sua sessão no script. Inicie sessão outra vez.
- Uma ligação para `./openldr` a partir de outra pasta, como uma pasta do seu `PATH`, funciona. Corre a instalação para onde aponta, com a sessão dessa instalação. Uma simples cópia do script noutra pasta termina com `This script must stay in its install folder, or be a link to it. <folder> has no .env or no docker-compose.yml.`
- Um `OPENLDR_KEY_FILE` errado, ou uma sessão guardada que o script não consegue usar, interrompe todos os comandos, incluindo os de recuperação. A mensagem nomeia a definição ou o ficheiro. Retire a definição, ou apague o ficheiro e inicie sessão outra vez.
- No Windows, `.\openldr.ps1` inicia sessão apenas com uma chave. Defina `OPENLDR_KEY`. `login` e `OPENLDR_KEY_FILE` são aí recusados. Uma cópia de `openldr.ps1` fora da sua pasta de instalação termina com a mesma mensagem que a cópia do script acima. Quando não encontra a sua própria pasta, termina com `Cannot find the folder this script is in, so the install it belongs to is not known.` Não está provado: nada foi corrido no Windows.

Uma instalação feita antes desta mudança tem o script antigo. Com ele, cada comando que passa pela aplicação responde `Sign in first: openldr login, or set OPENLDR_KEY.` Substitua o script depois de as imagens estarem na nova versão. [Atualizações planeadas](/docs/upgrading) tem o comando.

## Executar sem Docker

`openldr-standalone cli` aponta o CLI para o endereço do próprio lançador, a não ser que defina `OPENLDR_URL` ou passe `--server-url`. Só dá as definições de base de dados a um comando de recuperação. Qualquer outro comando passa pelo servidor em execução, por isso inicie sessão primeiro:

```sh
pnpm openldr-standalone cli -- login
pnpm openldr-standalone cli -- whoami
```

O pedido da palavra-passe pelo lançador não foi corrido. `login --username <name> --password-stdin` foi.

Um lançador iniciado com `--host` noutro endereço continua a ser este computador, por isso o HTTP simples para ele é permitido nestas chamadas. [Executar sem Docker](/docs/standalone) tem o resto.

## Instalações Keycloak e OIDC

`openldr login` não funciona aqui. Use chaves de acesso. As chaves nestas instalações não foram testadas com um fornecedor de identidade real.

- Crie a conta da IA no Studio, ou no fornecedor de identidade. Dê-lhe as funções no Studio. As funções definidas só no Keycloak chegam ao OpenLDR quando a pessoa inicia sessão com um token, e uma conta que só usa uma chave nunca o faz.
- O Studio consegue criar uma chave para uma conta que nunca iniciou sessão. O CLI não consegue. `openldr user key create` só encontra contas que o OpenLDR já conhece.
- Desativar uma conta só na consola do fornecedor de identidade não bloqueia as suas chaves. Desative-a no Studio ou com `openldr user deactivate`, ou revogue a chave.

## O que isto não protege

O início de sessão e as permissões limitam uma pessoa ou um programa que só tem uma chave ou uma sessão. Não limitam isto:

- Num anfitrião Docker, quem pode correr `docker compose exec` já chega à base de dados.
- Quem tem as definições de base de dados pode iniciar o CLI como o servidor o faz, sem início de sessão.
- Com `AUTH_DEV_BYPASS=true`, quem chega à porta pode correr qualquer comando. Use-o só numa máquina de desenvolvimento isolada.

## Mensagens que pode ver

| Mensagem | O que significa |
| --- | --- |
| `Sign in first: openldr login, or set OPENLDR_KEY.` | Não foi encontrada nenhuma chave nem sessão. Inicie sessão, ou defina uma chave. |
| `OpenLDR refused the access key from OPENLDR_KEY. It is revoked, expired or wrong.` | A chave em `OPENLDR_KEY` já não funciona. Crie uma chave nova. |
| `OpenLDR refused the access key from OPENLDR_KEY_FILE. It is revoked, expired or wrong.` | A chave nesse ficheiro já não funciona. Crie uma chave nova. |
| `Your session has ended. Sign in again: openldr login.` | A sessão passou o seu limite, ou o servidor terminou-a. |
| `This account lacks the capability <name>.` | As funções da conta não incluem essa permissão. |
| `account disabled` | A conta por trás da chave ou da sessão está desativada. `whoami` mostra o mesmo. |
| `Cannot reach OpenLDR at <address>: ETIMEDOUT.` | `login`, `whoami` ou `logout` não recebeu resposta em 30 segundos. |
| `OpenLDR stopped while this command was running.` | O servidor parou durante o comando. Corra-o outra vez quando o servidor voltar. |
| `This client is version <a> and OpenLDR is version <b>. Use the same release on both.` | Atualize o CLI ou o servidor para que sejam da mesma versão. |
| `OpenLDR is running other commands. Try again shortly.` | Já estão a correr `CLI_MAX_RUNNING` comandos, ou esta conta já corre a sua parte. Não corrido. |
| `This command works on the database itself. Run it on the machine that runs OpenLDR.` | Um comando de recuperação foi corrido onde não há definições de base de dados. |
| `Refusing to send a credential over plain HTTP to <host>. ...` | Use https, ou defina `OPENLDR_ALLOW_PLAIN_HTTP=true` numa rede de confiança. |
| `The key file named by OPENLDR_KEY_FILE cannot be read: <file>` | Verifique o caminho e o dono do ficheiro. |
| `--actor cannot be used through the app. The signed-in account is recorded.` | Retire `--actor`. |
| `--approved-by cannot be used through the app. The signed-in account is recorded.` | Retire `--approved-by`. |
| `Through the app, sync export needs --out <file>.` | Acrescente `--out`. |
| `user key revoke refused: that is not a key ID. Find the ID with "openldr user key list".` | Indique o identificador da chave dado por `user key list`, não a chave. |
| `<command> refused: that looks like a key, not a username. Give the account's username.` | Foi escrita uma chave no lugar do nome de utilizador. |
| `no user has that name. Usernames here match exactly, including case.` | Nenhuma conta tem esse nome de utilizador. O valor não é mostrado porque contém `oldr_`. |
| `user key create refused: name holds a control character, such as a tab or a line break` | Dê à chave um nome sem tabulações nem quebras de linha. |

## Guias relacionados

- [Referência do CLI](/docs/cli)
- [Atualizações planeadas](/docs/upgrading)
- [Executar sem Docker](/docs/standalone)
- [Fornecedores de autenticação](/docs/auth-providers)
- [Variáveis de ambiente](/docs/environment)
