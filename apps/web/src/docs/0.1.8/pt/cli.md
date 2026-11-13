# Interface de linha de comandos (CLI)

<!-- operator-platform -->

Faça a manutenção no anfitrião OpenLDR, na pasta Compose instalada. Os exemplos usam `~/Downloads/openldr_ce` no Linux/macOS e `C:\openldr_ce` no PowerShell. Substitua estes caminhos. O terminal já mostra o prompt azul; escreva apenas o comando. As ilustrações de ficheiros mostram texto para editar no ficheiro indicado. As imagens não provam uma operação concluída. Os dados de exemplo são opcionais.

## Usar o lançador instalado

Execute no anfitrião OpenLDR. Um navegador por Tailscale não é um terminal nesse computador. Use o terminal remoto ou SSH configurado.

### 1. Encontrar a pasta real da instalação

Substitua o caminho. Procure docker-compose.yml, data e openldr ou openldr.ps1. Não assuma um executável global.

```sh
{{operator:cli-find}}
```

![Encontrar a pasta real da instalação.](guide:operator-cli-find)

### 2. Ler a ajuda do lançador

A ajuda lista comandos sem alterar dados. O lançador executa no contentor api; esse serviço e Docker devem estar disponíveis.

```sh
{{operator:cli-help}}
```

![Ler a ajuda do lançador.](guide:operator-cli-help)

### 3. Ler opções do comando escolhido

Use --help em cada nível. Leituras costumam aceitar --json. Exemplos de alteração abaixo são alternativas, não um script em sequência. A maioria dos comandos passa pelo servidor em execução, por isso inicie sessão primeiro com ./openldr login ou uma chave de acesso. Ver [Início de sessão do CLI e chaves de acesso](/docs/cli-access).

```sh
{{operator:cli-group-help}}
```

![Ler opções do comando escolhido.](guide:operator-cli-group-help)

## Passar um ficheiro ao CLI instalado

Os ficheiros no contentor api devem usar a pasta partilhada data. Entradas e saídas ficam sob data/. Um caminho externo do anfitrião não é igual dentro do contentor.

### 1. Copiar o ficheiro aprovado para data

Substitua caminho e nome. A conta deve poder escrever na pasta. Uma instalação com sudo pode pertencer a root; use o proprietário adequado ou corrija deliberadamente, sem permissões gerais.

```sh
{{operator:cli-file}}
```

![Copiar o ficheiro aprovado para data.](guide:operator-cli-file)

### 2. Validar sem importar

Validação lê sem importar. Corrija erros antes de continuar. Não partilhe identificadores reais de pacientes em capturas.

```sh
{{operator:cli-validate}}
```

![Validar sem importar.](guide:operator-cli-validate)

### 3. Importar apenas quando pretender gravar

Grava na base configurada. Leia o resultado e os comandos pipeline em Carregar e enviar. Use data/ também para --out, mesmo como root, ou os ficheiros podem desaparecer com o contentor.

```sh
{{operator:cli-import}}
```

![Importar apenas quando pretender gravar.](guide:operator-cli-import)

## Usar o lançador de desenvolvimento

Use um repositório fonte com dependências e .env configurados. Não é a pasta Compose instalada. Veja Desenvolvimento primeiro.

### 1. Executar ajuda na raiz do repositório

A raiz contém package.json, pnpm-workspace.yaml, apps e packages. Os comandos de recuperação, como db migrate e health, usam os serviços de .env. Todos os outros comandos vão para a API em OPENLDR_URL, por predefinição http://127.0.0.1:3000, por isso inicie primeiro a API. Com AUTH_DEV_BYPASS=true, a API inicia sessão por si nestes comandos.

```sh
{{operator:cli-dev-help}}
```

![Executar ajuda na raiz do repositório.](guide:operator-cli-dev-help)

### 2. Usar um caminho normal do anfitrião

Substitua pelo caminho real do anfitrião. Desenvolvimento não se limita à pasta partilhada data instalada. Exemplos continuam opcionais.

```sh
{{operator:cli-dev-validate}}
```

![Usar um caminho normal do anfitrião.](guide:operator-cli-dev-validate)

## Recuperar de um erro da CLI instalada

Estes casos foram reproduzidos em Linux com o iniciador instalado e a CLI real numa instalação isolada. Windows e macOS não foram testados nativamente. Comece na pasta da instalação e identifique o erro.

