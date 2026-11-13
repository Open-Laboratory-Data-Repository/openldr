# Executar sem Docker

Execute o OpenLDR num único computador, sem Docker. Um só comando inicia uma base de dados Postgres 16 que vem com o OpenLDR e, a seguir, o servidor OpenLDR. Todos os seus dados ficam numa só pasta. Serve para quem quer experimentar o OpenLDR, ou para um laboratório pequeno com um único computador.

Só o Linux foi testado. O macOS e o Windows podem funcionar, mas ainda ninguém os verificou.

Executa-o a partir de uma cópia do código-fonte, compilada no seu próprio computador. Ainda não existe instalador. O lançador é o comando `openldr-standalone`, e as mensagens dele usam esse nome. Numa cópia do repositório, esse comando não está no seu PATH. Escreva `pnpm` antes dele e execute-o a partir da raiz do repositório, por exemplo `pnpm openldr-standalone start`.

## O que precisa

- Git, Node.js 22.13 ou mais recente, e pnpm. O repositório fixa pnpm 11.22.0. A página [Desenvolvimento](/docs/development) explica como os instalar.
- Nem Docker nem base de dados. O Postgres vem com as dependências.
- Acesso à rede no primeiro `pnpm install`. Este descarrega os programas do Postgres, cerca de 59 MB no Linux.

## Compilar

Execute todos os comandos desta página a partir da raiz do repositório, onde está o `package.json`.

Quando um comando do lançador termina com um código de saída diferente de 0, o pnpm acrescenta uma linha própria. Faz o mesmo quando carrega em Ctrl+C. Essa linha começa por `[ELIFECYCLE]`, por exemplo `[ELIFECYCLE] Command failed.` Vem do pnpm. Não é um erro do OpenLDR.

### 1. Obter o código-fonte

```sh
git clone https://github.com/Open-Laboratory-Data-Repository/openldr.git ~/Downloads/openldr_ce
cd ~/Downloads/openldr_ce
```

### 2. Instalar as dependências

```sh
pnpm install --frozen-lockfile
```

Este comando também descarrega o Postgres 16.15 a partir do pacote npm `embedded-postgres`. O repositório fixa a versão exata, `16.15.0-beta.19`. Assim, todas as instalações recebem o mesmo Postgres.

### 3. Compilar o Studio e o lançador

```sh
pnpm --filter @openldr/studio build
pnpm --filter @openldr/standalone build
```

Volte a compilar os dois sempre que obtiver código novo. O arranque seguinte atualiza então a base de dados. Se o Studio não tiver sido compilado, `start` para com `The studio is not built. Run: pnpm --filter @openldr/studio build`.

## Iniciar o OpenLDR

### 1. Iniciá-lo

```sh
pnpm openldr-standalone start
```

O primeiro arranque mostra isto:

```text
$ node apps/standalone/dist/index.js start
(node:12345) ExperimentalWarning: WASI is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
[seed] created default connector "Target Warehouse (Postgres)"
[seed] imported 672 FHIR R4 value set(s) (0 already present)
No administrator exists yet. Open the address and enter this setup code: XXXX-XXXX-XXXX
The setup code is valid for 30 minutes. For a new one run: openldr-standalone cli -- auth setup-code
OpenLDR is running at http://localhost:3000/studio/
Server log: /home/you/.local/share/openldr/logs/server.log
```

A primeira linha vem do pnpm. O Node avisa depois sobre o WASI, uma funcionalidade que os plugins usam. Pode ignorar esse aviso. As duas linhas `[seed]` aparecem até um arranque as concluir. Normalmente, é o primeiro arranque. Se o primeiro arranque foi interrompido, o seguinte mostra as que ficaram por fazer. Acrescentam os conjuntos de valores FHIR padrão e um conector para a base de dados de análise. O OpenLDR arranca sem dados de exemplo.

Mantenha este terminal aberto. O OpenLDR só funciona enquanto este comando estiver a correr.

### 2. Criar o primeiro administrador

Abra `http://localhost:3000/studio/` num navegador deste computador. O Studio mostra **Criar o administrador**. Introduza o código de configuração que aparece no terminal e escolha um nome de utilizador e uma palavra-passe. A página [Instalar](/docs/install) mostra cada ecrã na parte sobre o primeiro administrador.

