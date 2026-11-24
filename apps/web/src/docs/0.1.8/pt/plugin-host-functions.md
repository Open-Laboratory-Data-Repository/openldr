# Tabelas e funções do anfitrião para plugins

O código de servidor de um plugin pode guardar os seus próprios registos, ler alguns registos do CE e enviar registos FHIR para o CE. Faz isto através de quatro funções do anfitrião: `db_select`, `db_write`, `ce_read` e `fhir_emit`. Um plugin nunca envia SQL. Envia um pedido JSON, e o CE verifica-o antes de construir a instrução.

Esta página é para quem escreve o plugin. O administrador vê as capacidades no ecrã de instalação e aprova-as aí. As permissões de que uma pessoa precisa para executar cada ação estão em [Permissões dos plugins](/docs/plugin-permissions).

## Capacidades

Cada função do anfitrião só existe quando o manifesto do plugin pede a sua capacidade. Um plugin sem a capacidade não recebe a função.

| Função do anfitrião | Capacidade necessária |
|---|---|
| `db_select`, `db_write` | `host:db` |
| `ce_read` | `host:ce-read` |
| `fhir_emit` | `emit-fhir` e `host:db` |

A capacidade `emit-fhir` lista os tipos de registo que o plugin pode enviar, por exemplo `{ "kind": "emit-fhir", "resourceTypes": ["Observation"] }`.

Um módulo wasm que importa uma função do anfitrião não carrega onde o CE não a fornece. Por isso, importe só as funções que as suas capacidades dão.

As funções do anfitrião só correm numa thread de trabalho (worker). Um servidor iniciado com um carregador como `tsx` não consegue iniciar uma. Aí a chamada falha com uma mensagem que o diz, e o plugin não corre sem as suas funções.

Cada chamada precisa de uma pessoa com sessão iniciada. O CE passa essa pessoa às funções do anfitrião a partir da sua própria sessão. O plugin não a pode escolher nem mudar.

## Tabelas declaradas

Um plugin lista as suas tabelas em `payload.tables` no seu manifesto assinado. As tabelas precisam de `host:db`. O CE cria-as na instalação, num esquema só do plugin, `plugin_<id>`. Um plugin não chega a nenhuma outra tabela.

```json
{
  "name": "samples",
  "columns": [
    { "name": "id", "type": "integer" },
    { "name": "facility", "type": "uuid" },
    { "name": "code", "type": "text" },
    { "name": "note", "type": "text", "nullable": true }
  ],
  "primaryKey": ["id"],
  "indexes": [{ "columns": ["facility", "code"] }],
  "facilityColumn": "facility"
}
```

- Um nome de tabela ou de coluna segue `^[a-z][a-z0-9_]{0,62}$`.
- Um tipo de coluna é um de `text`, `integer`, `bigint`, `numeric`, `boolean`, `timestamptz`, `date`, `jsonb` ou `uuid`.
- Uma coluna pode ficar vazia, a menos que indique `"nullable": false`. As colunas da chave primária e da unidade sanitária nunca ficam vazias.
- Uma coluna pode ter um `default`: um texto, um número, true, false ou null.
- O CE acrescenta `created_at` e `updated_at` a cada tabela e mantém-nas atualizadas. Um plugin pode lê-las, mas não declará-las nem escrevê-las.
- Um plugin pode declarar até 50 tabelas, 100 colunas por tabela e 20 índices por tabela.

### Tabelas de unidade sanitária

Uma tabela com uma `facilityColumn` guarda linhas que pertencem cada uma a uma unidade sanitária. A coluna é `text` ou `uuid` e guarda o identificador da unidade.

O CE acrescenta as unidades de quem chama a cada leitura, atualização e eliminação nessa tabela. Uma pessoa limitada a algumas unidades vê só as linhas delas, mesmo sem filtro no pedido. Uma inserção ou atualização que indique outra unidade é recusada. O CE também ativa a segurança ao nível das linhas na tabela, como segunda proteção.

