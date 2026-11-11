# Carregar e enviar dados

Com o OpenLDR a correr, precisa de lhe fazer chegar dados de laboratório. O OpenLDR **não
tem um endpoint genérico de ingestão FHIR**: não existe um `POST /fhir` para onde enviar
recursos. Os dados entram por um dos caminhos abaixo. A escolha depende sobretudo da forma
como instalou.

> **Onde está a CLI `openldr`?** Os dois tipos de instalação têm-na. O instalador Docker de
> uma linha escreve um script `openldr` no diretório de instalação. Execute-o lá como
> `./openldr …` (`.\openldr.ps1` no Windows). A partir de uma cópia do repositório, execute
> `pnpm openldr …`. Em qualquer dos casos, não precisa da CLI para começar: o instalador
> define `MIGRATE_ON_START=true` e `SEED_ON_START=true`, por isso a pilha faz as migrações
> e cria os dados iniciais no primeiro arranque, e o **webhook HTTP** abaixo funciona em
> qualquer instalação.
>
> Há uma diferença que importa para os argumentos de ficheiro. O script executa a CLI
> dentro do contentor `api`, que só vê o diretório `data`. Por isso, coloque os ficheiros em
> `./data` e indique-os com o prefixo `data/`. Uma cópia do código-fonte usa caminhos
> normais do anfitrião. Consulte [a página da CLI](/docs/cli).

## 1. Enviar por HTTP com um webhook de fluxo de trabalho (funciona em qualquer instalação)

O caminho HTTP de entrada é um **fluxo de trabalho** com um gatilho **Webhook**. O corpo do
pedido é entregue ao fluxo como entrada, e **o que fica guardado é o que o fluxo fizer com
ele**. Assim, controla a forma exata (uma submissão de formulário, o conteúdo de um
fornecedor, ou um Bundle FHIR que normaliza dentro do fluxo).

Uma instalação nova inclui **um** fluxo de webhook de ingestão, **Ingest** (`wf-ingest`), que
encaminha conforme a **forma** do corpo enviado. **Numa instalação nova, vem ativo**: o
registo à mão na página **Formulários** submete através dele, por isso é essencial à
instalação e não opcional. (Numa instalação **atualizada**, uma versão anterior pode tê-lo
deixado desativado. Consulte *Está a atualizar uma instalação existente?* abaixo.) O seu
endpoint HTTP continua fechado a quem não tiver o segredo próprio da instalação:

| Fluxo de trabalho | Caminho do webhook | Espera | Comportamento |
|---|---|---|---|
| **Ingest** | `ingest` | um **Bundle** FHIR de transação, uma **lista simples** de recursos FHIR, ou um objeto `{…}` simples de **respostas de formulário** | um nó **Switch** verifica a forma: Bundle/lista → **Unwrap FHIR Bundle** (um item por recurso, referências resolvidas); objeto → **Form Validate** contra o formulário "Lab order" incluído. Os dois ramos guardam os dados através do mesmo **Persist / Store** |

Para o usar:

1. Na aplicação, abra **Fluxos de trabalho** e abra **Ingest**.
2. Abra o seu gatilho **Webhook**. Um segredo guardado não pode ser lido de volta, por isso
   selecione **Substituir segredo**, copie o novo segredo e depois guarde o fluxo. O Ingest é
   um fluxo de sistema, por isso confirme com **Save anyway**. O gatilho tem um caminho de
   URL fixo (`ingest`).
3. Envie o conteúdo a partir do seu sistema externo:

```bash
curl -X POST https://your-host/api/workflows/hooks/ingest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Token: <the-webhook-secret>" \
  -d @order.json
```

**Segurança:** o segredo é enviado no cabeçalho `X-Webhook-Token` e verificado no servidor
em tempo constante. Faça sempre o POST por **HTTPS** para não expor o token, trate o
segredo como uma palavra-passe e substitua-o editando o gatilho webhook do fluxo. Um token
errado ou em falta é rejeitado com `401`. Um caminho desconhecido devolve `404`.

Também pode construir o seu próprio fluxo de webhook (**Webhook → transformar/validar →
Persist / Store**) para qualquer outra forma de conteúdo. O **Ingest** cobre apenas os
casos comuns logo à partida.

