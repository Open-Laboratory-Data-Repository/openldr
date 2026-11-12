# Relatórios agendados com workflows

Use dois workflows quando um relatório exige dados preparados e um modelo de livro. O primeiro lê a origem e guarda um conjunto de dados com nome. O segundo carrega essas linhas e preenche o livro.

Comece com a sua consulta de relatório e o seu livro. Não são necessários dados de exemplo. A pequena contagem abaixo também executa num armazém vazio. O livro opcional de prática encontra-se no fim.

Precisa de **Edit workflows** e **Run workflows**. Configurar conectores de base ou correio também exige **Manage connectors**. Leia [Workflows](/docs/workflows) para os controlos da área de desenho.

Crie e verifique o livro antes de acrescentar um nó de envio. As capturas usam uma instalação de teste separada. As definições de correio servem apenas de explicação. Não foi enviado correio durante esta verificação.

## Criar a consulta de resumo

Use uma consulta só de leitura que devolva as colunas necessárias ao livro. Esta contagem inicial devolve uma linha mesmo sem pedidos.

### 1. Criar um workflow

Abra Workflows, depois Workflow actions e escolha **New**.

![New abre um workflow vazio.](report-pipeline-guide-build-new.png)

### 2. Dar um nome

Defina um nome útil em Workflow name. O exemplo usa `Build request summary`.

![Dar um nome ao workflow conforme a tarefa.](report-pipeline-guide-build-name.png)

### 3. Adicionar Manual Trigger

Pesquise Manual Trigger em Node library e arraste para a área de desenho.

![Arrastar Manual Trigger de Node library para a área de desenho.](report-pipeline-guide-build-manual.png)

### 4. Adicionar SQL Query

Pesquise SQL Query e arraste junto do acionador. Este nó lê diretamente o esquema de relatórios. Para outra origem, use um nó de base de dados e um conector.

![Arrastar SQL Query de Node library para a área de desenho.](report-pipeline-guide-build-sql-node.png)

### 5. Ligar os nós

Arraste o ponto de saída à direita do acionador para o ponto de entrada à esquerda de SQL Query.

![Ligar a saída de Manual Trigger à entrada de SQL Query.](report-pipeline-guide-build-connect.png)

### 6. Introduzir o SELECT

Selecione SQL Query e depois a engrenagem Configure. Introduza `SELECT COUNT(*) AS requests FROM lab_requests`. Feche o painel para adicionar o próximo nó.

![Contar os pedidos atuais do armazém. A contagem pode ser zero.](report-pipeline-guide-build-sql.png)

## Guardar o resultado como conjunto de dados

Um conjunto de dados mantém as últimas linhas materializadas sob um nome. Escolha um nome estável antes de outro workflow o ler.

### 1. Adicionar Materialize Dataset

Pesquise Materialize Dataset e arraste depois de SQL Query.

![Arrastar Materialize Dataset de Node library para a área de desenho.](report-pipeline-guide-build-materialize.png)

### 2. Ligar a SQL Query

Ligue a saída de SQL Query à entrada de Materialize Dataset.

![Ligar a saída de SQL Query à entrada de Materialize Dataset.](report-pipeline-guide-build-materialize-connect.png)

### 3. Dar um nome ao conjunto

Abra a configuração de Materialize Dataset. Defina **Dataset name** com o nome escolhido. O exemplo usa `request_summary`.

![Escolher um nome estável. Uma execução posterior substitui as linhas guardadas.](report-pipeline-guide-dataset-name.png)

### 4. Guardar a definição

Selecione **Save**.

![Guardar a definição antes de executar.](report-pipeline-guide-build-save.png)

### 5. Preparar o workflow

Selecione **Run**.

![Run prepara o acionador manual.](report-pipeline-guide-build-run.png)

### 6. Iniciar o acionador manual

Selecione o botão de reprodução de Manual Trigger. Aguarde Completed.

![Selecionar o botão de reprodução do acionador para iniciar a execução.](report-pipeline-guide-build-fire.png)

**Resultado esperado:** a execução de três passos guarda as linhas atuais da consulta com o nome escolhido.

![Completed confirma que o workflow chegou ao fim.](report-pipeline-guide-build-completed.png)

## Inspecionar e descarregar as linhas guardadas

Verifique o conjunto antes de criar o livro. Uma consulta de contagem tem uma linha cujo valor pode ser zero.

### 1. Abrir Datasets

