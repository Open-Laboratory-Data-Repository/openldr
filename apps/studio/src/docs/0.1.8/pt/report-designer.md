# Editor de relatórios

Use Report Designer para organizar elementos imprimíveis, ligá-los a Custom Queries guardadas e criar relatórios para a biblioteca. Um desenho controla a página. Uma consulta fornece linhas. Os parâmetros do modelo definem os filtros introduzidos ao executar um relatório.

Comece pela consulta guardada e pela disposição de página pretendida. Não precisa de dados de exemplo da documentação. As imagens usam uma consulta de relatório com zero pedidos numa instalação de teste separada. A prática opcional está no fim.

Precisa de **Edit report templates** para criar, editar e publicar desenhos. **View reports** abre a biblioteca e **Run reports** executa as entradas.

Publicar uma revisão do desenho e criar um relatório de biblioteca são ações separadas. Guarde o novo desenho antes de qualquer uma.

## Inspecionar um desenho de relatório existente

Compreenda assim a ligação entre uma tabela existente, a consulta e os filtros expostos pelo relatório.

### 1. Abrir Report Designer

Selecione Report Designer no menu principal.

![Abra Report Designer para inspecionar e criar disposições de relatório.](report-designer-guide-open-page.png)

### 2. Escolher um modelo

Selecione uma entrada existente em Templates. O exemplo abre Test Volume Over Time.

![Selecione um desenho existente em Templates.](report-designer-guide-existing-template.png)

### 3. Selecionar a tabela

Selecione o elemento de tabela na página imprimível.

![Selecione o elemento de tabela na página.](report-designer-guide-existing-table.png)

### 4. Ler as definições Data

Selecione Data no inspetor à direita. Verifique Bind query e os Parameters do modelo abaixo.

![Data mostra a ligação da consulta e os parâmetros do modelo.](report-designer-guide-existing-data-tab.png)

![A consulta ligada fornece as linhas. Os parâmetros do modelo definem filtros de execução.](report-designer-guide-existing-binding.png)

## Criar um desenho de tabela separado

Use um desenho novo para o relatório em vez de alterar uma definição integrada partilhada.

### 1. Escolher New template

Abra More actions acima do quadro e selecione New template. O editor vazio também oferece New template.

![More actions contém as operações dos modelos.](report-designer-guide-actions.png)

![New template inicia um desenho separado.](report-designer-guide-new-template.png)

### 2. Dar nome ao desenho

Introduza um Report name claro, como Request summary design.

![Defina Report name conforme o relatório precisa.](report-designer-guide-design-name.png)

### 3. Inserir uma tabela

Abra More actions, aponte para Insert e selecione Table.

![Insert lista os tipos de elementos imprimíveis.](report-designer-guide-insert.png)

![Table adiciona uma tabela de dados ao desenho.](report-designer-guide-insert-table.png)

### 4. Selecionar a tabela

A Table inserida fica selecionada. Arraste para a posição pretendida e use as pegas para mudar o tamanho. O exemplo mantém a posição inicial.

![A nova tabela está selecionada para configurar.](report-designer-guide-new-table.png)

## Escolher a consulta da tabela

Use uma consulta guardada que devolva as colunas pretendidas. Se tiver parâmetros, defina valores predefinidos correspondentes no modelo antes de carregar as colunas.

### 1. Abrir Data

Com a tabela selecionada, selecione Data no inspetor.

![Abra Data para a tabela personalizada selecionada.](report-designer-guide-new-data-tab.png)

### 2. Ligar a consulta guardada

Abra Bind query e escolha a Custom Query. O exemplo usa Request count for reporting, com dois parâmetros de consulta Text obrigatórios chamados from e to.

![Escolha a Custom Query guardada.](report-designer-guide-bind-query.png)

## Definir o filtro do relatório e os valores de pré-visualização

Em Reports, o filtro atual de intervalo de datas passa valores simples from e to. A consulta de exemplo declara-os como dois parâmetros Text obrigatórios. O modelo fornece um controlo Date range. Uma consulta do editor com um único parâmetro daterange falha atualmente quando ligada diretamente a Reports.

### 1. Adicionar um parâmetro de modelo

Selecione Add parameter abaixo das definições de ligação.

![Add parameter define um filtro exposto pelo modelo.](report-designer-guide-add-parameter.png)

### 2. Fazer corresponder a chave da consulta

Defina uma Key única, como period. Este controlo de intervalo fornece os valores from e to usados pela consulta de relatório.