> **Está a atualizar uma instalação existente?** Os fluxos de trabalho são criados pelo id e
> nunca são substituídos. Por isso, uma atualização mantém a linha `wf-ingest` que já tem,
> incluindo as suas alterações ao grafo.
>
> - **Estado ativo.** As versões anteriores incluíam o `wf-ingest` **desativado**. Como o
>   registo à mão submete agora através dele, um `wf-ingest` desativado faria falhar todas as
>   submissões de formulários com *"capture pipeline unavailable"*. Por isso, o servidor
>   **ativa-o por si no arranque** se o encontrar desativado. É uma alteração de um único
>   indicador, que não toca no grafo de nós, no nome nem no segredo do webhook. Nada mais no
>   fluxo é recriado. Se quiser mesmo desligá-lo, tem também de deixar de usar o registo à
>   mão, porque os dois não se podem separar.
> - **As suas alterações.** Um grafo `wf-ingest` personalizado nunca é substituído por uma
>   atualização. Se precisar de voltar ao grafo original, use **Reset to default** no menu ⋯
>   do fluxo.
> - **Fluxos retirados.** Numa instalação anterior à ligação unificada, os antigos
>   `wf-ingest-form` / `wf-ingest-raw` continuam lá (desativados) e podem ser eliminados à
>   mão. O fluxo reativo companheiro que já existia continua a escutar a fonte de eventos
>   antiga.

### Enviar FHIR já construído (o conjunto de ferramentas CDR)

O ramo FHIR do fluxo **Ingest** é a porta de entrada para um sistema que já emite recursos
FHIR, sobretudo o **conjunto de ferramentas CDR**, que envia um **Bundle FHIR de
transação**. As versões atuais do conjunto de ferramentas CDR usam **por omissão** como
caminho de destino (`OPENLDR_CE_HOOK_PATH`) o webhook unificado
(`/api/workflows/hooks/ingest`), por isso não é preciso configurar o caminho. Uma **versão
mais antiga, ou uma cujo `.env` ainda fixe o caminho retirado `cdr-ingest`**, tem de definir
`OPENLDR_CE_HOOK_PATH=/api/workflows/hooks/ingest` (o caminho **completo**, não apenas
`ingest`) para o usar. O pipeline é **Webhook → Switch → Unwrap FHIR Bundle → Persist /
Store → Log**:

- O corpo do pedido é um **Bundle FHIR de transação** (ou uma lista simples de recursos
  FHIR). **Unwrap FHIR Bundle** resolve as referências internas e divide-o em **um item por
  recurso**, porque o **Persist / Store guarda um recurso FHIR por cada item de entrada**. É
  o mesmo caminho de escrita (e o mesmo **controlo de rigor da validação**) que a CLI usa.
- **Um só webhook trata testes e questionários em conjunto.** O Persist guarda todos os
  recursos, e a projeção encaminha cada um pelo `resourceType` (`Observation` →
  `lab_results`, `ServiceRequest` → `lab_requests`, `QuestionnaireResponse` →
  `questionnaire_responses`, …).

Para ligar o conjunto de ferramentas CDR a uma instalação, copie o segredo do webhook
**Ingest** e defina:

```bash
OPENLDR_CE_URL=https://your-host        # base URL of the CE deployment
OPENLDR_CE_WEBHOOK_TOKEN=<the-secret>   # the Ingest webhook secret you copied
OPENLDR_CE_TIMEZONE=+03:00              # UTC offset for DISA's unzoned timestamps (per country)
# OPENLDR_CE_HOOK_PATH=/api/workflows/hooks/ingest  # optional — this is already the default
```

`OPENLDR_CE_TIMEZONE` é **obrigatório** e não tem uma omissão segura: o DISA guarda horas
locais sem fuso horário, por isso um desvio em falta deslocaria sem aviso todas as datas e
horas clínicas. Defina-o para o país da instalação (Tanzânia `+03:00`;
Moçambique/Zâmbia `+02:00`).

> **O webhook quer um Bundle ou uma lista, mas a CLI não.** O ramo FHIR do webhook `ingest`
> aceita um **Bundle** de transação ou uma **lista** simples de recursos. A **CLI**
> `openldr ingest` abaixo é mais restrita: aceita um **Bundle** FHIR (ou um único recurso
> isolado), não uma lista. Envie cada conteúdo para o caminho que corresponde à sua forma.