| Erro | Recuperação verificada no teste |
| --- | --- |
| `./openldr: not found` ou `no configuration file provided: not found` | Regresse à pasta real da instalação e execute `./openldr --help`. Confirme a presença do iniciador e do ficheiro Compose. |
| `failed to connect to the docker API` com um endereço `DOCKER_HOST` incorreto | Execute `docker info`. Se esse valor forçado estiver errado, retire-o com `unset DOCKER_HOST`, depois repita `docker info` e a ajuda CLI. Em PowerShell: `$env:DOCKER_HOST = $null`. Isto não inicia o Docker. |
| `service "api" is not running` | Verifique `docker compose ps -a api`, execute `docker compose up -d api` e repita a ajuda. O teste prova a recuperação do iniciador, não o arranque HTTP completo da aplicação. |
| `ingest failed: ENOENT`, ou `Cannot find <file>.` desde que os comandos passam pela aplicação, com o ficheiro ao lado do iniciador | Mova o ficheiro para a pasta `data` da instalação. Execute `./openldr fhir validate data/my-file.json`, depois importe esse caminho se quiser. A CLI de desenvolvimento lê caminhos locais normais. |
| `workflows` | Veja `workflows --help` para opções do operador. |
| `connectors` | Veja `connectors --help` para opções do operador. |
| `import` | Veja `import --help` para opções do operador. |
| `doctor` | Veja `doctor --help` para opções do operador. |
| `auth` | Veja `auth --help` para opções do operador. |
| `roles` | Veja `roles --help` para opções do operador. |
| `data-exposure` | Veja `data-exposure --help` para opções do operador. |
| `layouts` | Veja `layouts --help` para opções do operador. |
| `report-design` | Veja `report-design --help` para opções do operador. |
| `report-def` | Veja `report-def --help` para opções do operador. |
| `export` | Veja `export --help` para opções do operador. |


## Grupos de comandos

| Grupo | O que faz |
| --- | --- |
| `health` | Indica o estado dos serviços (autenticação, armazenamento, eventos, armazém de destino). |
| `db` | `migrate`, `reset`, `seed` da base de dados; `reproject` do modelo de leitura do armazém. |
| `patients` | `list` e `show` de doentes (mascarados, exceto com `--identifiers`, que fica na auditoria); `identifier-systems list` e `set` de rótulos. |
| `settings` | Indicadores de funcionalidades `flags list` / `flags set`, `danger <action>`, e `sync show` / `sync set` (configuração da sincronização laboratório⇄central). |
| `terminology` | Importa e consulta CodeSystems, ValueSets, ConceptMaps e ontologias. |
| `fhir` | Valida recursos FHIR R4. |
| `forms` | Lista definições de formulários; extrai respostas de um QuestionnaireResponse. |
| `ingest` | Carrega um ficheiro através do pipeline (opcionalmente com um plugin). |
| `facilities` | Importa um registo nacional de unidades: `suggest-map`, `suggest-values`, `import` (mapeamento de colunas e valores; consulte **Unidades** na Documentação do estúdio). |
| `test-catalog` | O catálogo nacional de exames: `list` dos testes, `import` de uma lista a partir de CSV ou Excel, `export` em CSV, `enable` ou `disable` de um teste neste laboratório, e `retire` ou `restore` de um teste quando esta instalação é dona do catálogo. |
| `query` | Consultas personalizadas: `export` para um ficheiro JSON, `import` a partir de um (`--force` substitui os nomes existentes). |
| `pipeline` | Inspeciona lotes de ingestão: `status`, `retry`, `logs`. |
| `queue` | Inspeciona a fila de eventos. |
| `provenance` | Ferramentas de auditoria da proveniência. |
| `plugin` | Gere plugins de ingestão WASM: `install`, `list`, `test`, `run`, `remove`. |
| `report` | `list` e `run` de relatórios analíticos; `glass-export`. |
| `audit` | Lê o registo de auditoria, onde só se acrescentam entradas. |
| `user` | Gere utilizadores: `list`, `show`, `create`, `set-role`, `activate`, `deactivate`. As mudanças de estado também atualizam as contas ligadas no fornecedor. `export` é um comando de dados de nível superior. |
| `market` | Artefactos do Marketplace: `verify`, `install`, `update`, `list`, `rollback`, `enable`, `disable`, `remove`. |
| `artifact` | Criação de artefactos: `keygen`, `new`, `build`, `pack`, `sign`, `test`, `publish`. |
| `sync` | Sincronização distribuída (laboratório⇄central): `status`, `now`, e, do lado central, `enroll`, `list`, `rotate`, `revoke`. |
| `errors` | Lista o catálogo de códigos de erro. |
| `update` | `check` verifica se foi publicada uma versão mais recente do OpenLDR (saída 0 = atualizado, 1 = há uma atualização disponível, 2 = a verificação falhou). |
| `storage` | `copy` copia os objetos de outro bucket S3 para o armazenamento desta instalação. |
| `target-store` | Testa a ligação ao armazém de destino. |

