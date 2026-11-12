# Interface de linha de comandos (CLI)

O OpenLDR inclui uma interface de linha de comandos (CLI) para o operador, `openldr`, para
tarefas de base de dados, terminologia, ingestão, plugins,
relatórios, utilizadores e Marketplace: tudo o que pode fazer na aplicação, e ainda
operações de nível mais baixo.

## Executar a CLI

**Numa pilha instalada**, o instalador coloca um script `openldr` no diretório de
instalação. Execute-o a partir daí:

```
./openldr <command>
./openldr --help           # list every command group
./openldr db --help        # drill into a group
```

No Windows, use `.\openldr.ps1`.

O script executa a CLI dentro do contentor `api`. Isso tem uma consequência importante:
**os comandos que leem ou escrevem ficheiros só veem o diretório `data`.** Coloque um
ficheiro em `./data`, ao lado do script, e indique-o com o prefixo `data/`:

```
./openldr ingest data/bundle.json
./openldr sync export --out data/export.ndjson
```

Um caminho fora de `data/` não é encontrado. Um caminho `--out` fora dele falha agora,
normalmente, com um erro de permissão, em vez de escrever dentro do contentor e
desaparecer no reinício.

O script corre como o utilizador que o invoca, por isso esse utilizador tem de poder
escrever em `./data`. Se a instalação correu com `sudo`, `./data` fica a pertencer ao root,
e um `./openldr sync export --out data/x.ndjson` posterior sem root falha com `EACCES`.
Resolva mudando o dono do diretório para o utilizador que invoca o script, ou executando o
script como o utilizador que é dono do diretório.

Um operador sem acesso ao grupo `docker` tem de executar `sudo ./openldr`, o que faz o
processo do contentor correr como root. O root pode escrever em qualquer sítio do
contentor, por isso um `--out` sem prefixo escreve sem aviso e perde-se no reinício. É
exatamente a falha que a regra `data/` existe para evitar. Ponha sempre o prefixo `data/`
nos caminhos de saída.

**A partir de uma cópia do código-fonte**, execute-a através do workspace:

```
pnpm openldr <command>
```

A maioria dos comandos de leitura aceita `--json` para uma saída legível por máquinas. Numa
pilha instalada, os passos comuns do ciclo de vida (migração do esquema e criação dos dados
iniciais) correm automaticamente no arranque, e as ações de administração e da zona de
perigo também estão disponíveis no Studio, em Definições.

### Escolher a pasta real da instalação

Execute a CLI instalada no computador que aloja o OpenLDR. À distância, use o acesso SSH ou o terminal remoto que configurou. Abrir o Studio pelo Tailscale não abre um terminal nesse computador.

Se descarregou e instalou o OpenLDR em `~/Downloads/openldr_ce` no Linux ou macOS:

```sh
cd ~/Downloads/openldr_ce
ls
./openldr --help
./openldr ingest --help
```

Se o instalou em `C:\openldr_ce` no Windows, abra o PowerShell e execute:

```powershell
cd C:\openldr_ce
Get-ChildItem -Name
.\openldr.ps1 --help
.\openldr.ps1 ingest --help
```

Substitua a pasta de exemplo pela sua pasta real. Contém `docker-compose.yml`, `data` e o iniciador. Execute um comando de cada vez. Os comandos de ajuda não alteram registos. O guia **Comece aqui** da aplicação ilustra cada passo com imagens do terminal e do gestor de ficheiros.

### Usar uma cópia do código-fonte

Use a raiz do repositório, com `package.json`, `pnpm-workspace.yaml`, `apps` e `packages`. Os mesmos caminhos de exemplo aplicam-se ao código-fonte. Em Linux ou macOS:

```sh
cd ~/Downloads/openldr_ce
pnpm openldr --help
pnpm openldr ingest --help
```

Em Windows, use `cd C:\openldr_ce`, depois os mesmos comandos `pnpm openldr`. Configure primeiro as dependências e `.env`, como descrito em [Desenvolvimento](/docs/development).

A CLI de código-fonte executa no computador e usa as bases e o armazenamento de `.env`. Esses serviços devem estar iniciados para importar. Não exige os servidores de desenvolvimento do Studio ou da API. Lê ficheiros locais fora da pasta partilhada `data`. Para o seu ficheiro JSON FHIR válido em `files/my-file.json`:

```sh
pnpm openldr fhir validate files/my-file.json
```

A validação não importa o ficheiro. Para o escrever na base de desenvolvimento, verifique `.env`, depois execute:

```sh
pnpm openldr ingest files/my-file.json
pnpm openldr pipeline status
```

O teste Linux importou um recurso Organization e indicou um lote concluído. O seu identificador e a contagem dependem do ficheiro.

## Recuperar de um erro da CLI instalada