![Defina Key param1 conforme o relatório precisa.](report-designer-guide-parameter-key.png)

### 3. Escolher o nome visível

Defina Label com o texto a apresentar, como Period.

![Defina Label period conforme o relatório precisa.](report-designer-guide-parameter-label.png)

### 4. Fazer corresponder o tipo de parâmetro

Defina Type como Date range. A própria consulta usa dois parâmetros Text chamados from e to.

![Escolha Date range para o parâmetro da consulta.](report-designer-guide-parameter-type.png)

### 5. Definir o início predefinido

Introduza a primeira data incluída por predefinição. O exemplo usa 2026-01-01.

![Defina From period conforme o relatório precisa.](report-designer-guide-parameter-from.png)

### 6. Definir o fim predefinido

Introduza a última data incluída por predefinição. O exemplo usa 2027-01-01. A consulta inclui todo o último dia, como o calendário e o agendador do relatório. São valores de pré-visualização. Os utilizadores podem escolher outros.

![Defina To period conforme o relatório precisa.](report-designer-guide-parameter-to.png)

## Escolher e pré-visualizar a coluna impressa

Load columns usa os valores predefinidos do modelo para executar a consulta ligada. A consulta de contagem devolve uma coluna requests mesmo sem pedidos no armazém.

### 1. Carregar as colunas da consulta

Selecione Load columns. Leia o erro se a consulta ou os valores predefinidos forem inválidos.

![Load columns executa a consulta com os valores predefinidos do modelo.](report-designer-guide-load-columns.png)

### 2. Incluir a coluna

Marque requests para incluir na tabela. Escolha as colunas de saída reais necessárias ao relatório.

![Inclua a coluna requests na tabela impressa.](report-designer-guide-include-column.png)

### 3. Definir o nome impresso

Introduza um nome legível, como Requests. Altera o nome impresso, não o campo da consulta.

![Defina Label da coluna requests conforme o relatório precisa.](report-designer-guide-column-label.png)

### 4. Carregar os dados das páginas

Selecione Load pages acima do quadro. Executa os dados ligados e calcula a contagem física de páginas.

![Load pages obtém linhas e calcula o número de páginas impressas.](report-designer-guide-load-pages.png)

### 5. Mostrar os dados carregados

Selecione Show data. Recarregue as páginas após editar se a contagem estiver desatualizada.

![Show data preenche o quadro com as linhas carregadas.](report-designer-guide-show-data.png)

**Resultado esperado:** a tabela mostra a contagem real. Esta instalação imprime uma coluna Requests com zero.

![A coluna impressa contém a contagem atual, incluindo zero.](report-designer-guide-bound-result.png)

## Guardar e inspecionar o PDF

Guarde explicitamente um desenho novo. Depois verifique a página realmente produzida antes de publicar.

### 1. Guardar o desenho

Abra More actions e selecione Save. Espere por Saved. Após guardar a primeira vez, as alterações seguintes também são guardadas automaticamente.

![Save guarda o novo desenho antes da publicação.](report-designer-guide-save.png)

### 2. Abrir Preview

Abra More actions e selecione Preview.

![Preview produz o desenho atual de trabalho em PDF.](report-designer-guide-preview.png)

### 3. Verificar e descarregar a página produzida

Leia a pré-visualização PDF e use Download para uma cópia local. Feche a pré-visualização para voltar à edição.

![A pré-visualização mostra a saída real da consulta no desenho imprimível.](report-designer-guide-preview-result.png)

![Download guarda o PDF produzido.](report-designer-guide-preview-download.png)

**Resultado esperado:** a pré-visualização produz o desenho atual com os dados da consulta. Um desenho em rascunho tem a marca DRAFT.

## Publicar uma revisão guardada

Publique após verificar o desenho guardado. Uma revisão regista o estado publicado. Não acrescenta uma entrada à biblioteca Reports.

### 1. Publicar a revisão

Abra More actions e selecione Publish revision. Guarde primeiro se o editor pedir.

![Publish revision regista o desenho guardado sem criar um relatório de biblioteca.](report-designer-guide-publish.png)

### 2. Verificar o estado publicado

Verifique Published junto ao nome do desenho.

![Published confirma a revisão do desenho.](report-designer-guide-published.png)

**Resultado esperado:** o desenho guardado tem uma revisão publicada.

## Inspecionar versões publicadas

Identifique assim a revisão guardada antes de considerar um restauro.

### 1. Abrir Versions