Os comandos da CLI que alteram dados (`sync enroll/rotate/revoke`, `user create/set-role/activate/deactivate`,
`settings … set`, `settings danger …`, `db reset`, `db reproject`, `terminology import/create`, `query import`) registam um
evento de auditoria. Um comando que passa pela aplicação regista a conta com sessão iniciada, e
`--actor` é aí recusado. Um comando de recuperação, como `db reset`, regista o tipo de ator
**`cli`** com o nome do operador nessa máquina, ou a opção global `--actor <name>`. Numa
instalação Docker, esse nome é procurado dentro do contentor, por isso é muitas vezes `node` ou
`cli`. Estes eventos aparecem na página Auditoria, ao lado das ações feitas na interface.
[Início de sessão do CLI e chaves de acesso](/docs/cli-access) indica o tipo de cada comando.

## Tarefas comuns

Atualizar uma base de dados depois de obter novas migrações (não destrutivo, mantém os
dados):

### 1. Aplicar migrações pendentes

```
{{operator:cli-pt-1}}
```

![Aplicar migrações pendentes.](guide:operator-cli-pt-1)

Repor e preencher uma base de dados de desenvolvimento (`db reset` **elimina e recria** o
esquema):

### 2. Repor apenas uma base descartável pretendida

```
{{operator:cli-pt-2}}
```

![Repor apenas uma base descartável pretendida.](guide:operator-cli-pt-2)

`db seed` recusa correr quando há migrações pendentes e indica o que falta. Execute
primeiro `db migrate`.

Reconstruir o modelo de leitura do armazém a partir do armazém FHIR canónico
(`db reproject` **reescreve todas as linhas projetadas**, por isso recusa correr sem
`--force`):

### 3. Reconstruir o armazém apenas se necessário

```
{{operator:cli-pt-3}}
```

![Reconstruir o armazém apenas se necessário.](guide:operator-cli-pt-3)

Mostra duas contagens separadas: os recursos canónicos que reescreveu e as chegadas que
registou no registo de ingestão (uma por versão de um recurso clínico). São unidades
diferentes, não o mesmo número. Tal como `db seed`, recusa correr quando há migrações
pendentes, em vez de ir até ao fim sobre um esquema atrasado. Use-o para preencher dados
depois de uma atualização acrescentar uma tabela ao armazém.

`terminology reproject` está **obsoleto**. Sempre chamou a mesma reconstrução completa do
modelo de leitura, nunca uma só da terminologia. Continua a funcionar como alias, mostra
agora um aviso de obsolescência e herda a proteção `--force`. Use antes `db reproject`.

Instalar e executar um plugin de ingestão, e depois carregar um ficheiro com ele:

### 4. Instalar um conversor aprovado e importar

```
{{operator:cli-pt-4}}
```

![Instalar um conversor aprovado e importar.](guide:operator-cli-pt-4)

Criar um utilizador local e atribuir funções:

### 5. Escolher a operação de utilizador pretendida

```
{{operator:cli-pt-5}}
```

![Escolher a operação de utilizador pretendida.](guide:operator-cli-pt-5)

Ligar ou desligar um indicador de funcionalidade:

### 6. Ler ou alterar uma funcionalidade escolhida

```
{{operator:cli-pt-6}}
```

![Ler ou alterar uma funcionalidade escolhida.](guide:operator-cli-pt-6)

Executar um relatório:

### 7. Executar relatório ou exportar na pasta partilhada

```
{{operator:cli-pt-7}}
```

![Executar relatório ou exportar na pasta partilhada.](guide:operator-cli-pt-7)