O código é válido durante 30 minutos. Cada arranque mostra um código novo enquanto não existir um administrador. Para obter um código novo com o OpenLDR a funcionar, abra um segundo terminal no repositório e execute:

```sh
pnpm openldr-standalone cli -- auth setup-code
```

O código de configuração só aparece no terminal. O lançador nunca o escreve num ficheiro de registo.

### 3. Escolher outras opções, se precisar

| Opção | Predefinição | O que faz |
| --- | --- | --- |
| `--data-dir <folder>` | Veja a secção seguinte | A pasta que guarda todos os dados desta instalação. |
| `--port <port>` | `3000` | A porta web. Se outro programa a estiver a usar, `start` para com `Port 3000 is already in use. Choose another with --port.` Nunca escolhe outra porta por si. |
| `--host <address>` | `127.0.0.1` | O endereço em que o OpenLDR escuta. A predefinição só deixa entrar este computador. Veja **Abrir o acesso a um telemóvel ou a outro computador** mais abaixo. |

Dê a `--data-dir` um caminho completo. O pnpm executa o lançador a partir da raiz do repositório. Um caminho curto como `mydata` aponta então para dentro do repositório, e não para a pasta em que o seu terminal está.

## Onde fica a pasta de dados

| Computador | Pasta de dados predefinida |
| --- | --- |
| Linux | `~/.local/share/openldr`. Se `XDG_DATA_HOME` tiver um caminho completo, `$XDG_DATA_HOME/openldr`. |
| macOS, não testado | `~/Library/Application Support/OpenLDR` |
| Windows, não testado | `%LOCALAPPDATA%\OpenLDR` |

Defina `OPENLDR_HOME` na shell para usar outra pasta. Dê-lhe também um caminho completo. `--data-dir` prevalece sobre ambos. Se arrancou com `--data-dir`, indique a mesma pasta a `stop`, `status` e `cli`. Caso contrário, procuram na pasta predefinida. `stop` e `status` mostram então `OpenLDR is not running.`, e `cli` mostra `Start OpenLDR first: openldr-standalone start`.

A pasta contém:

| Caminho | O que guarda |
| --- | --- |
| `postgres/` | A base de dados. |
| `blobs/` | Os ficheiros armazenados, como os carregamentos. |
| `logs/` | `server.log` e `postgres.log`. |
| `crash/` | Notas escritas quando o servidor ou um plugin falha. |
| `work/` | Ficheiros temporários, como um descarregamento de terminologia enquanto é importado. |
| `standalone.json` | A chave dos segredos, as duas palavras-passe da base de dados e a porta da base de dados. |
| `standalone.lock` | Existe enquanto um lançador funciona. Indica o processo e o endereço desse lançador. Pode ficar para trás depois de uma falha ou de uma paragem à força. O `start` seguinte substitui-o. |

No Linux, só o seu utilizador pode abrir a pasta. O lançador dá o modo 700 à pasta e o modo 600 aos dois ficheiros. A base de dados só escuta em `127.0.0.1`. A porta é escolhida no primeiro arranque, 54320 se estiver livre, e fica guardada em `standalone.json`.

## Verificar, parar e reiniciar

### 1. Verificar se está a funcionar

```sh
pnpm openldr-standalone status
```

```text
Data folder: /home/you/.local/share/openldr
OpenLDR is running at http://localhost:3000/studio/
```

`status` termina com o código 0 quando o OpenLDR está a funcionar e 3 quando não está. Quando não está, vê `OpenLDR is not running.` e depois a linha do pnpm `[ELIFECYCLE] Command failed with exit code 3.`

### 2. Pará-lo

A partir de um segundo terminal:

```sh
pnpm openldr-standalone stop
```

```text
Stopped.
```

Se o servidor ainda estiver ocupado ao fim de 60 segundos, o Postgres para na mesma. `stop` mostra então esta linha em vez disso, ao fim de cerca de um minuto:

```text
Stopped, but the server did not finish in 60 seconds. Work in flight will be retried.
```

Nos dois casos, o código de saída é 0. `stop` pede ao lançador em execução que pare, através de uma pequena porta aberta só neste computador. Não envia nenhum sinal a um número de processo. Se nada estiver a funcionar, mostra `OpenLDR is not running.`

