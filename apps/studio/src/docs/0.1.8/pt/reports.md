# Relatórios

Use Reports para executar uma entrada da biblioteca com filtros, ler Document ou Spreadsheet, exportar resultados e consultar o histórico. Um agendamento guarda um ficheiro para um período. Não o envia por email.

Comece com um relatório adequado aos dados recebidos. Não precisa de dados de exemplo. As imagens usam Request summary report criado em Report Designer. O armazém de teste tem zero pedidos. A consulta devolve uma linha com zero.

Precisa de **View reports** para abrir a biblioteca, **Run reports** para executar entradas e **Export reports** para descarregar resultados. **Edit report templates** permite gerir agendamentos, Edit template e ações de gestão dos relatórios.

Para acrescentar um relatório à biblioteca, guarde um desenho e use Create report from this design em [Editor de relatórios](/docs/report-designer). Publish revision, por si só, não cria uma entrada.

## Encontrar e abrir um relatório

Use o nome e a categoria para escolher a entrada pretendida antes de definir filtros.

### 1. Abrir Reports

Selecione Reports no menu principal.

![Abra Reports no menu principal.](reports-guide-open-page.png)

### 2. Pesquisar na biblioteca

Introduza parte do nome em Search reports. Limpe a pesquisa para repor toda a biblioteca.

![Pesquise na biblioteca pelo nome do relatório.](reports-guide-search.png)

### 3. Selecionar o relatório

Selecione o nome sob a categoria. O exemplo é Request summary report em Operational.

![Selecione o relatório sob a categoria.](reports-guide-select-report.png)

### 4. Abrir as ações

Selecione Actions junto do título do relatório escolhido.

![O relatório escolhido tem o próprio menu Actions.](reports-guide-report-actions.png)

## Escolher filtros e executar o relatório

Escolha datas e outros filtros adequados à pergunta. A consulta do exemplo inclui ambas as datas de calendário selecionadas.

### 1. Abrir Parameters

Escolha Parameters no menu Actions do relatório.

![Parameters abre os filtros do relatório.](reports-guide-first-parameters.png)

### 2. Abrir o período

Selecione o controlo Period. Outros relatórios podem chamar-lhe Date range ou usar filtros diferentes.

![Abra o controlo de datas para o período do relatório.](reports-guide-first-period.png)

### 3. Escolher as datas do relatório

Escolha uma predefinição, como This year, ou use os seletores de mês, ano e o calendário. Preencha outros filtros obrigatórios.

![Escolha uma predefinição ou as suas datas.](reports-guide-first-preset.png)

### 4. Executar o relatório

Selecione Run no painel dos parâmetros. Aguarde o resultado completo.

![Run executa o relatório com os filtros escolhidos.](reports-guide-first-run.png)

**Resultado esperado:** Document apresenta o relatório com os valores escolhidos. O zero deste exemplo é um resultado válido.

![Document apresenta a execução escolhida em PDF.](reports-guide-document.png)

## Descarregar o documento e a folha de cálculo

Use Document para a apresentação imprimível e Spreadsheet para as linhas exatas. Os nomes podem diferir porque o desenho pode mudar os nomes das colunas impressas.

### 1. Descarregar o PDF

Em Document, use Download para guardar o PDF. As setas de página e o zoom alteram a vista.

![Download guarda o PDF desta execução.](reports-guide-pdf-download.png)

### 2. Abrir Spreadsheet

Selecione Spreadsheet acima do resultado.

![Spreadsheet mostra as linhas da consulta numa tabela.](reports-guide-spreadsheet-tab.png)

### 3. Verificar os valores das linhas

Leia os nomes das colunas e as células antes de exportar. O exemplo mostra requests igual a zero.

![Leia a contagem real na linha da folha de cálculo.](reports-guide-spreadsheet-result.png)

### 4. Exportar CSV para obter o resultado da consulta

Selecione Export CSV. A consulta volta a executar com os parâmetros do resultado mostrado. Os filtros e a ordenação de Spreadsheet não se aplicam ao CSV. Alterações da origem após a execução podem afetar o ficheiro.

![Export CSV executa a consulta com os parâmetros da execução atual.](reports-guide-export-csv.png)

### 5. Exportar as linhas filtradas em XLSX

