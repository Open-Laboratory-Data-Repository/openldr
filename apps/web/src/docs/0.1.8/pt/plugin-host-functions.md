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
| `patients.get` | `ref` |
| `patients.register` | `patient`, um Patient FHIR com um `id` |
| `valueset.expand` | `url`, `count`, `offset`, `filter` |
| `valueset.lookup` | `system`, `code` |
| `testCatalog.list` | os filtros de lista do catálogo de testes |
| `testCatalog.get` | `code` |
| `facilities.search` | `q`, `limit`, `offset` |

Cada operação segue as mesmas regras da página do studio que mostra os mesmos registos. As operações de pacientes precisam que quem chama tenha `patients.view` ou `patients.find`. Só com `patients.find`, uma pesquisa tem de dar um identificador exato, ou um nome com a data de nascimento completa. Veja [Permissões dos plugins](/docs/plugin-permissions). Os identificadores só aparecem a quem tem `patients.view_identifiers`. Quem tem um limite só encontra pacientes e unidades dentro do seu limite. `patients.register` também precisa de `Patient` na lista `emit-fhir` do plugin.

## fhir_emit

Envia registos FHIR prontos para o CE. O pedido é `{ "resources": [ ... ] }`.

O CE verifica cada registo antes de guardar algum. Se um registo tiver um tipo que não está na lista `emit-fhir` do plugin, nada é guardado. O CE aplica a sua própria validação, como numa importação. Um plugin só pode mudar um registo que ele próprio escreveu. Cada envio fica no registo de auditoria com o identificador e a versão do plugin, e o registo guarda `plugin:<id>` como origem.

Quem está limitado a algumas unidades não pode enviar registos. Um Bundle, ou um registo com registos `contained`, é recusado.

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