Também pode carregar em Ctrl+C no terminal onde `start` está a correr. Fechar essa janela de terminal também é uma paragem normal. Em qualquer dos casos, o servidor para primeiro e o Postgres depois. O terminal de `start` mostra a mesma linha `Stopped.`, ou a linha dos 60 segundos acima.

Para não esperar os 60 segundos, aguarde um momento e carregue de novo em Ctrl+C. Depois de um Ctrl+C, o lançador ignora os toques seguintes durante um segundo e meio. Faz isto porque o pnpm e a shell podem entregar o mesmo sinal uma segunda vez. Um terceiro Ctrl+C, também passado um momento, termina o lançador de imediato com o código de saída 1. O Postgres recebe na mesma a ordem de parar quando o lançador sai. Fechar o terminal nunca encurta a espera.

### 3. Reiniciar depois de um corte de energia ou de uma falha

Execute de novo `pnpm openldr-standalone start`. Se um lançador foi terminado à força, `start` substitui primeiro o bloqueio antigo dele. Se esse lançador deixou o seu Postgres a correr, `start` inicia sessão na base de dados para verificar que esse Postgres pertence a esta pasta. Depois para esse Postgres e arranca normalmente. Vê as linhas de arranque habituais e mais nada.

Testámos isto terminando o lançador à força no Linux. Um corte de energia real não foi testado.

### 4. Um só lançador por pasta

Um segundo `start` na mesma pasta é recusado:

```text
OpenLDR is already running (process 12345) at http://localhost:3000/studio/.
```

Para ter duas instalações a funcionar ao mesmo tempo, dê a cada uma o seu `--data-dir` e a sua `--port`.

## Executar comandos da CLI

A CLI `openldr` funciona através do lançador, e o OpenLDR tem de estar a funcionar. `cli` aponta a CLI para o endereço do próprio lançador, a não ser que defina `OPENLDR_URL` ou passe `--server-url`. Só dá as definições de base de dados a um comando de recuperação, como `doctor` abaixo. Qualquer outro comando passa pelo servidor em execução, por isso inicie sessão primeiro:

```sh
pnpm openldr-standalone cli -- login
```

[Início de sessão do CLI e chaves de acesso](/docs/cli-access) explica o início de sessão, as chaves de acesso e os comandos de recuperação. Um comando de recuperação não pede início de sessão:

```sh
pnpm openldr-standalone cli -- doctor
```

```text
PASS  Services
WARN  Sign-in
      No administrator exists yet. Run "openldr auth setup-code", then open studio to create one.
PASS  Secrets key
WARN  Laboratory name
      The laboratory name is empty or still the shipped default. Reports print it as the issuing laboratory. Set it in Settings, Laboratory.
WARN  Time zone
      No time zone is set. The monthly transmission report then counts days in UTC, which moves evening arrivals to the wrong day. Set it in Settings, Laboratory.
PASS  Connectors: 1 of 1
SKIP  Sync with central
SKIP  Facilities in the data

3 warnings.
```

Acima destas linhas aparecem também a linha do pnpm, o aviso WASI do Node e uma linha de registo. Quando o OpenLDR não está a funcionar, vê `Start OpenLDR first: openldr-standalone start`.

- O `--` é opcional. `cli doctor` executa o mesmo comando.
- `--data-dir` fica antes do `--`, por exemplo `pnpm openldr-standalone cli --data-dir /srv/openldr -- doctor`.
- Quando uma mensagem da CLI lhe pede para executar um comando `openldr`, execute-o através do lançador. `openldr auth setup-code` passa a `pnpm openldr-standalone cli -- auth setup-code`.
- `sync export` precisa de `--out`. Um caminho relativo parte da raiz do repositório, por isso dê a `--out` um caminho completo.

`pnpm openldr` numa cópia do repositório não é o mesmo. Para um comando de recuperação, lê o ficheiro `.env` do repositório e liga-se às bases de dados indicadas nele. Envia qualquer outro comando para `OPENLDR_URL`, por predefinição `http://127.0.0.1:3000`. Use antes `pnpm openldr-standalone cli`, para que cada comando chegue a esta instalação. A [referência da CLI](/docs/cli) lista todos os comandos.

## Alterar uma definição

O lançador não lê nenhum ficheiro `.env`. Define ele próprio estas definições, e elas prevalecem sempre sobre a shell:

