# Workflows

Crie um workflow quando precisar de receber, verificar, transformar, guardar ou entregar dados no OpenLDR. Um nó é um passo. As linhas ligam a saída de um nó à entrada de outro.

Use os seus registos e consultas de relatório. Não precisa de dados de exemplo da documentação. As imagens usam uma instalação de teste separada. Há ficheiros fictícios opcionais no fim.

**View workflows** abre definições e execuções. **Edit workflows** cria e altera. **Run workflows** inicia execuções manuais. **Manage workflow secrets** altera as credenciais webhook.

O workflow fornecido **Ingest** também trata submissões Forms. Numa instalação nova, passa o que recebe por [Map to FHIR](/docs/map-to-fhir). Mantenha-o ativado. Editá-lo afeta todos os emissores que usam o webhook. Substitua um segredo apenas quando estiver preparado para atualizar esses emissores.

## Enviar uma linha de ensaio ao workflow Ingest fornecido

Pode usar **Ingest** sem criar outro workflow nem conhecer FHIR. FHIR é o formato padrão dos registos usado pelo OpenLDR. Numa instalação nova, os passos são **Ingest received**, **Map to FHIR**, **Persist store**, **Log persisted** e **Log held**. Map to FHIR transforma os seus campos em paciente, amostra, pedido e resultado ligados. Persist store guarda esses registos. Log held regista cada linha que não foi mapeada, com o motivo.

Use a linha fictícia abaixo numa instalação de teste. Mantenha o workflow existente ativado. Uma instalação antiga pode ter outro grafo. Não reponha um workflow operacional para experimentar este exemplo.

1. Abra **Workflows** no menu principal e selecione **Ingest**.
2. Selecione **Ingest received**, depois a engrenagem **Configure** por cima.
3. Copie **URL**. O caminho fornecido é `/api/workflows/hooks/ingest`.
4. Peça o segredo guardado ao administrador. Não pode ser mostrado. A tarefa de configuração do segredo Ingest abaixo explica a substituição quando necessária.
5. Substitua o URL e `YOUR_SECRET` abaixo e execute o comando no terminal.
6. Abra **History** na barra do workflow e selecione a nova execução.

```shell
curl -i -X POST 'https://your-host/api/workflows/hooks/ingest' \
  -H 'Content-Type: application/json' \
  -H 'X-Webhook-Token: YOUR_SECRET' \
  --data-binary '{
    "patient_no": "DOCS-INGEST-001",
    "patient_system": "urn:example:lab:patients",
    "first_name": "Docs",
    "surname": "Example",
    "sample_no": "DOCS-SAMPLE-001",
    "collected": "2026-11-18T09:00:00+02:00",
    "test_code": "DEMO-TEST",
    "result": 14.9,
    "unit": "g/dL"
  }'
```

**Resultado esperado:** a mensagem aparece em History. Sem um mapeamento guardado correspondente, Map to FHIR retém a linha e nada é guardado. A execução mostra mesmo assim **Completed**, com uma linha retida. O webhook responde HTTP 200 com `held: 1`, o motivo `no mapping for this shape` e uma `message`. Essa execução fornece a amostra para a tarefa seguinte. Envie só a linha acima. O webhook coloca-a em `body`.

Já envia FHIR? Ingest aceita os registos FHIR suportados sem mapeamento dos campos de origem. Para os seus nomes de campos, continue abaixo.

## Mapear a linha de ensaio

Escolha os campos de origem ao lado dos nomes de laboratório. Não precisa de escrever caminhos FHIR.

1. Feche History se estiver aberto.
2. Selecione **Map to FHIR**, depois **Configure**.
3. Confira que **Caminho de origem** é `body` e que o **Destino** é o resultado laboratorial.
4. Abra **Ações do nó**, os pontos junto ao título, e selecione **Abrir mapeamento**.
5. Abra **Ações do mapeamento**, os pontos no canto superior direito, e selecione **Usar a última execução guardada**.
6. Escolha os campos abaixo em **Dos seus dados**. Mantenha **Sem regra** nas regras.
7. Deixe os restantes campos **Não mapeado**.
8. Abra **Ações do mapeamento** e selecione **Testar**.

