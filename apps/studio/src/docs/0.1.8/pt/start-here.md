# Comece aqui

O OpenLDR Studio é a aplicação web para os registos do seu laboratório. Use os painéis, relatórios e formulários.

Comece por abrir o Studio. Se outro guia pedir uma instrução na linha de comandos, siga primeiro os passos abaixo. Não precisa de dados de exemplo.

## Abrir o Studio

Abra o endereço do Studio da sua instalação no navegador e entre com a sua conta.

Pode abrir o Studio noutro computador ou num telemóvel. Ligue primeiro o Tailscale ou a VPN, se a sua organização o exigir.

Depois, [consulte o guia dos painéis](/docs/dashboard), ou continue para aprender a linha de comandos.

## Usar a linha de comandos

A interface de linha de comandos, ou CLI, executa tarefas OpenLDR através de comandos escritos num terminal.

Use-a para importar ficheiros e manter a instalação. Se usa o código-fonte, consulte os [passos de desenvolvimento](#exemplo-1-usar-a-cli-num-ambiente-de-desenvolvimento).

Vai abrir um terminal e pedir ajuda ao OpenLDR. Os comandos de ajuda não alteram registos.

### Antes de começar

Use o computador onde instalou o OpenLDR e a verdadeira pasta de instalação. Esta pasta contém `docker-compose.yml` e o ficheiro de comando OpenLDR. O Docker e o OpenLDR devem estar iniciados. A sua conta precisa de permissão para usar o Docker.

Se trabalha à distância, ligue-se a esse computador antes de executar os comandos.

### Ligar a um servidor remoto

O Tailscale permite abrir o Studio no navegador. Execute os comandos através do acesso SSH ou do terminal remoto que configurou.

O SSH abre um terminal seguro noutro computador. Use o endereço, a conta e o método de entrada configurados. Por exemplo:

```sh
ssh username@server-address
```

Substitua `username` e `server-address` pelos seus dados. Depois siga os passos para o sistema operativo do servidor.

<!-- cli-platform -->

Se descarregou e instalou o OpenLDR em `~/Downloads/openldr_ce`, os comandos seguintes usam esse local.

Se a instalação estiver noutro local, substitua este caminho em todo o guia.

<!-- cli:linux -->O símbolo ~ representa a sua pasta pessoal. A pasta openldr_ce deste exemplo fica dentro de Downloads.<!-- /cli -->
<!-- cli:mac -->O símbolo ~ representa a sua pasta pessoal. A pasta openldr_ce deste exemplo fica dentro de Downloads.<!-- /cli -->
<!-- cli:windows -->C:\openldr_ce representa a pasta openldr_ce diretamente na unidade C:.<!-- /cli -->

As imagens são ilustrações. Os comandos e as linhas do terminal usam o mesmo local de exemplo. Selecione uma imagem para a ampliar.

### 1. Abrir um terminal

<!-- cli:linux -->Prima Super, frequentemente a tecla com o símbolo Windows. Procure Terminal nas aplicações e abra-o. As ilustrações Linux usam o Ubuntu.<!-- /cli -->
<!-- cli:mac -->Prima Comando e Espaço para abrir o Spotlight. Escreva Terminal e prima Return.<!-- /cli -->
<!-- cli:windows -->Prima a tecla Windows. Procure PowerShell, selecione Windows PowerShell e escolha Abrir.<!-- /cli -->

A linha terminada em <!-- cli:linux -->`$`<!-- /cli --><!-- cli:mac -->`%`<!-- /cli --><!-- cli:windows -->`>`<!-- /cli --> é o prompt. A barra vertical é o cursor. Escreva depois do prompt, sem o copiar.

![Ilustração de um terminal aberto, com o prompt e o cursor.](terminal-linux-ready.png)

O seu nome e o nome do computador podem ser diferentes. Use Backspace para corrigir um erro antes de premir Enter.

### 2. Ir para a pasta de instalação

Abrir um terminal não o coloca automaticamente na pasta OpenLDR. Este exemplo usa `~/Downloads/openldr_ce`.

![Ilustração da pasta de instalação e dos seus ficheiros.](terminal-linux-folder.png)

A pasta real deve conter os ficheiros criados pela sua instalação.

O comando `cd` muda de pasta. Escreva o comando abaixo e prima Enter. Ajuste o caminho à sua instalação.

```sh
cd ~/Downloads/openldr_ce
```

![Ilustração do comando cd antes de o executar.](terminal-linux-cd.png)

Deixe um espaço depois de `cd`. O restante texto é o caminho da pasta.

Normalmente aparece outro prompt sem mensagem de sucesso. Se aparecer um erro, verifique o caminho antes de continuar.

![Ilustração do prompt depois de mudar de pasta.](terminal-linux-changed.png)

Verifique agora os ficheiros da pasta.

### 3. Confirmar a pasta

Escreva este comando e prima Enter:

```sh
ls
```

![Ilustração da lista dos ficheiros necessários à instalação.](terminal-linux-files.png)

Confirme que existem `docker-compose.yml`, a pasta `data` e `openldr`. A pasta pode conter outros ficheiros. Se estes faltarem, procure a pasta criada pelo instalador.

### 4. Pedir ajuda ao OpenLDR

Fique na pasta confirmada no passo 3. Execute o primeiro comando OpenLDR:

```sh
./openldr --help
```

Prima Enter. Mantenha o espaço antes de `--help` e os dois hífenes.

![Ilustração do comando de ajuda pronto a executar.](terminal-linux-help.png)

**Resultado esperado:** o terminal mostra a utilização, as opções e os comandos disponíveis.

![Ilustração de um excerto da ajuda OpenLDR.](terminal-linux-help-result.png)

Desloque o conteúdo do terminal para ler a ajuda completa. Quando o prompt regressar, pode escrever outro comando.

### 5. Consultar a ajuda de um comando

O comando `ingest` importa um ficheiro. Acrescente `--help` para ler as instruções sem importar nada.

```sh
./openldr ingest --help
```

Escreva o comando e prima Enter.

![Ilustração do comando ingest --help.](terminal-linux-ingest.png)

**Resultado esperado:** a linha de utilização indica `ingest`. As opções seguintes aplicam-se a esse comando.

![Ilustração da ajuda do comando ingest.](terminal-linux-ingest-result.png)

`<file>` indica um caminho obrigatório. `[options]` indica definições opcionais. Não escreva estes parênteses retos. Nenhum ficheiro foi importado nestes passos.

Para abrir um terminal: [Ubuntu](https://ubuntu.com/desktop/docs/en/26.04/tutorial/the-linux-command-line-for-beginners/), [Spotlight no macOS](https://support.apple.com/guide/mac-help/mchlp1008/mac), [Windows PowerShell](https://learn.microsoft.com/en-us/powershell/scripting/windows-powershell/starting-windows-powershell).

## Exemplo 1: usar a CLI num ambiente de desenvolvimento

Estes passos aplicam-se a uma cópia do código-fonte. Vai usar `pnpm` para pedir ajuda, verificar um ficheiro e importá-lo quando quiser.

As dependências e o ficheiro `.env` devem estar configurados. Os comandos foram verificados com Node.js 24 e pnpm 11.22.0, a versão indicada pelo repositório.

A CLI de desenvolvimento usa as bases de dados e o armazenamento configurados em `.env`. Não precisa dos servidores de desenvolvimento do Studio ou da API iniciados.

A escolha do sistema acima também muda os caminhos e as imagens desta secção.

### 1. Abrir a pasta do código-fonte

O exemplo usa `~/Downloads/openldr_ce`. Substitua pelo local onde clonou o repositório.

```sh
cd ~/Downloads/openldr_ce
```

Esta pasta contém `package.json`, `pnpm-workspace.yaml`, `apps` e `packages`. Execute os comandos seguintes a partir desta raiz do repositório.

![Ilustração do terminal na pasta do código-fonte.](terminal-linux-dev-root.png)

### 2. Executar a CLI de desenvolvimento

Execute um comando de cada vez:

```sh
pnpm openldr --help
pnpm openldr ingest --help
```

![Ilustração da ajuda da CLI de desenvolvimento.](terminal-linux-dev-help.png)

Estes comandos mostram ajuda sem importar dados. O prefixo `pnpm openldr` executa `packages/cli/dev.mjs` neste repositório. Mantenha esse prefixo durante o desenvolvimento.

### 3. Verificar um ficheiro local

A CLI de desenvolvimento lê caminhos locais normais. Não exige a pasta partilhada `data` do Docker.

Se o seu ficheiro JSON FHIR estiver em `~/Downloads/openldr_ce/files/my-file.json`, verifique-o na raiz do repositório:

```sh
pnpm openldr fhir validate files/my-file.json
```

![Ilustração da validação de um ficheiro local em desenvolvimento.](terminal-linux-dev-file.png)

O ficheiro testado era válido. O seu resultado depende do conteúdo do seu ficheiro. A validação não o importa.

### 4. Importar para a base de desenvolvimento

Execute este passo quando quiser importar o ficheiro. Confirme que `.env` aponta para as bases e o armazenamento de desenvolvimento. Esses serviços devem estar iniciados.

```sh
pnpm openldr ingest files/my-file.json
pnpm openldr pipeline status
```

![Ilustração de uma importação e do estado do lote em desenvolvimento.](terminal-linux-dev-import.png)

O ficheiro testado criou um lote concluído com um recurso. O identificador e a contagem do seu lote serão diferentes. Nos outros comandos, mantenha `pnpm openldr` e use caminhos do seu computador.

## Usar caminhos numa instalação

Este exemplo explica o caminho. Substitua o nome pelo do seu ficheiro real:

```sh
./openldr ingest data/my-file.json
```

- `openldr` inicia a CLI instalada.
- `ingest` importa o ficheiro.
- `data/my-file.json` indica o ficheiro a importar.

Coloque-o na pasta de instalação usada acima:

```text
~/Downloads/openldr_ce/
  docker-compose.yml
  openldr
  data/
    my-file.json
```

Execute o comando em `~/Downloads/openldr_ce`. Mantenha o prefixo `data/`, pois o caminho é relativo a essa pasta.

A CLI instalada executa dentro do contentor API. A pasta `data` é partilhada com esse contentor. Num servidor remoto, coloque o ficheiro na pasta desse servidor. Guardar um ficheiro no portátil não o copia para o servidor.

Use também `data/` para ficheiros de saída. Coloque caminhos com espaços entre aspas, como `"data/my file.json"`. Cada guia explica o formato esperado. Executar uma importação escreve registos.

## Resolução de problemas

Comece na pasta real da instalação. Os erros e as recuperações seguintes foram reproduzidos em Linux. As imagens ilustram esses testes. As mensagens podem diferir em Windows e macOS.

### O iniciador ou a configuração Compose não foi encontrado

Pode ver `./openldr: not found` ou `no configuration file provided: not found`.

O primeiro erro indica que falta o iniciador na pasta atual. O segundo ocorreu ao executar o comando noutra pasta, onde o Compose não encontrou a configuração.

Regresse à pasta de instalação. Neste exemplo:

```sh
cd ~/Downloads/openldr_ce
./openldr --help
```

A ajuda confirma que o iniciador foi executado. Se o problema continuar, liste os ficheiros como no passo 3. Procure `openldr` e `docker-compose.yml`.

![Transcrição ilustrada do regresso à pasta correta e da ajuda obtida.](proof-wrong-folder.png)

### O Docker usa um endereço de ligação inacessível

O teste devolveu `failed to connect to the docker API`. A variável `DOCKER_HOST` apontava para um socket inexistente. O OpenLDR ainda não tinha iniciado.

Execute `docker info` e leia o endereço no erro. Se definiu `DOCKER_HOST` com um valor agora incorreto, retire-o do terminal atual:

```sh
unset DOCKER_HOST
```

Isto retira apenas esse valor forçado. Não inicia o Docker. Use esta correção apenas se essa variável causar o problema.

```sh
docker info
./openldr --help
```

![Transcrição ilustrada do endereço Docker incorreto e da sua correção.](proof-docker.png)

O teste recuperou depois de retirar o endereço incorreto. Se `docker info` continuar a falhar, leia esse erro antes de repetir o OpenLDR.

### O Docker indica que o serviço api está parado

O erro testado foi `service "api" is not running`. O Docker estava acessível, mas o contentor API estava parado. A CLI instalada executa dentro dele.

Na pasta de instalação, verifique o contentor e inicie-o:

```sh
docker compose ps -a api
docker compose up -d api
```

Depois repita:

```sh
./openldr --help
```

![Transcrição ilustrada do arranque do contentor API e da ajuda obtida.](proof-api.png)

O teste voltou a obter ajuda depois de iniciar o contentor. Não verificou o arranque HTTP completo da aplicação.

### A importação indica ENOENT para o ficheiro

O erro testado foi `ingest failed: ENOENT: no such file or directory, open 'my-file.json'`.

O ficheiro existia ao lado do iniciador. O contentor não o conseguia ler, porque apenas a pasta `data` era partilhada.

Mova-o para `~/Downloads/openldr_ce/data/my-file.json`. Verifique-o sem o importar:

```sh
./openldr fhir validate data/my-file.json
```

Para um ficheiro JSON FHIR válido, a saída inclui `all valid`. Se o quiser importar, use o caminho partilhado:

```sh
./openldr ingest data/my-file.json
```

![Transcrição ilustrada da mudança do ficheiro, da validação e da importação.](proof-file.png)

Esta regra aplica-se ao iniciador Docker instalado. A CLI de desenvolvimento lê caminhos locais normais.

## Guias relacionados

O [guia dos painéis](/docs/dashboard) explica como criar um painel e acrescentar widgets com os seus dados. Os exercícios opcionais vêm depois.
