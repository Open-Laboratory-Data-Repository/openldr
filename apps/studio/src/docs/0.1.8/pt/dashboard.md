# Painéis

Um painel é uma página de gráficos, números e tabelas. Cada bloco é um **widget**. Um widget executa uma consulta ao armazém do laboratório e desenha a resposta. Os filtros no topo da página mudam o que os widgets contam.

Este guia leva cerca de 45 minutos. Carrega um pequeno conjunto de dados de laboratório fictícios, explora o painel de exemplo e depois constrói o seu próprio painel com quatro widgets. Cada passo tem uma imagem ou um clip curto. Selecione uma imagem ou um clip para o ampliar.

Algumas partes da interface ainda estão em inglês. Este guia escreve cada rótulo tal como aparece no ecrã.

![O painel de exemplo. 1 Seletor. 2 Atualizar. 3 Menu do painel. 4 Filtros. 5 Um widget.](dashboard-tour.png)

1. **Seletor.** Muda entre os painéis que pode ver.
2. **Atualizar.** Volta a executar todos os widgets agora.
3. **Menu do painel.** O menu de três pontos. Tem todas as ações: criar, editar, adicionar widget, filtros, exportar, importar, eliminar.
4. **Filtros.** Limitam o painel a um período, um exame ou uma prioridade.
5. **Um widget.** Uma consulta e uma imagem da sua resposta.

## Quem pode fazer o quê

O que vê depende das permissões da sua função. Um administrador define-as em **Funções**. Os nomes das permissões aparecem em inglês.

| Permissão | O que permite |
| --- | --- |
| View dashboards | Abrir **Painel**, ler widgets, usar filtros, atualizar, exportar. |
| Create dashboards | Usar **Novo painel** e **Importar**. |
| Edit dashboards | Usar **Edit**, adicionar e alterar widgets e filtros, mover e redimensionar. |
| Delete dashboards | Usar **Eliminar** no modo de edição. |

Sem **View dashboards**, o Studio apresenta uma página de acesso negado e não carrega dados. A navegação, a documentação e a opção de terminar a sessão continuam a funcionar.