### Atualizações

Uma nova versão só pode acrescentar às suas tabelas. Pode acrescentar tabelas, colunas que podem ficar vazias e índices.

O CE recusa uma versão que elimine ou mude o nome de uma coluna, mude um tipo, mude se uma coluna pode ficar vazia, mude um valor por omissão, a chave primária ou a coluna da unidade, ou elimine uma tabela ou um índice. A recusa indica a tabela e a coluna. A versão instalada antes continua ativa.

Uma versão que não declara tabelas mantém as tabelas e as linhas da versão anterior. Desativar um plugin, voltar a uma versão anterior ou remover uma versão antiga também as mantém. Só remover o plugin e escolher não guardar nada elimina o esquema e as suas linhas.

Depois de voltar a uma versão anterior, essa versão continua a ler e escrever as suas tabelas. Lê e escreve só as colunas que declara. Uma coluna acrescentada por uma versão mais recente fica na tabela. As linhas que a versão anterior acrescenta deixam-na vazia, ou dão-lhe o seu valor por omissão quando a coluna tem um.

## db_select

Lê linhas de uma tabela declarada.

```json
{
  "table": "samples",
  "columns": ["id", "code"],
  "where": [
    { "column": "code", "op": "prefix", "value": "a" },
    { "column": "id", "op": "in", "values": [1, 2, 3] }
  ],
  "orderBy": [{ "column": "id", "direction": "desc" }],
  "limit": 100,
  "offset": 0,
  "count": true
}
```

Os filtros são `eq`, `lt`, `lte`, `gt`, `gte`, `in` (até 1000 valores), `is_null` (com `"value": true` ou `false`) e `prefix` (só colunas de texto). Todos os filtros têm de se cumprir. `limit` é 100 se o omitir, e no máximo 1000. A resposta é `{ "rows": [...] }`, com `count` quando o pede. A contagem ignora `limit` e `offset`.

## db_write

Insere, atualiza e elimina numa só transação. Se um passo falhar, nenhum fica guardado.

```json
{
  "steps": [
    { "op": "insert", "table": "samples", "values": { "id": 4, "facility": "aaaaaaaa-1111-4111-8111-111111111111", "code": "a4" } },
    { "op": "update", "table": "samples", "key": { "id": 4 }, "set": { "note": "checked" } },
    { "op": "delete", "table": "samples", "key": { "id": 2 } }
  ]
}
```

Uma `key` indica exatamente as colunas da chave primária. Um pedido tem até 500 passos. Uma inserção numa tabela de unidade sanitária tem de indicar a coluna da unidade. A resposta é `{ "results": [{ "rowCount": 1 }, ...] }`, uma por passo. Um passo sobre uma linha fora das unidades de quem chama não muda nada e dá `rowCount` 0.

`db_select` e `db_write` param cada um ao fim de 5 segundos.

## ce_read

Lê os registos do próprio CE através de uma operação. O pedido é `{ "op": "<op>", "input": { ... } }`.

| Operação | Entrada |
|---|---|
| `patients.search` | `search`, ou `identifier`, ou `given`, `family` e `birthDate`; depois `status`, `limit`, `offset` |
| `patients.get` | `ref` ou `pluginRef`, um dos dois |
| `patients.getMany` | `pluginRefs`, uma lista de 1 a 100 |
| `patients.register` | `patient`, um Patient FHIR com um `id` |
| `valueset.expand` | `url`, `count`, `offset`, `filter` |
| `valueset.lookup` | `system`, `code` |
| `testCatalog.list` | os filtros de lista do catálogo de testes |
| `testCatalog.get` | `code` |
| `testCatalog.resultParams` | `tests`, uma lista de 1 a 20 `{ system, code }`, e `patientRef`, um `pluginRef` |
| `facilities.search` | `q`, `limit`, `offset` |
| `facilities.get` | `id`. Dá uma unidade na forma de uma linha de `facilities.search` |
| `caller.get` | nenhuma. Dá `userId`, `displayName` e `facilities` (`*` ou a lista de identificadores de unidade) de quem chama. `displayName` pode ser null |