| Destino | Dos seus dados |
|---------|----------------|
| Número do paciente | `patient_no` |
| Sistema do número do paciente | `patient_system` |
| Nome próprio | `first_name` |
| Apelido | `surname` |
| Data de colheita | `collected` |
| Número da amostra | `sample_no` |
| Análise | `test_code` |
| Resultado (número) | `result` |
| Unidade de medida | `unit` |

**Resultado esperado:** os três campos obrigatórios estão mapeados e a primeira linha passa. Testar mostra a conversão sem guardar registos. [Map to FHIR](/docs/map-to-fhir) explica regras, listas e a pré-visualização dos registos gerados.

## Guardar o mapeamento e reenviar a linha

1. Abra **Ações do mapeamento** e selecione **Guardar**.
2. Feche o painel de mapeamento.
3. Selecione **Save** na barra do workflow.
4. Leia o aviso do workflow de sistema e selecione **Save anyway** para esta alteração pretendida.
5. Envie novamente o mesmo comando curl.
6. Abra **History** e escolha a nova execução pela hora.
7. Selecione **Persist store** para consultar a saída guardada.

**Resultado esperado:** a nova execução mostra **Completed**, uma linha mapeada, nenhuma retida e quatro registos guardados. Reenviar a mesma linha atualiza os mesmos registos. Não acrescenta outro paciente nem outro resultado.

## Encontrar os registos de ensaio guardados

1. Abra **Patients** no menu principal.
2. Escreva `Docs Example` em **Search name or identifier**.
3. Selecione o paciente e consulte **Identifiers** e **Requests** na ficha.
4. Abra **Dashboard** no menu principal.
5. Escolha **Lab Overview (Sample)** no seletor de dashboards, se estiver disponível.
6. Selecione **Refresh** e procure `DEMO-TEST` em **Recent Orders**.

**Resultado esperado:** o paciente tem um identificador e um pedido com um resultado. O dashboard pode mostrar o pedido pelo nome da análise. Uma célula Identifiers vazia na lista de pacientes não significa que a ficha não tenha identificadores.

A linha de ensaio tem data de colheita mas não tem data do pedido. Limpe o filtro Period do dashboard para a procurar. Um dashboard pode mostrar apenas as análises mais frequentes. Por isso, um pedido novo pode não aparecer em **Orders by Test**. Verifique primeiro a gravação em History e na ficha do paciente.

Se Map to FHIR retiver uma linha, consulte esse passo em History para ler o motivo. Uma estrutura de origem desconhecida precisa de um mapeamento guardado. Um identificador de paciente em falta precisa de dados corrigidos. No Ingest fornecido, **retidos** liga a **Log held**. As linhas válidas de uma mensagem são guardadas, e cada linha retida fica registada com o motivo. As linhas retidas não são guardadas. Corrija os dados ou o mapeamento e envie essas linhas novamente. [Map to FHIR](/docs/map-to-fhir) explica os motivos, e como recusar a mensagem inteira quando uma linha é retida.

## Encontrar um workflow

Abra uma definição existente antes de a inspecionar ou alterar.

### 1. Abrir Workflows

Selecione **Workflows** no menu principal.

![Abra Workflows no menu principal.](workflows-guide-open-page.png)

### 2. Encontrar o workflow

Use **Search workflows** para filtrar os nomes. Limpe a pesquisa para restaurar a lista.

![A pesquisa filtra os nomes dos workflows.](workflows-guide-search.png)

### 3. Abrir a linha

Selecione o nome do workflow. Este exemplo abre o workflow fornecido **Ingest**.

![Abra o workflow fornecido Ingest.](workflows-guide-ingest-row.png)

