# Consultas personalizadas

O espaço Query permite escrever e guardar consultas SQL. Os relatórios podem usar estas consultas guardadas.

![Explorador de conectores e consultas personalizadas](query-workbench.png)

## Guardar uma consulta

1. Abra **Query** e selecione **+** na barra de separadores.
2. O novo separador recebe um nome gerado, como `Query #1`.
3. Escolha um conector e escreva a consulta `SELECT`.
4. Abra o menu de ações da consulta e escolha Guardar. Na primeira gravação, o painel pede um Nome único. Introduza-o e escolha Guardar no menu do painel.
5. Reabra a consulta em **Custom Queries** no explorador. Ao guardar novamente, atualiza a mesma consulta.

Ao executar, um parâmetro opcional deixado em branco vale uma cadeia vazia. Por isso não filtra nada se o SQL testar `''`.

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


## Exportar e importar consultas

Use o menu de ações no cabeçalho do Explorador. Escolha Exportar consultas ou Importar consultas.

O ficheiro contém o nome, o SQL e os parâmetros de cada consulta. Não contém o id nem o conector.

A importação segue estas regras:

- Um nome novo é criado.
- Um nome que já existe é ignorado, a menos que escolha substituí-lo.
- Substituir mantém o id e o conector da consulta, por isso os relatórios que a usam continuam a funcionar.
- Substituir uma consulta integrada que vem com o CE é desfeito da próxima vez que o CE carregar as suas consultas integradas.
- Se uma consulta substituída mudar o id de um parâmetro, os relatórios que definem o parâmetro antigo perdem-no.
- Uma só consulta inválida pára o ficheiro inteiro. Nada é escrito.

As consultas novas usam `Target Warehouse (Postgres)`, a menos que escolha outro conector.

Na linha de comandos:

```
openldr query export --out queries.json [--name <name>...]
openldr query import queries.json [--connector <name>] [--force]
```

`--out` substitui um ficheiro existente. `--force` substitui as consultas que já existem.

O conteúdo escrito para um sistema de laboratório é partilhado como estes ficheiros. Ficam na pasta `packs/` do operador, não no CE.
