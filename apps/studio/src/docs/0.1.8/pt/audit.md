# Auditoria

**Auditoria** regista quem mudou o quê, e quando: fluxos de trabalho, formulários, utilizadores, funções, relatórios, conectores, definições, pacientes consultados, e mais. Cada evento tem um ator, uma ação, aquilo em que tocou e, muitas vezes, uma cópia disso antes e depois.

As entradas e saídas são tratadas pelo Keycloak, não pelo OpenLDR, que nunca vê a palavra-passe. Encontre-as na consola de administração do Keycloak, em **Realm**, **Events**. Este registo guarda as autenticações recusadas (`auth.failed`) e todas as ações de operadores, incluindo pela linha de comandos, com o tipo de ator `cli`.

Este guia leva cerca de 10 minutos. Selecione uma imagem ou um clip para o ampliar.

![Auditoria: os eventos mais recentes primeiro, com Quando, Ator, Ação, Tipo de entidade e ID da entidade.](audit-tour.png)

## Quem pode fazer o quê

Uma só permissão cobre esta página: **View audit log**. Só lê. Nada aqui pode alterar ou apagar um evento.

## Antes de começar

O exemplo encontra as alterações ao fluxo **Ingest**. Se seguiu [Fluxos de trabalho, exemplo 1](/docs/workflows#exemplo-1-preparar-o-webhook-ingest), há pelo menos uma. Caso contrário, escolha qualquer evento que veja.

## Exemplo 1: quem alterou o fluxo Ingest?

![Filtrar por ID da entidade wf-ingest e abrir o evento mais recente.](audit-filter-workflow.mp4)

1. Abra **Auditoria**. Os eventos mais recentes estão no topo.
2. Selecione **Filtrar** e depois **Adicionar filtro**.
3. Defina a coluna como **ID da entidade**, o operador como **Contém**, e o valor como `wf-ingest`.
4. Selecione **Aplicar**. Uma etiqueta por baixo da barra mostra o filtro.
5. Selecione a linha mais recente.

**Resultado esperado:** um evento `workflow.update` por cada vez que o Ingest foi guardado, pela pessoa que o guardou. A ficha mostra o identificador do evento, a hora, o ator, a ação, o tipo de entidade `workflow` e o identificador `wf-ingest`, depois **Before**: o fluxo como estava.

![Um evento: quem, o quê, quando, e o fluxo antes da alteração.](audit-event.png)

Cada valor tem um botão para copiar, para colar um identificador noutro filtro ou noutro ecrã.

## Filtrar, ordenar e colunas

- **Filtrar** junta regras: uma coluna, um operador e um valor. As colunas de texto oferecem **Igual a**, **Diferente de**, **Contém** e mais. **Quando** oferece datas e intervalos.
- Cada regra aparece como etiqueta por baixo da barra. Tire uma etiqueta para retirar uma regra, ou use **Limpar tudo**.
- **Ordenar** ordena por qualquer coluna, num sentido ou no outro.
- **Colunas** esconde e mostra colunas. **Repor** volta a tabela ao normal.
- A filtragem, a ordenação e a paginação correm no servidor, por isso um registo grande continua rápido.

Para seguir uma cadeia de alterações, comece pela entidade, junte o ator e compare as horas dos eventos de criação, alteração, execução, publicação e eliminação.

## Ações que vale a pena conhecer

| Ação | O que aconteceu |
| --- | --- |
| `workflow.create`, `workflow.update`, `workflow.delete` | Um fluxo foi criado, guardado ou eliminado |
| `dashboard.create`, `dashboard.update`, `dashboard.delete` | Um painel foi criado, guardado ou eliminado |
| `customQuery.create`, `customQuery.delete` | Uma consulta guardada foi criada ou eliminada |
| `role.create`, `role.delete`, `role.capability.backfill` | Uma função foi criada ou eliminada, ou recebeu uma capacidade nova numa atualização |
| `settings.flag.update` | Uma definição como **SQL bruto no painel** foi mudada |
| `patients.list`, `patients.view` | Alguém listou ou abriu pacientes |
| `user.status`, `user.status.failed` | Uma conta foi ativada ou desativada, ou a tentativa falhou |
| `auth.failed` | Um testemunho de entrada foi recusado |

## Na linha de comandos

`openldr audit list` aceita os mesmos filtros e a mesma ordenação da página, por isso um script pode repetir qualquer vista.

- `--where column:operator:value` pode repetir-se. Só os dois primeiros dois-pontos separam o valor, por isso um valor pode ter dois-pontos, como um identificador ou um URL.
- `--sort column` ordena de forma crescente, `--sort -column` de forma decrescente. Pode repetir-se.
- Na coluna do tempo, `eq` com uma data simples como `2026-08-06` abrange o dia todo. `between` com duas datas simples inclui o último dia inteiro.

A mesma pesquisa do exemplo 1:

```bash
./openldr audit list --where entityId:like:wf-ingest --sort -occurredAt
```

Todos os eventos de formulários, do mais recente ao mais antigo:

```bash
./openldr audit list --where action:like:form. --sort -occurredAt
```

Uma coluna desconhecida, ou um operador que essa coluna não aceita, é recusado com uma mensagem que diz o problema. É a mesma verificação da página.

## Resolução de problemas

- **Não aparece nenhum evento.** Alargue o período, ou tire um filtro de cada vez.
- **O ator é inesperado.** Um fluxo agendado ou uma ação do sistema pode ter feito a alteração.
- **Antes e depois estão vazios.** Alguns eventos registam a ação sem cópia completa.
- **Demasiados eventos.** Combine um filtro por entidade com um filtro por ator.
- **Não encontro uma entrada.** As entradas bem-sucedidas estão nos eventos do Keycloak, não aqui.

## Guias relacionados

- [Utilizadores e funções](/docs/users)
- [Fluxos de trabalho](/docs/workflows)
- [Atividade](/docs/activity)