Selecione **Datasets** na barra do workflow.

![Datasets abre os conjuntos de dados guardados dos workflows.](report-pipeline-guide-datasets-button.png)

### 2. Verificar o conjunto guardado

Leia o nome, a contagem de linhas e a hora de atualização. Confirme que o nome corresponde a Materialize Dataset.

![Ler o nome guardado, a contagem de linhas e a hora de atualização.](report-pipeline-guide-dataset-row.png)

### 3. Descarregar CSV

Selecione **CSV** nessa linha para inspecionar os valores noutra ferramenta.

![CSV descarrega as linhas guardadas.](report-pipeline-guide-dataset-csv.png)

**Resultado esperado:** o CSV descarregado contém as linhas que o segundo workflow irá carregar.

## Criar o workflow do livro

Use um segundo workflow para ler as linhas preparadas. Pode executar depois de o primeiro atualizar o conjunto.

### 1. Criar e dar um nome ao workflow

Regresse a Workflows e escolha New. Defina um nome como `Create summary workbook`.

![New abre um workflow vazio.](report-pipeline-guide-deliver-new.png)

![Dar um nome ao workflow conforme a tarefa.](report-pipeline-guide-deliver-name.png)

### 2. Adicionar Manual Trigger

Arraste Manual Trigger da biblioteca para a área de desenho.

![Arrastar Manual Trigger de Node library para a área de desenho.](report-pipeline-guide-deliver-manual.png)

### 3. Adicionar Load Dataset

Arraste Load Dataset para o lado.

![Arrastar Load Dataset de Node library para a área de desenho.](report-pipeline-guide-deliver-load.png)

### 4. Ligar o acionador

Ligue a saída de Manual Trigger à entrada de Load Dataset.

![Ligar a saída de Manual Trigger à entrada de Load Dataset.](report-pipeline-guide-deliver-load-connect.png)

### 5. Escolher o conjunto guardado

Abra a configuração de Load Dataset. Defina Dataset name com o nome exato escrito pelo primeiro workflow, como `request_summary`. Feche o painel.

![Carregar o nome exato produzido pelo primeiro workflow.](report-pipeline-guide-load-name.png)

### 6. Adicionar Excel Template

Arraste Excel Template para a área de desenho depois de Load Dataset.

![Arrastar Excel Template de Node library para a área de desenho.](report-pipeline-guide-deliver-excel.png)

### 7. Ligar Excel Template

Ligue a saída de Load Dataset à entrada de Excel Template.

![Ligar a saída de Load Dataset à entrada de Excel Template.](report-pipeline-guide-deliver-excel-connect.png)

## Configurar o modelo do livro

Use o seu livro .xlsx. Coloque cabeçalhos por cima das células que irão receber dados. Associe os nomes dos campos recebidos às colunas.

### 1. Guardar antes de carregar

Selecione Save. Carregar um modelo exige um identificador de workflow guardado.

![Guardar primeiro para que o carregamento tenha um identificador de workflow.](report-pipeline-guide-template-save.png)

### 2. Carregar o modelo

Abra a configuração de Excel Template, selecione **Upload template** e escolha o ficheiro .xlsx. A chave do artefacto é preenchida após carregar.

![Carregar o seu livro .xlsx com uma linha de cabeçalhos.](report-pipeline-guide-template-upload.png)

![O carregamento preenche a chave do artefacto do modelo.](report-pipeline-guide-template-uploaded.png)

### 3. Definir a primeira célula de dados

Defina **Start cell** como a célula de dados superior esquerda. Use A2 quando a primeira linha contém os cabeçalhos.

![A2 escreve dados por baixo do cabeçalho da primeira linha.](report-pipeline-guide-start-cell.png)

### 4. Associar as colunas por ordem

Em **Columns (ordered)**, introduza os nomes dos campos recebidos separados por vírgulas. O exemplo de contagem usa apenas `requests`.

![Listar os campos recebidos pela ordem das colunas do livro.](report-pipeline-guide-template-columns.png)

### 5. Escolher um cabeçalho de filtro opcional

Defina **Auto-filter header cell** como A1 para um filtro na primeira linha ou deixe vazio.

![A1 ativa um filtro na linha de cabeçalhos.](report-pipeline-guide-auto-filter.png)

### 6. Dar um nome ao ficheiro produzido

Defina **File name**, por exemplo `request-summary.xlsx`.

![Definir o nome do ficheiro a descarregar.](report-pipeline-guide-file-name.png)

