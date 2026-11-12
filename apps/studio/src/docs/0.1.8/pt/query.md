# Consultas

Use Query para explorar conectores de bases ativos, consultar conjuntos de dados de workflows e guardar instruções SELECT em Custom Queries. Report Designer pode associar tabelas a essas consultas.

Comece com o seu conector e os dados recebidos. Não precisa de dados de exemplo. A contagem abaixo também dá um resultado útil num armazém vazio. As imagens usam uma instalação de teste separada.

Precisa de **Use query workbench**. As consultas leem dados. São recusadas instruções que alterem dados ou tabelas. Uma nova instalação cria um conector para o motor de armazém configurado. Estas imagens usam **Target Warehouse (Postgres)**. Outras origens exigem um conector de base correspondente e ativo.

As consultas integradas guardadas podem alimentar relatórios. Consulte-as, mas compreenda essas dependências antes de alterar o SQL ou os identificadores de parâmetros.

## Explorar uma tabela de origem

Consulte o esquema de um conector antes de escrever SQL. Um esquema é o espaço de nomes da base que contém as tabelas.

### 1. Abrir Query

Selecione Query no menu principal.

![Abra Query no menu principal.](query-guide-open-page.png)

### 2. Expandir Connectors

Selecione Connectors no Explorer.

![Expanda Connectors no Explorer.](query-guide-connectors.png)

### 3. Expandir o conector

Selecione o conector de base ativo. O exemplo usa Target Warehouse (Postgres).

![Expanda o conector de base ativo.](query-guide-warehouse.png)

### 4. Expandir o esquema

Selecione o esquema, como public no armazém PostgreSQL.

![Expanda o esquema que contém os dados.](query-guide-schema.png)

### 5. Abrir a tabela

Selecione a tabela a consultar. O exemplo usa lab_requests. Uma tabela vazia pode não devolver linhas sem que exista erro.

![Selecione uma tabela para explorar as linhas atuais.](query-guide-table.png)

### 6. Consultar o SQL de exploração

Selecione o botão SQL acima dos resultados para mostrar o SELECT gerado. A exploração simples não garante a ordem das linhas.

![SQL mostra o SELECT usado nesta exploração.](query-guide-browse-sql.png)

### 7. Usar as páginas de resultados

Use o tamanho de página e as setas para resultados maiores. Acrescente um ORDER BY explícito terminado numa chave única antes de depender de páginas estáveis.

![Use o tamanho de página e as setas para tabelas maiores.](query-guide-browse-paging.png)

**Resultado esperado:** o separador lê as linhas atuais do conector escolhido. O armazém da captura não tem pedidos.

![Um armazém vazio pode não devolver linhas sem que exista erro.](query-guide-browse-result.png)

## Contar pedidos do armazém

Use uma pequena consulta apenas de leitura para confirmar o conector e o resultado. A sua contagem pode diferir da imagem.

### 1. Abrir uma nova consulta

Selecione o sinal mais com o nome new query na barra de separadores.

![O sinal mais abre um novo separador de consulta.](query-guide-new-query.png)

### 2. Escolher o conector

Abra Connector e selecione a base a consultar.

![Escolha a base ativa a consultar.](query-guide-choose-connector.png)

### 3. Introduzir o SELECT

Introduza `SELECT COUNT(*) AS requests FROM lab_requests` no editor.

![Introduza um SELECT apenas de leitura. Esta contagem também funciona sem dados.](query-guide-sql.png)

### 4. Executar a consulta

Selecione Run. O resultado tem uma coluna requests e uma linha, mesmo quando a contagem é zero.

![Run executa o SQL no conector escolhido.](query-guide-run-step-4.png)

**Resultado esperado:** o resultado mostra a contagem atual de pedidos do armazém.

![Uma linha de saída contém a contagem real de pedidos.](query-guide-count-result.png)

## Acrescentar um parâmetro obrigatório de período

Use parâmetros quando a consulta deve pedir valores em cada execução. Este exemplo conta pedidos desde uma data inicial incluída até uma data final excluída.

### 1. Usar o SQL com limites de datas

