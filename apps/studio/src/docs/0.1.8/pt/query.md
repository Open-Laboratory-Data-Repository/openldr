# Consultas personalizadas

**Consulta** é onde olha diretamente para os dados do laboratório e escreve SQL. Percorre tabelas, escreve um `SELECT`, junta parâmetros e guarda-o como **consulta personalizada**. As consultas guardadas são as que as tabelas do [Designer de relatórios](/docs/report-designer) usam, e as que os [relatórios](/docs/reports) publicados executam.

Este guia leva cerca de 25 minutos. Usa os dados de exemplo da documentação, por isso carregue-os primeiro. Selecione uma imagem ou um clip para o ampliar.

![Consulta com uma tabela aberta. 1 Conectores. 2 Conjuntos de dados. 3 Consultas personalizadas. 4 Novo separador de consulta. 5 Executar.](query-tour.png)

1. **Conectores.** Cada conector de base de dados, os seus esquemas e as suas tabelas.
2. **Conjuntos de dados.** Tabelas que fluxos de trabalho construíram para reutilizar.
3. **Consultas personalizadas.** As consultas guardadas, em grupos se os criou.
4. **Nova consulta.** O **+** na barra de separadores abre um separador de consulta vazio.
5. **Executar.** Executa o separador aberto.

## Quem pode fazer o quê

Uma só permissão cobre esta página: **Use query workbench**. As funções Lab Admin, Lab Manager e Data Analyst têm-na por predefinição.

As consultas só leem. Uma consulta que altere dados ou tabelas é recusada.

## Antes de começar