Se tiver apenas um ficheiro Bundle, `openldr ingest bundle.json` (abaixo) é o caminho
pronto a usar. Aplica o mesmo conversor e o mesmo controlo de rigor sem construir um fluxo.

## 2. Carregar um ficheiro com a CLI (qualquer instalação)

`openldr ingest <file>` lê um ficheiro, converte-o e escreve os resultados no armazém FHIR.
O **conversor** decide como o ficheiro é interpretado:

```bash
# A FHIR Bundle (the default converter)
./openldr ingest data/bundle.json

# A WHONET SQLite export, via a converter plugin (install the plugin first)
./openldr ingest data/whonet.sqlite --plugin whonet-sqlite

# A CSV with a column mapping
./openldr ingest data/results.csv --plugin tabular --config data/mapping.json
```

Estas são as formas para uma pilha instalada, por isso cada ficheiro está em `./data` e
leva o prefixo `data/`. A partir de uma cópia do código-fonte, use `pnpm openldr` e
caminhos normais do anfitrião. Os plugins de conversão incluídos são ficheiros do
repositório, por isso instalar um é um comando para uma cópia do código-fonte:

```bash
pnpm openldr ingest bundle.json
pnpm openldr plugin install reference-plugins/whonet-sqlite/plugin.wasm
pnpm openldr ingest whonet.sqlite --plugin whonet-sqlite
pnpm openldr ingest results.csv --plugin tabular --config mapping.json
```

Uma execução bem-sucedida mostra `batch <id>: done (<n> resources)`. **0 resources**
significa que o conversor não reconheceu o ficheiro. Consulte ou repita um lote com os
comandos `pipeline status` e `pipeline retry <batchId>`. Conversores incluídos no OpenLDR:
`fhir-bundle` (por omissão), `whonet-sqlite`, `hl7v2` e `tabular`. Pode acrescentar outros
como plugins do Marketplace.

### Exemplos de conteúdo

**`bundle.json`**: o conversor `fhir-bundle` por omissão aceita um `Bundle` FHIR (lê cada
`entry.resource`) ou um único recurso isolado. Uma **submissão laboratorial clinicamente
completa**: um doente, o **pedido** (`ServiceRequest`) e o **resultado** (`Observation`)
ligado a esse pedido:

```json
{
  "resourceType": "Bundle",
  "type": "collection",
  "entry": [
    {
      "resource": {
        "resourceType": "Patient",
        "id": "p1",
        "identifier": [{ "system": "urn:lab:mrn", "value": "MRN-001" }],
        "gender": "female",
        "birthDate": "1990-05-01"
      }
    },
    {
      "resource": {
        "resourceType": "ServiceRequest",
        "id": "sr1",
        "status": "active",
        "intent": "order",
        "subject": { "reference": "Patient/p1" },
        "code": { "coding": [{ "system": "http://loinc.org", "code": "718-7", "display": "Hemoglobin" }] }
      }
    },
    {
      "resource": {
        "resourceType": "Observation",
        "id": "o1",
        "status": "final",
        "category": [{ "coding": [{ "system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory" }] }],
        "basedOn": [{ "reference": "ServiceRequest/sr1" }],
        "subject": { "reference": "Patient/p1" },
        "code": { "coding": [{ "system": "http://loinc.org", "code": "718-7", "display": "Hemoglobin" }] },
        "valueQuantity": { "value": 13.5, "unit": "g/dL" }
      }
    }
  ]
}
```

> Uma **lista JSON simples** de recursos *não* é um Bundle e não é guardada. Coloque os
> recursos dentro de um `Bundle`, como acima, ou envie um único objeto de recurso.

> **Rigor da validação.** Os envios pela porta de entrada são validados ao nível configurado
> (**High por omissão**, em **Definições → Zona de perigo → Validação de dados**, ou com
> `openldr settings validation`). No nível High, um **resultado laboratorial** (uma
> `Observation` com o código de `category` `laboratory`, ou um `DiagnosticReport` `LAB`)
> **tem de referir o seu pedido** através de `basedOn`. O `ServiceRequest` tem de estar no
> mesmo lote ou já estar guardado. Caso contrário, **toda a submissão é rejeitada** com um
> `422` e um `OperationOutcome` que lista o que falta. É por isso que o exemplo acima inclui
> o `ServiceRequest` e liga a `Observation` a ele. Pode reduzir o nível para `medium` (pedido
> presente mas não resolvido) ou `low` (só a estrutura) se for mesmo preciso, mas High é a
> omissão segura para dados de laboratório.