### 4. Ajustar o quadro

Selecione **Fit View** no canto inferior esquerdo. Use mais e menos para ampliar. Pan move o quadro. Select desenha uma caixa de seleção.

![Fit View enquadra os nós no quadro.](workflows-guide-fit.png)

## Definir o segredo webhook de Ingest

Faça esta tarefa quando um emissor autorizado precisa de uma credencial que possa copiar. Um segredo guardado não pode ser revelado. Coordene primeiro a substituição com os emissores.

### 1. Selecionar Ingest received

Selecione o primeiro nó, **Ingest received**.

![Selecione o acionador webhook Ingest received.](workflows-guide-trigger.png)

### 2. Abrir as definições

Selecione a roda dentada **Configure** acima do nó selecionado.

![Configure abre as definições do nó selecionado.](workflows-guide-configure.png)

### 3. Gerar um novo segredo

Em **Secret**, selecione **Replace secret**. Um valor ainda não guardado oferece **Regenerate**.

![Replace secret gera um valor que tem de copiar antes de guardar.](workflows-guide-replace-secret.png)

### 4. Copiar o novo valor

Copie o segredo e guarde-o com as credenciais do emissor. URL e Header mostram onde e como enviar.

![Copie o novo segredo antes de guardar. O valor guardado não pode ser revelado.](workflows-guide-copy-secret.png)

### 5. Guardar o workflow

Selecione **Save** na barra de ferramentas.

![Save guarda o workflow e o novo segredo.](workflows-guide-save.png)

### 6. Confirmar a alteração do sistema

Leia o aviso de workflow de sistema e selecione **Save anyway** quando pretender a alteração.

![Os workflows de sistema exigem confirmação explícita Save anyway.](workflows-guide-confirm-save.png)

**Resultado esperado:** a mensagem Workflow saved confirma a escrita. Os emissores têm de usar o novo segredo guardado.

![A mensagem Workflow saved confirma esta escrita.](workflows-guide-saved.png)

## Ler uma execução e o recibo webhook

Faça esta tarefa depois de um emissor enviar dados. Também pode consultar execuções existentes sem enviar nada novo. O exemplo é uma execução webhook real com um paciente fictício.

### 1. Abrir History

No quadro do workflow, selecione **History**.

![History lista execuções reais e recibos webhook aceites.](workflows-guide-history.png)

### 2. Escolher a execução

Em **Runs**, selecione a linha correspondente à origem e à hora pretendidas.

![Selecione a execução webhook concluída.](workflows-guide-run-row.png)

### 3. Ler o resultado

Verifique Completed ou Failed e depois o estado de cada nó. As imagens vêm de uma instalação criada antes de Map to FHIR. Aí, Form Validate é ignorado porque o ramo FHIR tratou o Bundle. Numa instalação nova, o Bundle passa antes por **Map to FHIR**. Completed quer dizer que nenhum passo falhou. Um passo que não correu aparece como skipped. Completed não quer dizer que cada linha foi guardada. Quando Map to FHIR reteve linhas, a linha da execução mostra um número como **3 retidas** ao lado de Completed, e o cabeçalho da execução mostra quantas linhas foram mapeadas e retidas, e quantos registos foram guardados. As linhas retidas dentro de um ciclo também contam, mesmo quando uma passagem seguinte do ciclo falha. Um passo ignorado mostra o seu nome.

![A execução concluída mostra o ramo que tratou este Bundle.](workflows-guide-run-result.png)

### 4. Escolher um nó

Selecione uma linha de nó para consultar os dados recebidos e produzidos. O exemplo seleciona **Persist store**.

![Selecione a execução de um nó para inspecionar os dados.](workflows-guide-run-node.png)

### 5. Inspecionar a saída

Selecione **Output**. Use **Result** ou **Logs** para os outros detalhes registados. Um nó de armazenamento bem-sucedido não prova que um destinatário seguinte leu os dados.

