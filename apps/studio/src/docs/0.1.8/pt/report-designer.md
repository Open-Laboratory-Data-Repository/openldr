# Designer de relatórios

O **Designer de relatórios** (Report Designer) é uma ferramenta de paginação por arrastar e largar para relatórios imprimíveis. Coloca um cabeçalho, títulos, tabelas, gráficos e painéis numa página A4 ou Letter, liga cada tabela a uma [consulta personalizada](/docs/query) guardada, e publica o resultado como relatório na biblioteca de [Relatórios](/docs/reports).

Uma instalação nova traz dez modelos, um por relatório incluído. Este guia lê como um deles está construído, e depois constrói um modelo novo e publica-o como relatório. Leva cerca de 15 minutos. Selecione uma imagem ou um clip para o ampliar.

Os menus e painéis do designer estão em inglês no ecrã, por isso este guia mantém os rótulos em inglês.

![Test Volume Over Time aberto no designer, com a tabela selecionada e o separador Data a mostrar a consulta ligada.](report-designer-tour.png)

## Quem pode fazer o quê

| Capacidade | O que permite |
| --- | --- |
| **View reports** | Ver a biblioteca de Relatórios |
| **Run reports** | Executar e pré-visualizar um relatório |
| **Edit report templates** | Abrir o designer, criar e alterar modelos, publicá-los, e criar relatórios na biblioteca |

## Antes de começar