Estes casos foram reproduzidos em Linux com o iniciador instalado e a CLI real numa instalação isolada. Windows e macOS não foram testados nativamente. Comece na pasta da instalação e identifique o erro.

| Erro | Recuperação verificada no teste |
| --- | --- |
| `./openldr: not found` ou `no configuration file provided: not found` | Regresse à pasta real da instalação e execute `./openldr --help`. Confirme a presença do iniciador e do ficheiro Compose. |
| `failed to connect to the docker API` com um endereço `DOCKER_HOST` incorreto | Execute `docker info`. Se esse valor forçado estiver errado, retire-o com `unset DOCKER_HOST`, depois repita `docker info` e a ajuda CLI. Em PowerShell: `$env:DOCKER_HOST = $null`. Isto não inicia o Docker. |
| `service "api" is not running` | Verifique `docker compose ps -a api`, execute `docker compose up -d api` e repita a ajuda. O teste prova a recuperação do iniciador, não o arranque HTTP completo da aplicação. |
| `ingest failed: ENOENT` com o ficheiro ao lado do iniciador | Mova o ficheiro para a pasta `data` da instalação. Execute `./openldr fhir validate data/my-file.json`, depois importe esse caminho se quiser. A CLI de desenvolvimento lê caminhos locais normais. |

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
evento de auditoria com o tipo de ator **`cli`** e um nome de ator procurado **dentro do
contentor**, não o nome de utilizador do próprio operador. Numa instalação Docker, esse
nome segue o uid do anfitrião que executa o script: o uid 1000 corresponde a `node`, e a
maioria dos outros uids não tem nenhum nome de utilizador no contentor, por isso fica
registado o valor de recurso `cli`. Use a opção global `--actor <name>` para registar o
nome real do operador. Estes eventos aparecem na página Auditoria, ao lado das ações feitas
na interface.

## Tarefas comuns

Atualizar uma base de dados depois de obter novas migrações (não destrutivo, mantém os
dados):

```
./openldr db migrate
```

Repor e preencher uma base de dados de desenvolvimento (`db reset` **elimina e recria** o
esquema):

```
./openldr db reset
./openldr db seed
```

`db seed` recusa correr quando há migrações pendentes e indica o que falta. Execute
primeiro `db migrate`.

Reconstruir o modelo de leitura do armazém a partir do armazém FHIR canónico
(`db reproject` **reescreve todas as linhas projetadas**, por isso recusa correr sem
`--force`):

```
./openldr db reproject --force
```

Mostra duas contagens separadas: os recursos canónicos que reescreveu e as chegadas que
registou no registo de ingestão (uma por versão de um recurso clínico). São unidades
diferentes, não o mesmo número. Tal como `db seed`, recusa correr quando há migrações
pendentes, em vez de ir até ao fim sobre um esquema atrasado. Use-o para preencher dados
depois de uma atualização acrescentar uma tabela ao armazém.

`terminology reproject` está **obsoleto**. Sempre chamou a mesma reconstrução completa do
modelo de leitura, nunca uma só da terminologia. Continua a funcionar como alias, mostra
agora um aviso de obsolescência e herda a proteção `--force`. Use antes `db reproject`.

Instalar e executar um plugin de ingestão, e depois carregar um ficheiro com ele:

```
./openldr plugin install data/plugin.wasm
./openldr ingest data/results.sqlite --plugin whonet-sqlite
```

Criar um utilizador local e atribuir funções:

```
./openldr user create --username alice --name "Alice" --email alice@example.org --role lab_technician
./openldr user set-role <id> lab_admin
```

Ligar ou desligar um indicador de funcionalidade:

```
./openldr settings flags list
./openldr settings flags set dashboard.raw_sql true
```

Executar um relatório:

```
./openldr report list
./openldr report run <id>

# PDF in the design's own text, then in French
./openldr report run <id> --format pdf --out report.pdf
./openldr report run <id> --format pdf --lang fr --out rapport.pdf
```

`--lang` imprime as traduções guardadas no desenho, incluindo as datas. Os relatórios
incluídos trazem francês e português, por isso isto funciona com eles sem configuração. O
texto sem tradução para essa língua sai como foi escrito, e os dados nunca são traduzidos.

Inscrever um laboratório no servidor central e depois ligar o laboratório a ele:

```
# On central: mint the lab's client + secret (printed once)
./openldr sync enroll lab-site-01 --central-url https://central.example.org

# On the lab: apply the credentials, then check status
./openldr settings sync set clientId sync-lab-site-01
./openldr settings sync set mode bidirectional
./openldr settings sync set enabled true
./openldr sync status
```

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

Na CLI, use `openldr user deactivate <local-id>` ou `openldr user activate <local-id>`. Encontre o ID local com `openldr users list`. As contas ligadas atualizam os dois sistemas através do seu identificador no fornecedor. As contas criadas só no armazenamento local mudam apenas localmente. Os registos de auditoria de estado feitos pela CLI identificam o ator como `cli`.

