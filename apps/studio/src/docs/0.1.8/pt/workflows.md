# Workflows

Crie um workflow quando precisar de receber, verificar, transformar, guardar ou entregar dados no OpenLDR. Um nó é um passo. As linhas ligam a saída de um nó à entrada de outro.

Use os seus registos e consultas de relatório. Não precisa de dados de exemplo da documentação. As imagens usam uma instalação de teste separada. Há ficheiros fictícios opcionais no fim.

**View workflows** abre definições e execuções. **Edit workflows** cria e altera. **Run workflows** inicia execuções manuais. **Manage workflow secrets** altera as credenciais webhook.

O workflow fornecido **Ingest** também trata submissões Forms. Mantenha-o ativado. Editá-lo afeta todos os emissores que usam o webhook. Substitua um segredo apenas quando estiver preparado para atualizar esses emissores.

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

Verifique Completed ou Failed e depois o estado de cada nó. Neste exemplo Bundle, Form Validate é ignorado porque o ramo FHIR tratou a entrada.

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

![Duplicate cria uma cópia separada do workflow.](workflows-guide-duplicate.png)

**Resultado esperado:** o original e a cópia aparecem separadamente.

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

Uma resposta concluída contém `ok`, `runId` e `correlationId`. Uma resposta 202 significa aceite, com identificador do pedido e URL de consulta. Siga esse URL com o token atual. Respeite Retry-After. Reutilize a mesma chave de idempotência e uma entrada idêntica para repetir. Entrada diferente com a mesma chave devolve 409.

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

## Restaurar um workflow fornecido

Os workflows de sistema oferecem **Reset to default** em vez de Delete. Repor descarta o grafo personalizado e exige confirmação. Exporte primeiro a definição atual se precisar de a guardar.

A reposição normalmente mantém o segredo webhook existente. Se o aviso indicar que não foi possível mantê-lo, defina um novo segredo e atualize todos os emissores. Este guia não repôs um workflow operacional.

## Resolução de problemas

**Run espera sem iniciar.** Selecione o botão de reprodução no acionador depois de Run.

**Um segredo é rejeitado.** Verifique o valor guardado e o caminho atual. Substituir um segredo exige Save e, para Ingest, Save anyway. Um segredo guardado não pode ser revelado.

**Um nó falha.** Inspecione a entrada, a configuração e os registos em History. Verifique as definições do conector e os nomes dos campos que entram.

**A captura de formulário indica que o pipeline está indisponível.** Confirme que o workflow fornecido Ingest está ativado. Não limpe nem elimine os nós para diagnosticar um emissor.

**Uma entrega indica sucesso.** Verifique o sistema destinatário separadamente. A conclusão do nó não prova que uma pessoa recebeu ou leu o resultado.

## Guias relacionados

[Atividade](/docs/activity) acompanha o ciclo do conteúdo. [Relatórios agendados](/docs/report-pipeline) cria dados guardados e saída em livros Excel. [Conectores](/docs/connectors) configura sistemas externos.