O Exemplo 2 precisa dos dados de exemplo da documentação. Veja [Painéis, Carregar os dados de exemplo](/docs/dashboard#carregar-os-dados-de-exemplo).

## Exemplo 1: ler como está feito um relatório incluído

![Abrir Test Volume Over Time, selecionar a tabela e o separador Data.](report-designer-explore.mp4)

1. Abra **Designer de relatórios**. A lista **Templates** à esquerda mostra os dez modelos, com o formato e a orientação.
2. Selecione **Test Volume Over Time**. O cabeçalho mostra **Saved** e **PUBLISHED**.
3. Na página, selecione a tabela, chamada **Data**, com as colunas Month, Test e Count.
4. Abra o separador **Data** à direita.

**Resultado esperado:** **Bind query** mostra **Test volume by month**, uma consulta personalizada guardada. A lista **Columns** tem três colunas marcadas. Em **Parameters**, `dateRange` tem o rótulo **Date range**: é o filtro que o relatório pede ao executar.

Um relatório tem portanto três partes: um modelo (esta página), a consulta que enche as tabelas, e os filtros que passam valores à consulta.

## Exemplo 2: construir um modelo e publicá-lo como relatório

Construa um relatório de uma só tabela: pacientes por faixa etária.

### Construir o modelo

![New template, dar-lhe nome, inserir uma tabela, ligá-la a Patient demographics by age band, marcar as colunas e mostrar os dados.](report-designer-build.mp4)

1. Abra o menu **⋯** no topo da tela e selecione **New template**.
2. Clique na caixa do nome, **Untitled template**, e escreva `Patients by age band (sample)`.
3. Abra **⋯**, selecione **Insert** e depois **Table**. Uma tabela aparece na página.
4. Com a tabela selecionada, abra o separador **Data**. Defina **Bind query** como **Patient demographics by age band**.
5. Selecione **Load columns**. Aparecem cinco colunas: band, total, male, female, other. Marque as cinco.
6. Selecione **Load pages** por cima da tela, e depois **Show data** no cabeçalho.

**Resultado esperado:** a tabela enche-se com linhas reais: 5-14 com 3 pacientes, 15-24 com 4, 25-49 com 14, 50+ com 4. São 25 pacientes: os 24 dos dados de exemplo, e **Sample Seed**, que todas as instalações criam.

![A tabela ligada e cheia com os pacientes do exemplo.](report-designer-bound.png)

**Show data** só mostra as linhas que cabem na primeira página, para que a tela nunca prometa mais do que o PDF imprime.

### Guardar, publicar e juntar aos Relatórios

![Guardar o modelo e publicar uma revisão.](report-designer-publish.mp4)

1. Abra **⋯** e selecione **Save**. O cabeçalho mostra **Saved**.
2. Abra **⋯** e selecione **Publish revision**. O cabeçalho mostra **PUBLISHED**. Nada é juntado aos Relatórios.
3. Abra **⋯** e selecione **Create report from this design**. Abre-se o painel **New report**.

![Dar nome ao relatório, escolher Operational e criá-lo.](report-designer-create-report.mp4)

4. Em **Name**, escreva `Patients by age band (sample)`.
5. Abra **Category** e selecione **Operational**. **Template** e **Primary query** já estão preenchidos, a partir do modelo e da sua tabela.
6. Abra o menu **Actions** do painel e selecione **Create report**.

### Executá-lo

![Executar o relatório novo a partir da biblioteca de Relatórios.](report-designer-run.mp4)

1. Abra **Relatórios**. **Patients by age band (sample)** aparece em **Operational**.
2. Selecione-o, abra o menu de três pontos, selecione **Parâmetros** e depois **Executar**. Não tem filtros, não há nada a preencher.

**Resultado esperado:** o documento mostra as cinco colunas e as quatro linhas do passo 6.

![O documento do relatório.](report-designer-report.png)

Para retirar o exemplo, exclua o relatório no seu menu em Relatórios, e depois o modelo com **⋯ → Delete** no designer.

## Duas ações distintas

| Ação do menu ⋯ | Resultado |
| --- | --- |
| **Publish revision** | Publica uma versão do modelo guardado. Não cria um relatório na biblioteca. |
| **Create report from this design** | Abre o painel de criação de um relatório ligado ao modelo e a uma consulta principal. Não publica uma revisão do modelo. |

As duas exigem um modelo já guardado. O nome do relatório pode ser diferente do do modelo. Publicar uma revisão posterior do mesmo modelo não exige criar outro relatório: use a ação de criação só para juntar uma entrada à biblioteca.

Uma revisão publicada pertence ao modelo. A consulta principal fornece as linhas da folha de cálculo, o modelo define a paginação do documento.

## Os elementos

**⋯ → Insert** oferece: Text, Table, Key/value panel, Image, Barcode, QR code, Line, Rectangle, Date/time, Cell grid, Chart e Letterhead. Arraste um elemento para o mover e use as pegas para o redimensionar. Um elemento selecionado mostra o nome numa etiqueta por cima.

- **Table.** No separador **Data**: **Bind query**, **Load columns**, e depois marque, reordene e mude o nome das colunas. **Sort by column** ordena as linhas antes de desenhar. **First data row is the header** serve quando a consulta devolve os rótulos na primeira linha (precisa também de Sort by). **Transpose**, em Properties, vira uma tabela larga.
- **Cell grid.** Ligue a consulta em **Data**, e depois defina a coluna de rótulo, as colunas de células, os degraus de cor e as colunas finais em **Properties**.
- **Chart.** Ligue a consulta em **Data**, e depois escolha o tipo (bar, line ou donut), a coluna de rótulo e as colunas de valores em **Properties**. Os gráficos imprimem-se como formas vetoriais nítidas, e um gráfico ligado também exporta as linhas para Excel.
- **Parâmetros.** Em **Data**, **Add parameter** define os filtros do relatório (Text, Select ou Date range). A **Key** de um parâmetro tem de coincidir com o **Variable ID** do parâmetro da consulta, para o valor passar para a consulta.
- **Letterhead.** A faixa de identidade partilhada (logótipo, nome, morada, contacto, linha). A paginação é definida uma vez, por isso todos os modelos que a usam mudam juntos. Os valores vêm de Definições, Laboratório. Veja [Laboratório](/docs/laboratory).

## Mais possibilidades

- **Preview** gera o modelo em PDF com dados reais. **Export → PDF** ou **Excel** transfere a saída diretamente.
- O estado ao lado do nome mostra Saved, Saving ou Unsaved changes. O designer também guarda sozinho.
- A faixa por cima da tela diz quantas páginas o modelo imprime. **Load pages** executa as consultas ligadas para uma contagem real. A contagem é um instantâneo, e a faixa diz quando o modelo mudou desde então. Uma tabela que transborda recebe uma linha tracejada onde acaba a primeira página.
- A secção **Flow** de Properties controla os blocos quando uma tabela ou grelha passa para outras páginas: **Place below**, **Gap after**, **First page only**, **Show with** e **Fill to bottom of box**.
- Uma tabela ligada pode ter uma **linha de totais** (um rótulo, e as colunas a somar), e um texto pode mostrar `{{sum(elementName.columnKey)}}`. Uma **regra** por coluna ("When ≥ 10 → Critical") destaca valores sem mexer no SQL. Uma coluna de estado vinda da consulta ganha sempre a uma regra.
- **Trend** numa coluna ligada desenha o valor como uma pequena linha na célula. A consulta dá os números numa só cadeia delimitada, por exemplo `12,14,11,18`. O que não for pelo menos dois números limpos imprime-se como texto, e o Excel exporta sempre a cadeia em bruto.
- **⋯ → Versions** lista cada versão publicada, com autor e data. **Restore** volta a pôr uma versão na cópia de trabalho como uma edição normal: um só passo de anular, guardado sozinho, sem publicar.
- A escolha **Print language** no topo de Properties alterna o texto entre o texto do modelo e a tradução de uma língua. Uma caixa vazia quer dizer "imprime como escrito". Um relatório impresso em [Relatórios](/docs/reports) usa a língua do studio, e `openldr report run <id> --format pdf --lang fr` faz o mesmo sem interface. Só o texto escrito é traduzido: nunca os resultados das consultas, os dados do laboratório nem os códigos de barras.
- Os **relatórios incluídos já vêm em francês e português**. As datas seguem a língua de impressão (`2 sept. 2026`, `2 set. 2026`), sempre com o dia antes do mês. Os códigos de sensibilidade (R, I, S) nunca são traduzidos.
- Um painel chave/valor **não** ligado a uma consulta lista os pares em **Pair translations** quando uma língua está escolhida. Um valor com `{{param.from}}` ou `{{date}}` também pode ser traduzido, com os marcadores.
- Um modelo em **rascunho** imprime um carimbo DRAFT na diagonal em cada página. Publicar retira-o.
- **Page numbers**, nas definições da página, junta um rodapé numerado. Um modelo pode ter várias páginas.
- No separador **Layers**, o olho esconde um elemento (sai da tela e do PDF, e o bloco por baixo sobe), o cadeado bloqueia-o, e as linhas reordenam-se a arrastar.
- Selecione vários elementos e escolha **⋯ → Group selection** para lhes dar nome como grupo. **Alt** chega a um elemento sozinho dentro do grupo. **Ungroup** retira o grupo.
- **Ctrl+D** duplica, **Ctrl+C** e **Ctrl+V** copiam e colam. **⋯ → Duplicate** cria um modelo a partir de outro, **⋯ → Delete** elimina um.
- Em [Relatórios](/docs/reports), os gestores voltam ao modelo de um relatório publicado com **Editar modelo**.

## Num telemóvel

O designer é feito para um ecrã grande. Num telemóvel, use-o para ler um modelo, não para o construir. Os relatórios feitos a partir de um modelo executam-se e imprimem-se num telemóvel como os outros.

## Resolução de problemas

- **Não há colunas para escolher.** Escolha uma consulta em **Bind query** e selecione **Load columns**.
- **A tabela da tela fica vazia com Show data.** Marque pelo menos uma coluna e volte a **Load pages**. Uma consulta com um filtro obrigatório precisa de um valor por omissão no parâmetro.
- **O modelo está publicado mas não aparece nos Relatórios.** Publicar uma revisão não cria uma entrada. Use **Create report from this design**.
- **Create report está desativado.** Preencha Name, Category, Template e Primary query.
- **Publicar pede para guardar primeiro.** Guarde e espere por **Saved**.
- **A pré-visualização não aparece.** Confirme que a consulta ligada e os parâmetros são válidos.
- **Nada para exportar.** O modelo ainda não tem tabelas.
- **As linhas de uma tabela passam para outras páginas.** É normal: as tabelas repartem-se por várias páginas quando os dados não cabem numa.

## Guias relacionados

- [Relatórios](/docs/reports)
- [Consultas personalizadas](/docs/query)
- [Laboratório](/docs/laboratory)
- [Conectores](/docs/connectors)
