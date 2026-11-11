# Fluxos de trabalho

Um fluxo de trabalho é uma cadeia de passos que corre sozinha. Pode receber dados por HTTP, verificá-los, guardá-los, consultar uma base de dados, remodelar linhas, construir uma folha de cálculo e enviá-la por e-mail. Constrói-o numa tela arrastando passos, os **nós**, e ligando-os com linhas. Sem programa para escrever.

Este guia leva cerca de 40 minutos. Prepara o fluxo **Ingest** incluído para receber dados por HTTP, envia-lhe um registo, lê a execução e depois constrói um pequeno fluxo seu. Selecione uma imagem ou um clip para o ampliar. O ecrã dos fluxos está quase todo em inglês, por isso este guia escreve os rótulos em inglês.

![A lista de fluxos numa instalação nova: Ingest e On Ingest Persisted → Log.](workflows-tour.png)

## Quem pode fazer o quê

Os nomes das permissões aparecem em inglês.

| Permissão | O que permite |
| --- | --- |
| View workflows | Abrir **Fluxos de trabalho**, ver as definições e as suas execuções. |
| Edit workflows | Criar, alterar, importar e eliminar fluxos. |
| Run workflows | Iniciar uma execução à mão. |
| Manage workflow secrets | Definir segredos cifrados, como o segredo de um webhook. |

Lab Admin e Lab Manager têm-nas por predefinição.

## O que traz uma instalação nova

| Fluxo | O que faz |
| --- | --- |
| **Ingest** | Recebe os dados enviados para `/api/workflows/hooks/ingest`. Um nó **Switch** olha para a forma. Um Bundle FHIR, ou uma lista de recursos FHIR, é dividido num item por recurso. Um objeto simples de respostas de formulário é verificado contra o formulário **Lab order**. Os dois ramos acabam em **Persist store**, que guarda os dados. O registo à mão em **Formulários** também passa por este fluxo, por isso mantenha-o ativo. |
| **On Ingest Persisted → Log** | Corre sempre que o Ingest guarda alguma coisa e escreve uma linha no registo. Um ponto de partida para as suas reações a dados novos. |

Ambos são **fluxos de sistema**. Guardar uma alteração pede primeiro confirmação, porque um Ingest avariado deixa de guardar dados. **Reset to default**, no menu da sua linha, repõe a versão original.

## As ideias principais

- **Nós e linhas.** Cada nó faz um passo. Os dados passam pelas linhas como uma lista de **itens**. Cada item é um registo com um objeto `json` e, às vezes, ficheiros anexados.
- **Gatilhos.** Cada fluxo começa com um nó gatilho: à mão, agendado, webhook, carregamento de dados, evento ou escuta.
- **Configure Node.** Selecione um nó e depois a sua engrenagem para o configurar no painel à direita. O painel tem os separadores **Config**, **Input** e **Output**.
- **Conjuntos de dados.** Um fluxo pode guardar o resultado como conjunto de dados com nome. Outros fluxos, painéis e relatórios podem lê-lo depois. É assim que um fluxo pesado "preparar os dados" passa o trabalho a um fluxo leve "entregá-los".

## Exemplo 1: preparar o webhook Ingest

Uma instalação nova gera um segredo para o webhook Ingest, mas ninguém consegue ler um segredo guardado. Para enviar dados, substitua-o e copie o novo antes de guardar.

![Abrir o Ingest, abrir o seu gatilho, substituir o segredo e guardar.](workflows-ingest-secret.mp4)

1. Abra **Fluxos de trabalho** e selecione **Ingest**. A tela abre.
2. Selecione **Fit View**, o quadrado no canto inferior esquerdo da tela, para ver os seis nós.
3. Selecione o primeiro nó, **Ingest received**, e depois a engrenagem por cima. **Configure Node** abre à direita.
4. Em **Secret**, selecione **Substituir segredo**. Aparece um segredo novo na caixa.
5. Copie-o já. Não o vai conseguir ver depois de guardar.
6. Selecione **Save** no topo. O Ingest é um fluxo de sistema, por isso aparece a pergunta **Save changes to a system workflow?** Selecione **Save anyway**.

![Configure Node do gatilho webhook: caminho, URL, segredo novo e o cabeçalho a enviar.](workflows-ingest-panel.png)

