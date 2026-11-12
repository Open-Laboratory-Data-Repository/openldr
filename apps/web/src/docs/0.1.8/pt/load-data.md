# Carregar e enviar dados

<!-- operator-platform -->

Faça a manutenção no anfitrião OpenLDR, na pasta Compose instalada. Os exemplos usam `~/Downloads/openldr_ce` no Linux/macOS e `C:\openldr_ce` no PowerShell. Substitua estes caminhos. O terminal já mostra o prompt azul; escreva apenas o comando. As ilustrações de ficheiros mostram texto para editar no ficheiro indicado. As imagens não provam uma operação concluída. Os dados de exemplo são opcionais.

## Encontrar um workflow

Abra uma definição existente antes de a inspecionar ou alterar.

### 1. Abrir Workflows

Selecione **Workflows** no menu principal.

![Abra Workflows no menu principal.](/docs-images/operator/workflows-guide-open-page.png)

### 2. Encontrar o workflow

Use **Search workflows** para filtrar os nomes. Limpe a pesquisa para restaurar a lista.

![A pesquisa filtra os nomes dos workflows.](/docs-images/operator/workflows-guide-search.png)

### 3. Abrir a linha

Selecione o nome do workflow. Este exemplo abre o workflow fornecido **Ingest**.

![Abra o workflow fornecido Ingest.](/docs-images/operator/workflows-guide-ingest-row.png)

### 4. Ajustar o quadro

Selecione **Fit View** no canto inferior esquerdo. Use mais e menos para ampliar. Pan move o quadro. Select desenha uma caixa de seleção.

![Fit View enquadra os nós no quadro.](/docs-images/operator/workflows-guide-fit.png)

## Definir o segredo webhook de Ingest

Faça esta tarefa quando um emissor autorizado precisa de uma credencial que possa copiar. Um segredo guardado não pode ser revelado. Coordene primeiro a substituição com os emissores.

### 1. Selecionar Ingest received

Selecione o primeiro nó, **Ingest received**.

![Selecione o acionador webhook Ingest received.](/docs-images/operator/workflows-guide-trigger.png)

### 2. Abrir as definições

Selecione a roda dentada **Configure** acima do nó selecionado.

![Configure abre as definições do nó selecionado.](/docs-images/operator/workflows-guide-configure.png)

### 3. Gerar um novo segredo

Em **Secret**, selecione **Replace secret**. Um valor ainda não guardado oferece **Regenerate**.

![Replace secret gera um valor que tem de copiar antes de guardar.](/docs-images/operator/workflows-guide-replace-secret.png)

### 4. Copiar o novo valor

Copie o segredo e guarde-o com as credenciais do emissor. URL e Header mostram onde e como enviar.

![Copie o novo segredo antes de guardar. O valor guardado não pode ser revelado.](/docs-images/operator/workflows-guide-copy-secret.png)

### 5. Guardar o workflow

Selecione **Save** na barra de ferramentas.

![Save guarda o workflow e o novo segredo.](/docs-images/operator/workflows-guide-save.png)

### 6. Confirmar a alteração do sistema

Leia o aviso de workflow de sistema e selecione **Save anyway** quando pretender a alteração.

![Os workflows de sistema exigem confirmação explícita Save anyway.](/docs-images/operator/workflows-guide-confirm-save.png)

**Resultado esperado:** a mensagem Workflow saved confirma a escrita. Os emissores têm de usar o novo segredo guardado.

![A mensagem Workflow saved confirma esta escrita.](/docs-images/operator/workflows-guide-saved.png)

## Enviar os seus dados por HTTPS

Use URL e segredo guardados. Ingest aceita Bundle FHIR, lista de recursos ou respostas de formulário suportadas. O CLI aceita Bundle ou recurso único, não essa lista bruta. Não existe endpoint genérico POST /fhir. Coloque os seus dados aprovados em data/your-payload.json.

### 1. Enviar com segredo e chave de pedido

Substitua anfitrião, segredo e chave. Cada pedido lógico novo tem chave própria. Repetições usam a mesma chave e conteúdo. Não publique o segredo. O envio grava conforme o workflow; execute apenas quando pretendido.

```sh
{{operator:data-post}}
```

![Enviar com segredo e chave de pedido.](guide:operator-data-post)

### 2. Acompanhar um pedido aceite até terminar

HTTP 202 significa aceite, não concluído. Use statusUrl ou substitua REQUEST_ID. É necessário o segredo. Uma execução concluída pode devolver 200; 500 indica falha e interrupção ou cancelamento devolvem 409. Investigue efeitos incertos antes de repetir. Segredo ausente ou errado: 401; caminho desconhecido: 404.

```sh
{{operator:data-poll}}
```

![Acompanhar um pedido aceite até terminar.](guide:operator-data-poll)

### 3. Examinar o recibo no anfitrião

Substitua REQUEST_ID. History também distingue recibos e execuções. Um recibo em fila ou execução não terminou. Alterar ou desativar workflows pode cancelar trabalho. Não repita em massa com chaves novas.

```sh
{{operator:data-receipt}}
```

![Examinar o recibo no anfitrião.](guide:operator-data-receipt)

## Carregar um ficheiro pelo CLI instalado

Use o seu JSON FHIR válido na pasta partilhada data. Num repositório de desenvolvimento use pnpm openldr e caminhos normais. Exemplos e dashboards são opcionais; definições essenciais continuam disponíveis.

### 1. Validar sem importar

Validar não importa. Corrija erros. Um ficheiro não encontrado pode estar fora de data ou sem o prefixo data/.

```sh
{{operator:data-validate}}
```

![Validar sem importar.](guide:operator-data-validate)

### 2. Importar quando pretender gravar

Grava na instalação configurada. Sucesso indica lote e número de recursos. Zero recursos não prova importação útil. Verifique conversor e formato.

```sh
{{operator:data-ingest}}
```

![Importar quando pretender gravar.](guide:operator-data-ingest)

### 3. Ler o estado do lote

Encontre o identificador apresentado. O worker API pode terminar de forma assíncrona. Um lote pendente não é uma importação concluída.

```sh
{{operator:data-status}}
```

![Ler o estado do lote.](guide:operator-data-status)

### 4. Examinar erros antes de repetir

Substitua BATCH_ID. Corrija a causa antes de pipeline retry. Recursos FHIR são projetados no armazém; a apresentação depende também da projeção e dos filtros.

```sh
{{operator:data-logs}}
```

![Examinar erros antes de repetir.](guide:operator-data-logs)

## Usar um conversor aprovado quando necessário

FHIR é o padrão. Outros formatos exigem conversor e configuração adequados. Use um plugin assinado aprovado em operação. Os exemplos são alternativas, não ficheiros obrigatórios.

### 1. Instalar o plugin aprovado

Substitua pelo artefacto aprovado em data. Builds reference-plugins pertencem ao repositório, não são caminhos garantidos numa instalação fornecida.

```sh
{{operator:data-plugin}}
```

![Instalar o plugin aprovado.](guide:operator-data-plugin)

### 2. Escolher o identificador para importar

Substitua ficheiro e PLUGIN_ID. Use opções documentadas do plugin. Depois verifique lote com os comandos anteriores.

```sh
{{operator:data-plugin-ingest}}
```

![Escolher o identificador para importar.](guide:operator-data-plugin-ingest)

## Exemplos opcionais de dados

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

## Parâmetros do emissor CDR

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

**`CDR toolchain .env`**

```dotenv
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

    pnpm openldr terminology import resource packages/terminology/codesystems/openldr-request-attribute.json

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
