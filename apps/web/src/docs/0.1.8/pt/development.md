# Desenvolvimento

Execute o OpenLDR a partir do código-fonte para desenvolver sobre ele. O repositório é um
monorepo pnpm + Turbo: a API de backend (`apps/server`), a aplicação Studio (`apps/studio`),
este site de apresentação e documentação (`apps/web`) e pacotes partilhados. Os serviços de suporte (Postgres, Keycloak e o serviço de armazenamento, Garage) correm no
Docker. As aplicações correm no seu anfitrião, com recarregamento automático.

## Pré-requisitos

- **git**
- **Node.js 20+**
- **pnpm** (ou Corepack: `corepack enable`)
- **Docker** com o plugin Compose (para os serviços de suporte)

## Início rápido (arranque de uma linha)

O script de arranque para programadores clona o repositório, instala as dependências,
arranca os serviços de suporte, escreve um `.env` de desenvolvimento e inicializa a base de
dados.

**Linux / macOS**
```
curl -fsSL https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.sh | bash
```

**Windows (PowerShell)**
```
irm https://raw.githubusercontent.com/Open-Laboratory-Data-Repository/openldr/main/install/development.ps1 | iex
```

Opções úteis: `--dir <path>` onde clonar, `--branch <name>` que ramo usar, `--seed` também
carrega os dados de exemplo do WHONET, `--reset-db` força uma base de dados nova
(destrutivo), `--no-services` não arranca o Docker nem a base de dados. (Na PowerShell:
`-Dir`, `-Branch`, `-Seed`, `-ResetDb`, `-NoServices`.)

## Configuração manual

Se preferir fazer à mão:

```
git clone https://github.com/Open-Laboratory-Data-Repository/openldr.git
cd openldr
pnpm install

# dev config — enables a no-login dev admin so you don't need to configure Keycloak
cp .env.example .env
printf '\nAUTH_DEV_BYPASS=true\n' >> .env   # required: the bypass is off unless you set it

# backing services (Postgres :5433, S3 storage (Garage) :9010, Keycloak :8180)
docker compose up -d

# create the schema and seed the starter set (forms, workflows, terminology)
pnpm openldr db reset
pnpm openldr db seed
```

Se o seu `.env` for anterior à 0.1.11, altere `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` para os valores de `.env.example`.

> Em desenvolvimento, a base de dados **não** é migrada automaticamente
> (`MIGRATE_ON_START` está desligado). Por isso, **depois de qualquer pull que traga novas
> migrações, execute `pnpm openldr db migrate`**. Não é destrutivo e mantém os seus dados.
> Se a aplicação mostrar dados vazios ou o servidor registar `relation "…" does not exist`,
> é esta a solução. `db seed` recusa correr sobre um esquema atrasado em relação ao código
> e indica o que está pendente.
>
> Use `pnpm openldr db reset` apenas quando quiser mesmo começar do zero: este comando
> **elimina e recria o esquema**, e destrói tudo na sua base de dados de desenvolvimento.

## Executar as aplicações

Cada aplicação corre no seu próprio terminal, a partir da raiz do repositório:

```
pnpm -C apps/server dev   # API        → http://localhost:3000
pnpm -C apps/studio dev   # Studio app → http://localhost:5173/studio
pnpm -C apps/web dev      # This site  → http://localhost:5174
```

O Studio encaminha `/api` para o servidor na porta 3000. As duas portas do Vite estão
fixadas no `vite.config.ts` de cada aplicação com `strictPort`. Assim, um conflito de
portas falha de forma visível, em vez de mudar uma aplicação para outra porta sem aviso.
Com `AUTH_DEV_BYPASS` ligado, o Studio abre logo como administrador de desenvolvimento, sem
início de sessão. Retire-o do `.env` para testar o fluxo real do Keycloak.

### Aceder ao servidor de desenvolvimento a partir de outro dispositivo

O Vite fica ligado a localhost, por isso um telemóvel na mesma rede não consegue abrir o
Studio. Defina `DEV_HOST` no `.env` da raiz do repositório com o endereço a que o quer
ligar:

```
DEV_HOST=127.0.0.1
```

`apps/studio/vite.config.ts` lê-o a partir desse ficheiro. O `.env` está no gitignore, por
isso nenhum endereço específico de uma máquina vai parar a um ficheiro versionado. Deixe-o
por definir para manter a omissão, só localhost. Só são lidas as variáveis com nome
`DEV_*`, o que mantém o resto do `.env` fora da configuração do Vite.

> `AUTH_DEV_BYPASS` fica **desligado até o definir explicitamente**. Não é ativado por
> `NODE_ENV=development`. Se o Studio lhe pedir para iniciar sessão numa cópia existente,
> acrescente `AUTH_DEV_BYPASS=true` ao `.env`. Quando está ligado, o servidor regista um
> aviso no arranque e o Studio mostra uma faixa, porque nesse modo a API não exige
> autenticação.

## Comandos úteis

| Comando | O que faz |
| --- | --- |
| `pnpm test` | Executa os conjuntos de testes do workspace. |
| `pnpm typecheck` | Verifica os tipos de todos os pacotes e aplicações. |
| `pnpm build` | Compila tudo (Turbo). |
| `pnpm openldr db migrate` | Aplica as migrações pendentes. Não é destrutivo: execute-o depois de um pull. |
| `pnpm openldr db reset` | Elimina e recria o esquema da base de dados de desenvolvimento (**destrutivo**). |
| `pnpm openldr db seed` | Cria os formulários, fluxos de trabalho e terminologias por omissão. |
| `pnpm -C apps/studio test` | Executa apenas os testes do Studio. |

## Contribuir

As contribuições são bem-vindas. Por agora: faça um fork do repositório, crie um ramo de
funcionalidade, mantenha os testes e as verificações de tipos a passar (`pnpm test`,
`pnpm typecheck`) e abra um pull request contra `main` que descreva a alteração.

**Convenção das rotas do servidor:** a compressão das respostas está registada para todo o
servidor, por isso cada handler de rota assíncrono tem de fazer `return reply.send(...)`.
Um `reply.send(payload)` sem `return` devolve um corpo **vazio** sem qualquer aviso quando
o conteúdo passa de cerca de 1KB e o envio se torna assíncrono. O `return` é essencial, não
uma questão de estilo. O mecanismo está explicado no bloco de comentários no topo de
`apps/server/src/sync-routes.ts`.

Use antes `await reply.send(...)` quando a função ainda tiver de resolver para outra coisa,
por exemplo um helper de autenticação que indica "já respondido" ao resolver `undefined`.
Ambas as formas esperam pelo thenable da resposta, e é isso que as torna seguras.
`void reply.send(...)` **não** conta como confirmação: descarta esse thenable sem esperar
por ele, por isso falha exatamente como um envio sem `return`. Um handler síncrono
(`setNotFoundHandler`, `setErrorHandler`) nunca chega a este mecanismo e não é afetado.

Isto é imposto pela regra ESLint `openldr/require-return-reply-send`
(`apps/server/eslint-rules/`). Assim, `pnpm --filter @openldr/server lint` falha com um
envio sem `return` ou com `void` numa função assíncrona. A regra existe porque nenhum tipo
de teste apanha isto: os dados dos testes unitários ficam abaixo do limite de 1KB, por isso
o erro fica invisível até para um teste que usa o `buildApp` real. Só um conjunto de testes
de aceitação com HTTP real o deteta.

> Um guia de contribuição mais completo (convenções de código, processo de revisão e uma
> lista de verificação para pull requests) ainda está a ser escrito. Volte mais tarde, ou
> abra uma issue para iniciar uma discussão.