Para um relatório com um filtro Date range, forneça ambas as datas com `--param from=2026-01-01 --param to=2026-11-12`. O serviço de relatórios associa estes valores ao intervalo declarado pela consulta guardada. Escolha as datas do seu relatório.

`--lang` imprime as traduções guardadas no desenho, incluindo as datas. Os relatórios
incluídos trazem francês e português, por isso isto funciona com eles sem configuração. O
texto sem tradução para essa língua sai como foi escrito, e os dados nunca são traduzidos.

Inscrever um laboratório no servidor central e depois ligar o laboratório a ele:

### 8. Configurar o parceiro de sincronização

```
{{operator:cli-pt-8}}
```

![Configurar o parceiro de sincronização.](guide:operator-cli-pt-8)

> A sincronização distribuída liga laboratórios a um servidor central: os dados
> operacionais sobem para uma cópia só de leitura, e a configuração de referência e a
> terminologia descem. A inscrição cria um cliente Keycloak por laboratório e exige que a
> conta de serviço de administração do realm central tenha
> `manage-clients`/`view-clients`.

> Tudo o que está em `settings danger` é destrutivo (repor painéis, limpar a auditoria,
> repor as definições de fábrica). Esses comandos exigem `--force` e correspondem à zona de
> perigo do Studio.

## Copiar ficheiros entre armazenamentos S3

`openldr storage copy` copia todos os objetos de outro bucket S3 para o armazenamento desta instalação. Use-o para sair do MinIO, como descreve o [guia de atualização](/docs/upgrading). Lê a origem e nunca a altera. Ignora uma chave que já está no destino com o mesmo tamanho, por isso pode executá-lo de novo para retomar. Um objeto com o mesmo tamanho mas conteúdo diferente não é copiado de novo. Mostra o número de objetos e de bytes dos dois lados e depois verifica se cada objeto da origem está no destino com o mesmo tamanho. Termina com código diferente de zero se faltar algum. Objetos a mais no destino são normais enquanto a api corre, porque ela continua a escrever ficheiros novos lá. Não fazem a verificação falhar. A CLI regista o ator como `cli`.

| Opção | O que faz |
| --- | --- |
| `--from-endpoint <url>` | Endpoint do armazenamento de origem, por exemplo `http://minio:9000`. |
| `--from-key <key>` | Chave de acesso do armazenamento de origem. |
| `--from-secret <secret>` | Chave secreta do armazenamento de origem. Fica visível no histórico da shell e na lista de processos, por isso apague depois essa linha do histórico. |
| `--from-bucket <bucket>` | Bucket de onde copiar. |
| `--from-region <region>` | Região do armazenamento de origem. Por omissão `us-east-1`. |
| `--json` | Mostra o relatório em JSON. |

## Novas tentativas da projeção

O worker de projeção guarda as escritas de recursos e do registo de chegadas que falharam, para as tentar de novo automaticamente.
As novas tentativas sobrevivem a um reinício e voltam a ler o recurso canónico atual, incluindo eliminações.
Cada ciclo tenta de novo no máximo 100 recursos em fila e depois trata as alterações novas.
As falhas repetidas esperam 1, 2, 4 segundos e assim por diante, até cinco minutos.
As novas tentativas continuam até terem sucesso; um recurso com falha não bloqueia as alterações válidas seguintes.
Uma nova alteração a esse recurso pode provocar uma tentativa antes de o prazo terminar.
Se guardar uma nova tentativa falhar, o worker não mexe no seu cursor.
Uma projeção bem-sucedida apaga a nova tentativa. Os erros dos hooks auxiliares de captura são registados sem agendar novas tentativas.
Não é preciso nenhuma ação do operador depois de uma falha temporária terminar.
Para uma reconstrução completa intencional, use `openldr db reproject --force`.

## Desativar ou ativar o acesso

Abra o menu **Ações** da linha da conta para a desativar ou ativar. A desativação escreve o bloqueio de acesso local antes de atualizar o fornecedor de identidade. O pedido seguinte à API com autenticação devolve `403 account disabled`, incluindo pedidos com um token já emitido. Um ecrã já carregado no navegador pode continuar visível.

As contas que nunca iniciaram sessão também recebem um bloqueio local. A ativação atualiza primeiro o fornecedor e depois levanta esse bloqueio. Se uma das escritas falhar, a ação indica um erro. Uma desativação que falhe pode deixar o fornecedor ativo enquanto o OpenLDR bloqueia o acesso. Uma ativação que falhe pode deixar o fornecedor ativo enquanto o bloqueio local se mantém. Restabeleça a ligação que falha e repita a mesma ação. Os registos de auditoria usam `user.status.failed` para as falhas e `user.status` para o sucesso.