Selecione Export XLSX. Usa o resultado carregado com os filtros e a ordenação de Spreadsheet em todas as páginas. Inclui todas as colunas, mesmo as ocultas no ecrã.

![Export XLSX descarrega os filtros e a ordenação atuais da folha de cálculo.](reports-guide-export-xlsx.png)

**Resultado esperado:** o navegador descarrega o formato escolhido. Escolha a exportação cujo tratamento das linhas serve a tarefa.

## Filtrar e organizar linhas de Spreadsheet

Estes controlos alteram a vista carregada de Spreadsheet. Não alteram a definição do relatório nem a apresentação Document.

### 1. Acrescentar um filtro

Selecione Filter e depois Add filter.

![Add filter cria uma regra da folha de cálculo.](reports-guide-filter-add.png)

### 2. Escolher a coluna

Selecione a coluna a filtrar. O exemplo tem uma coluna requests.

![Escolha a coluna do resultado a filtrar.](reports-guide-filter-column.png)

### 3. Definir o valor da regra

Escolha um operador e introduza o valor. O exemplo usa Equals e 0.

![Introduza um valor adequado à coluna do resultado.](reports-guide-filter-value.png)

### 4. Aplicar a regra

Selecione Apply para atualizar as linhas mostradas.

![Apply altera as linhas mostradas em Spreadsheet.](reports-guide-filter-apply.png)

### 5. Acrescentar uma ordenação

Selecione Sort, depois Add sort e escolha uma coluna do resultado.

![Escolha Add sort para ordenar as linhas carregadas.](reports-guide-sort-add.png)

### 6. Escolher a direção

Use Asc ou Desc e selecione Apply. Este exemplo tem uma linha, pelo que a ordem não muda visivelmente.

![Asc ordena dos valores menores para os maiores. Selecione-o para mudar a direção.](reports-guide-sort-order.png)

### 7. Escolher as colunas visíveis

Abra Columns e use as caixas de seleção. A última coluna visível não pode ser ocultada. Feche o menu quando terminar.

![Columns altera os campos visíveis na página.](reports-guide-columns.png)

![Marque os campos necessários. A última coluna visível não pode ser ocultada.](reports-guide-column-options.png)

### 8. Repor ou usar as páginas

Reset limpa as regras e alterações de colunas. Use Rows per page e as setas quando o resultado ocupar várias páginas.

![Reset limpa filtros, ordenação e alterações de colunas.](reports-guide-reset-table.png)

![Use o tamanho de página e as setas quando houver mais linhas.](reports-guide-pagination.png)

## Atualizar um resultado apresentado

Use esta tarefa após mudanças nos dados para repetir a mesma pergunta.

### 1. Escolher Refresh

Abra o menu Actions do relatório e escolha Refresh. Usa os valores do resultado apresentado, mesmo com uma edição de parâmetros por terminar.

![Refresh volta a executar com os valores do resultado apresentado.](reports-guide-refresh.png)

**Resultado esperado:** a consulta executa novamente. A nova contagem pode ser igual à anterior.

## Consultar o histórico de execuções interativas

Use o histórico para identificar quando um relatório foi executado ou descarregado e os parâmetros dessa execução.

### 1. Abrir Run History

Abra Actions e escolha Run History.

![Run History lista execuções interativas e tentativas agendadas guardadas.](reports-guide-history.png)

### 2. Ler Activity

Confira formato, número de linhas, utilizador e hora. Preview é uma execução interativa. pdf, csv e xlsx identificam descargas.

![Leia formato, número de linhas, utilizador e hora de cada execução interativa.](reports-guide-history-rows.png)

### 3. Repor uma escolha anterior de parâmetros

Selecione uma linha Activity para repor os parâmetros nos controlos. Abra Parameters e Run para um novo resultado. Selecionar o histórico não reproduz o resultado guardado.

![Selecionar uma linha de atividade repõe os parâmetros sem reproduzir o resultado antigo.](reports-guide-history-apply.png)

## Criar um agendamento de relatório

Um agendamento guarda um resultado para um período. Não tem campo de destinatário. Confira o ficheiro gerado antes de depender das execuções automáticas.

### 1. Abrir Schedules

Abra Actions e escolha Schedules.