## Executar e verificar o livro

Confirme o ficheiro antes de agendar ou enviar por correio. Verifique os valores reais, cabeçalhos e formatação na aplicação de folhas de cálculo.

### 1. Guardar as definições do modelo

Selecione Save.

![Guardar a definição antes de executar.](report-pipeline-guide-deliver-save.png)

### 2. Preparar a execução

Selecione Run.

![Run prepara o acionador manual.](report-pipeline-guide-deliver-run.png)

### 3. Iniciar Manual Trigger

Selecione o botão de reprodução e aguarde Completed.

![Selecionar o botão de reprodução do acionador para iniciar a execução.](report-pipeline-guide-deliver-fire.png)

### 4. Descarregar o ficheiro produzido

Abra Excel Template, selecione Output e depois o livro identificado para descarregar.

![Descarregar o livro produzido a partir de Output de Excel Template.](report-pipeline-guide-workbook-download.png)

**Resultado esperado:** o livro contém as linhas guardadas. O exemplo tem Requests em A1 e zero numérico em A2.

![Completed confirma que o workflow chegou ao fim.](report-pipeline-guide-deliver-completed.png)

## Agendar a reconstrução

Acrescente o agendamento depois de uma execução manual produzir as linhas pretendidas. Uma expressão cron de cinco partes define minuto, hora, dia do mês, mês e dia da semana.

### 1. Adicionar Schedule

Abra o primeiro workflow e arraste Schedule de Node library para a área de desenho.

![Arrastar Schedule de Node library para a área de desenho.](report-pipeline-guide-schedule-node.png)

### 2. Definir a expressão cron

Abra a configuração de Schedule. Defina **Cron Expression** para a hora pretendida. `0 6 * * *` significa 06:00 todos os dias no fuso escolhido.

![Definir uma expressão cron de cinco partes para a hora de reconstrução.](report-pipeline-guide-schedule-cron.png)

### 3. Definir o fuso horário

Introduza um fuso IANA como `Africa/Dar_es_Salaam`. Timezone vazio usa UTC.

![Usar o fuso em que o agendamento deve ser interpretado.](report-pipeline-guide-schedule-timezone.png)

### 4. Ligar o agendamento

Feche a configuração e ligue a saída de Schedule à entrada de SQL Query. O acionador manual pode ficar para execuções manuais intencionais.

![Ligar a saída de Schedule à entrada de SQL Query.](report-pipeline-guide-schedule-connect.png)

### 5. Guardar a definição agendada

Selecione Save quando pretende ativar o agendamento ligado. Consulte History após a primeira hora prevista.

![Save ativa o agendamento ligado.](report-pipeline-guide-schedule-save.png)

**Resultado esperado:** o agendamento guardado determina quando o conjunto é reconstruído. Esta verificação guardou as definições e depois desativou o workflow de teste. O acionamento pelo relógio não foi testado.

## Configurar o envio opcional por correio

Acrescente o envio apenas após aprovação do conector e dos destinatários. A verificação mostra um conector de retorno local não utilizado e um endereço example.invalid. Este nó não foi guardado nem executado.

### 1. Adicionar e ligar Send Email

Abra o workflow do livro, acrescente Send Email (SMTP) e ligue a saída de Excel Template à sua entrada.

![Arrastar Send Email (SMTP) de Node library para a área de desenho.](report-pipeline-guide-email-node.png)

![Ligar a saída de Excel Template à entrada de Send Email (SMTP).](report-pipeline-guide-email-connect.png)

### 2. Escolher o conector de correio

Abra a configuração do nó. Escolha o conector SMTP aprovado. Gmail e Outlook têm os seus próprios tipos de nós e conectores correspondentes.

![Escolher o conector SMTP aprovado.](report-pipeline-guide-email-connector.png)

### 3. Definir os destinatários

Introduza os destinatários aprovados em To. Acrescente Cc apenas se necessário. Substitua o endereço de exemplo pelo destino real autorizado.

![Introduzir o destinatário aprovado. Este endereço de exemplo não pode receber correio.](report-pipeline-guide-email-to.png)

### 4. Definir o assunto

Introduza um Subject claro.

![Dar um assunto claro à mensagem.](report-pipeline-guide-email-subject.png)

### 5. Escrever o corpo

Introduza o Body da mensagem.

![Escrever o corpo da mensagem.](report-pipeline-guide-email-body.png)

### 6. Escolher o formato correspondente