![Output contém os dados transmitidos pelo nó selecionado.](workflows-guide-run-output.png)

### 6. Inspecionar o pedido aceite

Selecione **Webhook receipts**. Compare o identificador e o estado do pedido com a resposta ao emissor. Um recibo em espera ou em execução não é uma execução concluída.

![Webhook receipts mostra o pedido aceite e o estado final.](workflows-guide-receipts.png)

**Resultado esperado:** distingue o pedido webhook aceite da execução do workflow e dos resultados dos nós.

## Criar um workflow de contagem do armazém

Use este pequeno workflow de leitura para aprender o quadro. Conta os pedidos já no armazém. Zero é válido. Não precisa de dados de exemplo nem de conector de base de dados.

### 1. Abrir Workflow actions

Volte à lista Workflows e abra os pontos **Workflow actions**.

![Abra Workflow actions para criar ou importar.](workflows-guide-list-actions.png)

### 2. Escolher New

Selecione **New**.

![New abre um quadro vazio.](workflows-guide-new.png)

### 3. Dar nome ao workflow

Defina **Workflow name** com um nome útil. O exemplo usa `Warehouse row count`.

![Dê nome ao workflow antes de guardar.](workflows-guide-name.png)

### 4. Encontrar Manual Trigger

Em Node library, pesquise `Manual Trigger`.

![Pesquise Manual Trigger em Node library.](workflows-guide-find-manual.png)

### 5. Adicionar o acionador

Arraste **Manual Trigger** para uma parte vazia do quadro.

![Arraste Manual Trigger para o quadro.](workflows-guide-manual-card.png)

### 6. Adicionar SQL Query

Pesquise `SQL Query` e arraste-o para junto do acionador. Limpe a pesquisa da biblioteca quando terminar.

![Arraste SQL Query para a direita do acionador.](workflows-guide-sql-card.png)

### 7. Ligar os nós

Arraste o ponto à direita de Manual Trigger para o ponto à esquerda de SQL Query. Confirme que uma linha os liga.

![Ligue a saída direita do acionador à entrada esquerda de SQL Query.](workflows-guide-connect.png)

## Configurar e executar a contagem

Continue com os dois nós ligados. Esta consulta de leitura conta os pedidos já no armazém. A sua contagem pode diferir do exemplo.

### 1. Introduzir a consulta

Selecione SQL Query e a roda Configure. Em **SQL (SELECT only)**, introduza `SELECT COUNT(*) AS requests FROM lab_requests`. Esta consulta lê o esquema de relatórios.

![Use uma consulta de leitura sobre o esquema de relatórios.](workflows-guide-sql.png)

### 2. Guardar a definição

Selecione **Save**.

![Save cria o workflow com nome.](workflows-guide-save-new.png)

### 3. Preparar a execução

Selecione **Run**. O acionador manual espera pela próxima ação.

![Run prepara o acionador manual.](workflows-guide-run.png)

### 4. Iniciar o acionador

Selecione o botão de reprodução **Click to run** em Manual Trigger.

![Selecione o botão de reprodução no acionador manual para iniciar a execução.](workflows-guide-fire-trigger.png)

### 5. Ler a contagem

Depois de aparecer Completed, abra SQL Query e selecione **Output**. Leia o valor `requests`. A contagem pode diferir da imagem.

![A saída contém a contagem atual de pedidos, que pode ser zero.](workflows-guide-sql-output.png)

**Resultado esperado:** a execução termina em dois passos e produz um item com a contagem atual de pedidos.

![Uma execução bem-sucedida termina com Completed.](workflows-guide-completed.png)

## Exportar uma definição de workflow

Guarde assim uma cópia portátil da definição. As definições exportadas podem conter configuração. Reveja-as antes de partilhar.

### 1. Abrir as ações da linha

Volte à lista e abra os pontos da linha do workflow.

![Cada linha de workflow tem o seu menu de ações.](workflows-guide-row-actions.png)

### 2. Escolher Export

