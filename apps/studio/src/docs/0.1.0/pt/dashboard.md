# Painel

## Criar outro painel

Abra o menu de três pontos junto ao seletor e escolha **Novo painel**.
A ação está disponível nos modos de visualização e edição. Aguarde até guardar as alterações pendentes.
A ação fica desativada durante a criação para evitar duplicados.

O novo painel vazio abre no modo de edição. Uma confirmação indica o seu nome.
Abra o menu de três pontos e escolha **Add widget** para adicionar conteúdo.
Se a criação falhar, o painel atual continua selecionado. Leia o erro e tente novamente pelo menu.

![Vista do painel](dashboard-overview.png)
![Editor de widget](dashboard-edit-widget.png)

## Guias relacionados

- [Relatórios](/docs/reports)
- [Workflows](/docs/workflows)

As alterações feitas durante a criação continuam abertas. Guarde-as e selecione o novo painel.

A edição de widgets e filtros fica desativada durante a criação.

## Atualização automática

Cada widget carrega imediatamente. Com a atualização automática ativa, o intervalo começa após o pedido terminar. Um pedido lento adia a próxima atualização. O widget não inicia pedidos simultâneos. Um intervalo de zero desativa a atualização automática.

Alterar a consulta ou os filtros cancela o pedido obsoleto no navegador. Sair do painel cancela os pedidos pendentes. Os resultados e erros tardios não substituem os resultados recentes. Uma atualização bem-sucedida remove o erro anterior.

Cancelar um pedido no navegador não garante que a consulta pare na base de dados.

## Limites das consultas Builder

Os widgets Builder usam o tempo máximo SQL e o limite de linhas do painel. Os valores predefinidos são 5 000 milissegundos e 10 000 grupos. Os administradores podem alterar estas definições existentes.

O limite conta os grupos da base antes do agrupamento por período, dos totais por série e da seleção dos primeiros resultados. Se a consulta exceder o limite, o widget apresenta um erro em vez de totais parciais. Restrinja os filtros ou reduza o agrupamento. Pedir menos primeiros resultados não evita este limite.

O PostgreSQL cancela as instruções no tempo configurado. O MySQL e o MariaDB usam os respetivos limites por instrução. No SQL Server, esta definição limita apenas a espera por bloqueios. Não limita a duração da execução.