![Schedules gere os resultados automáticos deste relatório.](reports-guide-schedules.png)

### 2. Escolher New Schedule

Selecione New Schedule no painel de agendamentos.

![New Schedule abre as definições do agendamento.](reports-guide-new-schedule.png)

### 3. Escolher a frequência

Defina Frequency. O exemplo escolhe Weekly.

![Escolha a frequência do agendamento.](reports-guide-weekly.png)

### 4. Escolher o dia

Para Weekly, escolha Day of week. O exemplo usa Mon. Monthly oferece os dias 1 a 28.

![Escolha o dia da semana para o agendamento semanal.](reports-guide-weekday.png)

### 5. Escolher o formato de saída

Defina Output format como CSV, XLSX ou PDF. O exemplo usa PDF.

![Escolha o formato do ficheiro guardado.](reports-guide-schedule-format.png)

### 6. Guardar o agendamento

Abra os pontos Actions do editor e escolha Save. O período é calculado na execução, em vez de ser guardado como datas fixas.

![O editor do agendamento tem o próprio menu Actions.](reports-guide-schedule-actions.png)

![Save guarda o agendamento.](reports-guide-schedule-save-step-6.png)

**Resultado esperado:** a lista mostra frequência, formato, interruptor de ativação e próxima execução.

![O agendamento guardado mostra frequência, formato e próxima execução.](reports-guide-schedule-saved.png)

## Executar agora e descarregar o resultado guardado

Run now permite verificar um novo agendamento. Uma mensagem de fila não prova sucesso. Consulte Scheduled Runs para o resultado.

### 1. Colocar a execução em fila

Mantenha o agendamento ativo e selecione Run now. Um agendamento desligado não executa, mesmo que mostre uma mensagem de fila.

![Run now coloca uma execução imediata em fila. Confira o resultado em Scheduled Runs.](reports-guide-schedule-run.png)

### 2. Abrir Scheduled Runs

Feche Schedules. Abra Actions, Run History e o separador Scheduled Runs. Reabra o painel se o resultado ainda não chegou.

![Scheduled Runs separa resultados agendados guardados da atividade interativa.](reports-guide-scheduled-tab.png)

### 3. Ler o estado e o período

Confira OK ou Failed e o período registado. Uma tentativa falhada não tem ficheiro de saída.

![Confira OK e o período registado antes de descarregar.](reports-guide-scheduled-result.png)

### 4. Descarregar o resultado com sucesso

Selecione Download numa execução guardada com sucesso.

![Download obtém o resultado guardado com sucesso.](reports-guide-scheduled-download.png)

**Resultado esperado:** o PDF descarregado é o resultado agendado guardado. Não substitui o resultado apresentado na página do relatório.

## Desativar, alterar ou remover um agendamento

Use os controlos da linha correta. A verificação desliga e remove o agendamento descartável após conferir o ficheiro guardado.

### 1. Desativar as execuções automáticas

Abra Schedules e desligue o interruptor da linha. Uma data Next apresentada não se sobrepõe ao interruptor desligado.

![Desligue o interruptor para parar futuras execuções automáticas.](reports-guide-schedule-toggle.png)

### 2. Editar o agendamento guardado

Selecione Edit na linha.

![Edit altera a frequência, os filtros ou o formato guardados.](reports-guide-schedule-edit.png)

### 3. Guardar as alterações pretendidas

Altere as definições necessárias e use Actions e Save nesse editor. O exemplo muda o formato do agendamento desligado para XLSX.

![Este exemplo desligado muda o formato futuro para XLSX.](reports-guide-schedule-edit-format.png)

![Save guarda o agendamento.](reports-guide-schedule-save-step-3.png)

### 4. Remover um agendamento sem uso

Selecione Delete na linha correta.

![Delete remove apenas o agendamento selecionado.](reports-guide-schedule-delete.png)

### 5. Confirmar a remoção

Leia a confirmação e selecione Delete se pretender remover esse agendamento.

![Confirme a remoção quando o agendamento deixar de ser necessário.](reports-guide-schedule-delete-confirm.png)

**Resultado esperado:** o agendamento escolhido desaparece. A verificação não deixa agendamentos ativos ou guardados para o relatório.

## Manter um relatório fácil de encontrar