**`results.csv` + `mapping.json`**: o plugin `tabular` transforma linhas em FHIR. O seu
`--config` é um ficheiro JSON com um `output` (`fhir` ou `rows`) e um `mapping` que indica
ao plugin que colunas passam a que campos FHIR:

```
mrn,sex,dob,test,value,unit
MRN-001,female,1990-05-01,Hemoglobin,13.5,g/dL
```

As chaves exatas do `mapping` são definidas pelo plugin tabular e também se podem editar a
partir do seu nó em **Fluxos de trabalho** (o mesmo plugin suporta o nó **Tabular** dos
fluxos). Assim, pode construir e pré-visualizar um mapeamento na aplicação antes de o
guardar como `mapping.json`.

## 3. Sincronização distribuída (laboratório ↔ central, não para terceiros)

Se esta instância for um **laboratório** inscrito num servidor OpenLDR **central**, os seus
dados são replicados automaticamente para cima pelo canal de sincronização
(`POST /api/sync/push`, autenticado pelas credenciais de máquina do laboratório). Isto é
apenas replicação laboratório↔central. Um sistema de terceiros não pode enviar dados por
aqui. Consulte o guia **Sincronização distribuída** na aplicação.

## Para onde vão os dados

Os recursos carregados ficam no armazém FHIR interno e são projetados para o armazém
analítico que os relatórios e os painéis leem. Se os dados forem carregados mas não
aparecerem num relatório, confirme que o armazém de destino está configurado (consulte
[Variáveis de ambiente](/docs/environment)) e dê algum tempo à projeção para se atualizar.

### Factos e atributos dos pedidos

Cada pedido de laboratório traz, quando a origem os envia: o conjunto OBR, a hora da
análise, o ponto de cuidados, o tipo de pedido, quem o registou e quem o testou, o médico
requisitante, a idade na data do pedido, a informação clínica, o analisador, e o código e
motivo de rejeição. Cada relatório traz a sua secção e quem o autorizou.

Os factos mais raros são linhas em `lab_request_attributes`, uma linha por pedido e
atributo. Os códigos de atributo são o sistema de codificação
`urn:openldr:cs:request-attribute`. Carregue-o uma vez com:

    openldr terminology import resource packages/terminology/codesystems/openldr-request-attribute.json

Execute isto a partir de uma cópia do código-fonte do repositório OpenLDR CE, onde o
ficheiro está nesse caminho. Sem a importação, as linhas de atributos continuam a ser
guardadas. Só faltam os nomes de apresentação dos códigos.

Um facto que a origem não envia fica vazio. Nada é preenchido.

Um resultado numérico fora do intervalo de reporte do laboratório chega como o limite com
um comparador, por exemplo `< 20`. `lab_results.numeric_comparator` guarda `<`, `<=`, `>=`
ou `>`, e fica vazio para um número normal. Nesse caso, `numeric_value` guarda o limite.

Cada resultado traz o seu estado FHIR em `lab_results.status`. Um teste rejeitado no registo do resultado é guardado como uma linha com o estado `cancelled`, sem valor, e com o motivo em `data_absent_code` e `data_absent_reason`, por exemplo `HAEM` e `Haemolysed`. Para contar resultados, acrescente `(l.status is null or l.status <> 'cancelled')` à consulta. Para contar testes rejeitados, use `l.status = 'cancelled'`. Qualifique `status` com o alias de lab_results, porque lab_requests, specimens e diagnostic_reports também têm uma coluna `status`. Uma consulta antiga que junte essas tabelas e use `status` sem qualificação tem de ser corrigida. Uma instalação atualizada a partir de uma versão anterior não tem estado nas linhas que já tinha. Execute `openldr db reproject --force` uma vez depois da atualização para as preencher.

`clinical_info` está oculto por omissão no construtor de painéis, porque pode conter texto
livre ou um id de doente pseudonimizado. Mostre-o em Definições, depois Exposição de dados.
A tabela `lab_request_attributes` não está de todo no construtor de painéis. Leia-a com
consultas personalizadas.