Se outra mudança de estado estiver em curso para esta conta, a API devolve `409`. Espere que essa ação termine e depois tente de novo. Isto também se aplica quando o Studio e a CLI alteram a mesma conta.

## Paginação do diretório de utilizadores

Utilizadores começa com as contas ativas. A pesquisa procura nomes de utilizador do fornecedor, nomes e endereços de email em todo o diretório. Selecione Todos os estados para incluir as contas desativadas. Mudar a pesquisa, o estado ou o tamanho da página volta à primeira página.

Use Próximo para chegar às contas além das primeiras 100. Cada pedido devolve no máximo 100 contas. O rodapé mostra o intervalo visível sem indicar um total. As colunas continuam configuráveis. Não há filtros arbitrários por coluna nem ordenação, porque o fornecedor não os suporta. O fornecedor controla a ordem. Contas acrescentadas ou removidas entre pedidos podem deslocar as páginas.

Para acesso sem interface gráfica, execute:

```sh
openldr user directory-list --offset 100 --limit 25 --search Ada --enabled true --json
```

O JSON contém `rows`, `offset`, `limit`, `total: null` e `hasMore`. Some `limit` a `offset` enquanto `hasMore` for verdadeiro. Omita `--enabled` para incluir os dois estados. `openldr user list` continua a listar as contas locais.

Quando a administração do fornecedor não está configurada, a listagem do diretório usa as contas locais. A pesquisa local procura o nome de utilizador, o nome de apresentação e o email como partes do texto. Os resultados locais ficam ordenados por nome de utilizador e ID. A pesquisa no fornecedor segue as regras de pesquisa do fornecedor de identidade.

## Catálogo de exames

O catálogo de exames é a lista nacional de testes. É um sistema de códigos na página Terminologia, **Catálogo de exames**. As suas categorias são um segundo sistema de códigos, **Test categories**, que começa com cinco: Chemistry, Haematology, Microbiology, Serology e Molecular. Edite as categorias na página Terminologia.

O servidor central mantém o catálogo. Um laboratório recebe-o através da sincronização de terminologia e não pode alterar os seus testes. Cada laboratório regista as suas próprias definições para um teste: se o executa, uma lista de amostras mais curta e um nome local. A sincronização nunca envia essas definições.

Listar o catálogo a partir da linha de comandos:

```sh
openldr test-catalog list --search viral --category MOL --loinc linked --enabled on --json
```

Os testes retirados ficam ocultos, a menos que use `--status retired` ou `--status all`. `--loinc none` lista os testes sem código LOINC. `--limit` é 25 por omissão e 200 no máximo. Pagine com `--offset`. O JSON contém `rows`, `total` e `ownedHere`. `ownedHere` é falso quando esta instalação recebeu o catálogo do servidor central.

Ligar ou desligar um teste neste laboratório, ou retirá-lo e repô-lo, pelo código:

```sh
openldr test-catalog enable HIVVL
openldr test-catalog retire HIVVL --json
```

`enable` e `disable` funcionam em qualquer instalação. `retire` e `restore` só funcionam onde esta instalação é dona do catálogo. Retirar é reversível, por isso nenhum destes comandos aceita `--force`. Cada um fica no registo de auditoria como o utilizador da CLI.

Importar uma lista de testes de um ficheiro CSV ou Excel (.xlsx):

```sh
openldr test-catalog import national-tests.xlsx
openldr test-catalog import national-tests.xlsx --value-map answers.json --apply
```

Sem `--apply`, nada é escrito. O comando mostra o número de linhas novas, alteradas, sem alteração e recusadas, cada recusa com o número da linha, e qualquer texto de categoria ou de amostra que não correspondeu a nada. As colunas são associadas pelo cabeçalho. Para as indicar à mão, use `--column-map` com um ficheiro JSON como `{"code": "Test code", "name": "Test name"}`. Responda ao texto sem correspondência com `--value-map`:

```json
{
  "categories": [{ "text": "Virology", "kind": "new", "code": "VIRO", "display": "Virology" }],
  "specimens": [{ "text": "Plasma", "system": "urn:openldr:cs:local", "code": "BLD" }]
}
```

Uma resposta de categoria é `"kind": "existing"` com um `code`, ou `"kind": "new"` com um `code` e um `display`. Só uma instalação que seja dona do catálogo pode importar. Uma aplicação fica no registo de auditoria como o utilizador da CLI. Exporte os testes ativos em CSV, para a saída padrão ou para um ficheiro:

```sh
openldr test-catalog export --out catalog.csv
```