Abra More actions e selecione Versions.

![Versions lista os estados publicados.](report-designer-guide-versions.png)

### 2. Ler a linha da revisão

Verifique a versão, a hora de publicação e o autor. Restore carrega esse estado na cópia de trabalho como alteração. Não publica outra revisão. Feche o painel se não precisar de restaurar.

![Leia a revisão, a hora e o autor antes de restaurar.](report-designer-guide-version-row.png)

## Criar a entrada de biblioteca do relatório

Faça esta tarefa quando o desenho e a consulta estiverem preparados. O relatório da biblioteca pode ter um nome diferente do desenho.

### 1. Escolher Create report from this design

Abra More actions e selecione Create report from this design.

![Create report from this design cria uma entrada de biblioteca separada.](report-designer-guide-create-report.png)

### 2. Dar nome ao relatório

Introduza o Name da biblioteca. O exemplo usa Request summary report.

![Escolha o nome do relatório na biblioteca.](report-designer-guide-report-name.png)

### 3. Escolher a categoria

Abra Category e escolha onde as pessoas devem encontrar o relatório, como Operational.

![Escolha a categoria onde as pessoas devem encontrar o relatório.](report-designer-guide-report-category.png)

### 4. Verificar as definições ligadas

Confirme Template e Primary query. O modelo controla a disposição Document. A consulta principal fornece as linhas Spreadsheet.

![Verifique o modelo selecionado para o relatório.](report-designer-guide-report-template.png)

![Verifique a consulta principal que fornece as linhas da folha de cálculo.](report-designer-guide-report-query.png)

### 5. Criar a entrada de biblioteca

Abra os pontos Actions do painel e selecione Create report.

![O painel New report tem os seus próprios pontos Actions.](report-designer-guide-report-actions.png)

![Create report adiciona a entrada com nome à biblioteca.](report-designer-guide-report-create.png)

**Resultado esperado:** a entrada está disponível na categoria em Reports. Abra os Parameters e execute aí. [Relatórios](/docs/reports) explica esse processo.

## Exportar diretamente do editor

Use estas exportações para obter saída do desenho atual sem abrir o relatório da biblioteca.

### 1. Exportar PDF

Abra More actions, aponte para Export e selecione PDF.

![Export PDF descarrega a saída do desenho atual.](report-designer-guide-export-pdf.png)

### 2. Exportar Excel

Abra More actions, aponte para Export e selecione Excel. As linhas ligadas tornam-se dados do livro.

![Export Excel descarrega as linhas ligadas da tabela.](report-designer-guide-export-excel.png)

**Resultado esperado:** o navegador descarrega o PDF produzido ou o livro.

## Controlar a visibilidade e o bloqueio dos elementos

Layers fornece controlos diretos para os elementos selecionados. Ocultar afeta a saída. Bloquear impede o movimento.

### 1. Abrir Layers

Selecione Layers no inspetor.

![Layers seleciona elementos e controla a visibilidade, o bloqueio e a ordem.](report-designer-guide-layers.png)

### 2. Ocultar um elemento quando pretendido

Use Hide Table, o controlo do olho, na tabela selecionada. Os elementos ocultos não aparecem no quadro nem no PDF.

![Use o olho para ocultar um elemento de propósito.](report-designer-guide-hide-layer.png)

### 3. Mostrar novamente

Use Show Table para repor.

![Use Show Table para repor o elemento oculto.](report-designer-guide-show-layer.png)

### 4. Bloquear a posição

Use Lock Table para impedir o movimento mantendo o elemento selecionável.

![Lock mantém o elemento selecionável e impede o movimento.](report-designer-guide-lock-layer.png)

### 5. Desbloquear novamente

Use Unlock Table quando quiser mover. O exemplo deixa a tabela visível e desbloqueada.

![Unlock Table permite mover novamente.](report-designer-guide-unlock-layer.png)

## Inspecionar um desenho existente num telemóvel

Use um ecrã grande para criar disposições de página. No telemóvel, encontre e inspecione um modelo existente ou execute o relatório em Reports.

### 1. Expandir Explorer

Selecione Expand explorer na barra estreita.

![Use a barra Explorer para encontrar um modelo existente no telemóvel.](report-designer-guide-phone-explorer.png)

### 2. Escolher o modelo existente

Selecione o nome e recolha Explorer quando precisar de espaço no quadro.

![Escolha o desenho existente. Use um ecrã maior para editar.](report-designer-guide-phone-template.png)

### 3. Abrir as ações