Substitua o SQL por `SELECT COUNT(*) AS requests FROM lab_requests WHERE authored_at >= {{ param.from }} AND authored_at < {{ param.to }}`.

![O SQL do período lê os valores associados from e to.](query-guide-parameter-sql.png)

### 2. Abrir Parameters

Selecione Parameters acima do editor SQL.

![Parameters define os valores pedidos pela consulta.](query-guide-parameters.png)

### 3. Acrescentar um parâmetro

Abra os pontos Parameter actions no painel e escolha Add.

![O painel Parameters tem o próprio menu de ações.](query-guide-parameter-actions.png)

![Add cria uma definição de parâmetro.](query-guide-parameter-add.png)

### 4. Definir Variable ID

Introduza `period` em Variable ID. Os parâmetros de período fornecem os valores especiais from e to usados pelo SQL.

![Use um identificador de variável estável.](query-guide-parameter-id.png)

### 5. Definir o nome visível

Introduza um Label claro, como Period.

![O nome aparece ao executar a consulta.](query-guide-parameter-label.png)

### 6. Escolher daterange

Defina Type como **daterange**.

![daterange pede duas datas e fornece from e to.](query-guide-parameter-type.png)

### 7. Exigir os limites de datas

Ative Required porque este SQL exige ambas as datas.

![Exija um valor quando o SQL precisar de ambos os limites.](query-guide-parameter-required.png)

### 8. Guardar a definição do parâmetro

Abra Parameter actions e selecione Save. Isto atualiza o separador atual. Guarde a própria consulta quando a quiser manter.

![Save aplica a definição do parâmetro a este separador.](query-guide-parameter-save.png)

## Executar com as datas escolhidas

Use datas adequadas à pergunta do relatório. O exemplo inclui 2026-01-01 e exclui 2027-01-01. Cobre todo o ano civil de 2026.

### 1. Executar a consulta com parâmetros

Selecione Run. O painel Run parameters pede os valores configurados.

![Run executa o SQL no conector escolhido.](query-guide-run-step-1.png)

### 2. Introduzir os limites de datas

Defina a primeira data como início incluído. Defina a segunda como fim excluído por este SQL. Outro SQL pode usar uma regra diferente.

![Introduza a primeira data incluída.](query-guide-from-date.png)

![Introduza a data final excluída usada por este SQL de exemplo.](query-guide-to-date.png)

### 3. Abrir Run actions

Selecione os pontos do painel Run parameters.

![Abra as ações dos parâmetros após conferir as datas.](query-guide-run-values-actions.png)

### 4. Executar com estes valores

Selecione Run with these values.

![Run with these values executa a consulta com parâmetros.](query-guide-run-values.png)

**Resultado esperado:** o resultado conta apenas os pedidos dentro dos limites SQL. Zero é uma contagem válida.

![A contagem filtrada é um resultado real, incluindo zero.](query-guide-parameter-result.png)

## Guardar a consulta personalizada

Guarde o SQL, o conector e os parâmetros quando outras tarefas precisarem de os reutilizar.

### 1. Escolher Save

Abra Query actions acima do editor e selecione Save.

![Use Query actions para guardar este SQL e os parâmetros.](query-guide-query-actions.png)

![Save pede um nome na primeira gravação.](query-guide-save-query.png)

### 2. Dar nome à consulta

Introduza um nome único. O exemplo usa Requests in a date range.

![Escolha um nome único para a consulta guardada.](query-guide-query-name.png)

### 3. Guardar a definição com nome

Abra Name actions no painel do nome e escolha Save.

![Save neste painel guarda a consulta.](query-guide-name-save.png)

**Resultado esperado:** a consulta aparece em Custom Queries no Explorer. As gravações seguintes atualizam a mesma definição.

![A consulta guardada está disponível no Explorer.](query-guide-saved-query.png)

## Mudar o nome de uma consulta guardada

Use Rename para manter o identificador e as ligações dos relatórios. Mudar o nome não guarda alterações pendentes no editor.

### 1. Abrir as ações da linha guardada

Expanda Custom Queries e use os pontos junto da consulta guardada.

![As consultas guardadas têm as próprias ações de linha.](query-guide-saved-actions.png)