Escolha Plain text ou HTML conforme o texto escrito.

![Escolher Plain text ou HTML conforme o corpo da mensagem.](report-pipeline-guide-email-format.png)

### 7. Anexar o campo do livro

Defina **Attachment field** como `file`, o campo de saída de Excel Template. Um valor vazio não envia anexo.

![Usar file para anexar a saída de Excel Template.](report-pipeline-guide-email-attachment.png)

**Resultado esperado:** as definições identificam o transporte, os destinatários, o conteúdo e o anexo. Guardar e executar um nó de correio ligado envia correio real. Verifique a caixa de destino apenas quando a equipa autorizar esse teste.

## Inspecionar workflows de relatórios num telemóvel

Construa a área de desenho num ecrã maior. No telemóvel, use a lista e History para inspecionar uma definição existente.

### 1. Encontrar os workflows

Pesquise os nomes em Workflows.

![Encontrar os workflows de relatórios guardados no telemóvel.](report-pipeline-guide-phone-find.png)

### 2. Abrir o workflow do livro

Selecione o nome na lista.

![Abrir o workflow do livro para inspecionar o histórico.](report-pipeline-guide-phone-open.png)

### 3. Ler History

Selecione History e verifique o estado e a hora da execução.

![Ler a execução manual concluída em History.](report-pipeline-guide-phone-history.png)

## Livro opcional de prática

[Descarregar o livro de prática com uma coluna](https://openldr.online/docs-samples/user-guide/report-pipeline/example-summary-template.xlsx). Contém o cabeçalho Requests em A1. Destina-se ao exemplo de contagem só de leitura acima e não contém dados de pacientes. O seu livro pode usar outras colunas e formatação.

[Descarregar o livro produzido na verificação](https://openldr.online/docs-samples/user-guide/report-pipeline/generated-request-summary.xlsx) para comparar o resultado esperado. Este ficheiro veio da execução real isolada, com zero pedidos no armazém.

## Adaptar o resumo ao seu relatório

Substitua a contagem pelo SELECT aprovado e associe os campos ao livro. Para outra base, use um nó de conector Postgres, MySQL ou Microsoft SQL correspondente.

Para períodos de relatório, defina periodStart e periodEnd antes da consulta e leia com `{{ $json.periodStart }}`. Mantenha a consulta, os tipos dos parâmetros e os limites de datas coerentes com a origem.

Use Pivot para transformar um valor recebido em várias colunas. Use Merge com Combine by key para juntar dois ramos. Configure as chaves reais e as regras de colisão necessárias. Estas transformações maiores não foram testadas nesta verificação.

Também pode abrir os conjuntos em Datasets de [Consultas](/docs/query). Publicar conjuntos de workflows no SQL do armazém é uma opção de Settings. Mantenha o mesmo nome nos dois workflows.

## Escolher a hora de envio

Agende o workflow do livro para depois da hora prevista de conclusão da atualização. Reserve tempo para a consulta de origem. Um simples intervalo não garante que um primeiro workflow invulgarmente lento terminou. Verifique a hora de atualização do conjunto e History.

Run manual também usa o conjunto atualmente guardado. Não reconstrói automaticamente o primeiro workflow. Execute novamente o primeiro quando precisa de dados recentes.

## Resolução de problemas

**Falta o conjunto de dados.** Execute o primeiro workflow e verifique erros em Materialize Dataset. Confirme o nome exato em Load Dataset.

**O livro está vazio.** Inspecione o CSV e os nomes dos campos recebidos. Uma consulta filtrada pode legitimamente não devolver linhas.

**O carregamento pede para guardar primeiro.** Guarde o workflow e carregue novamente. O carregamento pertence a esse workflow guardado.

**Os valores surgem nas colunas erradas.** Verifique Start cell e Columns (ordered). A associação escreve os campos da esquerda para a direita na ordem indicada.

**O agendamento não produziu o ficheiro esperado.** Verifique se o workflow está ativo, a expressão cron, o fuso e depois History. Um agendamento guardado não prova que foi acionado.

**Um correio não tem o livro.** Verifique a saída anterior de Excel Template e Attachment field. Confirme separadamente o transporte e o destinatário reais.

## Guias relacionados

[Workflows](/docs/workflows) explica a área de desenho e o histórico. [Consultas](/docs/query) permite consultar conjuntos guardados. [Conectores](/docs/connectors) configura os transportes de origem e envio.