| Definição | Valor |
| --- | --- |
| `NODE_ENV` | `production` |
| `TZ` | `UTC` |
| `OPENLDR_SKIP_ENV_FILE` | `true` |
| `PORT` | O valor de `--port` |
| `LISTEN_HOST` | O valor de `--host` |
| `ROOT_REDIRECT_TO_STUDIO` | `true` |
| `LOG_LEVEL` | `info` |
| `LOG_FILE` | `logs/server.log` na pasta de dados |
| `AUTH_ADAPTER` | `local` |
| `AUTH_DEV_BYPASS` | `false` |
| `BLOB_ADAPTER` | `fs` |
| `BLOB_DIR` | `blobs/` na pasta de dados |
| `EVENTING_ADAPTER` | `pg` |
| `TARGET_STORE_ADAPTER` | `pg` |
| `INTERNAL_DATABASE_URL`, `TARGET_DATABASE_URL` | O Postgres incluído |
| `MIGRATE_ON_START` | `true` |
| `SEED_ON_START` | `false` |
| `SECRETS_ENCRYPTION_KEY` | A chave em `standalone.json` |
| `PLUGIN_CRASH_LOG_DIR` | `crash/` na pasta de dados |
| `TERMINOLOGY_WORK_DIR` | `work/` na pasta de dados |
| `WEB_DIST_DIR` | A compilação do Studio no repositório |
| `APP_VERSION` | A versão do lançador |
| `CLI_ENTRY` | `dist/cli.js` na pasta do lançador |

Por isso, `LOG_LEVEL` fica em `info` e não o pode alterar.

Defina qualquer outra definição na shell antes de `start`. Por exemplo, este comando bloqueia todas as chamadas de rede dos plugins:

```sh
PLUGIN_EGRESS_ENABLED=false pnpm openldr-standalone start
```

Uma definição indicada assim só vale para esse comando. Se um comando da CLI também precisar dela, coloque-a também antes desse comando `cli`. A página [Variáveis de ambiente](/docs/environment) lista-as todas.

O lançador remove as definições de componentes que uma instalação autónoma não tem. Ignora `OIDC_*`, `KEYCLOAK_*`, `S3_*`, `MSSQL_*`, `MYSQL_*`, `IDENTITY_ADMIN_ADAPTER`, `AUTH_DEV_USERNAME` e `AUTH_DEV_ROLES`.

## Abrir o acesso a um telemóvel ou a outro computador

Por predefinição, só este computador consegue abrir o OpenLDR. Para deixar entrar um telemóvel da mesma rede ou do Tailscale, arranque com o endereço deste computador nessa rede:

```sh
pnpm openldr-standalone start --host 100.64.0.10
```

```text
OpenLDR is running at http://100.64.0.10:3000/studio/
Server log: /home/you/.local/share/openldr/logs/server.log
Listening on 100.64.0.10. Sign-in travels over plain HTTP on this network.
```

Substitua `100.64.0.10` pelo endereço privado ou Tailscale do seu computador. Abra no telemóvel o endereço mostrado. `--host 0.0.0.0` escuta em todos os endereços deste computador. O lançador mostra então `http://localhost:3000/studio/`, que só funciona neste computador. No telemóvel, use antes o endereço do computador.

Em HTTP sem cifra, o navegador desativa uma funcionalidade que o Studio usa. Alguns ecrãs podem então falhar, entre eles as páginas de plugins e a edição de painéis. Isto acontece no telemóvel, e também neste computador quando abre o endereço dado a `--host`. Estes ecrãs funcionam quando abre o Studio em `http://localhost:3000/studio/` no computador que executa o OpenLDR. Esse endereço responde quando arranca sem `--host`, ou com `--host localhost`, `0.0.0.0`, `::1` ou `::`.

A última linha é um aviso. Uma instalação autónoma não tem TLS. Os nomes de utilizador, as palavras-passe e os dados dos doentes atravessam a rede sem cifra. Qualquer pessoa que consiga observar essa rede pode lê-los. Faça-o só numa rede de confiança. O Tailscale cifra o tráfego entre os seus próprios dispositivos. Nunca abra esta porta à Internet. Pode ter de autorizar a porta na firewall.

## Fazer e repor uma cópia de segurança

Uma cópia de segurança é uma cópia da pasta de dados inteira, feita com o OpenLDR parado. A cópia de uma base de dados em funcionamento pode não abrir.