### 2. Escolher Rename

Selecione Rename nesse menu de linha.

![Rename altera o nome guardado mantendo o identificador.](query-guide-rename.png)

### 3. Guardar o novo nome

Introduza o novo nome único, abra Name actions e escolha Save. O exemplo passa a Request count by period.

![Introduza o novo nome único.](query-guide-rename-value.png)

![Save neste painel guarda a consulta.](query-guide-name-save.png)

**Resultado esperado:** o Explorer mostra o novo nome e a consulta mantém o identificador.

![O Explorer mostra o novo nome da consulta.](query-guide-renamed.png)

## Organizar uma consulta num grupo

Os grupos organizam o Explorer desta instalação. Não alteram o SQL nem as associações dos relatórios.

### 1. Abrir Custom query actions

Selecione os pontos junto de Custom Queries.

![Custom query actions contém New group.](query-guide-custom-actions.png)

### 2. Criar um grupo

Selecione New group.

![New group cria uma pasta no Explorer para consultas guardadas.](query-guide-new-group.png)

### 3. Dar nome e guardar o grupo

Introduza um nome útil e use Name actions e Save. O exemplo usa Documentation examples.

![Escolha um nome útil para o grupo.](query-guide-group-name.png)

![Save neste painel guarda a consulta.](query-guide-name-save.png)

### 4. Mover a consulta

Abra os pontos da consulta, aponte para Move to group e escolha o grupo de destino. Expanda o grupo para ver a consulta.

![Move to group altera a organização sem mudar o SQL.](query-guide-move-group.png)

![Escolha o grupo de destino.](query-guide-group-option.png)

**Resultado esperado:** a consulta guardada aparece no grupo.

![A consulta aparece no grupo escolhido.](query-guide-grouped.png)

## Exportar consultas selecionadas

Uma exportação transfere nomes, SQL, parâmetros e nomes de grupos entre instalações. Reveja o ficheiro antes de partilhar conteúdo específico de uma origem.

### 1. Abrir Export queries

Abra Transfer actions no cabeçalho do Explorer e selecione Export queries.

![O Explorer tem ações de transferência separadas.](query-guide-transfer-actions.png)

![Export queries abre um painel de seleção.](query-guide-export-open.png)

### 2. Selecionar as definições

Marque apenas as consultas a exportar.

![Selecione apenas as consultas a exportar.](query-guide-export-select.png)

### 3. Descarregar o ficheiro

Abra os pontos do painel de exportação e escolha Download. Feche o painel quando terminar.

![Download exporta nomes, SQL, parâmetros e nomes de grupos.](query-guide-export-download.png)

**Resultado esperado:** o JSON contém as definições selecionadas. Omite identificadores de consultas e associações de conectores.

## Rever e importar um ficheiro de consultas

Use uma exportação de consultas ou um pacote de conteúdo aprovado. Confira o tratamento de nomes iguais antes de aplicar.

### 1. Abrir Import queries

Abra Transfer actions e selecione Import queries.

![Import queries abre a revisão do ficheiro.](query-guide-import-open.png)

### 2. Escolher o ficheiro JSON

Abra os pontos do painel de importação, escolha Choose file e selecione a exportação.

![Choose file abre o seletor de ficheiros.](query-guide-import-choose.png)

### 3. Ler a pré-visualização

Confira se cada nome será criado, ignorado ou substituído. O exemplo já existe e será ignorado com a substituição desligada.

![Confira se cada nome será criado, ignorado ou substituído.](query-guide-import-preview.png)

### 4. Verificar o conector e a substituição

Escolha o conector para novos nomes importados. Mantenha Replace existing queries desligado para preservar definições existentes. Ative-o apenas para uma substituição pretendida.

![Escolha o conector para novos nomes importados.](query-guide-import-connector.png)

![Mantenha Replace existing queries desligado para preservar definições com o mesmo nome.](query-guide-import-replace.png)

### 5. Aplicar a importação revista

Abra os pontos do painel e selecione Import. Uma definição inválida impede a importação do ficheiro.

![Import aplica o plano revisto. Este exemplo com nome igual é ignorado.](query-guide-import-apply.png)