Duas definições também contam. São para administradores e estão descritas em [Limites e definições](#limites-e-definicoes):

- **SQL bruto no painel** decide se alguém pode escrever widgets SQL. Está desativada numa instalação nova.
- **Exposição de dados** decide que colunas extra o Builder pode oferecer.

## Carregar os dados de exemplo

Uma instalação nova tem o painel de exemplo, **Lab Overview (Sample)**, mas quase nenhum dado de laboratório. Cada número mostra 0 e cada gráfico mostra **No data**. Os exemplos deste guia precisam de dados. Carregue primeiro o ficheiro de exemplo.

O ficheiro é um Bundle FHIR do tipo transação, com atividade fictícia. Tem 24 pacientes e 60 pedidos de exame em cinco exames, vindos de três unidades, com as suas amostras, resultados e relatórios. Todas as datas caem em setembro e outubro de 2026. O mesmo ficheiro dá sempre os mesmos números, por isso o seu ecrã deve coincidir com este guia.

> **Use uma instalação de teste.** As linhas de exemplo tornam-se linhas reais no seu armazém. Nenhum comando remove só essas linhas. Para recomeçar do zero, execute `./openldr db reset`, que apaga e recria toda a base de dados. Nunca carregue o exemplo na instalação de um laboratório em produção.

**Numa instalação feita com o instalador de uma linha**, execute estes comandos a partir da pasta de instalação. O comando `openldr` corre dentro do contentor `api`, que só vê a pasta `data`. Por isso o ficheiro tem de ficar lá.

```bash
curl -L -o data/openldr-sample-lab-data.json https://openldr.online/docs-samples/openldr-sample-lab-data.json
./openldr ingest data/openldr-sample-lab-data.json
```

No Windows, transfira o mesmo ficheiro para `data` e depois execute `.\openldr.ps1 ingest data/openldr-sample-lab-data.json`.

**A partir de uma cópia do código-fonte**, o ficheiro já está no repositório:

```bash
pnpm openldr ingest apps/web/public/docs-samples/openldr-sample-lab-data.json
```

Um carregamento bem-sucedido termina com `batch <id>: done (226 resources)`. Abra **Painel**. Em poucos segundos deve ver:

| Widget | Valor com o exemplo carregado |
| --- | --- |
| Total Orders | 60 |
| Distinct Patients | 21 |
| Results Recorded | 51 |
| Orders by Test | Full blood count 18, Malaria rapid test 16, HIV viral load 11, Blood glucose 9, Creatinine 6 |

Se os números forem mais altos, o armazém já tinha outros dados. Os exemplos continuam a funcionar, mas os seus números serão diferentes.

## O que mostra o painel de exemplo

**Lab Overview (Sample)** vem com cada instalação. Os seus widgets têm nomes em inglês. Cada um é escrito em SQL. Executam mesmo com **SQL bruto no painel** desativada, porque o servidor conhece estas consultas. Nem todos os widgets ouvem todos os filtros.

| Widget | Mostra | Segue os filtros |
| --- | --- | --- |
| Total Orders | Número de pedidos de exame | Period, Test, Priority |
| Distinct Patients | Pacientes com pelo menos um pedido | Period, Test, Priority |
| Results Recorded | Resultados não cancelados | Period, Test |
| Result Finalisation % | Parte dos relatórios finais ou corrigidos | Nenhum |
| Orders by Test | Pedidos por exame, os 15 primeiros | Period, Priority |
| Orders Trend | Pedidos por dia | Period, Test, Priority |
| Orders by Status | Pedidos por estado | Period, Test, Priority |
| Orders by Priority | Pedidos por prioridade | Period, Test |
| Order → Report Pipeline | Pedido, amostra recebida, resultado registado, relatório emitido | Nenhum |
| Abnormal Results | Resultados marcados como alto, baixo ou anormal | Period |
| Results Trend | Resultados por dia | Period, Test |
| Analyte Volume vs Avg Value | Número de resultados face ao valor médio, por analito | Nenhum |
| Recent Orders | Os 50 pedidos mais recentes | Period, Test, Priority |

**Test** lista nomes de pedidos, como Full blood count. **Results Recorded** e **Results Trend** contam os resultados dos pedidos desse exame. Um pedido de Full blood count tem dois resultados, Haemoglobin e White cell count, por isso contam-se os dois.

## Exemplo 1: filtrar o painel de exemplo

Descubra quantos pedidos urgentes de HIV viral load chegaram em outubro de 2026.

![Filtrar o painel de exemplo para outubro de 2026, HIV viral load, urgent.](dashboard-filters.mp4)

1. Abra **Painel**. O seletor mostra **Lab Overview (Sample)**.
2. Selecione **Period**. Volte a outubro de 2026. Selecione 1 de outubro e depois 31 de outubro.
3. Abra **Test** e escolha **HIV viral load**.
4. Abra **Priority** e escolha **urgent**.

**Resultado esperado:** Total Orders mostra 1 e Distinct Patients mostra 1. Results Recorded mostra 4, porque ignora **Priority**. Orders by Test continua a mostrar todos os exames, porque ignora **Test**.

![O painel depois dos três filtros.](dashboard-filters-result.png)

Para limpar um filtro, abra-o e escolha **All**. Para limpar **Period**, abra-o e selecione **Clear**. Os filtros não ficam guardados. Recarregar a página repõe cada filtro no seu valor predefinido.

## Atualizar

Selecione **Atualizar**, o ícone com setas, para voltar a executar todos os widgets agora.

Um widget também se pode atualizar sozinho. Os widgets de exemplo atualizam-se a cada 5 minutos. Os widgets que cria no editor não se atualizam sozinhos, porque o editor ainda não tem essa definição. Para lhes dar um intervalo, exporte o painel, defina `refreshIntervalSec` nesse widget no ficheiro e importe-o. Veja [Exportar, importar e copiar](#exportar-importar-e-copiar).

Como a atualização funciona:

- O intervalo começa quando um pedido termina. Uma consulta lenta atrasa a próxima atualização. Nunca lança um segundo pedido por cima do primeiro.
- Um intervalo de 0 desativa a atualização automática.
- Mudar um filtro, ou sair da página, cancela o pedido no navegador. Uma resposta tardia nunca substitui uma mais recente.
- Cancelar no navegador nem sempre para a consulta na base de dados.

## Exemplo 2: criar um painel e um gráfico de barras

Construa um gráfico de barras dos pedidos por exame com o **Builder**. Não precisa de SQL.

![Criar um painel e um gráfico de barras com o Builder.](dashboard-new-widget.mp4)

1. Abra o menu de três pontos e selecione **Novo painel**. Um painel vazio chamado **Novo painel** abre no modo de edição. O modo de edição mostra uma grelha de pontos.
2. Abra de novo o menu e selecione **Add widget**. O editor de widgets abre.
3. Selecione o título no canto superior esquerdo e escreva `Orders by test`.
4. **Data** já diz **Test Orders**, e **Summarize** já diz **Count**. Deixe os dois.
5. Selecione o botão **Group by**, o segundo ícone da fila por baixo de **Summarize**. Na nova caixa **Group by**, escolha **Test**.
6. A pré-visualização à direita mostra agora cinco números. Abra o menu de três pontos do editor, o **Editor menu**, e selecione **Charts**. Escolha **Bar**.
7. Abra de novo o **Editor menu** e selecione **Save**.

**Resultado esperado:** o gráfico de barras aparece na grelha. Full blood count é a barra mais alta, com 18.

Cada painel novo chama-se **Novo painel**, depois **Novo painel (2)**, e assim por diante. Para lhe dar um nome, abra o **Dashboard menu**, escolha **Mudar o nome**, escreva o nome e escolha **Guardar** no menu **⋯** do painel lateral. **Mudar o nome** espera enquanto houver alterações por guardar. O painel de exemplo mantém o seu nome: o OpenLDR repõe-no quando o servidor reinicia.

### O editor de widgets

![O editor de widgets. 1 Título. 2 Data. 3 Summarize. 4 Group by. 5 Builder ou SQL. 6 Editor menu.](dashboard-builder.png)

1. **Título.** Aparece no cartão do widget.
2. **Data.** O que contar: **Test Orders**, **Results**, **Reports**, **Specimens**, **Patients** ou **Facilities**.
3. **Summarize.** A medida. **Count** por predefinição. **Add measure** junta outra, como **Distinct Patients** ou **Avg Value**. **Formula** divide uma medida por outra, por exemplo para mostrar uma percentagem.
4. **Group by.** Divide a medida por um campo. Um campo de data pede também um **Grain**: dia, semana, mês, trimestre ou ano.
5. **Builder** ou **SQL.** Passar para SQL mostra a consulta que o Builder escreveu. Só a pode editar com **SQL bruto no painel** ativada.
6. **Editor menu.** **Tables** lista os campos. **Charts** escolhe a imagem. **Filters** define as variáveis SQL. **Save** guarda. **Delete** remove um widget guardado.

A fila de botões por baixo de **Summarize** junta outras partes: **Filter**, **Group by**, **Breakdown**, **Sort**, **Join data** e **Custom column**, por esta ordem. Cada parte tem um **×** para a retirar.

Em baixo à esquerda vê as linhas brutas. Em baixo à direita fica o estilo: que coluna é a categoria, qual é o valor, e a cor. Num telemóvel, estas zonas passam a quatro separadores: **Build**, **Preview**, **Data** e **Style**.

Para alterar um widget guardado, entre no modo de edição, abra o menu de três pontos do widget e selecione **Edit**.

### Tipos de gráfico

![A escolha do gráfico, aberta em Editor menu, Charts.](dashboard-chart-types.png)

| Tipo | Para que serve | Opções de estilo |
| --- | --- | --- |
| Number | Um total | Coluna de valor, sufixo como `%` |
| Line | Uma mudança ao longo do tempo | Categoria, valor, cor |
| Bar | Comparar grupos | Categoria, valor, cor |
| Area | Volume ao longo do tempo | Categoria, valor, cor |
| Row | Barras deitadas, para nomes longos | Categoria, valor, cor |
| Pie | Partes de um todo | Categoria, valor, raio interior. 0 desenha um gráfico circular, mais desenha um anel |
| Scatter | Duas medidas uma contra a outra | Coluna X, coluna Y, cor |
| Funnel | Passos que diminuem | Categoria, valor |
| Progress | Progresso até uma meta | Coluna de valor, meta, cor, sufixo |
| Gauge | Um valor num mostrador | Coluna de valor, mín., máx., verde a partir de, âmbar a partir de, sufixo |
| Table | As próprias linhas | Nenhuma |
| Traffic Light | Bom, atenção ou mau | Coluna de valor, verde a partir de, âmbar a partir de, sufixo |

**Breakdown** junta uma coluna `series`, por exemplo uma por prioridade. Hoje só **Table** a mostra. Os gráficos de linhas, barras e áreas desenham uma só série e ignoram-na.

## Exemplo 3: pedidos por semana

Mostre quantos pedidos chegam em cada semana.

![Um gráfico de linhas dos pedidos por semana.](dashboard-trend.mp4)

1. Fique no modo de edição. Abra o menu de três pontos e selecione **Add widget**.
2. Escreva o título `Orders per week`.
3. Selecione **Group by** e escolha **Authored**. Authored é a data em que o pedido foi feito.
4. Em **Grain**, escolha **week**.
5. Abra o **Editor menu**, selecione **Charts** e escolha **Line**.
6. Abra o **Editor menu** e selecione **Save**.

**Resultado esperado:** uma linha com um ponto por semana, da semana de 30 de agosto à semana de 25 de outubro de 2026. A semana com mais pedidos é a de 4 de outubro.

O editor coloca cada widget novo no fundo da grelha. Desça a página para o encontrar.

## Exemplo 4: um número com uma condição

Conte os resultados marcados como altos.

![Um widget de número que conta os resultados altos.](dashboard-number.mp4)

1. Abra o menu de três pontos e selecione **Add widget**.
2. Escreva o título `High results`.
3. Abra **Data** e escolha **Results**.
4. Selecione **Filter** e depois **Add condition**.
5. Defina o campo como **Interpretation**. Deixe o operador em **eq**, que quer dizer igual. Escreva `H` como valor.
6. **Number** já é o tipo de gráfico. Abra o **Editor menu** e selecione **Save**.

**Resultado esperado:** o widget mostra 22.

O exemplo usa os indicadores habituais: `H` alto, `L` baixo, `N` normal, `A` anormal. Para contar os altos e os baixos juntos, defina o operador como **in** e o valor como `H, L`. Isso dá 27.

Operadores de filtro: **eq** igual, **in** qualquer um de uma lista, **contains** contém um texto, **gte** maior ou igual, **lte** menor ou igual, **between** entre dois valores. **Add group** aninha condições. **Match type** escolhe se todas as condições ou qualquer uma delas tem de se verificar.

## Mover e redimensionar widgets

![Arrastar um widget e alargar outro.](dashboard-layout.mp4)

No modo de edição, cada cartão mostra uma pega junto ao título.

- **Mover.** Arraste um cartão pelo título. Os outros afastam-se para dar espaço.
- **Redimensionar.** Arraste o canto inferior direito de um cartão.

As alterações ficam guardadas sozinhas cerca de um segundo e meio depois de parar. **Done**, no menu de três pontos, também guarda e sai do modo de edição.

![O menu do painel no modo de edição.](dashboard-menu-edit.png)

Num telemóvel, os cartões aparecem numa só coluna e não podem ser movidos nem redimensionados. Use um computador para organizar um painel.

## Filtros do painel

O painel de exemplo tem três filtros. O seu painel novo não tem nenhum. Junte um filtro de período.

![Adicionar um filtro Period.](dashboard-filter-add.mp4)

1. No modo de edição, abra o menu de três pontos e selecione **Edit filters**. O painel **Filtros do painel** abre.
2. Abra **Ações do filtro**, os três pontos no topo do painel, e selecione **Adicionar filtro**.
3. Em **Identificador da variável**, escreva `period`.
4. Em **Rótulo**, escreva `Period`.
5. Em **Type**, escolha **Intervalo de datas**.
6. Abra **Ações do filtro** e selecione **Guardar**. Depois selecione **Done** no menu de três pontos.

![O painel de filtros. Os tokens a usar em SQL aparecem junto a cada filtro.](dashboard-filter-editor.png)

Tipos de filtro:

| Tipo | Escolhe | Tokens SQL |
| --- | --- | --- |
| Texto | Uma palavra de uma lista, ou escrita | `{{id}}` |
| Número | Um número | `{{id}}` |
| Data | Um dia | `{{id}}` |
| Intervalo de datas | Um primeiro e um último dia | `{{id_from}}` e `{{id_to}}` |

Um filtro de texto pode preencher a sua lista com **SQL das opções**. O filtro **Test** do exemplo usa `SELECT DISTINCT panel_desc FROM lab_requests WHERE panel_desc IS NOT NULL ORDER BY panel_desc`. Qualquer filtro pode ter um **Valor predefinido**.

> **Os filtros só chegam aos widgets SQL.** Um filtro do painel só muda um widget quando o SQL desse widget usa os tokens do filtro. Os widgets do Builder mantêm as suas próprias condições e ignoram a barra de filtros. O exemplo seguinte mostra como ligar um filtro.

## Exemplo 5: um widget escrito em SQL

Mostre os pedidos por unidade requisitante. O Builder não consegue, porque **Test Orders** não tem campo de unidade. Escreva SQL.

### Ativar os widgets SQL

Um administrador faz isto uma vez.

![Definições, Geral, com o interruptor SQL bruto no painel.](dashboard-raw-sql-setting.png)

1. Abra **Definições** e depois **Geral**.
2. Ative **SQL bruto no painel**.

Na linha de comandos, execute `./openldr settings flags set dashboard.raw_sql true`. Os widgets SQL só leem dados. Consultam o armazém que esta instalação usa: PostgreSQL, MySQL ou SQL Server.

### Escrever o widget

![Escrever o widget SQL, executá-lo e escolher um gráfico Row.](dashboard-sql.mp4)

1. Escolha **Novo painel** no seletor. Abra o menu de três pontos e selecione **Edit** e depois **Add widget**.
2. Escreva o título `Orders by requesting site`.
3. Selecione **SQL**. Substitua o texto do editor por:

```sql
SELECT requester_display AS label, COUNT(*) AS value
FROM lab_requests
WHERE 1=1
[[AND substring(authored_at,1,10) >= {{period_from}}]]
[[AND substring(authored_at,1,10) <= {{period_to}}]]
GROUP BY requester_display
ORDER BY value DESC
```

4. Selecione **Run query**, o botão de reprodução. As linhas mostram 23, 22 e 15.
5. Abra o **Editor menu**, selecione **Charts** e escolha **Row**.

Chame `label` à coluna de categoria e `value` à coluna de número. Os gráficos procuram primeiro esses nomes. O estilo pode apontá-los para outras colunas.

`{{period_from}}` é uma variável. `[[ ... ]]` torna uma linha opcional. Se a variável não tiver valor, a linha inteira desaparece. Sem os parênteses retos, uma variável vazia passa a `NULL` e a consulta não devolve nada.

### Ligar as variáveis ao filtro Period

![Abrir Filters, definir o tipo como Date Range e ligá-lo a Period.](dashboard-sql-variables.mp4)

1. Abra o **Editor menu** e selecione **Filters**. O painel **Variables** lista `{{period_from}}` e `{{period_to}}`.
2. Defina **Type** como **Date Range**. As duas variáveis juntam-se numa só, chamada `period`.
3. Defina **Dashboard Filter** como **Period (period)**.
4. Feche o painel. Abra o **Editor menu** e selecione **Save**. Depois selecione **Done** no menu de três pontos.

Só aparecem em **Dashboard Filter** os filtros do mesmo tipo. **Test Value** permite experimentar um valor no editor sem mexer no painel.

### Usar o filtro

![Escolher outubro de 2026 em Period. Só o widget SQL muda.](dashboard-filter-apply.mp4)

Selecione **Period** e escolha de 1 a 31 de outubro de 2026.

**Resultado esperado:** Orders by requesting site passa a 12, 11 e 9. Os widgets do Builder não mudam.

Uma etiqueta de variável vermelha por cima do SQL quer dizer que a variável não se resolve. Ou o seu tipo já não coincide com o filtro ligado, ou um intervalo de datas está escrito como `{{period}}` em vez de `{{period_from}}` e `{{period_to}}`. Abra **Filters** no **Editor menu** para ler a mensagem.

## Exportar, importar e copiar

O menu de três pontos tem **Exportar** e **Importar**, no modo de visualização e no de edição.

- **Exportar** transfere o painel como ficheiro JSON com o nome dele, por exemplo `Novo_painel.json`.
- **Importar** lê um ficheiro assim e junta-o como painel novo. Nunca substitui um painel. Se o nome já existir, junta um número.

Use-os para:

- **Copiar um painel** para outra instalação, ou guardar uma cópia de segurança.
- **Definir um intervalo de atualização.** Mude `refreshIntervalSec` num widget no ficheiro e depois importe.

Importar um painel com widgets SQL falha enquanto **SQL bruto no painel** estiver desativada, com a mensagem `raw SQL widgets are disabled`. Isto inclui uma cópia do painel de exemplo. Ative primeiro a definição.

## Eliminar um painel

1. Selecione o painel e entre no modo de edição.
2. Abra o menu de três pontos e selecione **Eliminar**.
3. Confirme com **Eliminar painel**.

![O pedido de confirmação.](dashboard-delete-confirm.png)

Eliminar não se pode desfazer. Exporte primeiro se o puder vir a querer de volta. Para terminar este guia, elimine **Novo painel**.

## Num telemóvel

Há quem use o Studio no telemóvel. Os painéis funcionam lá numa só coluna.

![O painel de exemplo num telemóvel.](dashboard-phone.png)

Num telemóvel pode ler widgets, usar filtros, atualizar e exportar. Mover e redimensionar precisam de um computador. O editor de widgets funciona num telemóvel, com os seus quatro separadores.

## Limites e definições

Estas definições são para administradores. Ficam em **Definições**, **Geral**.

| Definição | Predefinição | O que faz |
| --- | --- | --- |
| SQL bruto no painel | Desativada | Permite escrever e executar widgets SQL. O SQL do exemplo executa mesmo com ela desativada. |
| Tempo limite de SQL do painel (ms) | 5000 | Para qualquer consulta de widget, Builder ou SQL, que demore mais. |
| Limite de linhas de SQL do painel | 10000 | Os widgets SQL devolvem no máximo este número de linhas. Os widgets do Builder falham se a consulta criar mais grupos. |

O limite conta os grupos da base antes de o painel agrupar datas, somar séries ou escolher os N primeiros. Pedir menos primeiros resultados não contorna o limite. Se um widget atingir o limite, mostra um erro, nunca um total parcial. Restrinja os filtros ou agrupe menos.

O PostgreSQL, o MySQL, o MariaDB e o SQL Server param todos o trabalho da base no tempo limite. O SQL Server também repõe cada ligação partilhada depois de uma consulta, para que os limites de linhas e bloqueios nunca afetem a seguinte.

**Exposição de dados**, também em Definições, decide que colunas extra do armazém o Builder pode oferecer, por exemplo em **Join data**. Veja [Exposição de dados](/docs/data-exposure).

## Resolução de problemas

- **Cada número é 0 e cada gráfico mostra No data.** O armazém está vazio. [Carregue os dados de exemplo](#carregar-os-dados-de-exemplo), ou carregue os seus.
- **Não aparece nenhum painel.** Ainda não existe nenhum. A página vazia oferece **Novo painel** e **Importar**.
- **Edit não aparece no menu.** A sua função não tem **Edit dashboards**.
- **O SQL não se pode editar, ou guardar mostra `raw SQL widgets are disabled`.** Ative **SQL bruto no painel**. Veja [Ativar os widgets SQL](#ativar-os-widgets-sql).
- **Um widget ignora a barra de filtros.** Os widgets do Builder ignoram-na sempre. Um widget SQL só segue um filtro quando o seu SQL usa os tokens e as suas variáveis estão ligadas em **Filters**.
- **Breakdown não muda nada no meu gráfico.** Hoje só **Table** mostra uma divisão.
- **Um widget mostra um erro de tempo ou de linhas.** Atingiu o tempo limite ou o limite de linhas. Veja [Limites e definições](#limites-e-definicoes).
- **Um widget novo não está visível.** Os widgets novos vão para o fundo da grelha. Desça a página.

## Guias relacionados

- [Relatórios](/docs/reports)
- [Consultas personalizadas](/docs/query)
- [Fluxos de trabalho](/docs/workflows), que podem publicar conjuntos de dados lidos pelos painéis
- [Exposição de dados](/docs/data-exposure)
- [Definições](/docs/settings)