Selecione **Export**. O navegador descarrega um ficheiro `.workflow.json`. O menu de ações da lista oferece Import para este formato.

![Export descarrega a definição do workflow em JSON.](workflows-guide-export.png)

**Resultado esperado:** tem uma cópia JSON da definição. Export não executa o workflow.

## Criar uma cópia separada

Use Duplicate antes de experimentar com um workflow personalizado guardado. A cópia tem a sua própria definição.

### 1. Abrir as ações da linha

Abra os pontos junto ao workflow que pretende copiar.

![Cada linha de workflow tem o seu menu de ações.](workflows-guide-row-actions.png)

### 2. Escolher Duplicate

Selecione **Duplicate**. Uma nova linha termina em **(copy)**. Abra-a antes de alterar.

A cópia começa **Disabled**, com um novo segredo de webhook, por isso nunca recebe as mensagens do original. Para a usar, mude o caminho do webhook e guarde, depois abra os pontos ao lado na lista e selecione **Enable**. Guardar mantém um workflow ativo ou inativo como estava. **Disable**, no mesmo menu, desativa-o. Dois workflows ativos não podem partilhar um caminho de webhook: ativar ou guardar o segundo é recusado, e a mensagem nomeia o primeiro.

![Duplicate cria uma cópia separada do workflow.](workflows-guide-duplicate.png)

**Resultado esperado:** o original e a cópia aparecem separadamente. A cópia mostra **Disabled**.

![A cópia separada tem a sua própria linha.](workflows-guide-duplicate-result.png)

## Remover um workflow personalizado

Faça esta tarefa apenas quando já não precisa da definição. Delete remove permanentemente o workflow personalizado selecionado. O exemplo remove a cópia temporária.

### 1. Escolher Delete

Abra os pontos da linha do workflow personalizado e selecione **Delete**.

![Delete está disponível para workflows personalizados.](workflows-guide-delete.png)

### 2. Confirmar o workflow com nome

Leia o nome na confirmação. Selecione **Delete** apenas para a definição que quer remover.

![Confirme apenas a cópia de workflow personalizado que pretende remover.](workflows-guide-delete-confirm.png)

**Resultado esperado:** a cópia desaparece e o original permanece.

![O workflow original permanece após eliminar a cópia.](workflows-guide-delete-result.png)

## Importar uma definição exportada

Adicione assim um workflow de um ficheiro JSON exportado. Verifique a configuração antes de executar uma definição importada.

### 1. Abrir Workflow actions

Abra os pontos acima da lista de workflows.

![Abra Workflow actions para criar ou importar.](workflows-guide-list-actions.png)

### 2. Escolher Import e um ficheiro

Selecione **Import** e escolha o ficheiro `.workflow.json` exportado no seletor de ficheiros.

![Import lê uma definição anteriormente exportada.](workflows-guide-import.png)

**Resultado esperado:** o workflow personalizado importado aparece na lista. Import não o executa.

![Import adiciona outra definição personalizada sem a executar.](workflows-guide-import-result.png)

## Encontrar workflows num telemóvel

Use a lista de workflows no telemóvel. Crie e configure os workflows do quadro num ecrã maior.

### 1. Pesquisar na lista

Use **Search workflows** para encontrar a definição guardada.

![Pesquise workflows no telemóvel.](workflows-guide-phone-search.png)

### 2. Abrir o workflow

Selecione o nome. Use History para consultar as execuções. Um ecrã maior é melhor para editar o quadro.

![Abra um workflow existente pela sua linha.](workflows-guide-phone-open.png)

## Enviar o seu conteúdo webhook

Use o URL mostrado nas definições webhook. Use HTTPS fora de uma instalação de teste local. Envie o segredo guardado apenas em `X-Webhook-Token`. Use uma entrada aceite pelo workflow, como um Bundle FHIR para Ingest.