**Resultado esperado:** a mensagem **Workflow saved**. O painel mostra o **URL** completo e o cabeçalho a enviar: `X-Webhook-Token: <o seu segredo>`. Cada instância da API passa a usar o segredo novo de imediato. Não é preciso reiniciar.

## Exemplo 2: enviar um registo

Envie um paciente do exemplo da documentação. Já está nos dados de exemplo, com o mesmo identificador, por isso atualiza esse paciente e nenhuma contagem muda.

1. Transfira o ficheiro de exemplo, se ainda não o fez. Veja [Carregar os dados de exemplo](/docs/dashboard#carregar-os-dados-de-exemplo).
2. Tire o primeiro paciente para um Bundle próprio:

```bash
jq '{resourceType:"Bundle",type:"transaction",entry:[.entry[]|select(.resource.id=="sample-pat-0001")]}' \
  data/openldr-sample-lab-data.json > one-patient.json
```

3. Envie-o, com o segredo que copiou:

```bash
curl -X POST https://your-host/api/workflows/hooks/ingest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Token: <o seu segredo>" \
  -d @one-patient.json
```

**Resultado esperado:** uma resposta como `{"ok":true,"runId":"...","correlationId":"..."}`. Um segredo errado ou em falta devolve `401`. Um caminho errado devolve `404`.

Envie sempre por HTTPS, para o segredo não seguir às claras. Trate-o como uma palavra-passe.

## Exemplo 3: ler a execução

![Abrir History e escolher a execução.](workflows-history.mp4)

1. Na tela do Ingest, selecione **History**.
2. O separador **Runs** lista cada execução. Selecione a mais recente.

![Uma execução: tipo, estado e duração de cada nó, e os dados que passou.](workflows-run-detail.png)

**Resultado esperado:** **Completed**, iniciada por **webhook**. Cada nó mostra **success**, exceto **form-validate-1**, que mostra **skipped**: um Bundle segue o ramo FHIR, não o dos formulários. Selecione um nó para ver o seu **Output**, **Result** e **Logs** por baixo.

O separador **Webhook receipts** lista cada pedido aceite pelo webhook, com o seu estado. Veja [Pedidos webhook duráveis](#pedidos-webhook-duraveis).

O mesmo registo aparece agora em [Atividade](/docs/activity).

## Exemplo 4: construir um fluxo

Construa um fluxo que conta os pedidos de cada exame no armazém.

![Criar um fluxo: um Manual Trigger e um nó Postgres, ligados, configurados, guardados e executados.](workflows-build.mp4)

1. Na lista de fluxos, abra o menu no canto superior direito e selecione **New**.
2. Substitua **Untitled Workflow** por `Orders by test`.
3. Na **Node library** à esquerda, abra **Core** e arraste **Manual Trigger** para a tela.
4. Abra **Databases** e arraste **Postgres** para a direita dele.
5. Arraste do ponto à direita de **Manual Trigger** até ao ponto à esquerda de **Postgres**. Uma linha liga-os.
6. Selecione **Postgres** e depois a sua engrenagem. Escolha o conector **Target Warehouse (Postgres)**. Na caixa SQL, escreva:

```sql
SELECT panel_desc AS test, COUNT(*) AS orders
FROM lab_requests
GROUP BY panel_desc
ORDER BY orders DESC
```

7. Selecione **Save**.
8. Selecione **Run**. A barra de baixo diz **Waiting for trigger**. Selecione o botão de reprodução em **Manual Trigger** para começar.

**Resultado esperado:** a barra de baixo mostra **Completed** e **2 steps**. Abra **Postgres** e depois **Output**: cinco itens, Full blood count 18 primeiro.

![A saída do nó Postgres: um item por linha.](workflows-build-output.png)

Os números vindos do SQL chegam como texto, por exemplo `"18"`. Um nó seguinte que faça somas pode ter de os converter.

Para terminar este guia, elimine o fluxo: na lista, abra o menu da sua linha e selecione **Delete**.

## A lista de fluxos

- **New** e **Import** estão no menu do canto superior direito. **Import** lê um ficheiro criado por **Export**.
- Cada linha tem **Open**, **Duplicate**, **Export** e, ou **Delete**, ou, num fluxo de sistema, **Reset to default**.
- **Search workflows** filtra pelo nome.

## Mover-se na tela

Use os controlos no canto inferior esquerdo da tela:

- **+** aproxima e **−** afasta.
- **Fit View**, por baixo, mostra todos os nós.

O ícone da mão no canto superior esquerdo é o modo **Pan**: arraste uma zona vazia para mover a vista. O ícone do ponteiro é o modo **Select**: arraste para selecionar nós num retângulo. No modo **Select**, o botão do meio ou o direito do rato movem a vista.

O minimapa no canto inferior direito também move e aproxima. Se perder os nós, use **Fit View** antes de mover algum. Estes controlos mudam a vista, não as posições guardadas.

Os botões do topo: **Clear** esvazia a tela, **Datasets** lista os conjuntos de dados guardados, **History** abre as execuções, **Save** guarda, **Run** prepara uma execução.

## Valores do item que chega

A maioria dos campos de texto aceita modelos que leem o item atual: SQL, destinatário, assunto e corpo do e-mail, nomes de ficheiros.

- `{{ $json.fieldName }}` é um campo do item que chega.
- Num nó SQL: `... where registered >= '{{ $json.periodStart }}'`, em que um nó **Edit Fields** anterior definiu `periodStart`.

## Referência dos nós

A **Node library** agrupa os nós por uso: **Core**, **Communication**, **Developer Tools**, **Databases**, **Files & Storage** e **Data Transformation**. Escreva em **Search nodes** para encontrar um.

### Gatilhos

- **Manual Trigger**, **Schedule**, **Webhook**, **On Data Ingest**. Começam a pedido, num horário cron, a partir de uma chamada HTTP, ou quando um lote é carregado.
- **Event Trigger**. Começa quando acontece um evento, por exemplo dados guardados.
- **Postgres Trigger** e **Email Trigger**. Começam com um `NOTIFY` do Postgres, ou quando chega um e-mail por um conector IMAP.

### Trazer dados

- **Postgres**, **MySQL**, **Microsoft SQL**. Executam SQL por um conector de base de dados e produzem um item por linha. O conector define o dialeto. Use `{{ $json.x }}` para lá pôr valores. Mantenha `SELECT` simples e faça a remodelação em nós, para que o mesmo fluxo funcione noutra base.
- **SQL Query**. Executa um `SELECT` sobre o esquema de relatórios. Precisa de **SQL bruto no painel** ativado em **Definições**, **Geral**. Sem isso, falha com `raw SQL widgets are disabled`. O nó Postgres não precisa dessa definição.
- **Load Dataset**. Lê um conjunto de dados guardado antes.
- **HTTP Request** e **FHIR Query**. Vão buscar a uma API ou ao repositório FHIR.

### Remodelar dados

- **Edit Fields**. Junta ou calcula campos em cada item, como `periodStart` e `periodEnd`.
- **Pivot**. Transforma linhas longas em colunas largas. Escolha as chaves de **group-by**, a **pivot column** cujos valores passam a nomes de colunas, a **value column** e uma lista fixa de colunas de saída. Exemplo: um antibiótico por linha passa a uma coluna por antibiótico. Os conflitos combinam-se por `max`, `min`, `first` ou `last`.
- **Merge**. Combina ramos que chegam. *Append* empilha-os, *Combine* junta um objeto, *Choose Branch* escolhe um, e **Combine by key** junta dois ramos por campos comuns, à esquerda ou interno. O primeiro ramo ligado é o lado esquerdo.
- **If**, **Switch**, **Filter**. Ramificam ou retiram itens por uma condição.
- **Aggregate**, **Summarize**, **Sort**, **Limit**, **Remove Duplicates**, **Rename Keys**, **Split Out**, **Date & Time**. Operações comuns de tabela.
- **Unwrap FHIR Bundle**. Um item por recurso de um Bundle.

### Ficheiros e saídas

- **Excel Template**. Preenche um modelo `.xlsx` com as cores da instituição com as linhas e devolve-o como ficheiro. Carregue o modelo com o botão do nó, defina a **Start cell** como `A2`, as **Columns** por ordem, uma **Auto-filter header cell** opcional como `A1`, e uma palavra-passe opcional. Os valores entram por posição, como num relatório feito à mão.
- **Export File**, **Spreadsheet File**, **Convert to File**. CSV, XLSX ou PDF simples a partir dos itens, sem modelo.
- **Materialize Dataset**. Guarda os itens como conjunto de dados com nome.
- **Read/Write File**. Acesso a ficheiros do servidor, numa área isolada, quando está ativo.

### Comunicação

- **Send Email (SMTP)**, **Gmail**, **Outlook**. Enviam por um conector de e-mail. Defina **To**, **Cc** opcional, **Subject**, **Body**, **Body format** e o **Attachment field**, por exemplo o campo `file` de um nó Excel Template.

### Controlo do fluxo

- **Wait**, **Execute Workflow**, **Loop Over Items**, **Stop and Error**, **No Operation**. Pausar, chamar outro fluxo, repetir, ou falhar de propósito.

### Registo de dados

- **Form Validate**. Verifica itens contra um formulário e transforma-os em recursos FHIR.
- **Persist Store**. Guarda recursos FHIR e dispara `data.persisted`.

## Relatórios agendados

O uso mais comum no laboratório é "consultar uma base num horário, preencher um modelo e enviá-lo por e-mail". Tem o seu próprio guia: [Relatórios agendados com fluxos de trabalho](/docs/report-pipeline).

## Webhooks em várias instâncias da API

Guarde uma mudança de caminho ou de segredo antes de enviar pedidos com o valor novo. Cada instância da API lê o caminho e o segredo atuais da base partilhada. Não é preciso reiniciar. Os pedidos autenticados antes de guardar podem terminar.

Envie o segredo só no cabeçalho `x-webhook-token`.

| Resposta | Significado |
| --- | --- |
| 404 | Caminho antigo depois de uma mudança, ou fluxo desativado ou eliminado |
| 401 | Segredo antigo ou ilegível |
| 503 | Dois gatilhos ativos partilham um caminho, por isso nada corre. Também uma falha a ler a base. As instâncias nunca recorrem a credenciais em cache. |

Cada gatilho ativo precisa do seu próprio caminho, incluindo gatilhos no mesmo fluxo.

Pare todas as instâncias antigas da API e os escritores antigos de fluxos antes de correr a migração 096 com `openldr db migrate`. Depois inicie as instâncias atualizadas. Os escritores antigos não sabem manter o novo índice de caminhos. Esta atualização precisa de uma paragem. Não misture versões enquanto entram escritas. Todas as instâncias têm de usar a mesma base e a mesma chave de cifra.

## Pedidos webhook duráveis

O OpenLDR guarda um recibo e um evento de envio numa só transação da base antes de aceitar um webhook. Se isso não chegar à base, o pedido falha sem recibo. Um erro ou uma ligação perdida não provam que nada correu. Tente de novo com a mesma chave de idempotência e os mesmos dados.

Envie um cabeçalho `Idempotency-Key` opcional para cada pedido lógico. No mesmo fluxo, a mesma chave e os mesmos dados reutilizam o primeiro recibo. Dados diferentes com a mesma chave devolvem 409. Os dados incluem o corpo, a consulta, os cabeçalhos reencaminhados e o conteúdo binário. Os cabeçalhos de autenticação e de transporte não contam. Sem chave, cada POST é um pedido novo, e as repetições podem repetir os seus efeitos.

O OpenLDR espera até 10 segundos depois de aceitar:

- Trabalho terminado devolve 200 com os campos habituais. Uma repetição de um pedido terminado também devolve 200, mesmo com `Prefer: respond-async`.
- Uma falha registada devolve um 500 simples com `requestId`, sem o erro em bruto.
- Recibos interrompidos e cancelados devolvem 409.
- Trabalho em fila ou a correr devolve 202 com `accepted: true`, `requestId`, `status` e `statusUrl`. `Location` e `Retry-After` dão o endereço e o intervalo para consultar. 202 quer dizer aceite, não terminado.
- `Prefer: respond-async` salta a espera. Desligar não cancela trabalho aceite.

### Exemplo para quem envia

Uma resposta 200 terminada pode ser `{"ok":true,"runId":"run-id","correlationId":"correlation-id"}`. As chaves têm de 1 a 200 caracteres ASCII imprimíveis, sem espaços.

Envie `POST /api/workflows/hooks/example` com os cabeçalhos `x-webhook-token: CURRENT_SECRET`, `Idempotency-Key: sender-request-123` e `Prefer: respond-async`. Repita com a mesma chave e os mesmos dados.

Um corpo 202 pendente:

```json
{"accepted":true,"requestId":"request-id","status":"queued","statusUrl":"/api/workflows/hooks/example?requestId=request-id"}
```

Consulte-o com `GET /api/workflows/hooks/example?requestId=request-id` e o `x-webhook-token` atual. Respeite `Retry-After`. A consulta devolve só `requestId`, `status` e `runId`, nunca dados nem erros em bruto. O identificador do pedido sozinho não dá acesso. Um segredo substituído deixa de funcionar de imediato. Um caminho renomeado ou eliminado pode cortar o acesso de quem envia, mas os operadores ainda podem ver os recibos por fluxo e por identificador de pedido.

### Inspecionar e recuperar

O separador **Webhook receipts** em **History** mostra pedidos em fila, a correr, terminados, falhados, interrompidos e cancelados. As rotas da API são `GET /api/workflows/:id/receipts?limit=25&offset=0` e `GET /api/workflows/:id/receipts/:requestId`.

```bash
openldr workflows receipts list WORKFLOW_ID --limit 25 --offset 0 --json
openldr workflows receipts show REQUEST_ID --json
```

Os limites vão de 1 a 100. Os deslocamentos começam em zero. A linha de comandos e a API usam o mesmo serviço de recibos. Nenhuma repete um pedido.

Trabalho em fila pode retomar depois de reiniciar. Um fluxo desativado, eliminado ou alterado antes de correr cancela o trabalho em fila. `interrupted` quer dizer que o resultado é incerto. O OpenLDR nunca repete sozinho trabalho começado. Confirme que o primeiro processo parou, e corrija os efeitos externos, antes de enviar um pedido com uma chave nova. Os efeitos externos não são desfeitos.

Os recibos e os registos de idempotência sobrevivem à eliminação de um fluxo. Nada expira nem os limpa, por isso o armazenamento cresce. A migração 097 junta o armazenamento dos recibos. Atualize da mesma forma: pare as instâncias e os escritores antigos, corra `openldr db migrate` e depois inicie os novos. A compatibilidade do cliente CDR com estas respostas não foi verificada no seu código-fonte.

## Num telemóvel

A lista de fluxos funciona num telemóvel. A tela precisa de um computador: construa e altere fluxos num ecrã maior.

![A lista de fluxos num telemóvel.](workflows-phone.png)

## Resolução de problemas

- **O webhook responde 401.** O segredo está errado ou é antigo. Um segredo guardado não se lê, por isso substitua-o, copie o novo e guarde. Veja o [Exemplo 1](#exemplo-1-preparar-o-webhook-ingest).
- **Save no Ingest parece não fazer nada.** Procure a pergunta **Save changes to a system workflow?** e selecione **Save anyway**.
- **Um nó não corre.** Abra-o e preencha todos os campos obrigatórios. Um nó de base de dados ou de e-mail precisa de um conector.
- **Falta um conector num nó.** Confirme que o conector existe, está ativo e corresponde ao tipo do nó. Veja [Conectores](/docs/connectors).
- **O nó SQL Query falha com `raw SQL widgets are disabled`.** Ative **SQL bruto no painel**, ou use o nó **Postgres**, **MySQL** ou **Microsoft SQL** com um conector.
- **Run não faz nada.** **Run** só prepara o fluxo. Selecione o botão de reprodução no gatilho.
- **Um conjunto de dados está vazio.** Corra o fluxo que o constrói antes do que o lê.
- **Chegou um e-mail sem o anexo.** Defina o **Attachment field** do nó Send Email com o campo de ficheiro criado antes, normalmente `file`.
- **Uma execução falha depois de um ramo.** Verifique a condição do ramo e o nó logo antes da falha.
- **O registo de formulários falha com "capture pipeline unavailable".** O Ingest está desativado. O servidor volta a ativá-lo ao arrancar. Se o desativou de propósito, o registo de formulários não pode funcionar.

## Dicas

- Divida o trabalho pesado em dois fluxos ligados por um conjunto de dados. Um guarda os dados preparados num horário. Outro, mais leve, carrega-os, formata-os e envia-os. A consulta de origem continua rápida.
- Mantenha as consultas em `SELECT` simples. Faça os pivots e as junções nos nós **Pivot** e **Merge**, para que um fluxo feito para uma base corra noutra mudando o conector.
- Leia **History** antes de alterar um fluxo que falha, para saber se o problema está nos dados, na configuração ou no destino.

## Guias relacionados

- [Atividade](/docs/activity)
- [Relatórios agendados com fluxos de trabalho](/docs/report-pipeline)
- [Conectores](/docs/connectors)
- [Relatórios](/docs/reports)
- [Auditoria](/docs/audit)