Associar códigos de testes do laboratório a testes do catálogo. Consulte **Associar códigos de teste do laboratório** no guia Catálogo de exames da aplicação. O sistema é um URN, tal como aparece na coluna System do separador Observados. Para dados DISA é `urn:openldr:disa`:

```sh
openldr test-catalog map list --status unmapped --json
openldr test-catalog map set urn:openldr:disa POCVR HIVVL
openldr test-catalog map clear urn:openldr:disa POCVR --force
openldr test-catalog map export --out mappings.csv
openldr test-catalog map import mappings.csv
openldr test-catalog map import mappings.csv --apply --force
openldr test-catalog map rebuild --apply
```

- `map list` lista os códigos de testes do laboratório no armazém, com o mapeamento para o catálogo. `--status` aceita `unmapped`, `mapped`, `ambiguous` ou `all`. `--search`, `--limit` (1 a 200, 25 por omissão) e `--offset` filtram e paginam a lista.
- `map set <system> <code> <catalog-code>` associa um código a um teste do catálogo.
- `map clear <system> <code>` remove um mapeamento. Recusa correr sem `--force`.
- `map export` escreve em CSV todos os códigos observados e o seu mapeamento, no formato que `map import` lê. `--out` indica um ficheiro. Sem ele, o CSV vai para a saída padrão.
- `map import <file>` mostra o que mudaria e não escreve nada. `--apply --force` escreve. Recusa correr sem as duas opções.
- `map rebuild` mostra o que a cópia do armazém `test_map` iria conter. `--apply` escreve-a.

Os códigos de resultado usam os mesmos comandos com `--level result`. O destino é um código de campo de resultado:

```sh
openldr test-catalog map list --level result --status unmapped
openldr test-catalog map set urn:openldr:disa HIVVC HIVVL --level result
openldr test-catalog map match urn:openldr:disa
openldr test-catalog map match urn:openldr:disa --apply --force
```

- `--level result` em `map list`, `set`, `clear`, `export` e `import` trabalha sobre os códigos de resultado. O CSV de resultados tem as colunas `system, code, description, results, parameter_code, loinc`.
- `map match <system>` lista todos os códigos de resultado sem mapeamento desse sistema de laboratório que sejam iguais a um código de campo de resultado. `--apply --force` associa-os. Recusa `--apply` sem `--force`.

Ligar campos de resultado ao LOINC:

```sh
openldr test-catalog result-fields list --loinc none
openldr test-catalog result-fields link HIVVL 20447-9
openldr test-catalog result-fields unlink HIVVL --force
openldr test-catalog result-fields export --out result-fields.csv
openldr test-catalog result-fields import result-fields.csv --apply --force
```

- `result-fields list` lista os campos com a sua função, unidades e ligação LOINC. `--loinc` aceita `linked`, `none` ou `all`, e `--role` aceita `result`, `specimen`, `metadata` ou `admin`.
- `result-fields unlink` recusa correr sem `--force`. `result-fields import` só pré-visualiza, a menos que receba `--apply --force`. Um laboratório que recebe o dicionário do servidor central não pode alterar as ligações.
- `openldr terminology import parameters <file>` reconstrói `test_map` depois de carregar o dicionário.

Cada alteração fica no registo de auditoria como o utilizador da CLI.

## Instalar um pacote de conteúdo

```sh
openldr market install <bundle-dir> --dry-run
openldr market install <bundle-dir>
```

`--dry-run` executa as verificações e mostra os passos. Para cada passo de associação de ligações, mostra quantos códigos ligaria. Para cada passo de mapeamentos de testes ou de resultados, lista os mapeamentos que criaria, manteria e ignoraria. Não escreve nada. Um pacote de conteúdo tem de estar assinado por um editor. Instalar um pacote que já está instalado exige `--force`. Um pacote cuja última instalação falhou volta a instalar-se sem essa opção. `openldr market update` aceita as mesmas opções. Instala uma versão mais recente de um pacote instalado sem `--force`. Recusa a mesma versão ou uma mais antiga, e um pacote que não está instalado, a menos que use `--force`. `--json` mostra uma saída legível por máquinas. `openldr market list` mostra os pacotes com o seu estado. A CLI regista o ator como `cli`.

## Preferências pessoais

O guia **As suas preferências** do Studio encontra-se em **Preferências pessoais**. Mostra as escolhas de idioma, tema, página inicial e barra lateral, com uma captura para cada passo. As preferências ficam guardadas na conta de cada utilizador. Uma página inicial pessoal tem prioridade sobre a página da disposição. O painel é a última opção predefinida.

Para operadores, `user preferences show <user-id>` lê os valores guardados e `user preferences set <user-id> startPage none` limpa a escolha pessoal da página inicial. Use a forma do comando instalado ou de desenvolvimento descrita acima. Limpar a escolha permite voltar a usar a página inicial da disposição, quando está configurada.