Na pasta da instalação, coloque o conteúdo aprovado em `data/your-payload.json`. Substitua o anfitrião e o segredo abaixo. Leia [Começar aqui](/docs/start-here) para os locais dos comandos instalados e de desenvolvimento.

```shell
curl -X POST https://your-host/api/workflows/hooks/ingest \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Token: YOUR_SECRET" \
  -H "Idempotency-Key: sender-request-123" \
  -d @data/your-payload.json
```

Para enviar FHIR em XML, use `Content-Type: application/fhir+xml` e envie o ficheiro com `--data-binary @data/your-payload.xml`. O OpenLDR transforma-o em JSON FHIR antes de o workflow correr, por isso cada nó vê o mesmo JSON que um emissor JSON envia. Lê um Bundle e os tipos de recurso que o OpenLDR guarda: Patient, Specimen, ServiceRequest, Observation, DiagnosticReport, Encounter, Location, Organization e Practitioner. XML que não é FHIR recebe HTTP 415, e XML mal formado recebe HTTP 400. Em ambos os casos nada corre.

Uma resposta concluída contém `ok`, `runId` e `correlationId`. Uma resposta 202 significa aceite, com identificador do pedido e URL de consulta. Siga esse URL com o token atual. Respeite Retry-After. Reutilize a mesma chave de idempotência e uma entrada idêntica para repetir. Entrada diferente com a mesma chave devolve 409.

Numa instalação nova, o **Ingest** guarda as partes de uma mensagem que consegue mapear e retém o resto. As partes retidas não são guardadas. Seguem para o passo **Log held** com o seu motivo. O webhook responde na mesma HTTP 200, e acrescenta `held`, `heldReasons` e uma `message` que diz quantas foram retidas. Um envio de formulário com uma parte retida é recusado, com os motivos. History mostra cada motivo no nó **Map to FHIR**.

## Ficheiros fictícios opcionais de prática

