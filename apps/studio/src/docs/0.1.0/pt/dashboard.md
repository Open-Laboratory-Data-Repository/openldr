# Painel

Abra Dashboard para consultar os widgets partilhados. A permissão de edição permite alterar os widgets e a disposição através do menu do painel. No editor, escolha Builder para uma consulta guiada ou SQL se o administrador o permitir.

![Painel](dashboard-overview.png)

## Limites das consultas Builder

Os widgets Builder usam o tempo máximo SQL e o limite de linhas do painel. Os valores predefinidos são 5 000 milissegundos e 10 000 grupos. Os administradores podem alterar estas definições existentes.

O limite conta os grupos da base antes do agrupamento por período, dos totais por série e da seleção dos primeiros resultados. Se a consulta exceder o limite, o widget apresenta um erro em vez de totais parciais. Restrinja os filtros ou reduza o agrupamento. Pedir menos primeiros resultados não evita este limite.

O PostgreSQL cancela as instruções no tempo configurado. O MySQL e o MariaDB usam os respetivos limites por instrução. No SQL Server, esta definição limita apenas a espera por bloqueios. Não limita a duração da execução.

## Guias relacionados

- [Relatórios](/docs/reports)
- [Workflows](/docs/workflows)