Cada operação segue as mesmas regras da página do studio que mostra os mesmos registos. As operações de pacientes precisam que quem chama tenha `patients.view` ou `patients.find`. Só com `patients.find`, uma pesquisa tem de dar um identificador exato, ou um nome com a data de nascimento completa. Veja [Permissões dos plugins](/docs/plugin-permissions). Os identificadores só aparecem a quem tem `patients.view_identifiers`. Quem tem um limite só encontra pacientes e unidades dentro do seu limite. `patients.register` também precisa de `Patient` na lista `emit-fhir` do plugin. `facilities.get` responde `NOT_FOUND` para uma unidade fora do limite de quem chama, tal como para uma que não existe.

### Guardar uma ligação a um paciente

O `ref` de um paciente só funciona até o CE reiniciar. Uma linha mascarada também não tem `id`. Por isso não guarde nenhum dos dois.

Guarde antes o `pluginRef`. Cada linha de `patients.search`, a resposta de `patients.get` e a de `patients.register` trazem um. Fica igual para o mesmo paciente em cada chamada e depois de reiniciar. Esconde o identificador do paciente. É feito só para o seu plugin: outro plugin recebe um `pluginRef` diferente para o mesmo paciente e não pode usar o seu.

Para abrir o paciente mais tarde, chame `patients.get` com `{ "pluginRef": "..." }`. Aplicam-se as mesmas regras que com `ref`. Um paciente fora do limite de quem chama, ou um `pluginRef` feito para outro plugin, dá `NOT_FOUND`.

Para abrir vários pacientes de uma vez, como pede uma lista de pedidos, chame `patients.getMany` com `{ "pluginRefs": ["...", "..."] }`. A resposta é `{ "rows": [...] }`, pela mesma ordem. Cada linha é o que `patients.get` daria, ou `null` onde `patients.get` daria `NOT_FOUND`. Uma leitura sem máscara escreve uma só linha de auditoria para toda a chamada, com o número.

A linha de um paciente fundido também tem `replacedByPluginRef`, o `pluginRef` do registo que o substituiu. É null para um paciente que não foi fundido. Siga-o para que a ligação guardada aponte para o registo que ficou.

Um `pluginRef` pertence ao identificador do plugin, não a uma instalação. Se remover um plugin e mais tarde instalar outro com o mesmo identificador, este pode abrir as refs que o anterior guardou. Uma reposição de fábrica mantém as ligações a funcionar.

`testCatalog.get` e `testCatalog.list` respondem a cada teste com `code` e `testCode`. `code` é o identificador fixo do teste. Nunca muda: guarde-o e devolva-o ao CE. `testCode` é o código de teste nacional. Pode mudar, e um teste guardado antes desta mudança tem o mesmo valor que o seu `code`. Mostre `testCode` às pessoas.

### Parâmetros de resultado para um paciente

`testCatalog.resultParams` dá os parâmetros de resultado de cada teste, com o intervalo de referência que serve a um paciente. Envie `{ "tests": [{ "system": "...", "code": "..." }], "patientRef": "p1...." }`. Precisa de `patients.view` ou `patients.find`, como as operações de paciente. Um paciente fora do limite de quem chama dá `NOT_FOUND`.

A resposta é `{ "tests": [...], "sexes": [...] }`. Cada teste lista os seus `params`. Cada parâmetro tem a sua `unit`, o seu `display`, as suas `bands`, a `band` que serve ao paciente ou null, e `fits`, que vale `yes`, `no` ou `unknown` para cada intervalo, pela ordem. Um intervalo tem um `name` quando o laboratório lhe deu um. `sexes` dá cada código de sexo com o seu rótulo em en, fr e pt. O CE lê o sexo e a idade do paciente para escolher o intervalo. A resposta não os inclui.

