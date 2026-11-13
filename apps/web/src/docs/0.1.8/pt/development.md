# Desenvolvimento

<!-- operator-platform -->

Execute a API, o Studio e o site público a partir do código. Os exemplos usam `~/Downloads/openldr_ce` no Linux/macOS e `C:\openldr_ce` no PowerShell. Substitua-os pelo seu caminho. O terminal já fornece o prompt azul; escreva apenas o comando. As linhas atenuadas são saídas. Os excertos de configuração indicam o ficheiro e aparecem uma só vez. As imagens ilustram comandos, sem provar uma instalação bem-sucedida. Os dados de exemplo são opcionais.

## Preparar uma cópia de desenvolvimento separada

Use um computador de desenvolvimento e bases separadas. As aplicações correm nesse computador; o Docker executa Postgres, Garage e Keycloak. Instale Git, Node.js 22.13+ e Docker com Compose. O repositório fixa pnpm 11.22.0, que exige Node 22.13+. Instale pnpm pelas [instruções oficiais](https://pnpm.io/installation). Se o Node incluir Corepack, `corepack enable` ativa o lançador pnpm. Abra um terminal após instalar estas ferramentas.

### 1. Verificar as ferramentas

Execute cada comando separadamente. Os comandos de versão mostram as versões instaladas. `docker info` também deve mostrar uma secção Server com resposta. Pare se faltar um comando ou se o Docker não ligar.

```sh
{{operator:dev-tools}}
```

![Verificar as ferramentas.](guide:operator-dev-tools)

### 2. Clonar para uma pasta livre

Este exemplo descarrega o código para `openldr_ce`. A pasta Downloads deve existir no Linux/macOS. Escolha outra pasta principal existente se necessário. Não clone para a pasta Compose instalada.

```sh
{{operator:dev-clone}}
```

![Clonar para uma pasta livre.](guide:operator-dev-clone)

### 3. Entrar na cópia

Use o caminho escolhido em toda a página. Os comandos `pnpm` seguintes partem desta raiz, onde existem `package.json` e `pnpm-workspace.yaml`.

```sh
{{operator:dev-folder}}
```

![Entrar na cópia.](guide:operator-dev-folder)

### 4. Instalar as dependências

O ficheiro de bloqueio escolhe as versões. Se o pnpm rejeitar a versão do Node, atualize o Node antes de tentar novamente. Não apague esse ficheiro para contornar um erro.

```sh
{{operator:dev-dependencies}}
```

![Instalar as dependências.](guide:operator-dev-dependencies)

## Configurar e inicializar os serviços de desenvolvimento

Estes passos constituem a preparação manual. O script automático é uma alternativa, não um passo adicional. Os dados de exemplo continuam opcionais.

### 1. Criar o ficheiro de configuração local

Copie `.env.example` apenas se não existir `.env`. Este comando conserva um ficheiro existente. Verifique depois os URL das bases. Devem identificar as suas bases de desenvolvimento.

```sh
{{operator:dev-copy-env}}
```

![Criar o ficheiro de configuração local.](guide:operator-dev-copy-env)

### 2. Gerar uma chave de encriptação

O Node mostra uma chave aleatória nova. Copie a saída para o passo seguinte. Conserve a chave existente se a base já contiver segredos de conectores encriptados. Outra chave não conseguirá lê-los.

```sh
{{operator:dev-key}}
```

![Gerar uma chave de encriptação.](guide:operator-dev-key)

### 3. Configurar a autenticação de desenvolvimento

Edite `.env` num editor. Cole a chave após `SECRETS_ENCRYPTION_KEY=`. O texto abaixo não é uma chave. `AUTH_DEV_BYPASS=true` desativa a autenticação da API e abre o Studio como administrador de desenvolvimento. Use este modo apenas num ambiente isolado. Conserve os outros valores do `.env.example` atual, incluindo as credenciais Garage de desenvolvimento.

```text
{{operator:dev-env}}
```

![Configurar a autenticação de desenvolvimento.](guide:operator-dev-env)

### 4. Iniciar os serviços Docker

Inicie o Docker e execute os comandos pela ordem indicada. Aguarde até Postgres aceitar ligações e o armazenamento estar saudável. Um contentor em execução não prova que o serviço esteja pronto. Consulte `docker compose logs SERVICE_NAME` se falhar.

```sh
{{operator:dev-services}}
```

![Iniciar os serviços Docker.](guide:operator-dev-services)

### 5. Migrar e inicializar o esquema

A migração aplica alterações ao esquema sem apagar os dados. A inicialização adiciona definições predefinidas, como formulários, workflows e terminologia. Não exige registos laboratoriais de exemplo. Pare se algum comando falhar.

```sh
{{operator:dev-migrate}}
```

![Migrar e inicializar o esquema.](guide:operator-dev-migrate)

## Executar as aplicações e a CLI

Use um terminal separado para cada servidor de desenvolvimento. Entre na mesma raiz do repositório em cada um. Mantenha os servidores ativos enquanto usa as páginas.

### 1. Iniciar a API

A API usa normalmente `http://localhost:3000`. O servidor mostra um aviso quando a autenticação está desativada. Leia os erros de arranque antes de abrir o Studio.

```sh
{{operator:dev-api}}
```

![Iniciar a API.](guide:operator-dev-api)

### 2. Iniciar o Studio

Abra `http://localhost:5173/studio/`. O Studio encaminha os pedidos `/api` para a porta 3000. O modo de desenvolvimento abre a aplicação sem início de sessão e mostra um aviso. Para o início de sessão normal, veja o [guia ilustrado de instalação](/docs/install).

```sh
{{operator:dev-studio}}
```

![Iniciar o Studio.](guide:operator-dev-studio)

### 3. Iniciar o site público

Abra `http://localhost:5174/`. O Studio usa 5173 e este site usa 5174. Num conflito, ambos param em vez de escolher outra porta. Pare o processo antigo nessa porta antes de tentar novamente.

```sh
{{operator:dev-web}}
```

![Iniciar o site público.](guide:operator-dev-web)

### 4. Executar a CLI a partir do código

O lançador do código é `pnpm openldr`, a partir da raiz do repositório. Para um comando de recuperação como `health`, lê `.env` e liga aos serviços Docker. Todos os outros comandos vão para a API em `OPENLDR_URL`, por predefinição `http://127.0.0.1:3000`, por isso mantenha a API do passo 1 em execução. Com `AUTH_DEV_BYPASS=true`, a API inicia sessão nestes comandos. Ver [Início de sessão do CLI e chaves de acesso](/docs/cli-access). Consulte o [guia da CLI](/docs/cli) para comandos e caminhos.

```sh
{{operator:dev-cli}}
```

![Executar a CLI a partir do código.](guide:operator-dev-cli)

## Abrir o site de desenvolvimento noutro dispositivo

Este passo é opcional. Uma API de desenvolvimento sem autenticação deve ficar numa rede privada. A API já escuta em todas as interfaces; verifique a firewall antes de permitir acesso remoto.

### 1. Configurar o endereço de escuta Vite

Edite `.env`. `0.0.0.0` faz ambos os servidores Vite escutarem em todas as interfaces IPv4. Pode usar o endereço privado ou Tailscale do computador. `127.0.0.1` aceita apenas ligações locais.

```text
{{operator:dev-remote}}
```

![Configurar o endereço de escuta Vite.](guide:operator-dev-remote)

### 2. Reiniciar o servidor de desenvolvimento

Prima Ctrl+C no terminal Studio e volte a iniciá-lo. Reinicie também o site público se necessário. No outro dispositivo, abra `http://YOUR_PRIVATE_HOST:5173/studio/` com o seu endereço. Não use `0.0.0.0` nem `localhost` como endereço remoto.

```sh
{{operator:dev-restart}}
```

![Reiniciar o servidor de desenvolvimento.](guide:operator-dev-restart)

## Atualizar ou repor o desenvolvimento

Migre após obter alterações ao esquema. A reposição é uma escolha destrutiva separada.

### 1. Atualizar sem apagar os dados

Consulte primeiro `git status`. Guarde as suas alterações antes do pull. Pare se Git ou a instalação falhar. Migre antes de iniciar a API atualizada. `db seed` recusa um esquema atrasado e não substitui a migração.

```sh
{{operator:dev-update}}
```

![Atualizar sem apagar os dados.](guide:operator-dev-update)

### 2. Verificar a aplicação alterada

Este exemplo verifica o site público. Escolha o pacote afetado para outras alterações. Na raiz, `pnpm test`, `pnpm typecheck` e `pnpm build` executam as tarefas do repositório. Os testes Rust são separados.

```sh
{{operator:dev-check}}
```

![Verificar a aplicação alterada.](guide:operator-dev-check)

### 3. Repor apenas uma base descartável

Opcional e destrutivo. Verifique os dois URL das bases. Estes comandos apagam e recriam o esquema e carregam as definições. Não os use para reparar uma migração em falta. `pnpm e2e:seed` e `pnpm docs:seed` também repõem dados e compilam extensões; são conjuntos de teste opcionais. Cada um tem uma metade de reposição que não precisa da API, e uma metade de carga que passa pela API em execução. A metade de carga precisa de `AUTH_DEV_BYPASS=true`, porque a reposição não deixa nenhuma conta nem chave para iniciar sessão. Corra-os pela ordem que o `e2e/README.md` indica. Essa ordem não foi corrida.

```sh
{{operator:dev-reset}}
```

![Repor apenas uma base descartável.](guide:operator-dev-reset)

## Usar o script em vez da preparação manual

Use esta alternativa numa instalação de desenvolvimento isolada. O script cria `.env` apenas se não existir. Um `.env` novo provoca a reposição, mesmo que a base predefinida já exista. Um `.env` existente evita-a, salvo pedido explícito. Confirme este comportamento antes de usar bases existentes.

### 1. Descarregar o script

Descarregue para uma pasta temporária. Escolha a plataforma correta acima. Descarregar o ficheiro não o executa.

```sh
{{operator:dev-bootstrap-download}}
```

![Descarregar o script.](guide:operator-dev-bootstrap-download)

### 2. Ler antes de executar

Leia o ficheiro. Em `less`, prima q para sair. Verifique a pasta de destino, a criação de `.env` e as condições de reposição. Se seguiu a preparação manual, ignore esta alternativa.

```sh
{{operator:dev-bootstrap-read}}
```

![Ler antes de executar.](guide:operator-dev-bootstrap-read)

### 3. Executar com um destino explícito

Use uma pasta de desenvolvimento nova. O script instala dependências, inicia os serviços e inicializa a base nova. Não inicia a API nem o Studio. Continue em Executar as aplicações acima. Só adicione a opção de dados de exemplo se aceitar a preparação destrutiva.

```sh
{{operator:dev-bootstrap-run}}
```

![Executar com um destino explícito.](guide:operator-dev-bootstrap-run)

## Compilar e testar uma extensão de referência

Opcional. Instale Rust com [rustup](https://rustup.rs). Reabra o terminal se faltar `cargo`. Use a extensão de teste numa instalação de desenvolvimento.

### 1. Adicionar o destino WebAssembly

Execute a partir da raiz. As extensões atuais usam `wasm32-wasip1`. Não são necessários dados laboratoriais de exemplo.

```sh
{{operator:dev-rust}}
```

![Adicionar o destino WebAssembly.](guide:operator-dev-rust)

### 2. Compilar a extensão de teste

Este exemplo Rust não precisa das ferramentas C do WHONET. O script escreve `plugin.wasm` e `manifest.json` em `reference-plugins/test-sink/`.

```sh
{{operator:dev-plugin-build}}
```

![Compilar a extensão de teste.](guide:operator-dev-plugin-build)

### 3. Executar os testes Rust

O comando de testes JavaScript não executa estes testes Rust. Teste o pacote Rust quando o alterar.

```sh
{{operator:dev-plugin-test}}
```

![Executar os testes Rust.](guide:operator-dev-plugin-test)

### 4. Instalar apenas no sistema de teste

Estes comandos escrevem no registo e armazenamento de desenvolvimento. Passam pela API em execução, por isso mantenha-a a correr, com sessão dada por `AUTH_DEV_BYPASS=true` ou por `pnpm openldr login`. Verifique `.env`. Antes de os executar, adicione `MARKETPLACE_DEV_ALLOW_UNSIGNED=true` ao `.env` do teste isolado e reinicie a API. Mantenha o manifesto junto do ficheiro WASM. Esta compilação não está assinada; reserve a opção de desenvolvimento sem assinatura a um sistema isolado. Use pacotes assinados e aprovados numa instalação normal.

```sh
{{operator:dev-plugin-install}}
```

![Instalar apenas no sistema de teste.](guide:operator-dev-plugin-install)

## Opções do script e comandos de compilação

| Linux/macOS | PowerShell | Efeito |
| --- | --- | --- |
| `--dir PATH` | `-Dir PATH` | Escolher a pasta do repositório. |
| `--branch NAME` | `-Branch NAME` | Escolher o ramo de um clone novo. |
| `--no-services` | `-NoServices` | Ignorar Docker e a inicialização das bases. |
| `--reset-db` | `-ResetDb` | Repor uma base de desenvolvimento existente. Destrutivo. |
| `--seed` | `-Seed` | Na inicialização, executar a preparação destrutiva WHONET. Exige ferramentas de compilação. Se alguma coisa estiver à escuta na porta 3000, o script termina antes de instalar ou mudar o que quer que seja. Numa instalação nova ou com `--reset-db`, compila depois a amostra e as extensões. Repõe e carrega a base, e depois repõe-na outra vez. Inicia então a sua própria API na porta 3000 e carrega a amostra por ela. Verifica a porta 3000 outra vez antes de cada reposição e antes de a API iniciar, e termina se alguma coisa estiver à escuta. Uma paragem depois de uma reposição di-lo e indica como correr outra vez. A carga precisa de `AUTH_DEV_BYPASS=true` em `.env`, e de nenhum `OPENLDR_KEY` nem `OPENLDR_KEY_FILE` na sua shell. A API fica a correr. Não testado. |

`pnpm build:ui-reference` compila a extensão com página, cartão e painel. `pnpm build:v1-import` compila o importador v1. `pnpm build:plugins` compila WHONET e as outras extensões de referência. WHONET também exige clang e um sysroot WASI.

Para um pacote local sem assinatura num sistema de teste isolado, adicione `MARKETPLACE_DEV_ALLOW_UNSIGNED=true` ao respetivo `.env` e reinicie a API. Mantenha esta opção desativada nas instalações normais. Veja [Variáveis de ambiente](/docs/environment).

## Cartão e painel lateral de um plugin

Um plugin com página própria (`ui.entry` no manifesto) pode também mostrar essa página como cartão no painel e como painel lateral. Declare-os em `ui.sites`:

**`manifest.json`, excerto**

```json
"ui": {
  "entry": "ui.html",
  "sha256": "<sha256 of ui.html>",
  "nav": { "label": "Bench notes" },
  "sites": {
    "widget": { "title": "Today", "height": "small" },
    "panel": { "title": "Bench notes" }
  }
}
```

- Ambos são opcionais. `height` é `small`, `medium` ou `large`: 160, 240 ou 360 px de altura. O valor por omissão é `medium`.
- Os títulos têm de 1 a 60 caracteres.
- `ui.sites` faz parte do manifesto assinado, por isso a assinatura cobre-o. Os pacotes assinados antes de ele existir continuam a ser verificados.
- O plugin traz um único `ui.html`. Depois de `await openldr.ready`, leia `openldr.site`. O valor é `page`, `widget` ou `panel`. Desenhe a vista desse lugar.
- Todos os lugares usam as mesmas chamadas ao broker, o mesmo armazenamento e o mesmo controlo de funções, `ui.requiredRoles`.

A Documentação do estúdio explica o que os utilizadores veem, em **Cartões e painéis laterais de plugins**.

## Contribuir

Crie um fork e um ramo de trabalho. Execute os testes, verificações de tipos e compilações relevantes. Abra um pull request para `main` com a alteração e a validação.

As rotas assíncronas do servidor devem usar `return reply.send(...)`. Use `await reply.send(...)` quando uma função auxiliar precisar de outro valor de retorno. Uma chamada isolada ou com `void` não espera pela compressão assíncrona e pode enviar um corpo vazio. Veja o comentário no início de `apps/server/src/sync-routes.ts`.

`pnpm --filter @openldr/server lint` aplica a regra `openldr/require-return-reply-send`. Teste respostas grandes por HTTP real ao alterar o seu tratamento. Os pequenos conteúdos dos testes unitários não exercitam a compressão assíncrona.