Os exemplos precisam dos dados de exemplo da documentação. Se **Total Orders** no painel de exemplo mostrar 0, carregue-os primeiro. Veja [Carregar os dados de exemplo](/docs/dashboard#carregar-os-dados-de-exemplo).

Uma instalação nova já tem um conector, **Target Warehouse (Postgres)**, que aponta para o armazém do laboratório. Traz também as consultas por trás dos relatórios incluídos, em **Consultas personalizadas**. Pode abri-las e lê-las. Altere-as com cuidado, porque os relatórios usam-nas.

## Exemplo 1: percorrer uma tabela

Veja os pedidos de exame em bruto.

![Abrir Conectores, Target Warehouse, public e lab_requests.](query-browse.mp4)

1. Abra **Consulta**.
2. No **Explorador**, expanda **Conectores**, depois **Target Warehouse (Postgres)**, depois **public**.
3. Selecione **lab_requests**. Abre-se um separador com as suas linhas.

**Resultado esperado:** o rodapé mostra **1–50 of 60**. Cada linha é um pedido, com colunas como `request_id`, `patient_id`, `panel_desc`, `status`, `priority` e `authored_at`.

As tabelas que mais vai usar:

| Tabela | Uma linha por |
| --- | --- |
| `lab_requests` | Pedido de exame |
| `lab_results` | Resultado, por exemplo um valor de hemoglobina |
| `specimens` | Amostra |
| `diagnostic_reports` | Relatório emitido |
| `patients` | Paciente |
| `facility_registry` | Unidade do registo. Veja [Unidades](/docs/facilities). |

Percorrer uma tabela não tem ordem fixa. Para ver o SQL por trás, selecione o botão de código no canto superior direito do separador.

## Exemplo 2: escrever uma consulta

Conte os pedidos de cada exame.

![Abrir um separador novo, escolher o conector, escrever SQL e executá-lo.](query-write.mp4)

1. Selecione **+** na barra de separadores. Abre-se um separador chamado **Query #1**.
2. Abra a lista de conectores e escolha **Target Warehouse (Postgres)**.
3. Escreva isto no editor:

```sql
SELECT panel_desc AS test, COUNT(*) AS orders
FROM lab_requests
GROUP BY panel_desc
ORDER BY orders DESC
```

4. Selecione **Executar**, o botão de reprodução.

**Resultado esperado:** cinco linhas. Full blood count 18, Malaria rapid test 16, HIV viral load 11, Blood glucose 9, Creatinine 6.

**Executar** fica desativado enquanto o separador não tiver conector e SQL.

## Exemplo 3: juntar um parâmetro

Transforme a consulta para que pergunte que exame contar e divida os pedidos por prioridade.

![Mudar o SQL, juntar um parâmetro select com SQL das opções, e guardá-lo.](query-params.mp4)

1. Substitua o SQL por:

```sql
SELECT priority, COUNT(*) AS orders
FROM lab_requests
WHERE panel_desc = {{ param.test }}
GROUP BY priority
ORDER BY orders DESC
```

2. Selecione o botão **Parâmetros**, o ícone de controlos deslizantes à direita da barra do separador. Abre-se a janela **Parâmetros**.
3. Selecione **Adicionar**.
4. Em **ID da variável**, escreva `test`. Tem de coincidir com o nome em `{{ param.test }}`.
5. Em **Etiqueta**, escreva `Test`. É o que as pessoas veem quando a executam.
6. Defina **Tipo** como **select**. Aparece uma caixa **SQL das opções**. Escreva `SELECT DISTINCT panel_desc FROM lab_requests ORDER BY 1`. A primeira coluna enche a lista.
7. Marque **Obrigatório**.
8. Selecione **Guardar**.

![A janela Parâmetros com um parâmetro select.](query-params-sheet.png)

Tipos de parâmetro:

| Tipo | Pede | SQL |
| --- | --- | --- |
| text | Qualquer texto | `{{ param.<id> }}` |
| select | Um valor de uma lista. **SQL das opções** enche a lista. | `{{ param.<id> }}` |
| daterange | Um primeiro e um último dia | `{{ param.from }}` e `{{ param.to }}` |

As setas de um parâmetro mudam a sua ordem. O caixote remove-o.

### Executá-la com um valor

![Executar a consulta, escolher HIV viral load e executar com esse valor.](query-run-values.mp4)

1. Selecione **Executar**. Como a consulta tem parâmetros, um painel lateral, **Parâmetros de execução**, pede primeiro os valores.
2. Defina **Test** como **HIV viral load**.
3. Abra **Ações de execução**, o menu de três pontos do painel, e selecione **Executar com estes valores**.

**Resultado esperado:** três linhas. routine 7, urgent 2, stat 2. São os 11 pedidos de HIV viral load.

Um parâmetro opcional deixado em branco corre como texto vazio. Isso quer dizer nenhum filtro quando o SQL testa `''`.

## Exemplo 4: guardar a consulta

![Guardar a consulta com um nome. Aparece em Consultas personalizadas.](query-save.mp4)

1. Abra **Ações da consulta**, os três pontos junto ao botão dos parâmetros, e selecione **Guardar**.
2. A primeira vez pede um nome em **Guardar consulta**. Escreva `Orders by priority for one test`.
3. Abra o menu de três pontos do painel e selecione **Guardar**.

**Resultado esperado:** a mensagem **Consulta personalizada "Orders by priority for one test" salva**, o separador ganha o nome novo, e a consulta aparece em **Consultas personalizadas** no Explorador. As vezes seguintes atualizam a mesma consulta.

Um nome tem de ser único. Um nome repetido deixa o painel aberto com o seu rascunho. Escolha outro nome.

Para usar esta consulta num relatório, veja o [Designer de relatórios](/docs/report-designer). Os filtros de um relatório vêm dos parâmetros do seu modelo, não da consulta. Dê ao parâmetro da consulta o mesmo **ID da variável** que a chave do parâmetro do modelo, e o valor do filtro passa quando o relatório corre.

Para terminar este guia, elimine a consulta: abra o seu menu no Explorador e selecione **Eliminar consulta**.

## Mudar o nome, agrupar e eliminar

Cada consulta guardada no Explorador tem o seu próprio menu.

![O menu de uma consulta guardada.](query-row-actions.png)

- **Renomear.** Muda só o nome. A consulta mantém o identificador, por isso os relatórios continuam a encontrá-la. Não precisa de a abrir num separador. Não elimine uma consulta para lhe mudar o nome.
- **Mover para o grupo.** Põe-na num grupo, ou tira-a com **Sem grupo**.
- **Eliminar consulta.** Remove-a, depois de confirmar.

**Renomear**, em **Ações da consulta** de um separador, faz o mesmo para a consulta aberta. Muda só o nome guardado. As alterações por guardar ao SQL, ao conector e aos parâmetros ficam no separador até selecionar **Guardar**.

### Grupos

Um pacote de conteúdo pode juntar muitas consultas de uma vez. Os grupos mantêm a lista legível.

- Para criar um grupo, abra o menu de **Consultas personalizadas** e escolha **Novo grupo**. Escreva um nome e escolha **Guardar** no menu do painel.
- Para pôr uma consulta num grupo, arraste-a para o grupo. Num telemóvel, carregue sem soltar na consulta, ou use **Mover para o grupo**.
- Para tirar uma consulta do grupo, arraste-a para **Consultas personalizadas**, ou escolha **Mover para o grupo** e depois **Sem grupo**.
- Cada grupo tem um menu com **Renomear grupo** e **Eliminar grupo**. Eliminar um grupo mantém as suas consultas. Saem do grupo.

Os grupos só arrumam a lista. Mover uma consulta não muda o nome, o SQL nem o identificador, por isso os relatórios continuam a funcionar. Os grupos pertencem a esta instalação. A sincronização central-laboratório não os envia nem os altera.

## Exportar e importar consultas

O cabeçalho do Explorador tem o seu próprio menu, **Ações de transferência**.

![O menu do Explorador: Atualizar, Exportar consultas, Importar consultas.](query-transfer-menu.png)

- **Atualizar** recarrega o Explorador quando as consultas mudam noutro lado, por exemplo pela linha de comandos ou por um pacote de conteúdo.
- **Exportar consultas** transfere um ficheiro com o nome, o SQL, os parâmetros e o nome do grupo de cada consulta. Não tem o identificador nem o conector.
- **Importar consultas** lê um ficheiro assim.

A importação segue estas regras:

- Um nome novo é criado.
- Um nome que já existe é ignorado, a não ser que escolha substituí-lo.
- Substituir mantém o identificador e o conector da consulta, por isso os relatórios que a usam continuam a funcionar.
- Substituir uma consulta que vem com o CE é desfeito da próxima vez que o CE volta a carregar as suas consultas incluídas.
- Se uma consulta substituída mudar o identificador de um parâmetro, os relatórios que definiam o parâmetro antigo perdem-no.
- Uma consulta inválida para o ficheiro inteiro. Nada é escrito.
- As consultas novas usam **Target Warehouse (Postgres)**, a não ser que escolha outro conector.
- Uma consulta com nome de grupo vai para esse grupo, criado se for preciso. Uma consulta nova junta-se sempre ao seu grupo. Uma consulta substituída só se junta ao grupo se ainda não tiver nenhum, por isso uma consulta que moveu fica onde a pôs.

Na linha de comandos:

```bash
openldr query export --out queries.json [--name <name>...]
openldr query import queries.json [--connector <name>] [--force]
```

`--out` substitui um ficheiro que já exista. `--force` substitui as consultas que já existem.

O conteúdo escrito para um sistema de laboratório partilha-se com estes ficheiros. Ficam na pasta `packs/` do operador, não no próprio CE.

## Conjuntos de dados

Expanda **Conjuntos de dados** para consultar tabelas que um fluxo de trabalho construiu. Use-as para dados lentos ou complexos, para que um relatório leia uma tabela pronta em vez da fonte em direto. Veja [Fluxos de trabalho](/docs/workflows).

## Paginação e SQL Server

Percorrer tabelas e os resultados das consultas funcionam com conectores PostgreSQL, MySQL ou MariaDB, e SQL Server.

- O PostgreSQL e o MySQL ou MariaDB mostram um total contado, como **1–50 of 60**.
- O SQL Server mostra um intervalo de linhas e "total desconhecido". A ferramenta não contou o resultado todo. **Seguinte** só fica disponível quando o servidor encontrou mais uma linha depois desta página. Uma última página exatamente cheia desativa **Seguinte** na mesma. **Anterior** volta uma página.
- Mudar o número de linhas por página volta à primeira página.
- O SQL Server lê até ao deslocamento pedido, por isso as páginas mais à frente podem ser mais lentas. A paginação não tira uma fotografia da base de dados.

Para uma paginação estável, junte um `ORDER BY` que acabe numa chave única. Por exemplo, se `id` for único, `ORDER BY created_at, id` desempata as horas iguais. A ferramenta não consegue adivinhar uma chave única para o seu SQL. Sem ela, linhas podem repetir-se ou faltar entre páginas, tal como linhas que mudam enquanto pagina.

## Num telemóvel

Num telemóvel, o Explorador começa dobrado numa faixa estreita à esquerda. Selecione o botão de painel no topo da faixa, **Expandir explorador**, para o abrir. Volte a dobrá-lo para dar o ecrã todo à consulta.

![O Explorador aberto num telemóvel, com Consultas personalizadas expandidas.](query-phone.png)

## Resolução de problemas

- **Executar está desativado.** Escolha primeiro um conector e escreva SQL.
- **"unbound parameter".** Cada `{{ param.x }}` no SQL precisa de um parâmetro com esse **ID da variável**.
- **"required parameter" ao executar.** Preencha todos os parâmetros marcados como **Obrigatório**.
- **A consulta é recusada.** Só correm instruções `SELECT`. Tudo o que altere dados ou tabelas é recusado.
- **Não há conectores no Explorador.** Crie ou ative um conector de base de dados. Veja [Conectores](/docs/connectors).
- **A lista de um parâmetro select está vazia.** O seu **SQL das opções** não devolveu linhas. Execute esse SQL num separador à parte para o verificar.
- **As páginas repetem ou saltam linhas.** Junte um `ORDER BY` que acabe numa chave única. Veja [Paginação e SQL Server](#paginacao-e-sql-server).
- **Precisa do registo de unidades.** Leia a tabela `facility_registry` do armazém. Veja [Unidades](/docs/facilities).

## Guias relacionados

- [Relatórios](/docs/reports)
- [Designer de relatórios](/docs/report-designer)
- [Conectores](/docs/connectors)
- [Painéis](/docs/dashboard)