## fhir_emit

Envia registos FHIR prontos para o CE. O pedido é `{ "resources": [ ... ] }`.

O CE verifica cada registo antes de guardar algum. Se um registo tiver um tipo que não está na lista `emit-fhir` do plugin, nada é guardado. O CE aplica a sua própria validação, como numa importação. Um plugin só pode mudar um registo que ele próprio escreveu. Cada envio fica no registo de auditoria com o identificador e a versão do plugin, e o registo guarda `plugin:<id>` como origem.

Quem está limitado a algumas unidades não pode enviar registos. Um Bundle, ou um registo com registos `contained`, é recusado.

Uma referência escrita `Patient/` seguida de um `pluginRef` é trocada pelo identificador real do paciente antes de o CE verificar ou guardar alguma coisa. Isto vale para qualquer referência no registo, como `subject` ou o `target` de uma Provenance. Se um destes `pluginRef` não abrir para o seu plugin, nada é guardado e a resposta é `NOT_FOUND`. Uma referência a `Patient/<id>` fica como a escreveu. Um envio com uma ligação `pluginRef` exige que quem chama tenha `patients.view` ou `patients.find`, por isso uma função que autoriza resultados precisa de **View patient index** ou **Find a patient**. Sem isso, a resposta é `FORBIDDEN`. Um envio pode ligar no máximo 200 pacientes diferentes. Uma ligação tem de ser exatamente `Patient/` seguido de um `pluginRef`. Qualquer outra escrita com `/p1.`, como `patient/p1...`, um URL completo ou um caminho a mais, dá `INVALID_REQUEST`. Em cada caso, nada é guardado.

## Respostas e erros

Cada função do anfitrião responde `{ "ok": true, "result": ... }` ou `{ "ok": false, "error": { "code": "...", "message": "..." } }`. Uma função do anfitrião não lança exceções. Leia a resposta e decida o que fazer.

O CE recusa isto antes de correr qualquer SQL:

- um nome de tabela ou de coluna com aspas ou um ponto, como `pg_catalog.pg_roles` ou `public.users`
- uma tabela ou coluna que o manifesto não declara
- um limite acima de 1000, ou mais de 1000 valores em `in`
- um valor do tipo errado para a sua coluna
- uma inserção ou atualização de `created_at` ou `updated_at`
- um campo que a forma do pedido não tem, como `pluginId` ou `facilities`

Os códigos comuns são `REQUEST_INVALID`, `REQUEST_TABLE`, `REQUEST_COLUMN`, `REQUEST_VALUE`, `REQUEST_KEY` e `REQUEST_FACILITY` para pedidos sobre tabelas. `ce_read` e `fhir_emit` usam `INVALID_REQUEST`, `UNKNOWN_OP`, `FORBIDDEN`, `NOT_FOUND`, `OUTSIDE_DATA_LIMIT`, `RESOURCE_TYPE_NOT_ALLOWED` e `VALIDATION_FAILED`. Um pedido ou resposta acima de 1 MB dá `TOO_LARGE`. Um erro dentro do CE dá `HOST_ERROR`, e os detalhes vão para o registo do CE, não para o plugin.

## A partir de Rust

A crate `openldr-plugin-sdk` tem uma função para cada função do anfitrião em `openldr_plugin_sdk::host`. Cada uma recebe um `serde_json::Value` e devolve `Result<Value, HostError>`.

```rust
use openldr_plugin_sdk::host;
use serde_json::json;

let rows = host::db_select(&json!({ "table": "samples", "limit": 10 }))?;
let facilities = host::ce_read("facilities.search", json!({ "q": "clinic" }))?;
host::fhir_emit(&[json!({ "resourceType": "Observation", "id": "obs-1", "status": "final", "code": { "text": "Test" } })])?;
```

`HostError` tem o `code` e a `message` do CE. O plugin de teste em `wasm/test-sink`, construído com a funcionalidade `host`, chama cada função.