Na CLI, use `openldr user deactivate <local-id>` ou `openldr user activate <local-id>`. Encontre o ID local com `openldr users list`. As contas ligadas atualizam os dois sistemas através do seu identificador no fornecedor. As contas criadas só no armazenamento local mudam apenas localmente. Os registos de auditoria nomeiam a conta com sessão iniciada.

Se outra mudança de estado estiver em curso para esta conta, a API devolve `409`. Espere que essa ação termine e depois tente de novo. Isto também se aplica quando o Studio e a CLI alteram a mesma conta.

## Contas do início de sessão local

Estes comandos servem uma instalação com `AUTH_ADAPTER=local`. Veja [Fornecedores de autenticação](/docs/auth-providers). As linhas de utilização abaixo foram copiadas do `--help` de cada comando:

```text
Usage: openldr auth setup-code [options]
Usage: openldr user create [options]
Usage: openldr user assign-role [options] <subject> <slug>
Usage: openldr user reset-password [options] <username>
Usage: openldr user end-sessions [options] <username>
```

- `openldr auth setup-code` mostra um código de uso único para criar o primeiro administrador no Studio. É válido durante 30 minutos, e um código novo substitui o anterior. Assim que existe um administrador, o comando recusa com `an administrator already exists`. O código nunca é escrito no registo de auditoria.
- `openldr user create --username <u>` cria uma conta que pode iniciar sessão. O comando mostra o ID do novo utilizador e uma palavra-passe temporária, uma só vez. A pessoa tem de alterar essa palavra-passe no primeiro início de sessão. `--role` recebe o identificador de uma função, como `lab_technician`. Uma função que não existe faz o comando recusar com `no role named <slug>`, e nada é criado. Passa pela aplicação, por isso inicie sessão primeiro com uma conta que tenha `users.manage`. Crie o primeiro administrador no Studio com um código de configuração. `--no-password` cria uma conta que não consegue iniciar sessão, para uma chave de acesso.
- `openldr user assign-role <subject> <slug>` junta uma função. Com início de sessão local, o sujeito é o ID do utilizador que `user create` mostra. Com um nome de utilizador, o comando indica sucesso e não concede nada.
- `openldr user reset-password <username> --force` define uma nova palavra-passe temporária, mostra-a uma só vez e termina as sessões do utilizador. O utilizador tem de escolher uma nova palavra-passe no próximo início de sessão. Sem `--force`, recusa e não altera nada. É assim que se recupera a palavra-passe esquecida de um administrador.
- `openldr user end-sessions <username>` termina a sessão do utilizador em todo o lado. A palavra-passe não muda.

`reset-password` e `end-sessions` comparam o nome de utilizador exatamente, incluindo maiúsculas. Com Keycloak ou OIDC, recusam com `local sign-in is not enabled`. `reset-password` escreve um evento de auditoria com o tipo de ator `cli`. `user create` e `end-sessions` passam pela aplicação, e os seus eventos de auditoria nomeiam a conta com sessão iniciada. Uma palavra-passe temporária nunca aparece no registo de auditoria.

```
./openldr user create --username amina --name "Amina Hassan" --role lab_technician
./openldr user reset-password amina --force
./openldr user end-sessions amina
```

`user create` mostra três linhas: `created amina (<id>)`, `temporary password: <password>` e `amina must change it at first sign-in.` Entregue a palavra-passe diretamente à pessoa.

## Paginação do diretório de utilizadores

Utilizadores começa com as contas ativas. A pesquisa procura nomes de utilizador do fornecedor, nomes e endereços de email em todo o diretório. Selecione Todos os estados para incluir as contas desativadas. Mudar a pesquisa, o estado ou o tamanho da página volta à primeira página.

Use Próximo para chegar às contas além das primeiras 100. Cada pedido devolve no máximo 100 contas. O rodapé mostra o intervalo visível sem indicar um total. As colunas continuam configuráveis. Não há filtros arbitrários por coluna nem ordenação, porque o fornecedor não os suporta. O fornecedor controla a ordem. Contas acrescentadas ou removidas entre pedidos podem deslocar as páginas.