**Resultado esperado:** a operação cria, ignora ou substitui os nomes como indicado. A substituição mantém o identificador e o conector existentes.

## Abrir um conjunto de dados de workflow

Use esta tarefa quando um workflow já preparou as linhas necessárias. As outras tarefas deste guia não exigem conjuntos de dados de workflow.

### 1. Expandir Datasets

Selecione Datasets no Explorer.

![Datasets lista os dados guardados pelos workflows.](query-guide-datasets.png)

### 2. Abrir um conjunto de dados guardado

Selecione o nome. O exemplo abre request_summary, criado em Relatórios agendados com workflows. Contém um valor requests igual a zero.

![O resumo guardado do workflow abre sem uma nova consulta à origem.](query-guide-dataset-result.png)

**Resultado esperado:** o separador mostra as linhas guardadas pelo workflow.

## Executar uma consulta guardada num telemóvel

O Explorer começa recolhido para dar mais espaço à área de trabalho. Um ecrã grande facilita a escrita de SQL.

### 1. Expandir o Explorer

Selecione Expand explorer no topo da barra estreita.

![O Explorer começa recolhido num telemóvel.](query-guide-phone-expand.png)

### 2. Abrir a consulta guardada

Expanda Custom Queries e o grupo e selecione o nome da consulta.

![Abra uma consulta guardada no grupo.](query-guide-phone-query.png)

### 3. Recolher o Explorer

Selecione Collapse explorer para alargar o editor.

![Recolha o Explorer para dar mais espaço ao editor.](query-guide-phone-collapse.png)

### 4. Introduzir os valores de execução

Selecione Run e preencha o painel dos parâmetros. Use Run actions e Run with these values como no computador.

![Run abre a introdução dos parâmetros da consulta guardada.](query-guide-phone-run.png)

![Introduza os limites de datas no painel do telemóvel.](query-guide-phone-values.png)

## Remover um grupo e manter as consultas

Use esta tarefa quando a pasta deixar de ser útil. Remover um grupo mantém todas as consultas.

### 1. Abrir as ações do grupo

Use os pontos junto do nome do grupo.

![Abra as ações do grupo sem alterar a consulta.](query-guide-group-actions.png)

### 2. Escolher Delete group

Selecione Delete group.

![Delete group remove a pasta e mantém as consultas.](query-guide-group-delete.png)

### 3. Confirmar a remoção da pasta

Leia a confirmação de que as consultas ficam e selecione Delete group.

![A confirmação mantém explicitamente as consultas.](query-guide-group-delete-confirm.png)

**Resultado esperado:** a pasta desaparece e as consultas aparecem fora dela.

![A consulta fica fora do grupo removido.](query-guide-ungrouped.png)

## Remover uma consulta guardada sem uso

Confira as dependências dos relatórios antes de eliminar. Este exemplo remove uma definição descartável e mantém a consulta revista.

### 1. Abrir as ações da consulta

Use os pontos junto da consulta guardada sem uso.

![Abra as ações de uma consulta personalizada sem uso.](query-guide-delete-query-actions.png)

### 2. Escolher Delete query

Selecione Delete query. Isto remove a definição guardada, não as linhas do armazém.

![Delete query remove definitivamente esta definição guardada.](query-guide-delete-query.png)

### 3. Confirmar a remoção

Leia a confirmação e escolha Delete query apenas para a definição que pretende remover.

![Confirme apenas a consulta guardada que pretende remover.](query-guide-delete-query-confirm.png)

**Resultado esperado:** a definição guardada desaparece do Explorer.

## Escolher os tipos de parâmetros

Text aceita um valor lido com `{{ param.variableId }}`. Select pede um valor de Options SQL. A primeira coluna devolvida fornece as escolhas. Date range fornece `{{ param.from }}` e `{{ param.to }}`.

Escolha um Variable ID único e não vazio por parâmetro. Os pontos da linha permitem subi-lo, descê-lo ou removê-lo. Remover um parâmetro ainda referido pelo SQL causa um erro de parâmetro não associado.