Os favoritos organizam a biblioteca neste navegador. Não alteram os dados dos relatórios.

### 1. Fixar o relatório

Aponte para a linha do relatório e selecione a estrela. Também aparece em Pinned.

![Fixe o relatório para o manter perto do topo da biblioteca deste navegador.](reports-guide-pin.png)

### 2. Retirar o favorito

Selecione novamente a estrela preenchida para deixar de o fixar.

![Selecione novamente a estrela preenchida para retirar o favorito.](reports-guide-unpin.png)

## Abrir o desenho associado

Use esta tarefa quando um responsável autorizado precisar de alterar a apresentação ou os filtros do modelo.

### 1. Escolher Edit template

Abra Actions e selecione Edit template.

![Edit template abre o desenho associado em Report Designer.](reports-guide-edit-template.png)

### 2. Verificar o nome do desenho

Confirme que Report Designer abriu o desenho associado pretendido antes de editar.

![O modelo associado abre para um responsável autorizado.](reports-guide-edit-template-result.png)

## Retirar um relatório da publicação

Use Unpublish para ocultar uma entrada da biblioteca mantendo o desenho. O relatório passa a Draft.

### 1. Escolher Unpublish

Abra o menu **Actions** do relatório pretendido e selecione **Unpublish**.

![Escolha Unpublish para o relatório que pretende ocultar.](reports-guide-unpublish.png)

### 2. Confirmar a saída da biblioteca

Confira a mensagem **Report unpublished** e a lista da biblioteca. O relatório já não deve aparecer.

![Report unpublished confirma o sucesso da ação.](reports-guide-unpublish-success.png)

**Resultado esperado:** o relatório está em Draft e já não aparece na biblioteca. O desenho continua disponível em Report Designer.

## Eliminar um relatório sem uso da biblioteca

Delete elimina definitivamente a definição selecionada. Confira se a equipa já não precisa dela. O exemplo remove uma entrada descartável e mantém o relatório principal e o desenho.

### 1. Escolher Delete report

Abra Actions do relatório sem uso e selecione Delete report.

![Delete report elimina definitivamente a entrada selecionada.](reports-guide-delete-report.png)

### 2. Confirmar a ação indicada

Leia a confirmação e escolha Delete report apenas para a remoção pretendida.

![Confirme apenas a entrada que pretende remover.](reports-guide-delete-report-confirm.png)

**Resultado esperado:** a entrada desaparece da biblioteca. O desenho associado continua disponível em Report Designer.

## Executar um relatório existente num telemóvel

A biblioteca começa recolhida numa barra estreita. Use-a para escolher o relatório e depois dê mais espaço ao resultado.

### 1. Expandir a biblioteca

Selecione Expand library na barra estreita.

![Expanda a barra da biblioteca num telemóvel.](reports-guide-phone-library.png)

### 2. Encontrar e escolher o relatório

Pesquise pelo nome e selecione-o. Recolha a biblioteca depois.

![Pesquise e abra o relatório.](reports-guide-phone-select.png)

### 3. Escolher as datas

Abra Actions e Parameters. Abra o período e escolha uma predefinição ou datas. No telemóvel, as predefinições mudam de linha acima de um único mês.

![As predefinições mudam de linha acima do calendário de um mês no telemóvel.](reports-guide-phone-dates.png)

### 4. Executar com os valores selecionados

Selecione Run no painel dos parâmetros.

![Run continua disponível no painel dos parâmetros do relatório.](reports-guide-phone-run.png)

### 5. Ler Spreadsheet

Após terminar, selecione Spreadsheet e consulte os valores. Tabelas largas podem deslocar-se horizontalmente.

![Spreadsheet mostra o mesmo resultado completo num telemóvel.](reports-guide-phone-result.png)

## Compreender a hora e os períodos dos agendamentos

Os agendamentos executam às 06:00 UTC. O editor não tem definição separada de hora ou fuso. Next e Last usam o fuso do navegador. O filtro de fuso do relatório controla o agrupamento dos dados, não o relógio do agendamento.

Um novo agendamento Daily começa amanhã. Weekly usa o próximo dia escolhido, nunca hoje. Monthly usa o dia escolhido do próximo mês. Quarterly usa o primeiro dia do próximo trimestre civil.