```sh
pnpm openldr-standalone stop
cp -a ~/.local/share/openldr /media/backup/openldr-2026-11-13
```

Guarde `standalone.json` com o resto. Sem ele, o lançador recusa arrancar nessa base de dados. Sem a chave que ele contém, os segredos guardados na base de dados não podem ser lidos.

A cópia contém dados de doentes. Contém também o ficheiro de estado, `standalone.json`, com a palavra-passe de administrador da base de dados e a chave dos segredos guardados. Guarde a cópia numa pasta que só o seu utilizador possa abrir. Um disco FAT ou exFAT não guarda as permissões da pasta. Qualquer pessoa que consiga ler esse disco consegue ler a cópia.

Para repor, pare o OpenLDR, volte a colocar a pasta copiada no sítio original e arranque de novo. Também pode arrancar com `--data-dir` a apontar para a cópia.

## Limites

- Sem TLS. O OpenLDR serve HTTP sem cifra.
- Ainda sem instalador. Executa-o a partir de uma cópia compilada do repositório.
- Só Postgres. O Postgres incluído guarda as duas bases de dados. O SQL Server e o MySQL não podem ser a base de dados de análise.
- Um só lançador por pasta de dados.
- Só o Linux foi testado. O Windows e o macOS não foram testados.
- A sincronização com um servidor central que use um certificado autoassinado não é suportada.
- Em HTTP sem cifra, alguns ecrãs do Studio precisam de um endereço que o navegador considere local: `localhost` ou `127.0.0.1`. As páginas de plugins e a edição de painéis estão entre eles. Noutro endereço, podem falhar. `http://localhost:3000/studio/` responde quando arranca sem `--host`, ou com `--host localhost`, `0.0.0.0`, `::1` ou `::`.
- O Postgres incluído não pode passar para uma nova versão principal. A pasta de dados só funciona com o Postgres 16.
- Fazer uma cópia de segurança é parar e depois copiar a pasta. Não existe ferramenta de cópia de segurança.
- Os registos do servidor e do Postgres não têm rotação. Crescem até os apagar com o OpenLDR parado.
- Não pode mover dados entre uma instalação autónoma e uma instalação Docker.
- Não arranca com o computador. Só funciona enquanto `start` estiver a correr num terminal.

## Mensagens que pedem uma ação

| Mensagem | O que fazer |
| --- | --- |
| `Port 3000 is already in use. Choose another with --port.` | Pare o outro programa nessa porta, ou arranque com outra `--port`. |
| `Port 54320 on 127.0.0.1 is in use by another program. This install's database always uses port 54320. Free that port, then start again.` | Pare o programa que ocupou a porta da base de dados. Esta porta é fixa para cada pasta de dados. |
| `A Postgres for <folder> is running as process <n> but does not accept this install's login. Stop that process, then start again.` | Um Postgres que esta instalação não iniciou está a usar a pasta da base de dados. Pare-o e arranque de novo. |
| `The state file <file> is missing, but a database already exists in <folder>.` | Reponha `standalone.json` a partir da sua cópia de segurança. Não apague a base de dados para contornar esta mensagem. |
| `Could not confirm that OpenLDR stopped: ...` | Execute `status`. Se ainda estiver a funcionar, carregue em Ctrl+C no terminal dele. |
| `The database is recovering after an unclean stop. This can take a few minutes.` | Aguarde. O arranque continua sozinho quando o Postgres terminar a reparação. |
| `WORKFLOW_FILE_ACCESS_ROOT must not be the OpenLDR data folder, hold it, or sit inside it.` | Indique em `WORKFLOW_FILE_ACCESS_ROOT` uma pasta fora da pasta de dados e arranque de novo. |
| `OpenLDR stopped after an error. See <path>.` | O lançador parou. O registo do servidor tem o motivo. Execute `start` de novo. |
| `The database stopped by itself. OpenLDR has stopped. See <path>.` | O lançador parou. O registo do Postgres tem o motivo. Execute `start` de novo. |

Se a base de dados parar com o OpenLDR a funcionar, o OpenLDR também para. Pode ver qualquer uma das duas últimas linhas.

## Guias relacionados

- [Primeiros passos](/docs/getting-started)
- [Instalar](/docs/install)
- [Variáveis de ambiente](/docs/environment)
- [Referência da CLI](/docs/cli)
- [Desenvolvimento](/docs/development)