Use More actions para inspecionar as operações disponíveis. Altere a disposição num ecrã maior.

![Use More actions para inspecionar um desenho existente.](report-designer-guide-phone-actions.png)

## Escolher elementos de página e ferramentas de disposição

Insert também oferece Text, Letterhead, Key/value panel, Image, Barcode, QR code, Line, Rectangle, Date, Cell grid e Chart. Selecione um elemento para editar as Properties. A tarefa de uma tabela não exige estes elementos adicionais.

Properties controla o papel, a orientação e os números de página quando nenhum elemento está selecionado. Também controla posição, dimensões e aspeto dos elementos. Undo e Redo percorrem as alterações. O zoom só altera a vista.

Para Chart ou Cell grid, ligue uma consulta em Data e escolha as colunas correspondentes de nome, valor ou célula em Properties. Verifique a saída produzida com as suas linhas.

As definições Flow podem colocar um elemento abaixo de outro ou controlar conteúdo repetido nas páginas seguintes. Use Load pages após mudar a disposição para verificar o número físico de páginas. Show data apresenta apenas as linhas que cabem na página do quadro.

## Separar o texto do relatório dos campos da consulta

O nome impresso de uma coluna pode diferir do nome do campo da consulta. Use os campos de nome em Data para o texto visível. Mantenha as chaves de ligação alinhadas com a saída real da consulta.

O seletor Print language em Properties edita o texto de relatório de uma língua. As traduções vazias usam o texto original. Mudar a língua do desenho não traduz a saída da consulta.

Um Letterhead usa a identidade do laboratório configurada em Settings. Pode dar a vários desenhos o mesmo logótipo, nome e contactos.

## Gerir desenhos com cuidado

More actions inclui Duplicate e Delete. Duplicate inicia um desenho separado para uma variante. Delete remove permanentemente após confirmação. Verifique primeiro os relatórios ligados.

Restore em Versions altera a cópia de trabalho e pode ser anulado. Pré-visualize o desenho restaurado antes de o publicar de propósito. Publicar outra revisão não exige outro relatório de biblioteca para o mesmo desenho.

Create report from this design acrescenta uma entrada de biblioteca separada. Não substitui Publish revision. Um desenho publicado ausente de Reports ainda precisa da criação da entrada.

## Referência opcional de prática

[Descarregue a consulta opcional de contagem para relatórios](https://openldr.online/docs-samples/user-guide/report-designer/report-count-query.json). Importe por Query se quiser uma referência. Usa parâmetros Text obrigatórios from e to, correspondentes ao intervalo de datas atual de Reports. Não exige dados de pacientes. Use uma consulta aprovada para os relatórios normais.

[Descarregue o PDF de exemplo publicado](https://openldr.online/docs-samples/user-guide/report-designer/published-summary.pdf) ou [o livro exportado](https://openldr.online/docs-samples/user-guide/report-designer/summary-design.xlsx) para comparar o resultado de uma coluna. Estes ficheiros contêm apenas uma contagem zero.

## Resolução de problemas

**Não aparecem colunas.** Escolha Bind query, configure os valores predefinidos necessários e selecione Load columns.

**O quadro continua vazio.** Inclua pelo menos uma coluna ligada, depois Load pages e Show data. Leia os erros da consulta antes de mudar a disposição.

**O estado de gravação mostra um erro.** Resolva-o antes de publicar. Um modelo novo exige um primeiro Save explícito.

**Create report está indisponível.** Guarde o desenho e preencha Name, Category, Template e Primary query no painel New report.

**A pré-visualização e a saída diferem das linhas esperadas.** Alinhe as chaves do modelo com os identificadores dos parâmetros da consulta. Verifique os valores predefinidos e os limites de datas SQL. O exemplo inclui os dois dias extremos do calendário.

**Uma tabela imprime em várias páginas.** Os dados podem continuar depois da primeira página. Use Load pages e consulte o PDF para verificar a contagem real.

**Reports indica required parameter: period.** Uma Custom Query com um parâmetro daterange funciona em Query, mas atualmente não recebe um intervalo aninhado de Reports. Use dois parâmetros Text chamados from e to, referidos pelo SQL. Uma pré-visualização bem-sucedida não prova uma execução na biblioteca.

## Guias relacionados

[Consulta](/docs/query) cria consultas guardadas. [Relatórios](/docs/reports) executa entradas da biblioteca e agenda saídas. [Laboratório](/docs/laboratory) configura a identidade partilhada.