| Frequência | Período na execução |
| --- | --- |
| Daily | O dia UTC anterior. |
| Weekly | Os sete dias UTC anteriores, até ontem. |
| Monthly | O mês civil anterior em UTC. |
| Quarterly | O trimestre civil anterior em UTC. |

Run now usa o mesmo período calculado. Não reutiliza as datas escolhidas na página do relatório. A consulta deve incluir o dia final completo. A execução semanal verificada cobriu 5 a 11 de novembro de 2026.

## Compreender filtros e dados dos relatórios

Os filtros vêm dos parâmetros do modelo. Altere-os em Report Designer. A consulta principal fornece as linhas de Spreadsheet. As associações dos elementos fornecem Document. Um relatório pode ter várias tabelas associadas enquanto Spreadsheet mostra a consulta principal.

Reports fornece as datas escolhidas aos parâmetros de consulta Date range, incluindo `period`. As consultas existentes com parâmetros Text chamados `from` e `to` continuam compatíveis. Apresente as datas com um parâmetro de modelo Date range em Report Designer.

Os relatórios exigem dados recebidos diferentes. Um relatório de amostras, organismos ou suscetibilidade não os pode inventar a partir de uma contagem de pedidos. Um resultado vazio pode ser correto para os filtros ou dados disponíveis.

Nos relatórios integrados, Facility costuma significar o laboratório que testa. Leia a ajuda do filtro e a consulta antes de assumir agrupamento pela clínica que enviou o pedido.

## Executar um relatório pela CLI

Use `./openldr` na pasta instalada em Linux ou macOS, `.\openldr.ps1` em Windows, ou `pnpm openldr` numa cópia de desenvolvimento. Execute o comando na sua pasta `openldr_ce`. [Start here](/docs/start-here) explica o lançador e os caminhos.

```shell
./openldr report list
./openldr report run REPORT_ID --param from=2026-01-01 --param to=2026-11-12 --json
./openldr report run REPORT_ID --param from=2026-01-01 --param to=2026-11-12 --format pdf --out data/report.pdf
```

Substitua REPORT_ID pela entrada listada no primeiro comando. Substitua as datas e os caminhos de saída pelos valores pretendidos. A execução JSON verificada pela CLI devolveu uma linha com requests igual a zero.

## Resultados opcionais de verificação

O uso normal precisa dos seus relatórios e dados recebidos. Não exige um pacote de documentação. Para criar o mesmo relatório pequeno, use a consulta opcional em [Editor de relatórios](/docs/report-designer#referencia-opcional-de-pratica).

As descargas reais são [o PDF interativo](https://openldr.online/docs-samples/user-guide/reports/request-summary.pdf), [CSV](https://openldr.online/docs-samples/user-guide/reports/request-summary.csv), [XLSX](https://openldr.online/docs-samples/user-guide/reports/request-summary.xlsx) e [o PDF agendado guardado](https://openldr.online/docs-samples/user-guide/reports/scheduled-request-summary.pdf). Contêm apenas uma contagem de pedidos igual a zero.

## Resolução de problemas

**A biblioteca está vazia.** Limpe a pesquisa e confira View reports. Publicar um desenho, por si só, não cria uma entrada.

**Run está indisponível.** Preencha os filtros obrigatórios e confira Run reports. Uma consulta pode exigir valores que o modelo não marcou como obrigatórios.

**Um relatório não devolve linhas.** Confira o período, a unidade e os registos de origem necessários. Um ficheiro de exemplo não é requisito para relatórios reais.

**Um relatório personalizado indica required parameter: period.** Defina ambas as datas em Parameters e execute novamente. Confira se o desenho apresenta um filtro Date range e se a consulta declara os parâmetros obrigatórios.

**Falta uma execução agendada.** Confira o interruptor de ativação, feche e reabra Scheduled Runs. Uma mensagem de fila, por si só, não comprova execução.

**Uma execução agendada indica Failed.** Num computador, aponte para o estado para ler o erro guardado. Corrija as definições reais e repita Run now.

## Guias relacionados

[Editor de relatórios](/docs/report-designer) define a apresentação e cria entradas na biblioteca. [Consultas](/docs/query) define os dados. [Relatórios agendados com workflows](/docs/report-pipeline) cobre workflows de livros personalizados e email.