Para acesso sem interface gráfica, execute:

### 9. Escolher a operação de utilizador pretendida

```sh
{{operator:cli-pt-9}}
```

![Escolher a operação de utilizador pretendida.](guide:operator-cli-pt-9)

O JSON contém `rows`, `offset`, `limit`, `total: null` e `hasMore`. Some `limit` a `offset` enquanto `hasMore` for verdadeiro. Omita `--enabled` para incluir os dois estados. `openldr user list` continua a listar as contas locais.

Quando a administração do fornecedor não está configurada, a listagem do diretório usa as contas locais. A pesquisa local procura o nome de utilizador, o nome de apresentação e o email como partes do texto. Os resultados locais ficam ordenados por nome de utilizador e ID. A pesquisa no fornecedor segue as regras de pesquisa do fornecedor de identidade.

## Catálogo de exames

O catálogo de exames é a lista nacional de testes. É um sistema de códigos na página Terminologia, **Catálogo de exames**. As suas categorias são um segundo sistema de códigos, **Test categories**, que começa com cinco: Chemistry, Haematology, Microbiology, Serology e Molecular. Edite as categorias na página Terminologia.

O servidor central mantém o catálogo. Um laboratório recebe-o através da sincronização de terminologia e não pode alterar os seus testes. Cada laboratório regista as suas próprias definições para um teste: se o executa, uma lista de amostras mais curta e um nome local. A sincronização nunca envia essas definições.

Listar o catálogo a partir da linha de comandos:

### 10. Usar o catálogo com os seus códigos

```sh
{{operator:cli-pt-10}}
```

![Usar o catálogo com os seus códigos.](guide:operator-cli-pt-10)

Os testes retirados ficam ocultos, a menos que use `--status retired` ou `--status all`. `--loinc none` lista os testes sem código LOINC. `--limit` é 25 por omissão e 200 no máximo. Pagine com `--offset`. O JSON contém `rows`, `total` e `ownedHere`. `ownedHere` é falso quando esta instalação recebeu o catálogo do servidor central.

Ligar ou desligar um teste neste laboratório, ou retirá-lo e repô-lo, pelo código:

### 11. Usar o catálogo com os seus códigos

```sh
{{operator:cli-pt-11}}
```

![Usar o catálogo com os seus códigos.](guide:operator-cli-pt-11)

`enable` e `disable` funcionam em qualquer instalação. `retire` e `restore` só funcionam onde esta instalação é dona do catálogo. Retirar é reversível, por isso nenhum destes comandos aceita `--force`. Cada um fica no registo de auditoria com a conta com sessão iniciada.

Importar uma lista de testes de um ficheiro CSV ou Excel (.xlsx):

### 12. Usar o catálogo com os seus códigos

```sh
{{operator:cli-pt-12}}
```

![Usar o catálogo com os seus códigos.](guide:operator-cli-pt-12)

Sem `--apply`, nada é escrito. O comando mostra o número de linhas novas, alteradas, sem alteração e recusadas, cada recusa com o número da linha, e qualquer texto de categoria ou de amostra que não correspondeu a nada. As colunas são associadas pelo cabeçalho. Para as indicar à mão, use `--column-map` com um ficheiro JSON como `{"code": "Test code", "name": "Test name"}`. Responda ao texto sem correspondência com `--value-map`:

### 13. Guardar o mapeamento no ficheiro JSON

```json
{{operator:cli-pt-13}}
```

![Guardar o mapeamento no ficheiro JSON.](guide:operator-cli-pt-13)

Uma resposta de categoria é `"kind": "existing"` com um `code`, ou `"kind": "new"` com um `code` e um `display`. Só uma instalação que seja dona do catálogo pode importar. Uma aplicação fica no registo de auditoria com a conta com sessão iniciada. Exporte os testes ativos em CSV, para a saída padrão ou para um ficheiro:

### 14. Usar o catálogo com os seus códigos

```sh
{{operator:cli-pt-14}}
```

![Usar o catálogo com os seus códigos.](guide:operator-cli-pt-14)

Associar códigos de testes do laboratório a testes do catálogo. Consulte **Associar códigos de teste do laboratório** no guia Catálogo de exames da aplicação. O sistema é um URN, tal como aparece na coluna System do separador Observados. Para dados DISA é `urn:openldr:disa`:

### 15. Usar o catálogo com os seus códigos

```sh
{{operator:cli-pt-15}}
```

![Usar o catálogo com os seus códigos.](guide:operator-cli-pt-15)

- `map list` lista os códigos de testes do laboratório no armazém, com o mapeamento para o catálogo. `--status` aceita `unmapped`, `mapped`, `ambiguous` ou `all`. `--search`, `--limit` (1 a 200, 25 por omissão) e `--offset` filtram e paginam a lista.
- `map set <system> <code> <catalog-code>` associa um código a um teste do catálogo.
- `map clear <system> <code>` remove um mapeamento. Recusa correr sem `--force`.
- `map export` escreve em CSV todos os códigos observados e o seu mapeamento, no formato que `map import` lê. `--out` indica um ficheiro. Sem ele, o CSV vai para a saída padrão.
- `map import <file>` mostra o que mudaria e não escreve nada. `--apply --force` escreve. Recusa correr sem as duas opções.
- `map rebuild` mostra o que a cópia do armazém `test_map` iria conter. `--apply` escreve-a.

Os códigos de resultado usam os mesmos comandos com `--level result`. O destino é um código de campo de resultado:

### 16. Usar o catálogo com os seus códigos

```sh
{{operator:cli-pt-16}}
```

![Usar o catálogo com os seus códigos.](guide:operator-cli-pt-16)

- `--level result` em `map list`, `set`, `clear`, `export` e `import` trabalha sobre os códigos de resultado. O CSV de resultados tem as colunas `system, code, description, results, parameter_code, loinc`.
- `map match <system>` lista todos os códigos de resultado sem mapeamento desse sistema de laboratório que sejam iguais a um código de campo de resultado. `--apply --force` associa-os. Recusa `--apply` sem `--force`.

Ligar campos de resultado ao LOINC:

### 17. Usar o catálogo com os seus códigos

```sh
{{operator:cli-pt-17}}
```

![Usar o catálogo com os seus códigos.](guide:operator-cli-pt-17)

- `result-fields list` lista os campos com a sua função, unidades e ligação LOINC. `--loinc` aceita `linked`, `none` ou `all`, e `--role` aceita `result`, `specimen`, `metadata` ou `admin`.
- `result-fields unlink` recusa correr sem `--force`. `result-fields import` só pré-visualiza, a menos que receba `--apply --force`. Um laboratório que recebe o dicionário do servidor central não pode alterar as ligações.
- `openldr terminology import parameters <file>` reconstrói `test_map` depois de carregar o dicionário.

Cada alteração fica no registo de auditoria com a conta com sessão iniciada.

## Instalar um pacote de conteúdo

### 18. Pré-visualizar um pacote aprovado antes de instalar

```sh
{{operator:cli-pt-18}}
```

![Pré-visualizar um pacote aprovado antes de instalar.](guide:operator-cli-pt-18)

`--dry-run` executa as verificações e mostra os passos. Para cada passo de associação de ligações, mostra quantos códigos ligaria. Para cada passo de mapeamentos de testes ou de resultados, lista os mapeamentos que criaria, manteria e ignoraria. Não escreve nada. Um pacote de conteúdo tem de estar assinado por um editor. Instalar um pacote que já está instalado exige `--force`. Um pacote cuja última instalação falhou volta a instalar-se sem essa opção. `openldr market update` aceita as mesmas opções. Instala uma versão mais recente de um pacote instalado sem `--force`. Recusa a mesma versão ou uma mais antiga, e um pacote que não está instalado, a menos que use `--force`. `--json` mostra uma saída legível por máquinas. `openldr market list` mostra os pacotes com o seu estado. O registo de auditoria nomeia a conta com sessão iniciada.

## Preferências pessoais

O guia **As suas preferências** do Studio encontra-se em **Preferências pessoais**. Mostra as escolhas de idioma, tema, página inicial e barra lateral, com uma captura para cada passo. As preferências ficam guardadas na conta de cada utilizador. Uma página inicial pessoal tem prioridade sobre a página da disposição. O painel é a última opção predefinida.

Para operadores, `user preferences show <user-id>` lê os valores guardados e `user preferences set <user-id> startPage none` limpa a escolha pessoal da página inicial. Use a forma do comando instalado ou de desenvolvimento descrita acima. Limpar a escolha permite voltar a usar a página inicial da disposição, quando está configurada.