Um valor opcional vazio torna-se uma cadeia vazia. O SQL tem de a tratar explicitamente quando significa ausência de filtro. Required não cria uma predefinição. Um relatório usa parâmetros do modelo. Faça corresponder a chave à definição da consulta.

A página Reports atual passa os filtros de datas como valores simples from e to. Uma Custom Query com um parâmetro daterange funciona aqui, mas atualmente falha quando associada diretamente a Reports. Para relatórios, use dois parâmetros Text chamados from e to, referidos por {{ param.from }} e {{ param.to }}. Report Designer pode expô-los num único controlo Date range.

## Remover ou reagrupar definições

A linha de uma consulta oferece Rename, Move to group e Delete query. No group devolve a consulta à lista principal. Eliminar uma consulta exige confirmação e pode afetar relatórios que a referenciem.

Cada grupo tem Rename group e Delete group. Eliminar um grupo mantém e retira as consultas. Arrastar uma consulta para um grupo também a move. No telemóvel, use Move to group para uma ação direta no menu.

Refresh em Transfer actions recarrega entradas do Explorer alteradas noutros locais, incluindo pela CLI ou importações de pacotes. A organização dos grupos pertence a esta instalação e não é enviada pela sincronização do central para o laboratório.

## Manter páginas de resultados consistentes

PostgreSQL e MySQL mostram um total contado. SQL Server pode mostrar total unknown e só ativa Next quando encontra outra linha. Alterar Rows per page regressa à primeira página.

Para páginas estáveis, termine ORDER BY numa chave única. Por exemplo, `ORDER BY authored_at, id` desempata horas iguais quando id é único. As linhas podem mudar durante a navegação porque a ferramenta não mantém um instantâneo da base.

Um conector SQL Server sem Database pode mostrar bases acessíveis antes dos esquemas. Use nomes completos de base, esquema e tabela para SQL entre bases no mesmo servidor. Cada conector PostgreSQL lê uma base.

## Exportar ou importar pela CLI

Use `./openldr` na pasta instalada em Linux ou macOS, `.\openldr.ps1` em Windows, ou `pnpm openldr` numa cópia de desenvolvimento. Execute o comando na sua pasta `openldr_ce`. [Start here](/docs/start-here) explica o lançador e os caminhos.

```shell
./openldr query export --out data/queries.json --name "Request count by period"
./openldr query import data/queries.json
```

A exportação substitui um ficheiro de saída existente. A importação ignora nomes existentes por predefinição. Acrescente `--force` apenas para os substituir. O conteúdo específico de um sistema laboratorial pertence a ficheiros de pacotes geridos pelo operador.

## Ficheiro opcional de consulta para praticar

[Descarregar a exportação da consulta revista](https://openldr.online/docs-samples/user-guide/query/request-count-queries.json). Pede datas e conta pedidos do armazém. Não contém linhas de pacientes nem precisa de um lote de exemplo. Importe-o apenas se quiser uma referência após escrever a sua consulta.

Para um conjunto de dados de prática, siga o workflow opcional de contagem em [Relatórios agendados com workflows](/docs/report-pipeline). Uma instalação nova pode não ter conjuntos de dados.

## Resolução de problemas

**Não existem origens disponíveis.** Peça a um responsável para configurar um conector de base ativo ou criar o conjunto de dados necessário.

**Uma consulta falha.** Leia o erro que substitui o resultado. Corrija o SQL ou os valores e execute novamente. Resultados antigos não comprovam uma nova resposta com sucesso.

**É indicado um parâmetro não associado.** Faça corresponder cada parâmetro SQL a uma definição configurada. Os períodos usam from e to.

**Uma lista Select está vazia.** Execute o Options SQL num separador separado. Pode legitimamente não devolver linhas.

**Um nome já existe.** Escolha outro nome. O painel mantém o rascunho após recusar um nome duplicado.

**Uma alteração importada desaparece após reiniciar.** As definições integradas podem voltar a ser carregadas. Crie um nome personalizado separado para manter uma variante duradoura.

## Guias relacionados

[Editor de relatórios](/docs/report-designer) associa resultados de consultas a uma página. [Relatórios](/docs/reports) executa entradas da biblioteca. [Conectores](/docs/connectors) configura as origens de dados.
