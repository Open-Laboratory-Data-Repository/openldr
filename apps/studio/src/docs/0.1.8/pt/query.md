# Consultas personalizadas

O espaço Query permite escrever e guardar consultas SQL. Os relatórios podem usar estas consultas guardadas.

![Explorador de conectores e consultas personalizadas](query-workbench.png)

## Guardar uma consulta

1. Abra **Query** e selecione **+** na barra de separadores.
2. O novo separador recebe um nome gerado, como `Query #1`.
3. Escolha um conector e escreva a consulta `SELECT`.
4. Abra o menu de ações da consulta e escolha Guardar. Na primeira gravação, o painel pede um Nome único. Introduza-o e escolha Guardar no menu do painel.
5. Reabra a consulta em **Custom Queries** no explorador. Ao guardar novamente, atualiza a mesma consulta.

![Editor SQL com uma consulta guardada e os seus resultados](query-sql-editor.png)

## Renomear uma consulta

Renomear altera apenas o nome guardado. As alterações de SQL, conector e parâmetros ficam no separador até escolher Guardar no menu da consulta.

Escolha Renomear no menu de ações. Altere o Nome e guarde pelo menu do painel. A consulta mantém o identificador e as referências nos relatórios. Se o nome já existir, o painel mantém o texto introduzido e pede outro nome.

Mantenha as consultas usadas por relatórios. Eliminá-las não é uma solução para mudar o nome.

## Guias relacionados

- [Relatórios](/docs/reports)
- [Editor de relatórios](/docs/report-designer)
- [Conectores](/docs/connectors)

## Paginação SQL Server

A consulta de tabelas e os resultados aceitam conectores PostgreSQL, MySQL/MariaDB e SQL Server.
As páginas SQL Server mostram um intervalo e "total desconhecido": o total dos resultados não foi calculado.
Next fica disponível apenas quando o servidor encontra mais uma linha além da página atual. Previous volta à página anterior.
Uma última página completamente preenchida também desativa Next. Alterar Rows per page volta à primeira página.
PostgreSQL e MySQL/MariaDB continuam a mostrar os totais calculados.

Para repetir a paginação com a mesma ordem, abra SQL no separador da tabela e adicione ORDER BY terminando numa chave única.
Por exemplo, se id for único na tabela, ORDER BY created_at, id desempata datas iguais.
Num separador de consulta, acrescente essa ordem antes de Run. O editor não pode deduzir uma chave única para qualquer SQL.
A consulta simples de uma tabela não garante uma ordem. Podem aparecer linhas repetidas ou faltar linhas sem uma ordem única, ou se os dados mudarem entre pedidos.
SQL Server lê até ao deslocamento pedido, pelo que páginas distantes podem demorar mais. A paginação não cria uma cópia estável da base de dados.