Use apenas numa instalação de teste. [Descarregue um Bundle com um paciente fictício](https://openldr.online/docs-samples/user-guide/workflows/example-patient.json) para praticar o webhook. Guarde como `data/your-payload.json` na pasta da instalação, por exemplo `~/Downloads/openldr_ce` ou `C:\openldr_ce`. Use o comando acima com o anfitrião e token de teste.

[Descarregue o workflow de contagem com dois nós](https://openldr.online/docs-samples/user-guide/workflows/warehouse-row-count.workflow.json). Importe por Workflow actions se quiser uma referência após criar o seu. Nenhum ficheiro é necessário para uso normal.

## Escolher outros nós

Node library agrupa acionadores, bases de dados, comunicação, ficheiros e transformações. Pesquise pelo nome do nó. Uma entrada cinzenta Coming soon não pode executar.

Use Postgres, MySQL ou Microsoft SQL com um conector correspondente ativado. SQL Query lê diretamente o esquema de relatórios. Load Dataset lê linhas de workflow guardadas. Materialize Dataset substitui as linhas guardadas sob um nome de conjunto de dados.

Use Edit Fields, Filter, Switch, Pivot ou Merge para transformar itens. A maioria das definições de texto pode ler o item de entrada com `{{ $json.fieldName }}`. Adapte os nomes de campos à entrada que inspecionou.

Os passos de ficheiro e entrega precisam de configuração própria. [Relatórios agendados](/docs/report-pipeline) explica os conjuntos de dados e modelos Excel. Configure um conector de email aprovado antes de adicionar entrega.

## Tratar pedidos webhook interrompidos

History mostra os recibos separados das execuções. O trabalho em espera pode retomar após reiniciar. Desativar, eliminar ou alterar um workflow pode cancelar esse trabalho. Interrupted significa que o resultado é desconhecido.

O OpenLDR não repete automaticamente trabalho já iniciado. Confirme que o primeiro processamento parou e reconcilie efeitos externos antes de usar uma nova chave de pedido. Uma ligação falhada não prova que nada executou. Os recibos permanecem após eliminar o workflow.

Use `./openldr` na pasta instalada em Linux ou macOS, `.\openldr.ps1` em Windows, ou `pnpm openldr` numa cópia de desenvolvimento. Execute o comando na sua pasta `openldr_ce`. [Start here](/docs/start-here) explica o lançador e os caminhos.

```shell
./openldr workflows receipts list WORKFLOW_ID --limit 25 --offset 0 --json
./openldr workflows receipts show REQUEST_ID --json
```

Para experimentar os mapeamentos guardados de um nó Map to FHIR num ficheiro, execute `workflows map-test`. O comando não guarda nada. Guarde primeiro o workflow, porque o comando lê o nó guardado. No workflow fornecido Ingest, o identificador do nó é `map-1`.

```shell
./openldr workflows map-test wf-ingest map-1 data/your-rows.csv
```

Para ativar ou desativar um workflow pela linha de comandos, execute `workflows enable` ou `workflows disable` com o seu id. Só isso muda, como com **Enable** e **Disable** na lista. A ativação é recusada quando outro workflow ativo usa o seu caminho de webhook. Um webhook segue de imediato. Reinicie o servidor para que os agendamentos, os ouvintes, a ingestão e os gatilhos de eventos sigam.

```shell
./openldr workflows disable WORKFLOW_ID
./openldr workflows enable WORKFLOW_ID
```

## Restaurar um workflow fornecido

Os workflows de sistema oferecem **Reset to default** em vez de Delete. Repor descarta o grafo personalizado e exige confirmação. Exporte primeiro a definição atual se precisar de a guardar.

A reposição normalmente mantém o segredo webhook existente. Se o aviso indicar que não foi possível mantê-lo, defina um novo segredo e atualize todos os emissores. Este guia não repôs um workflow operacional.

## Resolução de problemas

**Run espera sem iniciar.** Selecione o botão de reprodução no acionador depois de Run.

**Um segredo é rejeitado.** Verifique o valor guardado e o caminho atual. Substituir um segredo exige Save e, para Ingest, Save anyway. Um segredo guardado não pode ser revelado.

**O XML é recusado com 415.** O elemento raiz tem de estar no espaço de nomes `http://hl7.org/fhir`, e cada recurso tem de ser de um tipo que o OpenLDR guarda. A resposta indica o problema. Só é lido XML FHIR.

**Um nó falha.** Inspecione a entrada, a configuração e os registos em History. Verifique as definições do conector e os nomes dos campos que entram.

**A captura de formulário indica que o pipeline está indisponível.** Confirme que o workflow fornecido Ingest está ativado. Não limpe nem elimine os nós para diagnosticar um emissor.

**Uma entrega indica sucesso.** Verifique o sistema destinatário separadamente. A conclusão do nó não prova que uma pessoa recebeu ou leu o resultado.

## Guias relacionados

[Atividade](/docs/activity) acompanha o ciclo do conteúdo. [Relatórios agendados](/docs/report-pipeline) cria dados guardados e saída em livros Excel. [Conectores](/docs/connectors) configura sistemas externos. [Map to FHIR](/docs/map-to-fhir) mapeia as linhas próprias de um laboratório.

## Quando uma execução é interrompida

Uma execução pode ser cortada quando o servidor reinicia ou para. Uma execução de workflow nunca recomeça sozinha, porque pode já ter enviado um e-mail ou chamado outro sistema antes do corte.

1. Abra o workflow e o seu **Histórico**.
2. Uma execução interrompida mostra o estado **Interrompido**. Aponte para o distintivo **Interrompido** para ver quando aconteceu.
3. Para a executar de novo, abra o menu **⋯** da linha e selecione **Continuar**. Uma nova execução começa com os mesmos dados. Se o workflow mudou desde o início da execução interrompida, a mensagem diz isso e a nova execução usa-o como está agora.

Na linha de comandos: `openldr workflows run-continue <workflowId> <requestId>`.
